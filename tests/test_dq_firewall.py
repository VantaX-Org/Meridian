"""DQ firewall service: pass, critical block, refusals (unknown module, over limit, unknown field)."""
import pytest

from api.services import dq_firewall as fw

T = "00000000-0000-0000-0000-000000000001"


def test_modules_exclude_overlays_and_include_material_master():
    assert "material_master" in fw.modules()
    assert not any(m.endswith(".generated") or m == "column_map" for m in fw.modules())


def test_unknown_module_refused():
    with pytest.raises(fw.FirewallError):
        fw.validate(T, "no_such_module", [{"MARA.MATNR": "1"}])


def test_over_limit_refused():
    with pytest.raises(fw.FirewallError, match="At most"):
        fw.validate(T, "material_master", [{"MARA.MATNR": "1"}] * (fw.MAX_RECORDS + 1))


def test_unknown_field_refused():
    with pytest.raises(fw.FirewallError, match="not a field"):
        fw.validate(T, "material_master", [{"NOPE.NOPE": "1"}])


def test_result_shape_and_block_policy():
    res = fw.validate(T, "material_master",
                      [{"MARA.MATNR": "ABC", "MARA.MTART": "ZZZZ", "MAKT.MAKTX": ""}], overrides={}, extra_rules=[])
    assert res["block_severity"] == "critical" and res["module"] == "material_master"
    rec = res["records"][0]
    for f in rec["failures"]:
        assert f["rule_id"] and f["description"] and f["severity"] in ("critical", "high", "medium", "low")
    assert rec["verdict"] == ("block" if any(f["severity"] == "critical" for f in rec["failures"]) else "pass")
    assert res["verdict"] == rec["verdict"]


def test_default_response_has_no_suggestion():
    res = fw.validate(T, "material_master", [{"MARA.GEWEI": "XX"}], overrides={}, extra_rules=[])
    assert all(f.get("suggestion") is None for r in res["records"] for f in r["failures"])


def test_suggestions_are_grounded_and_cited():
    res = fw.validate(T, "material_master", [{"MARA.GEWEI": "KGM"}, {"MARA.GEWEI": "ZZZ"}], overrides={},
                      extra_rules=[], suggest=True)
    got = {}
    for i, r in enumerate(res["records"]):
        for f in r["failures"]:
            if f["rule_id"] == "MM016":
                got[i] = f.get("suggestion")
    # KGM is in the rule's auto_fix map: a verified corrected value
    assert got[0] and got[0]["kind"] == "value" and got[0]["value"] == "KG" and got[0]["verified"]
    # ZZZ maps to nothing: only the rule's own allowed values are offered, each with its rule id and source
    s = got[1]
    assert s["kind"] == "allowed_values" and s["rule_id"] == "MM016" and "MM016" in s["source"]
    assert {"code": "KG", "text": "Kilogram"} in s["allowed_values"]


def test_no_grounded_value_means_no_suggestion():
    res = fw.validate(T, "material_master", [{"MARA.MATNR": "ABC", "MAKT.MAKTX": ""}], overrides={}, extra_rules=[],
                      suggest=True)
    for r in res["records"]:
        for f in r["failures"]:
            s = f.get("suggestion")
            assert s is None or (s["rule_id"] == f["rule_id"] and s["source"])


def test_describe_and_tally():
    from api.routes.dq_firewall import _tally
    assert fw.describe("MM016")
    assert _tally([{"records": 2, "blocked_records": 1}])["warned"] is None
    assert _tally([{"records": 3, "blocked_records": 1, "warned_records": 1}])["passed"] == 1
