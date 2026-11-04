"""Cross-object rules (MM1108, SDCM858, SDCM859): an exists_check whose target table belongs to another
licensed object. The target is looked up only when that object is in the same run; otherwise the rule
skips as 'other_object_not_extracted', and its target table is never added to this object's extract."""

import pandas as pd
import pytest
import yaml

from checks.frames import TableFrames
from checks.runner import get_required_columns, module_rules, run_checks, run_rule
from sap.ddic import get_dictionary
from sap.extraction_plan import plan_modules

DDIC = get_dictionary("ecc6")
RULES = {r["id"]: r for m in ("material_master", "sd_customer_master") for r in module_rules(m)}
IDS = ["MM1108", "SDCM858", "SDCM859"]


def frame(table, **cols):
    return pd.DataFrame({f"{table}.{k}": v for k, v in cols.items()})


KNVV = frame("KNVV", KUNNR=["C1", "C2"], VKORG=["1000", "2000"], VTWEG=["10", "10"], SPART=["00", "00"],
             VWERK=["P1", "P9"])
MVKE = frame("MVKE", MATNR=["M1", "M2"], VKORG=["1000", "3000"], VTWEG=["10", "10"])
MARC = frame("MARC", MATNR=["M1"], WERKS=["P1"])
# rule -> (module, tables held, (population, failing))
CASES = {
    "SDCM858": ("sd_customer_master", {"KNVV": KNVV, "MVKE": MVKE}, (2, 1)),   # C2: 2000/10 has no material
    "SDCM859": ("sd_customer_master", {"KNVV": KNVV, "MARC": MARC}, (2, 1)),   # C2: plant P9 has no material
    "MM1108": ("material_master", {"KNVV": KNVV, "MVKE": MVKE}, (2, 1)),       # M2: 3000/10 has no customer
}


@pytest.mark.parametrize("rid", IDS)
def test_flags_missing_counterpart(rid):
    module, tables, (pop, bad) = CASES[rid]
    _, res = run_rule(dict(RULES[rid]), TableFrames(tables, DDIC, module=module), None)
    assert res is not None and not res.error
    assert (res.total_count, res.affected_count) == (pop, bad)


@pytest.mark.parametrize("rid", IDS)
def test_skips_and_says_so_when_other_object_absent(rid):
    module, tables, _ = CASES[rid]
    own = {t: f for t, f in tables.items() if t == RULES[rid]["field"].split(".")[0]}
    stats: dict = {}
    run_checks(module, TableFrames(own, DDIC, module=module), "t", extra_rules=[RULES[rid]], stats=stats,
               prefetch_budget=0)
    assert stats.get("other_object_not_extracted", 0) >= 1
    _, res = run_rule(dict(RULES[rid]), TableFrames(own, DDIC, module=module), None)
    assert res is None  # no finding, no error


def test_other_objects_tables_are_not_pulled_into_the_extract():
    cols = get_required_columns("sd_customer_master")
    assert "MVKE.VKORG" not in cols and "MARC.WERKS" not in cols  # SDCM858/859 targets
    assert "KNVV.VWERK" in cols
    mm = get_required_columns("material_master")
    assert "KNVV.VTWEG" not in mm  # MM1108 target; MVKE is the material object's own table


def test_extraction_plan_leaves_the_other_objects_target_out():
    # KNVV and MARC can still be planned for other reasons; only this object must not be why
    material = plan_modules(["material_master"], DDIC)
    assert "material_master" not in material["KNVV"].modules
    customer = plan_modules(["sd_customer_master"], DDIC)
    assert "MVKE" not in customer or "sd_customer_master" not in customer["MVKE"].modules
    both = plan_modules(["material_master", "sd_customer_master"], DDIC)
    assert {"KNVV", "MVKE", "MARC"} <= set(both)


def test_cross_object_rules_name_a_real_module():
    for rid in IDS:
        other = RULES[rid]["cross_object"]
        assert other != RULES[rid]["module"] if "module" in RULES[rid] else True
        assert module_rules(other)
