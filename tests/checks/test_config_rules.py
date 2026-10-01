"""Rules generated from the system's own T685A (condition types) and T582A
(infotype time constraints): each is proven, and judges real records."""

import logging

import pandas as pd
import pytest

from checks import config_rules
from checks.frames import TableFrames
from checks.runner import run_rule
from sap.ddic import get_dictionary
from tests.checks.rule_proofs import prove

D = get_dictionary("s4hana")
CONFIG = {
    "T685A": [
        {"KAPPL": "V", "KSCHL": "PR00", "KNEGA": "A", "KRECH": "C", "KOAID": "B"},
        {"KAPPL": "V", "KSCHL": "K007", "KNEGA": "X", "KRECH": "A", "KOAID": "A"},
        {"KAPPL": "V", "KSCHL": "KF00", "KNEGA": "", "KRECH": "B", "KOAID": "A"},
        {"KAPPL": "M", "KSCHL": "PB00", "KNEGA": "A", "KRECH": "C", "KOAID": "B"},
    ],
    "T683S": [{"KVEWE": "A", "KAPPL": "V", "KALSM": "RVAA01", "KSCHL": "PR00"},
              {"KVEWE": "A", "KAPPL": "V", "KALSM": "RVAA01", "KSCHL": "K007"},
              {"KVEWE": "A", "KAPPL": "V", "KALSM": "RVAA01", "KSCHL": ""},       # subtotal step
              {"KVEWE": "B", "KAPPL": "V", "KALSM": "V10000", "KSCHL": "KF00"},   # output, not pricing
              {"KVEWE": "A", "KAPPL": "M", "KALSM": "RM0000", "KSCHL": "PB00"}],
    "T582A": [{"INFTY": "0001", "ZEITB": "1"}, {"INFTY": "0105", "ZEITB": "2"},
              {"INFTY": "0009", "ZEITB": "T"}, {"INFTY": "0015", "ZEITB": "3"}],
}
RULES = (config_rules.generate("sd_sales_orders", CONFIG, D) + config_rules.generate("mm_purchasing", CONFIG, D)
         + config_rules.generate("employee_central", CONFIG, D))


def test_generated_set():
    assert sorted(r["id"] for r in RULES) == sorted([
        "KS-V-X", "KS-V-A", "KC-V-A", "KC-V-B", "KC-V-C", "KZ-V", "KP-V", "KS-M-A", "KC-M-C", "KZ-M", "KP-M",
        "TC-PA0001", "TC-PA0105"])  # subtype-dependent (T) and constraint 3 are not judged
    assert config_rules.generate("sd_sales_orders", {}, D) == []
    assert config_rules.generate("fi_gl", CONFIG, D) == []


@pytest.mark.parametrize("rule", RULES, ids=[r["id"] for r in RULES])
def test_generated_rule_is_proven(rule):
    logging.disable(logging.CRITICAL)
    try:
        verdict, detail = prove(rule, D)
    finally:
        logging.disable(logging.NOTSET)
    assert verdict == "proven", f"{rule['id']}: {verdict} — {detail}"


def _konp(rows):
    recs = [{"KONH.KNUMH": k, "KONH.KAPPL": "V", "KONH.KSCHL": t, "KONP.KNUMH": k, "KONP.KOPOS": "01",
             "KONP.KAPPL": "V", "KONP.KSCHL": t, "KONP.KRECH": c, "KONP.KBETR": b, "KONP.LOEVM_KO": d}
            for k, t, c, b, d in rows]
    return TableFrames.from_flat(pd.DataFrame(recs), D, module="sd_sales_orders")


