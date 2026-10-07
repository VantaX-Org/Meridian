"""auto_fix: every shipped block validates; each op, the guard, lookup, self-verification and the
four-eyes bulk accept of high-confidence remediation proposals."""

import asyncio
import uuid
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pandas as pd
import pytest
import yaml
from fastapi import HTTPException

from checks import auto_fix
from checks.frames import TableFrames
from checks.runner import REGISTRY, _find_module_yaml, run_rule
from sap.ddic import get_dictionary

RULES = Path(__file__).resolve().parents[2] / "checks" / "rules"


def _rules():
    for p in sorted(RULES.rglob("*.yaml")):
        doc = yaml.safe_load(p.read_text()) or {}
        for r in (doc.get("rules") if isinstance(doc, dict) else doc) or []:
            if isinstance(r, dict) and "auto_fix" in r:
                yield p.name, r


def test_every_shipped_auto_fix_validates():
    found = list(_rules())
    assert found, "no rule ships an auto_fix block"
    assert [e for _, r in found for e in auto_fix.validate_auto_fix(r)] == []


def _rule(*steps, field="T.F", **spec):
    return {"id": "X1", "field": field, "auto_fix": {"steps": list(steps), "confidence": "high", **spec}}


@pytest.mark.parametrize("step,before,after", [
    ({"op": "strip"}, "  ab ", "ab"),
    ({"op": "collapse_spaces"}, "a   b", "a b"),
    ({"op": "upper"}, "eur", "EUR"),
    ({"op": "lower"}, "ABC", "abc"),
    ({"op": "title"}, "john smith", "John Smith"),
    ({"op": "pad_left", "width": 10}, "4711", "0000004711"),
    ({"op": "pad_left", "width": 4, "char": "#"}, "7", "###7"),
    ({"op": "strip_leading_zeros"}, "000123", "123"),
    ({"op": "regex_replace", "pattern": r"[^0-9]", "repl": ""}, "12-34 5", "12345"),
    ({"op": "truncate", "width": 3}, "ABCDE", "ABC"),
    ({"op": "map", "values": {"KGS": "KG", "__blank__": "EA", "__other__": "ST"}}, "KGS", "KG"),
    ({"op": "map", "values": {"KGS": "KG", "__blank__": "EA"}}, "", "EA"),
    ({"op": "map", "values": {"KGS": "KG", "__other__": "ST"}}, "LB", "ST"),
    ({"op": "set", "value": "X"}, "", "X"),
    ({"op": "date_format", "to": "%Y%m%d"}, "31.12.2025", "20251231"),
    ({"op": "date_format", "to": "%Y-%m-%d"}, "/Date(1735603200000)/", "2024-12-31"),
    ({"op": "gtin_check_digit"}, "4006381333932", "4006381333931"),
])
def test_ops(step, before, after):
    assert auto_fix.validate_auto_fix(_rule(step)) == []
    assert auto_fix.propose(_rule(step), {"T.F": before}) == (after, "high")


def test_no_proposal_when_a_step_cannot_produce_a_value():
    assert auto_fix.propose(_rule({"op": "map", "values": {"A": "B", "C": None}}), {"T.F": "C"}) is None  # null map
    assert auto_fix.propose(_rule({"op": "map", "values": {"A": "B"}}), {"T.F": "Z"}) is None  # unmapped
    assert auto_fix.propose(_rule({"op": "date_format", "to": "%Y%m%d"}), {"T.F": "soon"}) is None
    assert auto_fix.propose(_rule({"op": "gtin_check_digit"}), {"T.F": "12AB"}) is None
    assert auto_fix.propose(_rule({"op": "strip"}), {"T.F": "OK"}) is None  # unchanged
    assert auto_fix.propose(_rule({"op": "regex_replace", "pattern": ".", "repl": ""}), {"T.F": "ab"}) is None  # blanked


