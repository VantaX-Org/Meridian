"""Extraction targets for S/4 load dry-run cost analysis."""

from sap import extraction_plan as ep
from sap.ddic import get_dictionary
from sap.extraction_registry import get_table_names


def _tables(modules: list[str]) -> set[str]:
    plan = ep.plan_modules(modules, get_dictionary("ecc6"))
    return {t for t in plan}  # adjust to plan_modules' return shape (dict keyed by table, see DISCOVERY test)


def test_s4_load_tables_planned_for_master_modules():
    assert {"KNVK", "KNKK", "MARD", "T001L", "NAST", "KONV"} <= _tables(["sd_customer_master", "material_master"])


def test_registry_has_read_targets():
    names = set(get_table_names("ecc", "s4_load_sim"))
    assert {"KNVK", "KNKK", "MARD", "T001L", "KONV", "NAST"} <= names