def test_pricing_rules_judge_condition_records():
    frames = _konp([("1", "PR00", "C", "12.50", ""),     # fine
                    ("2", "PR00", "C", "0", ""),         # zero price
                    ("3", "PR00", "A", "5", ""),         # calculation type changed since
                    ("4", "K007", "A", "3", ""),         # discount stored as a surcharge
                    ("5", "PR00", "C", "0", "X")])       # deleted: out of the population
    got = {r["id"]: run_rule(r, frames)[1] for r in RULES if r["module"] == "sd_sales_orders"}
    assert got["KZ-V"].affected_count == 1 and got["KZ-V"].details["population_excluded"] == {"deleted": 1}
    assert got["KC-V-C"].affected_count == 1
    assert got["KS-V-X"].affected_count == 1
    assert got["KS-V-A"].affected_count == 0
    assert got["KP-V"].affected_count == 0                       # PR00 and K007 are in RVAA01


def test_condition_type_in_no_pricing_procedure():
    kp = next(r for r in RULES if r["id"] == "KP-V")
    assert kp["allowed_values"] == ["K007", "PR00"]              # KF00 is only in an output procedure
    frames = _konp([("1", "PR00", "C", "12.50", ""), ("2", "KF00", "B", "4", ""),
                    ("3", "KF00", "B", "4", "X")])               # deleted: out of the population
    _, r = run_rule(kp, frames)
    assert (r.total_count, r.affected_count) == (2, 1)
    assert config_rules.generate("sd_sales_orders", {"T685A": CONFIG["T685A"]}, D) and \
        not any(x["id"].startswith("KP-") for x in config_rules.generate(
            "sd_sales_orders", {"T685A": CONFIG["T685A"]}, D))   # no T683S: nothing assumed


def test_time_constraint_one_needs_unbroken_history():
    tc = next(r for r in RULES if r["id"] == "TC-PA0001")
    rows = [("1", "20200101", "20201231", ""), ("1", "20210101", "99991231", ""),   # unbroken
            ("2", "20200101", "20200630", ""), ("2", "20200801", "99991231", ""),   # gap in July
            ("3", "20200101", "99991231", ""), ("3", "20200301", "20200331", "X")]  # locked: pending, not judged
    df = pd.DataFrame([{"PA0001.PERNR": p, "PA0001.SUBTY": "", "PA0001.OBJPS": "", "PA0001.SPRPS": s,
                        "PA0001.BEGDA": b, "PA0001.ENDDA": e, "PA0001.SEQNR": "000"} for p, b, e, s in rows])
    _, r = run_rule(tc, TableFrames.from_flat(df, D, module="employee_central"))
    assert (r.total_count, r.affected_count) == (5, 1)
    assert r.details["population_excluded"] == {"locked": 1}


def _live_s4():
    """An S/4 system's own DDIC as discovery reads it (the bundle has no ACDOCA)."""
    f = lambda pos, name, key, typ, ln, dec=0: {"pos": pos, "name": name, "key": key, "data_element": name,  # noqa: E731
                                                "domain": name, "type": typ, "length": ln, "decimals": dec,
                                                "description": name, "check_table": None}
    acdoca = {"table": "ACDOCA", "description": "Universal Journal Entry Line Items", "category": "TRANSP",
              "delivery_class": "A", "fields": [f(1, "RCLNT", True, "CLNT", 3), f(2, "RLDNR", True, "CHAR", 2),
                                                f(3, "RBUKRS", True, "CHAR", 4), f(4, "GJAHR", True, "NUMC", 4),
                                                f(5, "BELNR", True, "CHAR", 10), f(6, "DOCLN", True, "CHAR", 6),
                                                f(7, "HSL", False, "CURR", 23, 2), f(8, "BUDAT", False, "DATS", 8)],
              "foreign_keys": []}
    return get_dictionary("s4hana").overlay({"ACDOCA": acdoca})