def test_copy_and_guard():
    rule = _rule({"op": "copy", "from": "T001.WAERS"}, field="SKB1.WAERS", when="T001.WAERS.notna() & SKB1.WAERS != 'XXX'")
    assert auto_fix.columns(rule) == ["T001.WAERS", "SKB1.WAERS"]
    assert auto_fix.propose(rule, {"SKB1.WAERS": "USD", "T001.WAERS": "ZAR"}) == ("ZAR", "high")
    assert auto_fix.propose(rule, {"SKB1.WAERS": "USD", "T001.WAERS": None}) is None
    assert auto_fix.propose(rule, {"SKB1.WAERS": "XXX", "T001.WAERS": "ZAR"}) is None
    assert auto_fix.propose(rule, {"SKB1.WAERS": "USD"}) is None  # guard column missing: never fires


def test_lookup_unique_ambiguous_absent():
    t005 = pd.DataFrame({"T005.LAND1": ["DE", "ZA", "XX", "XX"], "T005.WAERS": ["EUR", "ZAR", "AAA", "BBB"]})
    rule = _rule({"op": "lookup", "table": "T005", "match": {"LAND1": "LFA1.LAND1"}, "value": "WAERS"},
                 field="LFB1.WAERS")
    assert auto_fix.reference_columns(rule) == ["T005.LAND1", "T005.WAERS"]
    refs = {"T005": t005}
    assert auto_fix.propose(rule, {"LFB1.WAERS": None, "LFA1.LAND1": " ZA"}, refs) == ("ZAR", "high")
    assert auto_fix.propose(rule, {"LFB1.WAERS": None, "LFA1.LAND1": "XX"}, refs) is None  # ambiguous
    assert auto_fix.propose(rule, {"LFB1.WAERS": None, "LFA1.LAND1": "FR"}, refs) is None  # absent
    assert auto_fix.propose(rule, {"LFB1.WAERS": None, "LFA1.LAND1": "ZA"}) is None  # no reference table


def test_legacy_fix_value_is_sugar():
    assert auto_fix.propose({"field": "T.F", "fix_value": "KG"}, {"T.F": None}) == ("KG", "medium")
    assert auto_fix.propose({"field": "T.F", "fix_value": {"__blank__": "EA"}}, {"T.F": " "}) == ("EA", "medium")


def test_validation_errors():
    def errs(**kw):
        return auto_fix.validate_auto_fix({"id": "X1", "field": "T.F", **kw})
    assert any("unknown op" in e for e in errs(auto_fix={"steps": [{"op": "guess"}], "confidence": "high"}))
    assert any("exclusive" in e for e in errs(fix_value="A", auto_fix={"steps": [{"op": "strip"}], "confidence": "low"}))
    assert any("confidence" in e for e in errs(auto_fix={"steps": [{"op": "strip"}], "confidence": "sure"}))
    assert any("needs 'width'" in e for e in errs(auto_fix={"steps": [{"op": "pad_left"}], "confidence": "low"}))
    assert any("bad pattern" in e for e in errs(auto_fix={"steps": [{"op": "regex_replace", "pattern": "(", "repl": ""}],
                                                          "confidence": "low"}))
    assert any("does not parse" in e for e in errs(auto_fix={"when": "T.F ==", "steps": [{"op": "strip"}],
                                                             "confidence": "low"}))
    assert any("unknown key" in e for e in errs(auto_fix={"steps": [{"op": "strip"}], "confidence": "low", "x": 1}))


def test_self_verify_discards_proposals_that_still_fail():
    rule = {"id": "R1", "field": "T.F", "check_class": "regex_check", "pattern": "^[A-Z]{3}$",
            "auto_fix": {"steps": [{"op": "strip"}, {"op": "upper"}], "confidence": "high"}}
    df = pd.DataFrame({"T.F": [" eur", "euro", "USD"]})
    check = REGISTRY["regex_check"](rule)
    out = auto_fix.proposals(rule, df, check.evaluate(df).failing, evaluate=check.evaluate)
    assert out == {0: ("EUR", "high")}  # 'EURO' still fails the rule: dropped


