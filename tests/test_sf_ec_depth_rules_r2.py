"""Depth/enrichment/fixture contract for EC617 onward: compensation, payment information,
national ID card type and current-job/job-history consistency on top of EC450-616
(tests/test_sf_ec_depth_rules3.py). Same idioms; every fixture value is synthetic."""
import re

import pandas as pd
import pytest
import yaml

from checks.frames import TableFrames
from checks.runner import run_rule
from sap.ddic import get_dictionary

S4 = get_dictionary("s4hana")
RULES = yaml.safe_load(open("checks/rules/successfactors/employee_central.yaml"))["rules"]
BY_ID = {r["id"]: r for r in RULES}
NEW = [r for r in RULES if re.fullmatch(r"EC\d+", r["id"]) and int(r["id"][2:]) >= 617]

MANDATORY = ["id", "field", "check_class", "severity", "dimension", "message",
             "why_it_matters", "rule_authority", "sap_impact", "fix_map", "record_fix_template"]


def frame(table, **cols):
    return pd.DataFrame({f"{table}.{k}": v for k, v in cols.items()})


def fire(rid, tables, refs=None):
    frames = TableFrames(tables, S4, module="employee_central")
    _, res = run_rule(dict(BY_ID[rid]), frames, refs or {})
    assert res is not None and not res.error, (rid, res and res.error)
    return res.affected_count


def test_new_ids_unique_and_contiguous():
    nums = [int(r["id"][2:]) for r in NEW]
    assert len(nums) == len(set(nums)) == 28
    assert nums == list(range(617, 617 + len(nums)))


def test_target_tables_exist_in_dictionary():
    for r in NEW:
        for key in ("target_table", "grain"):
            if r.get(key):
                assert S4.table(r[key]) is not None, (r["id"], r[key])


def test_new_rules_fully_enriched():
    for r in NEW:
        for k in MANDATORY:
            assert r.get(k), (r["id"], k)
        assert r["rule_authority"] in ("sap_hard_constraint", "best_practice"), r["id"]
        cols = re.findall(r"`([A-Z0-9]+\.[A-Z0-9_]+)`", r.get("fail_when", ""))
        cols += re.findall(r"\{([A-Z0-9]+\.[A-Z0-9_]+)\}", r["record_fix_template"])
        cols += [r["field"]] + list(r.get("fields") or [])
        cols += list((r.get("applies_when") or {}).keys())
        for f in cols:
            table, field = f.split(".")
            assert S4.field(table, field) is not None, (r["id"], f)
        for f in r.get("target_fields") or []:
            assert S4.field(r["target_table"], f) is not None, (r["id"], f)


def test_new_rules_never_case_fix_sf_codes():
    for r in NEW:
        ops = {s["op"] for s in (r.get("auto_fix") or {}).get("steps", [])}
        assert not ops & {"upper", "lower", "title"}, r["id"]


def test_no_message_duplicates_existing_rule():
    old = {r["message"].strip().lower() for r in RULES if r not in NEW}
    for r in NEW:
        assert r["message"].strip().lower() not in old, r["id"]


def test_tolerance_rules_state_their_tolerance():
    for r in NEW:
        if ".abs()" in r.get("fail_when", ""):
            assert "0.02" in r["why_it_matters"], r["id"]


# ── fixtures: (rule_id, tables, expected_affected, slice_tables_for_clean) ──
CI, PY, EE, JH, PI, ER = "COMPINFO", "PAYMENTINFO", "EMPEMPLOYMENT", "EMPJOBHIST", "PERINFO", "FOEVENTREASON"


def _ci(**cols):
    return {CI: frame(CI, USERID=["u1", "u2"], EFFECTIVE_DATE=["20200101", "20200101"], **cols)}


def _rng(**cols):
    base = dict(PAY_RANGE_FREQUENCY=["ANN", "ANN"], PAY_RANGE_CURRENCY=["EUR", "EUR"], CURRENCY=["EUR", "EUR"],
                PAY_RANGE_MIN=["40000", "40000"], PAY_RANGE_MID=["50000", "50000"], PAY_RANGE_MAX=["60000", "60000"])
    return _ci(**{**base, **cols})


