"""Fix simulation: patching a copy, side-effect detection, DQS delta math, ranking."""

import pandas as pd

from api.services import fix_simulation as fs
from checks.base import CheckResult
from checks.frames import TableFrames
from checks.runner import run_checks


def _frames() -> TableFrames:
    lfa1 = pd.DataFrame({"LFA1.LIFNR": ["V1", "V2", "V3", "V4"],
                         "LFA1.NAME1": ["A", "B", "C", "D"],
                         "LFA1.LAND1": ["ZA", "", "za", "XX1"]})
    lfb1 = pd.DataFrame({"LFB1.LIFNR": ["V1", "V2", "V2"], "LFB1.BUKRS": ["1000", "1000", "2000"],
                         "LFB1.ZTERM": ["0001", "", "0002"]})
    return TableFrames({"LFA1": lfa1, "LFB1": lfb1})


def _r(check_id, failing, total, *, dim="completeness", sev="medium", module="accounts_payable", keys=None,
       field="LFA1.LAND1", error=None):
    return CheckResult(check_id=check_id, module=module, field=field, severity=sev, dimension=dim,
                       passed=failing == 0, affected_count=failing, total_count=total,
                       pass_rate=round(100 * (total - failing) / total, 2) if total else 0.0,
                       message="", details={}, error=error,
                       failing_record_keys=keys if keys is not None else [f"LIFNR=V{i}" for i in range(failing)])


# ── patching ─────────────────────────────────────────────────────────────────


def test_value_map_patches_copy_only():
    f = _frames()
    patched, stats = fs.apply_fixes(f, value_maps={"LFB1.ZTERM": {"0001": "Z030", "__blank__": "Z030"}})
    assert list(patched.frames["LFB1"]["LFB1.ZTERM"]) == ["Z030", "Z030", "0002"]
    assert list(f.frames["LFB1"]["LFB1.ZTERM"]) == ["0001", "", "0002"]  # original untouched
    assert patched.frames["LFA1"] is f.frames["LFA1"]  # untouched table shared, not copied
    assert stats["cells_changed"] == 2 and stats["tables"] == ["LFB1"]


def test_record_fix_narrows_child_grain_key_to_parent_table():
    f = _frames()
    fixes = [{"field": "LFA1.LAND1", "record_key": "LIFNR=V2|BUKRS=1000", "new_value": "DE"},
             {"field": "LFA1.LAND1", "record_key": "LIFNR=V2|BUKRS=2000", "new_value": "DE"},
             {"field": "LFA1.LAND1", "record_key": "LIFNR=V9", "new_value": "DE"},
             {"field": "LFA1.LAND1", "record_key": "row:3", "new_value": "DE"}]
    patched, stats = fs.apply_fixes(f, record_fixes=fixes)
    assert list(patched.frames["LFA1"]["LFA1.LAND1"]) == ["ZA", "DE", "za", "XX1"]
    assert stats["cells_changed"] == 1
    assert stats["unmatched_records"] == 2  # V9 does not exist, row:i cannot be located


def test_rule_record_fixes_from_fix_value_map():
    f = _frames()
    rule = {"id": "T1", "field": "LFA1.LAND1", "fix_value": {"__blank__": "ZA", "za": "ZA"}}
    res = _r("T1", 3, 4, keys=["LIFNR=V2", "LIFNR=V3", "LIFNR=V4"])
    fixes = fs.rule_record_fixes(rule, res, f)
    assert sorted((x["record_key"], x["new_value"]) for x in fixes) == [("LIFNR=V2", "ZA"), ("LIFNR=V3", "ZA")]
    assert "current_value" in fixes[0]


def test_rule_record_fixes_falls_back_to_single_option_suggestion():
    f = _frames()
    res = _r("T1", 1, 4, keys=["LIFNR=V4"]).model_copy(
        update={"value_fix_map": {"XX1": {"suggested_value": "XX"}}})
    assert fs.rule_record_fixes({"field": "LFA1.LAND1"}, res, f) == [
        {"field": "LFA1.LAND1", "record_key": "LIFNR=V4", "new_value": "XX", "current_value": "XX1"}]


def test_end_to_end_resolves_blank_country_on_real_rules():
    df = pd.DataFrame({"LFA1.LIFNR": ["V1", "V2", "V3"], "LFA1.NAME1": ["A", "B", "C"],
                       "LFA1.LAND1": ["ZA", "", "DE"], "LFA1.KTOKK": ["KRED"] * 3})
    f = TableFrames.from_flat(df)
    before = {r.check_id: r for r in run_checks("accounts_payable", f, "t")}
    assert before["AP005"].affected_count == 1
    patched, _ = fs.apply_fixes(f, value_maps={"LFA1.LAND1": {"__blank__": "ZA"}})
    after = {r.check_id: r for r in run_checks("accounts_payable", patched, "t")}
    assert after["AP005"].affected_count == 0
    d = fs.diff_results(list(before.values()), list(after.values()), targeted={"AP005"})
    row = next(r for r in d["rules"] if r["check_id"] == "AP005")
    assert row["status"] == "resolved" and row["records_resolved"] == 1


# ── side effects ─────────────────────────────────────────────────────────────


