"""Fixture contract for EC728-EC781: Employee Central entry dates, stock grants, shift data,
Brazilian FGTS, payment info, dependants, permits, personal info and positions.
Every fixture has one good row and one bad row; the rule must flag only the bad one."""
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
NEW = [r for r in RULES if re.fullmatch(r"EC\d+", r["id"]) and 728 <= int(r["id"][2:]) <= 781]
MANDATORY = ["id", "field", "check_class", "severity", "dimension", "message",
             "why_it_matters", "rule_authority", "sap_impact", "fix_map", "record_fix_template"]
EE, P, M, W, I, O = "EMPEMPLOYMENT", "PAYMENTINFO", "PEREMERGENCY", "EMPWORKPERMIT", "PERINFO", "POSITION"
FUT, PAST, OLD = "20990101", "20200101", "19900101"
KEY = {EE: "USERID", P: "USERID", W: "USERID", M: "PERSON_ID", I: "PERSON_ID", O: "CODE"}


def case(table, **cols):
    """Two-row frame: row 0 is clean, row 1 is bad."""
    cols.setdefault(KEY[table], ["k1", "k2"])
    return {table: pd.DataFrame({f"{table}.{k}": v for k, v in cols.items()})}


T, F = "true", "false"
CASES = {
    **{f"EC{728 + i}": case(EE, **{f: [PAST, FUT]}) for i, f in enumerate(
        ["POSITION_ENTRY_DATE", "JOB_ENTRY_DATE", "COMPANY_ENTRY_DATE", "LOCATION_ENTRY_DATE",
         "DEPARTMENT_ENTRY_DATE", "PAY_SCALE_LEVEL_ENTRY_DATE", "INITIAL_ENTRY_DATE", "ENTRY_INTO_GROUP",
         "PROFESSIONAL_SERVICE_DATE"])},
    **{f"EC{737 + i}": case(EE, **{f: [PAST, OLD], "COMPANY_ENTRY_DATE": [OLD, PAST]}) for i, f in enumerate(
        ["POSITION_ENTRY_DATE", "JOB_ENTRY_DATE", "LOCATION_ENTRY_DATE", "DEPARTMENT_ENTRY_DATE",
         "PAY_SCALE_LEVEL_ENTRY_DATE"])},
    "EC742": case(EE, COMPANY_ENTRY_DATE=[PAST, OLD], ENTRY_INTO_GROUP=[OLD, PAST]),
    "EC743": case(EE, ENTRY_INTO_GROUP=[PAST, OLD], INITIAL_ENTRY_DATE=[OLD, PAST]),
    "EC744": case(EE, ELIGIBLE_FOR_STOCK=[T, F], INITIAL_STOCK_GRANT=[100.0, 100.0]),
    "EC745": case(EE, INITIAL_STOCK_GRANT=[100.0, -5.0]),
    "EC746": case(EE, ELIGIBLE_FOR_STOCK=[T, F], INITIAL_OPTION_GRANT=[50.0, 50.0]),
    "EC747": case(EE, INITIAL_OPTION_GRANT=[50.0, -1.0]),
    "EC748": case(EE, SHIFT_RATE=[1.5, -1.5]),
    "EC749": case(EE, SHIFT_FACTOR=[1.0, -1.0]),
    "EC750": case(EE, TRAVEL_DISTANCE=[12.0, -12.0]),
    "EC751": case(EE, CONTINUED_SICKNESS_PAY_PERIOD=[6, -6]),
    "EC752": case(EE, PROBATIONARY_PERIOD=[3, -3]),
    "EC753": case(EE, IS_SHIFT_EMPLOYEE=[T, F], SHIFT_RATE=[1.5, 1.5], SHIFT_FACTOR=[None, None]),
    "EC754": case(EE, PROBATIONARY_PERIOD=[3, 3], PROBATIONARY_PERIOD_MEASURE=["M", None]),
    "EC755": case(EE, CONTINUED_SICKNESS_PAY_PERIOD=[6, 6], CONTINUED_SICKNESS_PAY_MEASURE=["W", None]),
    "EC756": case(EE, FGTS_PERCENT=[8.0, 108.0]),
    "EC757": case(EE, FGTS_OPTANT=[T, T], FGTS_DATE=[PAST, None]),
    "EC758": case(EE, FGTS_DATE=[PAST, FUT]),
    "EC759": case(EE, CONTRACT_DATE=[PAST, FUT]),
    "EC760": case(EE, CONTRACT_DATE=[OLD, FUT], CONTRACT_END_DATE=[PAST, PAST]),
    "EC761": case(EE, EXCHANGE_RATE=[18.2, 0.0]),
    "EC762": case(EE, WTD_HOURS_LIMIT=["48", "200"]),
    "EC763": case(EE, DEGREE_OF_PRODUCTIVITY=[90.0, 120.0]),
    "EC764": case(EE, GUARANTEED_PAYMENT=[1000.0, -1000.0]),
    "EC765": case(EE, REGRET_TERMINATION=[T, T], STATUS=["T", "A"], TERMINATION_DATE=[PAST, None]),
    "EC766": case(EE, REGRET_TERMINATION=[T, T], OK_TO_REHIRE=[T, F]),
    "EC767": case(P, EFFECTIVE_START_DATE=[OLD, PAST], EFFECTIVE_END_DATE=[PAST, OLD]),
    "EC768": case(P, EFFECTIVE_DATE=[PAST, PAST], EFFECTIVE_START_DATE=[PAST, OLD]),
    "EC769": case(P, PAY_TYPE=["MAIN", None], IBAN=["DE00", "DE01"], ACCOUNT_NUMBER=[None, None]),
    "EC770": case(P, JOB_COUNTRY=["ZAF", None]),
    "EC771": case(M, DATE_OF_BIRTH=[OLD, FUT]),
    "EC772": case(M, IS_DEPENDENT=[T, T], DATE_OF_BIRTH=[OLD, None]),
    "EC773": case(M, IS_STUDENT=[T, T], DATE_OF_BIRTH=["20050101", "19700101"]),
    "EC774": case(M, PHONE=["+27 82 555 0101", "+27 82 555 0101"], SECOND_PHONE=["+27 82 555 0202", "+27 82 555 0101"]),
    "EC775": case(M, IS_DEPENDENT=[T, T], IS_ADD_SAME_AS_EMPLOYEE=[T, F], ADDRESS=[None, None]),
    "EC776": case(W, IS_VALIDATED=[T, T], ISSUING_AUTHORITY=["Home Affairs", None]),
    "EC777": case(I, IS_TEMPORARY=[T, T], TEMPORARY_ID=["TMP1", None]),
    "EC778": case(I, SINCE=[PAST, FUT]),
    "EC779": case(I, SINCE=[PAST, OLD], DATE_OF_BIRTH=[OLD, PAST]),
    "EC780": case(I, CHALLENGE_STATUS=[T, T], CERTIFICATE_START_DATE=[PAST, None]),
}
# EC781 bad row must be row 1: vacant with incumbent.
CASES["EC781"] = case(O, VACANT=[F, T], INCUMBENT=["u1", "u2"])