def test_universal_journal_only_from_the_live_dictionary():
    from sap.extraction_plan import plan_modules

    assert not any(r["id"] == "LJ-ACDOCA" for r in config_rules.generate("fi_gl", {}, D))   # bundle: nothing
    assert "ACDOCA" not in plan_modules(["fi_gl"], D)
    live = _live_s4()
    rule = next(r for r in config_rules.generate("fi_gl", {}, live) if r["id"] == "LJ-ACDOCA")
    plan = plan_modules(["fi_gl"], live)["ACDOCA"]
    assert plan.where.startswith("BUDAT >= ") and {"HSL", "RLDNR", "BELNR"} <= plan.fields
    rows = [("0L", "1000", "2026", "100", "000001", "500.00"), ("0L", "1000", "2026", "100", "000002", "500.00-"),
            ("0L", "1000", "2026", "101", "000001", "120.00"), ("0L", "1000", "2026", "101", "000002", "-100.00"),
            ("2L", "1000", "2026", "100", "000001", "500.00")]  # same document number, other ledger
    df = pd.DataFrame([dict(zip(["ACDOCA.RLDNR", "ACDOCA.RBUKRS", "ACDOCA.GJAHR", "ACDOCA.BELNR", "ACDOCA.DOCLN",
                                 "ACDOCA.HSL"], r)) for r in rows])
    _, r = run_rule(rule, TableFrames({"ACDOCA": df}, live, module="fi_gl"))
    assert (r.total_count, r.affected_count) == (3, 2) and r.details["largest_imbalance"] == 500.0
    verdict, detail = prove(rule, live)
    assert verdict == "proven", detail


def _live_prcd():
    f = lambda pos, name, key, typ, ln: {"pos": pos, "name": name, "key": key, "data_element": name,  # noqa: E731
                                         "domain": name, "type": typ, "length": ln, "decimals": 0,
                                         "description": name, "check_table": None}
    prcd = {"table": "PRCD_ELEMENTS", "description": "Pricing Elements", "category": "TRANSP",
            "delivery_class": "A", "fields": [f(1, "CLIENT", True, "CLNT", 3), f(2, "KNUMV", True, "CHAR", 10),
                                              f(3, "KPOSN", True, "NUMC", 6), f(4, "STUNR", True, "NUMC", 3),
                                              f(5, "ZAEHK", True, "NUMC", 3), f(6, "KAPPL", False, "CHAR", 2),
                                              f(7, "KSCHL", False, "CHAR", 4), f(8, "KDATU", False, "DATS", 8)],
            "foreign_keys": []}
    return get_dictionary("s4hana").overlay({"PRCD_ELEMENTS": prcd})


def test_document_conditions_only_from_the_live_dictionary():
    from sap.extraction_plan import plan_modules

    assert not any(r["id"].startswith("PE-") for r in RULES)            # bundle: nothing
    assert "PRCD_ELEMENTS" not in plan_modules(["sd_sales_orders"], D)
    live = _live_prcd()
    assert config_rules.generate("sd_sales_orders", {}, live) == []      # no T685A: nothing assumed
    rule = next(r for r in config_rules.generate("sd_sales_orders", CONFIG, live) if r["id"] == "PE-V")
    assert rule["allowed_values"] == ["K007", "KF00", "PR00"]
    plan = plan_modules(["sd_sales_orders"], live)["PRCD_ELEMENTS"]
    assert plan.where.startswith("KDATU >= ") and {"KSCHL", "KAPPL"} <= plan.fields
    rows = [("1", "000010", "010", "001", "V", "PR00"), ("1", "000010", "020", "001", "V", ""),   # subtotal line
            ("1", "000010", "030", "001", "V", "ZOLD"),                                            # deleted type
            ("2", "000010", "010", "001", "M", "PB00")]                                            # purchasing
    df = pd.DataFrame([dict(zip([f"PRCD_ELEMENTS.{c}" for c in ("KNUMV", "KPOSN", "STUNR", "ZAEHK", "KAPPL",
                                                                 "KSCHL")], r)) for r in rows])
    _, r = run_rule(rule, TableFrames({"PRCD_ELEMENTS": df}, live, module="sd_sales_orders"))
    assert r.affected_count == 1
    verdict, detail = prove(rule, live)
    assert verdict == "proven", detail