D = get_dictionary("ecc6")


def _fi_gl(rid):
    return {**next(r for r in yaml.safe_load(_find_module_yaml("fi_gl").read_text())["rules"] if r["id"] == rid),
            "module": "fi_gl"}


def _fixes(rid, frames):
    _, r = run_rule(_fi_gl(rid), TableFrames(frames, D, module="fi_gl"))
    return {f["record_key"]: (f["proposed_value"], f["confidence"], f["sql_statement"])
            for f in r.record_fixes or [] if f.get("auto_fix")}


def test_fi_gl_examples_end_to_end():
    skb1 = pd.DataFrame({"SKB1.BUKRS": ["1000"] * 3, "SKB1.SAKNR": ["0000100000", "0000100001", "0000100002"],
                         "SKB1.WAERS": [" eur", "EURO", "ZAR"], "SKB1.XOPVW": ["X", "X", None],
                         "SKB1.XKRES": [None, None, None]})
    assert _fixes("GL010", {"SKB1": skb1}) == {
        "BUKRS=1000|SAKNR=0000100000": ("EUR", "high",
                                        "UPDATE SKB1 SET WAERS = 'EUR' WHERE BUKRS = '1000' AND SAKNR = '0000100000';")}
    assert {k: v[:2] for k, v in _fixes("GL057", {"SKB1": skb1}).items()} == {
        "BUKRS=1000|SAKNR=0000100000": ("X", "high"), "BUKRS=1000|SAKNR=0000100001": ("X", "high")}
    ska1 = pd.DataFrame({"SKA1.KTOPL": ["INT", "INT"], "SKA1.SAKNR": ["0000400000", "0000400001"],
                         "SKA1.XBILK": [None, None]})
    skb1 = pd.DataFrame({"SKB1.BUKRS": ["1000", "1000"], "SKB1.SAKNR": ["0000400000", "0000400001"],
                         "SKB1.WAERS": ["USD", "ZAR"]})
    t001 = pd.DataFrame({"T001.BUKRS": ["1000"], "T001.KTOPL": ["INT"], "T001.WAERS": ["ZAR"]})
    assert {k: v[:2] for k, v in _fixes("GL214", {"SKA1": ska1, "SKB1": skb1, "T001": t001}).items()} == {
        "BUKRS=1000|SAKNR=0000400000": ("ZAR", "medium")}  # copied from the company code currency


def test_bulk_accept_high_confidence_respects_four_eyes(monkeypatch):
    from api.routes import remediation as routes
    creator, other = str(uuid.uuid4()), str(uuid.uuid4())
    batch = {"status": "draft", "created_by": creator}
    monkeypatch.setattr(routes, "_batch", AsyncMock(side_effect=lambda *a: batch))
    monkeypatch.setattr(routes, "current_user_label", lambda: "u")
    tenant = SimpleNamespace(id=uuid.uuid4())

    def call(uid):
        monkeypatch.setattr(routes, "current_user_id", lambda request=None: uid)
        db = AsyncMock()
        db.execute.return_value = MagicMock(fetchall=lambda: [(uuid.uuid4(),), (uuid.uuid4(),)])
        return db, asyncio.run(routes.accept_high_confidence(uuid.uuid4(), MagicMock(), db=db, tenant=tenant))

    with pytest.raises(HTTPException) as e:
        call(creator)
    assert e.value.status_code == 403
    db, out = call(other)
    assert out["accepted"] == 2
    sql = str(db.execute.call_args_list[0].args[0])
    assert "confidence = 'high'" in sql and "proposal_source = 'rule'" in sql
    batch["status"] = "approved"
    with pytest.raises(HTTPException) as e:
        call(other)
    assert e.value.status_code == 409
    assert routes._auto_approvable({"proposal_source": "rule", "confidence": "high", "proposed_value": "X"})
    assert not routes._auto_approvable({"proposal_source": "rule", "confidence": "medium", "proposed_value": "X"})
