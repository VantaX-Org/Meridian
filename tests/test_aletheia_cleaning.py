"""Aletheia cleaning plan: explanation, suggestion with confidence, fix batches, change narrative and the engine
/learn layer. No database: the plan is pure and the engine call is monkeypatched to see exactly what is sent."""
import json

from api.routes.aletheia_engine import CleaningPlan
from api.services import aletheia_cleaning as ac
from api.services import aletheia_engine as engine


def _finding(cid, field, affected, total=100, vfm=None, severity="high"):
    return {"check_id": cid, "field": field, "affected_count": affected, "total_count": total, "pass_rate": 0.5,
            "severity": severity, "dimension": "validity", "value_fix_map": vfm or {}, "record_fixes": []}


RULES = {
    "R-NULL": {"id": "R-NULL", "field": "MARA.MTART", "check_class": "null_check", "message": "Type is required"},
    "R-DOM": {"id": "R-DOM", "field": "MARA.MEINS", "check_class": "domain_value_check", "message": "Unit allowed"},
    "R-FMT": {"id": "R-FMT", "field": "MARA.MATKL", "check_class": "regex_check", "message": "Group format",
              "auto_fix": {"steps": [{"op": "strip"}, {"op": "upper"}], "confidence": "high"}},
    "R-ONE": {"id": "R-ONE", "field": "MARA.SPART", "check_class": "domain_value_check", "message": "Division"},
}
HISTORY = [
    {"version_id": "v1", "label": "Run 1", "run_at": "2026-10-01", "rules": {"R-NULL": 10, "R-DOM": 5, "R-OLD": 3}},
    {"version_id": "v2", "label": "Run 2", "run_at": "2026-10-08", "rules": {"R-NULL": 12, "R-DOM": 4, "R-OLD": 2}},
    {"version_id": "v3", "label": "Run 3", "run_at": "2026-10-15",
     "rules": {"R-NULL": 40, "R-DOM": 2, "R-FMT": 6, "R-ONE": 4}},
]


def _data():
    return {"run": {"id": "v3", "label": "Run 3"}, "module": "material_master", "rules": RULES, "history": HISTORY,
            "findings": [_finding("R-NULL", "MARA.MTART", 40, severity="critical"), _finding("R-DOM", "MARA.MEINS", 2),
                         _finding("R-FMT", "MARA.MATKL", 6),
                         _finding("R-ONE", "MARA.SPART", 4, vfm={"X1": {"suggested_value": "01"},
                                                                 "X2": {"suggested_value": "01"}})],
            "values": {"R-NULL": ["", "", " "], "R-FMT": [" ab1", "cd2 ", "EF3"], "R-ONE": ["X1", "X2", "ZZ", "X1"]},
            "drafts": {}}


def test_plan_explains_suggests_and_batches() -> None:
    p = ac.build(_data(), use_engine=False)
    items = {x["rule"]: x for x in p["items"]}
    assert p["items"][0]["rule"] == "R-NULL"  # critical first
    assert items["R-NULL"]["kind"] == "fill" and "40 of 100 records fail R-NULL" in items["R-NULL"]["explanation"]
    assert "3 are blank" in items["R-NULL"]["explanation"]
    assert items["R-DOM"]["kind"] == "pick" and items["R-DOM"]["suggestion"] is None
    fmt = items["R-FMT"]
    assert fmt["kind"] == "auto" and fmt["suggestion"]["source"] == "rule_auto_fix"
    assert fmt["suggestion"]["confidence"] == 90 and "leading or trailing spaces" in fmt["explanation"]
    one = items["R-ONE"]["suggestion"]
    assert one["source"] == "value_fix_map" and (one["covered"], one["base"], one["confidence"]) == (3, 4, 75)
    assert [b["kind"] for b in p["batches"]] == ["auto", "auto", "fill", "pick"]
    fill = next(b for b in p["batches"] if b["kind"] == "fill")
    assert "R-NULL" in fill["instruction"] and fill["affected"] == 40
    # no failing value leaves the plan: pattern masks only
    assert "ab1" not in json.dumps(p) and "X1" not in json.dumps(p)
    CleaningPlan.model_validate(p)


def test_draft_beats_rule_fix() -> None:
    d = _data()
    d["drafts"] = {"R-DOM": {"rule_id": "R-DOM", "status": "pending", "steps": [{"op": "upper"}],
                             "verification": {"failing": 2, "fixed": 1, "broken": 0}}}
    s = {x["rule"]: x for x in ac.build(d, use_engine=False)["items"]}["R-DOM"]["suggestion"]
    assert s["source"] == "fix_draft" and s["confidence"] == 50 and s["value"] == "upper"


def test_changes_narrative() -> None:
    c = ac.changes(HISTORY)
    assert [r["rule"] for r in c["new"]] == ["R-FMT", "R-ONE"] and [r["rule"] for r in c["resolved"]] == ["R-OLD"]
    assert c["worse"][0] == {"rule": "R-NULL", "before": 12, "after": 40}
    assert c["narrative"].startswith("Failing records rose from 18 to 52 since Run 2.")
    assert not ac.changes(HISTORY[:1])["available"]


def test_engine_gets_counts_only(monkeypatch) -> None:
    sent = []
    monkeypatch.setattr(engine, "_gate", lambda n, m: None)
    monkeypatch.setattr(engine, "_tenant", lambda: "t1")

    def call(path, body=None, timeout=4):
        sent.append((path, body))
        return {"benchmarks": {"rule:R-NULL": {"mean": 11, "low": 8, "high": 14, "n": 3}, "composite": {}}}

    monkeypatch.setattr(engine, "_call", call)
    eng = ac.build(_data())["engine"]
    path, body = sent[0]
    assert path == "/api/t1/learn"
    assert set(body) == {"rule:R-NULL", "rule:R-DOM", "rule:R-OLD", "rule:R-FMT", "rule:R-ONE"}
    assert all(isinstance(v, float) for vs in body.values() for v in vs)
    assert eng["available"] and eng["ranges"] == [{"rule": "R-NULL", "mean": 11, "low": 8, "high": 14, "n": 3,
                                                   "latest": 40.0, "outside": True}]
    monkeypatch.setattr(engine, "_call", lambda *a, **k: None)
    assert ac.learn(HISTORY)["reason"] == "engine_error"


def test_engine_gate() -> None:
    assert ac.learn(HISTORY[:2])["available"] is False


def test_workbook_rows_follow_batches() -> None:
    p = ac.build(_data(), use_engine=False)
    rows = ac.workbook_rows(p)
    assert [r["order"] for r in rows] == list(range(1, len(p["batches"]) + 1))
    assert rows[0]["instruction"] == p["batches"][0]["instruction"] and rows[0]["kind"] == "Suggested fix"