def fire(rid, tables):
    frames = TableFrames(tables, S4, module="employee_central")
    _, res = run_rule(dict(BY_ID[rid]), frames, {})
    assert res is not None and not res.error, (rid, res and res.error)
    return res.affected_count


def test_ids_contiguous_and_fully_enriched():
    assert [int(r["id"][2:]) for r in NEW] == list(range(728, 782))
    for r in NEW:
        for k in MANDATORY:
            assert r.get(k), (r["id"], k)
        cols = re.findall(r"`([A-Z0-9]+\.[A-Z0-9_]+)`", r["fail_when"]) + [r["field"]]
        cols += re.findall(r"\{([A-Z0-9]+\.[A-Z0-9_]+)\}", r["record_fix_template"])
        for c in cols:
            assert S4.field(*c.split(".")) is not None, (r["id"], c)


def test_every_new_rule_has_a_fixture():
    assert {r["id"] for r in NEW} == set(CASES)


@pytest.mark.parametrize("rid", sorted(CASES))
def test_flags_only_the_bad_row(rid):
    assert fire(rid, CASES[rid]) == 1


@pytest.mark.parametrize("value,bad", [("0", False), ("48", False), ("48.5", False), ("168", False),
                                       ("168.5", True), ("169", True), ("-1", True), ("forty", True)])
def test_ec762_hours_limit_range(value, bad):
    assert fire("EC762", case(EE, WTD_HOURS_LIMIT=["48", value])) == int(bad)