def test_side_effects_flag_non_targeted_rules_that_gain_failures():
    before = [_r("A", 2, 10, keys=["LIFNR=1", "LIFNR=2"]), _r("B", 0, 10, keys=[]),
              _r("C", 1, 10, keys=["LIFNR=5"])]
    after = [_r("A", 0, 10, keys=[]), _r("B", 1, 10, keys=["LIFNR=1"]),
             _r("C", 1, 10, keys=["LIFNR=6"])]  # same count, different record: still a side effect
    d = fs.diff_results(before, after, targeted={"A"})
    status = {r["check_id"]: r["status"] for r in d["rules"]}
    assert status == {"A": "resolved", "B": "newly_failing", "C": "unchanged"}
    assert {r["check_id"] for r in d["side_effects"]} == {"B", "C"}
    assert d["findings"] == {"before": 2, "after": 2, "resolved": 1, "introduced": 1}
    assert d["records"] == {"resolved": 3, "introduced": 2}


def test_errored_checks_are_ignored_in_diff():
    d = fs.diff_results([_r("A", 0, 10, error="boom")], [_r("A", 3, 10)])
    assert d["rules"][0]["status"] == "newly_evaluated"


# ── DQS delta math ───────────────────────────────────────────────────────────


def test_dqs_delta_record_weighted_and_tenant_weights():
    before = [_r("A", 50, 100, dim="completeness"), _r("B", 0, 300, dim="validity")]
    after = [_r("A", 10, 100, dim="completeness"), _r("B", 0, 300, dim="validity")]
    w = {"completeness": 1, "validity": 1}  # tenant config: equal weights over the measured dims
    d = fs.dqs_delta(before, after, w)
    assert d["overall"]["before"] == 75.0 and d["overall"]["after"] == 95.0 and d["overall"]["delta"] == 20.0
    dims = {x["dimension"]: x for x in d["dimensions"]}
    assert dims["completeness"]["delta"] == 40.0 and dims["validity"]["delta"] == 0.0
    assert d["modules"][0]["delta"] == 20.0


def test_dqs_delta_lifts_critical_cap():
    before = [_r("A", 1, 1000, sev="critical"), _r("B", 0, 1000)]
    after = [_r("A", 0, 1000, sev="critical"), _r("B", 0, 1000)]
    d = fs.dqs_delta(before, after, None)
    assert d["overall"]["before"] == 85.0 and d["overall"]["capped_before"]
    assert d["overall"]["after"] == 100.0 and not d["overall"]["capped_after"]


def test_impact_delta_reports_unblocked_feature():
    rules = {"A": [{"module": "m", "target_feature": "Payments", "impact_type": "full_block"}],
             "B": [{"module": "m", "target_feature": "Payments", "impact_type": "degraded"}]}
    out = fs.impact_delta([_r("A", 1, 10), _r("B", 1, 10)], [_r("A", 0, 10), _r("B", 1, 10)], rules)
    assert out == [{"module": "m", "feature": "Payments", "before": "full_block", "after": "degraded",
                    "change": "unblocked"}]


# ── ranking ──────────────────────────────────────────────────────────────────


def test_rank_prefers_gain_per_record_and_does_not_double_count():
    before = [_r("A", 40, 100, keys=[f"k{i}" for i in range(40)]),
              _r("B", 10, 100, keys=[f"j{i}" for i in range(10)], dim="validity")]
    key_a, key_b = ("accounts_payable", "A"), ("accounts_payable", "B")
    cands = [
        {"id": "big", "label": "big", "records_changed": 400, "resolves": {key_a: {f"k{i}" for i in range(40)}}},
        {"id": "small", "label": "small", "records_changed": 10, "resolves": {key_b: {f"j{i}" for i in range(10)}}},
        {"id": "dup", "label": "dup", "records_changed": 1, "resolves": {key_b: {"j0"}}},
    ]
    picked = fs.rank_fixes(before, cands, None)
    assert [p["id"] for p in picked][:2] == ["dup", "small"]
    assert picked[1]["dqs_gain"] > 0
    assert "big" in [p["id"] for p in picked]
    assert picked[-1]["dqs_after"] == 100.0


# ── API ──────────────────────────────────────────────────────────────────────


def test_request_rejects_non_sap_field_keys():
    import uuid

    import pytest
    from pydantic import ValidationError

    from api.routes.simulation import SimulationRequest
    ok = SimulationRequest(version_id=uuid.uuid4(), value_maps={"LFB1.ZTERM": {"0001": "Z030"}})
    assert ok.rank and not ok.all_rule_fixes
    with pytest.raises(ValidationError):
        SimulationRequest(version_id=uuid.uuid4(), value_maps={"zterm": {"a": "b"}})


def test_get_simulation_reads_stored_result_and_404s_when_expired(monkeypatch):
    import asyncio
    import json
    import uuid

    import pytest
    from fastapi import HTTPException

    from api.deps import Tenant
    from api.routes import simulation as route
    from workers.tasks.run_simulation import result_key

    tid, sid = uuid.uuid4(), uuid.uuid4()
    store = {result_key(str(tid), str(sid)): json.dumps({"status": "completed", "dqs": {}})}
    fake = type("R", (), {"get": lambda self, k: store.get(k)})()
    monkeypatch.setattr(route, "_redis_client", lambda: fake)
    monkeypatch.setattr(route.jobs, "get_job", lambda t, j: None)
    tenant = Tenant(tid, "T", [])
    assert asyncio.run(route.get_simulation(sid, tenant))["status"] == "completed"
    store.clear()
    with pytest.raises(HTTPException) as e:
        asyncio.run(route.get_simulation(sid, tenant))
    assert e.value.status_code == 404
