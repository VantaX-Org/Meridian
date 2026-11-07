"""Extraction targets for S/4 load dry-run cost analysis."""

from sap import extraction_plan as ep
from sap.ddic import get_dictionary
from sap.extraction_registry import (
    get_available_modules,
    get_extraction_targets,
    get_table_names,
)


def _tables(modules: list[str]) -> set[str]:
    plan = ep.plan_modules(modules, get_dictionary("ecc6"))
    return {t for t in plan}  # adjust to plan_modules' return shape (dict keyed by table, see DISCOVERY test)


def test_s4_load_tables_planned_for_master_modules():
    assert {"KNVK", "KNKK", "MARD", "T001L", "NAST", "KONV"} <= _tables(["sd_customer_master", "material_master"])


def test_registry_has_read_targets():
    names = set(get_table_names("ecc", "s4_load_sim"))
    assert {"KNVK", "KNKK", "MARD", "T001L", "KONV", "NAST"} <= names


def test_proven_cost_tables_planned():
    t = _tables(["mm_purchasing", "sd_sales_orders", "accounts_payable"])
    assert {"EKET", "EKBE", "EINA", "EINE", "MARM", "RSEG", "VBUK", "BSAK"} <= t


def test_proven_cost_registry_and_ekbe_budat():
    names = set(get_table_names("ecc", "proven_cost"))
    assert {"EKET", "EINA", "EINE", "MARM", "RSEG", "VBUK", "BSAK"} <= names
    from sap.extraction_plan import PROVEN_COST_DATA
    assert {"BUDAT", "DMBTR"} <= PROVEN_COST_DATA["EKBE"]
    assert {"LIFSK", "NETWR"} <= PROVEN_COST_DATA["VBAK"]


def test_ecc_kna1_has_stcd1():
    """Every ECC KNA1 target must include STCD1 (tax number)."""
    modules = get_available_modules("ecc")
    for module in modules:
        targets = get_extraction_targets("ecc", module)
        for target in targets:
            if target.source == "KNA1":
                assert "STCD1" in target.fields, (
                    f"KNA1 in module '{module}' missing STCD1. "
                    f"Fields: {target.fields}"
                )


def test_plan_builds_each_empty_frame_once_not_once_per_rule(monkeypatch):
    """One frame per table per rule was 915,186 calls, enough to time out a CI shard."""
    import sap.extraction_plan as ep
    from checks.frames import _graph
    from sap.ddic import get_dictionary

    built = []
    real = ep._empty
    monkeypatch.setattr(ep, "_empty", lambda d, t: built.append(t) or real(d, t))
    ep.plan_modules(["material_master"], get_dictionary("s4hana"))
    joinable = {t for e in _graph()[0] for t in (e.parent, e.child)}
    assert len(built) - len(joinable) < 200, "empty frames are being rebuilt for every rule"
