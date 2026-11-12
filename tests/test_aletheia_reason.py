"""Aletheia reason: the deterministic anomalies and drivers, the engine layer's off states, the aggregates-only
payload, and the route answering with the engine off. No database: the route's loader is stubbed."""
import uuid

import pytest

from api.deps import Tenant
from api.routes import aletheia_engine as route
from api.services import aletheia_engine as engine
from api.services import aletheia_reason as rs


def _runs(scores: list[float], dims: list[float] | None = None) -> list[dict]:
    return [{"version_id": f"v{i}", "label": f"Run {i + 1}", "run_at": f"2026-01-{i + 1:02d}T08:00:00+00:00",
             "composite": c, "failing_rules": 20, "affected_records": 100, "critical": 0, "high": 1, "blockers": 0,
             "auto_fixable_pct": None, "dimensions": {"completeness": (dims or scores)[i]},
             "modules": {"material_master": c}} for i, c in enumerate(scores)]


def _rules(counts: list[int]) -> dict:
    return {f"v{i}": ({"R1": n} if n else {}) for i, n in enumerate(counts)}


def test_anomaly_flagged_with_expected_and_observed() -> None:
    runs = _runs([80, 81, 80, 81, 80, 60])
    out = rs.reason(runs, _rules([0] * 6), {})
    det = out["deterministic"]
    assert det["available"]
    top = det["anomalies"][0]
    assert top["version_id"] == "v5" and top["observed"] == 60 and top["expected"] == 80.4
    assert top["z"] < -3.5 and top["severity"] == "high"
    assert det["anomaly_evidence"]["runs"] == 6 and det["anomaly_evidence"]["method"]


def test_flat_history_has_no_anomaly() -> None:
    assert rs.reason(_runs([80] * 6), _rules([0] * 6), {})["deterministic"]["anomalies"] == []


def test_rule_driver_ranked_when_failures_rise_as_score_falls() -> None:
    runs = _runs([90, 89, 85, 80, 70, 60], [90, 90, 89, 89, 88, 88])
    det = rs.reason(runs, _rules([0, 1, 5, 10, 30, 60]), {"R1": "Missing plant"})["deterministic"]
    r = det["risks"][0]
    assert r["kind"] == "rule" and r["driver"] == "R1" and r["name"] == "Missing plant"
    assert r["effect"] < 0 and 0 < r["confidence"] <= 100 and det["risk_evidence"]["confidence"] == r["confidence"]


def test_dimension_driver_when_dimension_drops() -> None:
    runs = _runs([90, 90, 89, 85, 80, 70], [95, 95, 94, 90, 85, 70])
    kinds = {r["kind"] for r in rs.reason(runs, _rules([0] * 6), {})["deterministic"]["risks"]}
    assert "dimension" in kinds


def test_too_few_runs() -> None:
    out = rs.reason(_runs([80, 81, 82]), _rules([0] * 3), {})
    assert out["deterministic"]["reason"] == "too_few_runs" and not out["deterministic"]["available"]
    assert out["engine"]["reason"] == "too_few_runs" and out["engine"]["anomalies"] == []


@pytest.mark.parametrize("state,reason", [
    ({"configured": False}, "not_configured"),
    ({"configured": True, "live": False}, "unreachable"),
    ({"configured": True, "live": True, "token_set": False}, "no_token"),
    ({"configured": True, "live": True, "token_set": True, "licence": {"licensed": True, "valid": False}},
     "licence_invalid"),
])
def test_engine_off_states(monkeypatch, state, reason) -> None:
    base = {"configured": True, "live": True, "token_set": True, "licence": None}
    monkeypatch.setattr(engine, "status", lambda: {**base, **state})
    out = rs.reason(_runs([80, 81, 80, 81, 80, 60]), _rules([0] * 6), {})
    assert out["engine"]["available"] is False and out["engine"]["reason"] == reason
    assert out["deterministic"]["available"]  # the deterministic layer is unaffected


def test_engine_without_a_known_contract_is_not_called(monkeypatch) -> None:
    monkeypatch.setattr(engine, "status", lambda: {"configured": True, "live": True, "token_set": True, "licence": None})
    monkeypatch.setattr(engine, "_call", lambda *a, **k: pytest.fail("engine called without a contract"))
    assert rs.reason(_runs([80, 81, 80, 81, 80, 60]), _rules([0] * 6), {})["engine"]["reason"] == "not_configured"


def test_aggregates_hold_numbers_only() -> None:
    runs = _runs([80, 81, 80, 81, 80, 60])
    runs[0]["label"] = "PERSON-NAME-9"
    agg = rs.aggregates(runs, _rules([1, 2, 3, 4, 5, 6]))
    assert set(agg) == {"series", "rule_failures"}
    flat = [v for d in agg.values() for s in d.values() for v in s]
    assert flat and all(isinstance(v, float) for v in flat)
    assert "PERSON-NAME-9" not in repr(agg) and set(agg["rule_failures"]) == {"R1"}


class _Db:
    pass


@pytest.mark.anyio
async def test_route_answers_with_engine_off(monkeypatch) -> None:
    monkeypatch.delenv("ALETHEIA_URL", raising=False)
    runs = _runs([80, 81, 80, 81, 80, 60])

    async def fake_agg(db, tenant, fn, *a):
        return {"lineage": "material_master", "runs": runs, "rules": _rules([0, 0, 0, 0, 0, 9]), "rule_names": {}}

    monkeypatch.setattr(route, "_agg", fake_agg)
    out = await route.get_reason(None, None, 12, _Db(), Tenant(uuid.uuid4(), "T", []))
    body = route.Reason.model_validate(out)
    assert body.engine.reason == "not_configured" and body.deterministic.anomalies
