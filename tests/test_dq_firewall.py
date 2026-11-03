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
