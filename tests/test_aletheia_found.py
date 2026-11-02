"""What Aletheia found: ranking, actions, confidence, proof of value, and the assistant's grounded answer."""
import asyncio

from api.services import aletheia_found as af
from api.services import assistant as a


def _row(cid, impact, delta=None, fix=0.0):
    return {"check_id": cid, "name": f"{cid} rule", "impact": impact, "delta_affected": delta, "auto_fix_pct": fix}


def test_rank_by_impact_then_rise_then_id():
    rows = [_row("B", 10, 1), _row("A", 10, 5), _row("C", 50), _row("D", 10, 5)]
    assert [r["check_id"] for r in af.rank(rows, 3)] == ["C", "A", "D"]


def test_movers_by_absolute_change():
    rows = [_row("A", 1, 3), _row("B", 1, -9), _row("C", 1, None), _row("D", 1, 0)]
    assert [m["check_id"] for m in af.movers(rows)] == ["B", "A"]


def test_action_prefers_tune_then_cleanse_then_open():
    assert af.action_for(_row("A", 1, fix=40), {"A": {}}) == {"kind": "tune"}
    assert af.action_for(_row("A", 1, fix=40), {}) == {"kind": "cleanse"}
    assert af.action_for(_row("A", 1), {}) == {"kind": "open"}


def test_confidence_precision_then_origin_else_none():
    computed = {"status": "computed", "share": 0.8}
    assert af.confidence_of(computed, {"precision_before": 0.61}) == {"basis": "precision", "value": 0.61}
    assert af.confidence_of(computed, None) == {"basis": "origin_share", "value": 0.8}
    assert af.confidence_of({"status": "not_computed", "share": None}, None) is None


def test_score_of():
    assert af.score_of({"dqs_summary": {"mm": {"composite_score": 71.234}}}, "mm") == 71.23
    assert af.score_of(None, "mm") is None
    assert af.score_of({"dqs_summary": {}}, "mm") is None


def test_proof_waits_for_a_newer_run_then_measures():
    acted = {"version_id": "v1", "affected_before": 100, "score_before": 70.0}
    w = af.proof(acted, 40, 75.0, "v1")
    assert w["waiting"] and w["reduction"] is None and w["gain"] is None
    assert af.proof(acted, 40, 75.0, None)["waiting"]
    p = af.proof(acted, 40, 75.5, "v2")
    assert not p["waiting"] and p["reduction"] == 60 and p["gain"] == 5.5
    assert af.proof({**acted, "score_before": None}, 40, 75.5, "v2")["gain"] is None


def test_every_query_filters_by_tenant():
    """Belt and braces under RLS: each FROM in the service's SQL reads the caller's tenant only."""
    import inspect
    src = inspect.getsource(af)
    assert src.count(" FROM ") == src.count("tenant_id = :t") > 0


class _Src:
    async def findings(self, module):
        return {"currency": "ZAR", "changes": [{"module": "material_master", "delta": -2.5}], "findings": [
            {"check_id": "MM003", "module": "material_master", "field": "MARA.MTART", "affected": 1200,
             "delta_affected": 40, "why": {"origin": {"status": "computed", "top": "MM01 jsmith", "share": 0.82}},
             "money": {"cost_at_risk": 12000.0}}]}


def test_assistant_found_is_grounded_and_holds_no_origin_name():
    assert a.match("What did you find?").intent == "found"
    assert a.match("What should I fix first?").intent == "top_rules"
    out = asyncio.run(a._found(_Src(), None, a.Match("found")))
    assert out["grounded"] and out["intent"] == "found"
    blob = " ".join(f["statement"] for f in out["facts"])
    assert "jsmith" not in blob and "82%" in blob and "+40" in blob and "MARA.MTART" in blob
    assert out["citations"][0]["check_id"] == "MM003"
