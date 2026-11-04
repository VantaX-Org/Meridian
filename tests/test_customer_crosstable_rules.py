"""Customer master cross-table integrity rules (SDCM850-SDCM855): orphan child rows, child rows missing their
intermediate parent, and the KNA1 -> KNB1 deletion-flag cascade. Integrity plus one failing/one passing record each."""
import re

import pandas as pd
import pytest
import yaml

from checks.frames import TableFrames
from checks.runner import run_rule
from sap.ddic import get_dictionary

START, COUNT = 850, 6
DDIC = get_dictionary("ecc6")
ALL = yaml.safe_load(open("checks/rules/ecc/sd_customer_master.yaml"))["rules"]
RULES = {r["id"]: r for r in ALL}
NEW = [r for r in ALL if START <= int(r["id"][4:]) < START + COUNT]
MANDATORY = ["id", "check_class", "severity", "dimension", "message", "why_it_matters", "rule_authority",
             "sap_impact", "fix_map", "record_fix_template"]


def frame(table, **cols):
    return pd.DataFrame({f"{table}.{k}": v for k, v in cols.items()})


def fire(rid, tables):
    _, res = run_rule(dict(RULES[rid]), TableFrames(tables, DDIC, module="sd_customer_master"), None)
    assert res is not None and not res.error, (rid, res and res.error)
    return res.affected_count, res.total_count


def test_ids_contiguous_and_fields_present():
    assert [r["id"] for r in NEW] == [f"SDCM{n}" for n in range(START, START + COUNT)]
    assert len({r["message"] for r in NEW}) == COUNT
    for r in NEW:
        assert all(r.get(k) for k in MANDATORY), r["id"]
        refs = [r.get("field"), *r.get("fields", []), *re.findall(r"`([A-Z0-9_]+\.[A-Z0-9_]+)`", r.get("fail_when", ""))]
        for ref in filter(None, refs):
            assert DDIC.resolve(ref), (r["id"], ref)


KNA1 = frame("KNA1", KUNNR=["C1", "C2"], LOEVM=["X", ""])
LIVE = frame("KNA1", KUNNR=["C1", "C2"])


@pytest.mark.parametrize("rid, table, cols", [
    ("SDCM850", "KNB1", dict(BUKRS=["1000", "1000"])),
    ("SDCM851", "KNVP", dict(VKORG=["1000"] * 2, VTWEG=["10"] * 2, SPART=["00"] * 2, PARVW=["WE"] * 2)),
    ("SDCM852", "KNB5", dict(BUKRS=["1000", "1000"])),
])
def test_orphan_child_rows(rid, table, cols):
    child = frame(table, KUNNR=["C1", "ZZ"], **cols)
    assert fire(rid, {"KNA1": LIVE, table: child}) == (1, 2)


def test_dunning_without_company_code():
    knb5 = frame("KNB5", KUNNR=["C1", "C1"], BUKRS=["1000", "2000"])
    knb1 = frame("KNB1", KUNNR=["C1"], BUKRS=["1000"])
    assert fire("SDCM853", {"KNB5": knb5, "KNB1": knb1}) == (1, 2)


def test_partner_without_sales_area():
    knvp = frame("KNVP", KUNNR=["C1", "C1"], VKORG=["1000", "2000"], VTWEG=["10"] * 2, SPART=["00"] * 2,
                 PARVW=["WE"] * 2)
    knvv = frame("KNVV", KUNNR=["C1"], VKORG=["1000"], VTWEG=["10"], SPART=["00"])
    assert fire("SDCM854", {"KNVP": knvp, "KNVV": knvv}) == (1, 2)


def test_company_code_deletion_cascade():
    knb1 = frame("KNB1", KUNNR=["C1", "C1", "C2"], BUKRS=["1000", "2000", "1000"], LOEVM=["", "X", ""])
    assert fire("SDCM855", {"KNA1": KNA1, "KNB1": knb1})[0] == 1