CASES = [
    ("EC617", {CI: frame(CI, USERID=["u9", "u1"], EFFECTIVE_DATE=["20200101", "20200101"]),
               EE: frame(EE, USERID=["u1"])}, 1, [CI]),
    ("EC618", {CI: frame(CI, USERID=["u1", "u2", "u3"], EFFECTIVE_DATE=["20190101", "20200101", "20150101"]),
               EE: frame(EE, USERID=["u1", "u2", "u3"], START_DATE=["20200101", "20200101", "20200101"],
                         ORIGINAL_START_DATE=[None, None, "20100101"])}, 1, [CI]),
    ("EC619", _ci(END_DATE=["20191231", "20211231"]), 1, [CI]),
    ("EC620", _ci(EFFECTIVE_DATE_COMP=["20200101", "20200101"], PAYCOMP_END_DATE=["20191231", None]), 1, [CI]),
    ("EC621", _ci(SALARY=["50000", "50000"], PAY_TYPE=[None, "BASE"]), 1, [CI]),
    ("EC622", _ci(CURRENCY=["eur", "EUR"]), 1, [CI]),
    ("EC623", _ci(SALARY=["50000", "50000"], COMP_FREQUENCY=[None, "ANN"]), 1, [CI]),
    ("EC624", _ci(PAYROLL_SYSTEM_ID=["P1", "P1"], PAY_GROUP=[None, "G1"]), 1, [CI]),
    ("EC625", _rng(PAY_RANGE_MID=["70000", "50000"]), 1, [CI]),
    ("EC626", _rng(ANNUAL_SALARY=["65000", "55000"]), 1, [CI]),
    ("EC627", _rng(ANNUAL_SALARY=["50000", "55000"], COMPA_RATIO=["0.90", "1.10"]), 1, [CI]),
    ("EC628", _rng(ANNUAL_SALARY=["50000", "50000"], RANGE_PENETRATION=["0.80", "0.51"]), 1, [CI]),
    ("EC629", {CI: frame(CI, USERID=["u1", "u2"], EFFECTIVE_DATE=["20200101", "20200101"], EVENT_REASON=["XX", "R1"]),
               ER: frame(ER, EXTERNAL_CODE=["R1"], EVENT=["5"])}, 1, [CI]),
    ("EC630", _ci(PAY_SCALE_TYPE=[None, "01"], PAY_SCALE_AREA=["02", "02"], PAY_SCALE_LEVEL=["L1", "L1"]), 1, [CI]),
    ("EC631", {CI: frame(CI, USERID=["u1", "u2"], EFFECTIVE_DATE=["20200101", "20200101"], END_DATE=[None, None],
                         PAY_GRADE=["G1", "G1"], PAY_GRADE_STATUS=["I", "A"], PAY_RANGE_STATUS=["A", "A"],
                         PAY_COMPONENT_STATUS=["A", "A"]),
               EE: frame(EE, USERID=["u1", "u2"], STATUS=["A", "A"])}, 1, [CI]),
    ("EC632", _ci(PAY_COMPONENT_TYPE=["CASH", "AMOUNT"]), 1, [CI]),
    ("EC633", _ci(PAY_COMPONENT_RECURRING=["false", "true"]), 1, [CI]),
    ("EC634", _ci(PAY_COMPONENT_CAN_OVERRIDE=["false", "false"], SALARY=["120", "100"],
                  PAY_COMPONENT_DEFAULT=["100", "100"]), 1, [CI]),
    ("EC635", _ci(ANNUALIZATION_FACTOR=["0", "12"]), 1, [CI]),
    ("EC636", {PY: frame(PY, USERID=["u1", "u2"], EFFECTIVE_DATE=["20190101", "20200101"]),
               EE: frame(EE, USERID=["u1", "u2"], START_DATE=["20200101", "20200101"],
                         ORIGINAL_START_DATE=[None, None])}, 1, [PY]),
    ("EC637", {PY: frame(PY, USERID=["u1", "u2"], EXTERNAL_CODE=[None, "1"])}, 1, [PY]),
    ("EC638", {PY: frame(PY, USERID=["u1", "u2", "u3"], PAYMENT_METHOD=[None, "05", None],
                         IBAN=["DE00SYNTHETIC", "DE00SYNTHETIC", None], ACCOUNT_NUMBER=[None, None, None])}, 1, [PY]),
    ("EC639", {PY: frame(PY, USERID=["u1", "u2"], CURRENCY=["EURO", "EUR"])}, 1, [PY]),
    ("EC640", {PI: frame(PI, PERSON_ID=["p1", "p2", "p3"], NATIONAL_ID=["X1", "X2", None],
                         NATIONAL_ID_CARD_TYPE=[None, "ID", None])}, 1, [PI]),
    ("EC641", {EE: frame(EE, USERID=["u1", "u2"], JOB_START_DATE=["20210101", "20200101"], SEQ_NUMBER=["1", "1"]),
               JH: frame(JH, USERID=["u1", "u2"], START_DATE=["20200101", "20200101"], SEQ_NUMBER=["1", "1"])},
     1, [EE]),
    ("EC642", {JH: frame(JH, USERID=["u1", "u2"], START_DATE=["20200101", "20200101"], END_DATE=[None, None],
                         PAY_GRADE=["G2", "G1"]),
               EE: frame(EE, USERID=["u1", "u2"], STATUS=["A", "A"], PAY_GRADE=["G1", "G1"])}, 1, [JH]),
    ("EC643", {CI: frame(CI, USERID=["u1", "u2"], EFFECTIVE_DATE=["20200101", "20200101"], END_DATE=[None, None],
                         PAY_RANGE_STATUS=["I", "A"]),
               EE: frame(EE, USERID=["u1", "u2"], STATUS=["A", "A"])}, 1, [CI]),
    ("EC644", {CI: frame(CI, USERID=["u1", "u2"], EFFECTIVE_DATE=["20200101", "20200101"], END_DATE=[None, None],
                         PAY_COMPONENT_STATUS=["I", "A"]),
               EE: frame(EE, USERID=["u1", "u2"], STATUS=["A", "A"])}, 1, [CI]),
]


