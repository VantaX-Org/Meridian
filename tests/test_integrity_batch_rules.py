"""SDCM856 (IBAN mod-97), SDCM857 (same-VAT near-duplicate), EC653 (job relationship overlap): synthetic fixtures."""
import pandas as pd
import yaml

from checks.frames import TableFrames
from checks.runner import run_rule
from sap.ddic import get_dictionary


def rule(path, rid):
    rules = yaml.safe_load(open(path))
    return next(r for r in (rules["rules"] if isinstance(rules, dict) else rules) if r["id"] == rid)


def fire(path, rid, module, dictionary, **tables):
    dfs = {t: pd.DataFrame({f"{t}.{k}": v for k, v in cols.items()}) for t, cols in tables.items()}
    _, res = run_rule(dict(rule(path, rid)), TableFrames(dfs, get_dictionary(dictionary), module=module), {})
    assert res is not None and not res.error, res and res.error
    return res.affected_count


CUST = "checks/rules/ecc/sd_customer_master.yaml"
EC = "checks/rules/successfactors/employee_central.yaml"


def test_iban_mod97():
    # published example IBANs; the third has a transposed check digit, the fourth is a vendor bank row
    ibans = ["GB82 WEST 1234 5698 7654 32", "de89370400440532013000", "GB28WEST12345698765432", "GB28WEST12345698765432"]
    n = fire(CUST, "SDCM856", "sd_customer_master", "ecc6",
             TIBAN={"IBAN": ibans, "BANKS": ["GB", "DE", "GB", "GB"], "TABNAME": ["KNBK", "KNBK", "KNBK", "LFBK"]})
    assert n == 1


def test_same_vat_near_duplicate():
    base = dict(LOEVM=[None] * 4, STCEG=["XX100", "XX100", "XX200", "XX300"],
                NAME1=["Northwind Trading GmbH", "Northwind Tradng GmbH", "Northwind Trading GmbH", "Contoso Supplies"],
                KUNNR=["1", "2", "3", "4"])
    assert fire(CUST, "SDCM857", "sd_customer_master", "ecc6", KNA1=base) == 2


def test_job_relationship_overlap():
    def run(starts, ends):
        n = len(starts)
        return fire(EC, "EC653", "employee_central", "s4hana", EMPJOBRELATIONSHIPS={
            "USERID": ["u1"] * n, "RELATIONSHIP_TYPE": ["MM"] * n, "RELATED_USER_ID": ["u9"] * n,
            "START_DATE": starts, "END_DATE": ends})
    d = pd.to_datetime
    assert run(d(["2024-01-01", "2024-06-01"]), d(["2024-07-31", "2024-12-31"])) == 1
    assert run(d(["2024-01-01", "2024-06-01"]), d(["2024-05-31", "2024-12-31"])) == 0
