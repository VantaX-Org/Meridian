"""Aletheia verified fixes: shape aggregation, op validation, verification counts, fallback, overrides merge."""

import json

import pandas as pd
import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from api.services import fix_drafter as fd
from checks import overrides
from checks.runner import REGISTRY

SECRET = "ZQ-7731-SECRETNAME"
RULE = {"id": "T1", "field": "BUT000.BU_SORT1", "check_class": "regex_check", "pattern": "^[A-Z0-9]+$",
        "severity": "high", "dimension": "validity", "message": "Search term must be upper case"}


def frame():
    vals = ["ABC", "DEF", "abc", " xyz ", "Mixed1", SECRET, "OK1", "KEEP"]
    return pd.DataFrame({"BUT000.BU_SORT1": vals})


def ev(rule=RULE):
    return REGISTRY[rule["check_class"]](rule).evaluate


def failing(df):
    return ev()(df).failing.to_numpy(dtype=bool)


def test_shape_is_aggregate_only():
    df = frame()
    shape = fd.build_shape(df["BUT000.BU_SORT1"][failing(df)])
    blob = json.dumps(shape)
    for raw in ("abc", "xyz", "Mixed1", SECRET, "SECRETNAME"):
        assert raw not in blob
    assert shape["total_failing"] == 4 and shape["leading_ws"] == 1 and shape["trailing_ws"] == 1
    assert {m["mask"] for m in shape["masks"]} >= {"aaa", "~aaa~"}
    fd.assert_aggregate(shape)
    with pytest.raises(ValueError):
        fd.assert_aggregate({**shape, "samples": ["abc"]})
    with pytest.raises(ValueError):
        fd.assert_aggregate({**shape, "masks": [{"mask": "abc!", "count": 1}]})


def test_llm_prompt_carries_no_raw_value(monkeypatch):
    seen = []
    import llm.provider as prov
    monkeypatch.setattr(prov, "llm_is_noop", lambda: False)
    monkeypatch.setattr(prov, "get_llm", lambda: object())
    monkeypatch.setattr(prov, "safe_invoke", lambda llm, prompt, **kw: seen.append(prompt) or '{"steps":[{"op":"strip"},{"op":"upper"}]}')
    monkeypatch.setattr("api.utils.llm_logger.log_llm_call", lambda *a, **k: seen.append(("logged", a[1])))
    df = frame()
    out = fd.draft(RULE, df, ev(), "t1")
    prompt = seen[0]
    for raw in ("abc", "xyz", "Mixed1", SECRET):
        assert raw not in prompt
    assert out["source"] == "llm" and out["status"] == "pending" and out["confidence"] == "low"
    assert seen[1][0] == "logged"


def test_validate_steps_rejects_unknown_and_malformed():
    assert fd.validate_steps(RULE, [{"op": "strip"}, {"op": "upper"}]) == []
    assert fd.validate_steps(RULE, [{"op": "drop_table"}])
    assert fd.validate_steps(RULE, [])
    assert fd.validate_steps(RULE, ["strip"])
    assert fd.validate_steps(RULE, [{"op": "pad_left"}])  # missing width
    assert fd.parse_steps("```json\n{\"steps\": [{\"op\": \"strip\"}]}\n```") == [{"op": "strip"}]
    assert fd.parse_steps("not json") is None


def test_verify_counts():
    df = frame()
    f = failing(df)  # abc, " xyz ", Mixed1, SECRET (hyphens fail the regex)
    v = fd.verify(RULE, [{"op": "strip"}, {"op": "upper"}], df, f, ev())
    assert v["failing"] == 4 and v["fixed"] == 3 and v["rejected"] == 0 and v["still_failing"] == 1
    assert v["broken"] == 0
    v = fd.verify(RULE, [{"op": "lower"}], df, f, ev())
    assert v["fixed"] == 0 and v["broken"] > 0  # lower breaks rows that passed


def test_fallback_when_llm_off_or_bad(monkeypatch):
    df = frame()
    import llm.provider as prov
    monkeypatch.setattr(prov, "llm_is_noop", lambda: True)
    out = fd.draft(RULE, df, ev(), "t1")
    assert out["source"] == "deterministic" and [s["op"] for s in out["steps"]] == ["upper"]  # the check ignores edge spaces, so one step is enough
    assert out["verification"]["fixed"] == 3
    # LLM answers an unknown op: rejected, deterministic wins
    monkeypatch.setattr(prov, "llm_is_noop", lambda: False)
    monkeypatch.setattr(prov, "get_llm", lambda: object())
    monkeypatch.setattr(prov, "safe_invoke", lambda *a, **k: '{"steps":[{"op":"exec"}]}')
    monkeypatch.setattr("api.utils.llm_logger.log_llm_call", lambda *a, **k: None)
    out = fd.draft(RULE, df, ev(), "t1")
    assert out["source"] == "deterministic" and out["errors"] and out["llm_tried"]
    # whitespace-only shape gives strip
    ws = {**RULE, "pattern": "^[A-Z]+$"}
    shape = fd.build_shape(pd.Series([" CD", "EF "]))
    assert fd.deterministic_candidates(shape)[0] == [{"op": "strip"}]
    # nothing fixable: no draft
    d3 = pd.DataFrame({"BUT000.BU_SORT1": ["AB", "12-3"]})
    assert fd.draft(ws, d3, ev(ws), "t1", use_llm=False)["status"] == "none"


def test_approved_draft_merges_as_auto_fix_without_enabling():
    eng = create_engine("sqlite://")
    with Session(eng) as s:
        s.execute(text("CREATE TABLE rules_hq_cache (id TEXT, enabled BOOLEAN, severity TEXT)"))
        s.execute(text("CREATE TABLE rules (name TEXT, enabled BOOLEAN, source TEXT)"))
        s.execute(text("CREATE TABLE tenant_settings (key TEXT, value TEXT)"))
        doc = {"rule_id": "T1", "status": "approved", "steps": [{"op": "strip"}]}
        s.execute(text("INSERT INTO tenant_settings VALUES ('fix_draft.T1', :v)"), {"v": json.dumps(doc)})
        s.execute(text("INSERT INTO tenant_settings VALUES ('fix_draft.T2', :v)"),
                  {"v": json.dumps({**doc, "rule_id": "T2", "status": "pending"})})
        ov = overrides.load_overrides(s)
    assert ov["T1"]["auto_fix"]["steps"] == [{"op": "strip"}] and "T2" not in ov
    out = overrides.apply([{"id": "T1", "enabled": False}, {"id": "T3"}], {"T1": ov["T1"]})
    assert [r["id"] for r in out] == ["T3"]
    out = overrides.apply([{"id": "T1"}], {"T1": ov["T1"]})
    assert out[0]["auto_fix"]["confidence"] == "low"