def test_ec643_skips_terminated_employee():
    tables = {CI: frame(CI, USERID=["u1"], EFFECTIVE_DATE=["20200101"], END_DATE=[None], PAY_RANGE_STATUS=["I"]),
              EE: frame(EE, USERID=["u1"], STATUS=["T"])}
    frames = TableFrames(tables, S4, module="employee_central")
    _, res = run_rule(dict(BY_ID["EC643"]), frames, {})
    assert res is None or res.affected_count == 0


def clean(tables, slice_tables):
    return {t: (df.iloc[1:].reset_index(drop=True) if t in slice_tables else df) for t, df in tables.items()}


@pytest.mark.parametrize("rid,tables,expected,slice_tables", CASES, ids=[c[0] for c in CASES])
def test_fixture_flags_only_the_bad_record(rid, tables, expected, slice_tables):
    assert fire(rid, tables) == expected


@pytest.mark.parametrize("rid,tables,expected,slice_tables", [c for c in CASES if c[3]],
                         ids=[c[0] for c in CASES if c[3]])
def test_fixture_clean_rows_pass(rid, tables, expected, slice_tables):
    assert fire(rid, clean(tables, slice_tables)) == 0


def test_every_new_rule_has_a_fixture():
    assert {r["id"] for r in NEW} <= {c[0] for c in CASES}


@pytest.mark.parametrize("ratio,bad", [("1.015", False), ("1.025", True), ("0.985", False), ("0.975", True)])
def test_ec627_tolerance_boundary(ratio, bad):
    assert fire("EC627", _rng(ANNUAL_SALARY=["50000"] * 2, COMPA_RATIO=[ratio, "1.00"])) == int(bad)


def test_ec627_skips_range_in_other_currency():
    assert fire("EC627", _rng(PAY_RANGE_CURRENCY=["USD", "USD"], ANNUAL_SALARY=["50000"] * 2,
                              COMPA_RATIO=["2.00", "2.00"])) == 0


def test_ec636_rehire_original_start_honoured():
    tables = {PY: frame(PY, USERID=["u1"], EFFECTIVE_DATE=["20150101"]),
              EE: frame(EE, USERID=["u1"], START_DATE=["20200101"], ORIGINAL_START_DATE=["20100101"])}
    assert fire("EC636", tables) == 0
