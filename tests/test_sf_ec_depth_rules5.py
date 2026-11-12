"""Employee Central field-sweep rules EC782-EC908: Boolean, text, count and date fields
that no earlier rule covered. Each rule fires on its bad row ("k2") and passes the clean one."""
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
NEW = [r for r in RULES if re.fullmatch(r"EC\d+", r["id"]) and 782 <= int(r["id"][2:]) <= 908]
MANDATORY = ["id", "field", "check_class", "severity", "dimension", "message",
             "why_it_matters", "rule_authority", "sap_impact", "fix_map", "record_fix_template"]

# check id: (table, field, [clean value, bad value])
CASES = {
    "EC782": ("EMPEMPLOYMENT", "EMPLOYEE_FIRST_EMPLOYMENT", ['a b', 'a  b']),
    "EC783": ("EMPEMPLOYMENT", "ELIGIBLE_FOR_SAL_CONTINUATION", ['true', 'yes']),
    "EC784": ("EMPEMPLOYMENT", "TIME_IN_POSITION", ['a b', 'a  b']),
    "EC785": ("EMPEMPLOYMENT", "LOCAL_JOB_TITLE", ['a b', 'a  b']),
    "EC786": ("EMPEMPLOYMENT", "IS_CROSS_BORDER_WORKER", ['true', 'yes']),
    "EC787": ("EMPEMPLOYMENT", "IS_COMPETITION_CLAUSE_ACTIVE", ['true', 'yes']),
    "EC788": ("EMPEMPLOYMENT", "IS_SIDE_LINE_JOB_ALLOWED", ['true', 'yes']),
    "EC789": ("EMPEMPLOYMENT", "TIME_IN_JOB", ['a b', 'a  b']),
    "EC790": ("EMPEMPLOYMENT", "TIME_IN_COMPANY", ['a b', 'a  b']),
    "EC791": ("EMPEMPLOYMENT", "TIME_IN_LOCATION", ['a b', 'a  b']),
    "EC792": ("EMPEMPLOYMENT", "TIME_IN_DEPARTMENT", ['a b', 'a  b']),
    "EC793": ("EMPEMPLOYMENT", "TIME_IN_PAY_SCALE_LEVEL", ['a b', 'a  b']),
    "EC794": ("EMPEMPLOYMENT", "TIME_RECORDING_ADMISSIBILITY_CODE", ['a b', 'a  b']),
    "EC795": ("EMPEMPLOYMENT", "DEFAULT_OVERTIME_COMPENSATION_VARIANT", ['a b', 'a  b']),
    "EC796": ("EMPEMPLOYMENT", "CORPORATION", ['a b', 'a  b']),
    "EC797": ("EMPEMPLOYMENT", "PERMIT_INDICATOR", ['true', 'yes']),
    "EC798": ("EMPEMPLOYMENT", "PCFM", ['true', 'yes']),
    "EC799": ("EMPEMPLOYMENT", "RETIRED", ['true', 'yes']),
    "EC800": ("EMPEMPLOYMENT", "HEALTH_RISK", ['true', 'yes']),
    "EC801": ("EMPEMPLOYMENT", "HAZARD", ['true', 'yes']),
    "EC802": ("EMPEMPLOYMENT", "INTEGRATION_AGENT", ['a b', 'a  b']),
    "EC803": ("EMPEMPLOYMENT", "EDUCATIONAL_ENTITY", ['a b', 'a  b']),
    "EC804": ("EMPEMPLOYMENT", "WORK_LOCATION", ['a b', 'a  b']),
    "EC805": ("EMPEMPLOYMENT", "LABOR_PROTECTION", ['true', 'yes']),
    "EC806": ("EMPEMPLOYMENT", "NEW_CALC_AVG_PPU", ['true', 'yes']),
    "EC807": ("EMPEMPLOYMENT", "NEW_CALC_AVG_DNP", ['true', 'yes']),
    "EC808": ("EMPEMPLOYMENT", "ASSEDIC_CERT_INITIAL_STATE_NUM", [5, -5]),
    "EC809": ("EMPEMPLOYMENT", "ASSEDIC_CERT_OBJECT_NUM", [5, -5]),
    "EC810": ("EMPEMPLOYMENT", "CONTRACT_REFERENCE_FOR_AED", ['a b', 'a  b']),
    "EC811": ("EMPEMPLOYMENT", "EXCL_EXECUTIVE_SECTOR", ['true', 'yes']),
    "EC812": ("EMPEMPLOYMENT", "RESIDENT_VOTE", ['true', 'yes']),
    "EC813": ("EMPEMPLOYMENT", "MUNICIPAL_INSEE_CODE", [5, -5]),
    "EC814": ("EMPEMPLOYMENT", "NOTICE_PERIOD", ['a b', 'a  b']),
    "EC815": ("EMPEMPLOYMENT", "CONTRACT_ID", ['a b', 'a  b']),
    "EC816": ("EMPEMPLOYMENT", "CONTRACT_NUMBER", [5, -5]),
    "EC817": ("EMPEMPLOYMENT", "INELIGIBLE_STATUTORY_MIN_WAGE", ['true', 'yes']),
    "EC818": ("EMPEMPLOYMENT", "SPCL_RULE_NON_MANUAL_WORKER", ['true', 'yes']),
    "EC819": ("EMPEMPLOYMENT", "PAYMENT_IN_LIEU_OF_NOTICE", ['true', 'yes']),
    "EC820": ("EMPEMPLOYMENT", "CALCULATION_BASE", ['a b', 'a  b']),
    "EC821": ("EMPEMPLOYMENT", "CREDIT_FOR_PREVIOUS_SERVICE", ['a b', 'a  b']),
    "EC822": ("EMPEMPLOYMENT", "CURRENT_WAGE_LEVEL", [5.0, -5.0]),
    "EC823": ("EMPEMPLOYMENT", "SICK_PAY_SUPPLEMENT_PERIOD", [5, -5]),
    "EC824": ("EMPEMPLOYMENT", "CHANGE_REASON", ['a b', 'a  b']),
    "EC825": ("EMPEMPLOYMENT", "CHANGE_REASON_EXTERNAL", ['a b', 'a  b']),
    "EC826": ("EMPEMPLOYMENT", "VALID_FROM", ['20200101', '18500101']),
    "EC827": ("EMPEMPLOYMENT", "CALC_METHOD_INDICATOR", ['true', 'yes']),
    "EC828": ("EMPEMPLOYMENT", "WORKING_TIME_DIRECTIVE", ['true', 'yes']),
    "EC829": ("EMPEMPLOYMENT", "TUPE_ORG_NUMBER", ['a b', 'a  b']),
    "EC830": ("EMPEMPLOYMENT", "PENSION_PROTECTION", ['true', 'yes']),
    "EC831": ("EMPEMPLOYMENT", "TEACHERS_PENSION", ['true', 'yes']),
    "EC832": ("PERINFO", "REGION_OF_BIRTH", ['a b', 'a  b']),
    "EC833": ("PERINFO", "SECOND_LAST_NAME", ['a b', 'a  b']),
    "EC834": ("PERINFO", "FIRST_NAME_ALT1", ['a b', 'a  b']),
    "EC835": ("PERINFO", "MIDDLE_NAME_ALT1", ['a b', 'a  b']),
    "EC836": ("PERINFO", "LAST_NAME_ALT1", ['a b', 'a  b']),
    "EC837": ("PERINFO", "FIRST_NAME_ALT2", ['a b', 'a  b']),
    "EC838": ("PERINFO", "MIDDLE_NAME_ALT2", ['a b', 'a  b']),
    "EC839": ("PERINFO", "LAST_NAME_ALT2", ['a b', 'a  b']),
    "EC840": ("PERINFO", "DISPLAY_NAME", ['a b', 'a  b']),
    "EC841": ("PERINFO", "FORMAL_NAME", ['a b', 'a  b']),
    "EC842": ("PERINFO", "TITLE", ['a b', 'a  b']),
    "EC843": ("PERINFO", "BIRTH_NAME_ALT1", ['a b', 'a  b']),
    "EC844": ("PERINFO", "BIRTH_NAME_ALT2", ['a b', 'a  b']),
    "EC845": ("PERINFO", "INITIALS", ['a b', 'a  b']),
    "EC846": ("PERINFO", "DISPLAY_NAME_ALT1", ['a b', 'a  b']),
    "EC847": ("PERINFO", "DISPLAY_NAME_ALT2", ['a b', 'a  b']),
    "EC848": ("PERINFO", "FORMAL_NAME_ALT1", ['a b', 'a  b']),
    "EC849": ("PERINFO", "FORMAL_NAME_ALT2", ['a b', 'a  b']),
    "EC850": ("PERINFO", "PARTNER_NAME", ['a b', 'a  b']),
    "EC851": ("PERINFO", "NAME_FORMAT_CODE", ['a b', 'a  b']),
    "EC852": ("PERINFO", "SCRIPT", ['a b', 'a  b']),
    "EC853": ("PERINFO", "SCRIPT_ALT1", ['a b', 'a  b']),
    "EC854": ("PERINFO", "SCRIPT_ALT2", ['a b', 'a  b']),
    "EC855": ("PERINFO", "THIRD_NAME", ['a b', 'a  b']),
    "EC856": ("PERINFO", "THIRD_NAME_ALT1", ['a b', 'a  b']),
    "EC857": ("PERINFO", "THIRD_NAME_ALT2", ['a b', 'a  b']),
    "EC858": ("PERADDRESS", "ADDRESS3", ['a b', 'a  b']),
    "EC859": ("PERADDRESS", "ADDRESS4", ['a b', 'a  b']),
    "EC860": ("PERADDRESS", "ADDRESS5", ['a b', 'a  b']),
    "EC861": ("PERADDRESS", "COUNTY", ['a b', 'a  b']),
    "EC862": ("PERADDRESS", "ADDRESS6", ['a b', 'a  b']),
    "EC863": ("PERADDRESS", "ADDRESS8", ['a b', 'a  b']),
    "EC864": ("PERADDRESS", "ADDRESS13", ['a b', 'a  b']),
    "EC865": ("PERADDRESS", "ADDRESS10", ['a b', 'a  b']),
    "EC866": ("PERADDRESS", "ADDRESS11", ['a b', 'a  b']),
    "EC867": ("PERADDRESS", "ADDRESS15", ['a b', 'a  b']),
    "EC868": ("PERADDRESS", "ADDRESS20", ['a b', 'a  b']),
    "EC869": ("PEREMERGENCY", "IS_EMERGENCY_CONTACT", ['true', 'yes']),
    "EC870": ("PEREMERGENCY", "GENDER", ['a', 'aaa']),
    "EC871": ("PEREMERGENCY", "IS_DISABLED", ['true', 'yes']),
    "EC872": ("PEREMERGENCY", "EC_NAME_ALT1", ['a b', 'a  b']),
    "EC873": ("PEREMERGENCY", "EC_NAME_ALT2", ['a b', 'a  b']),
    "EC874": ("EMPWORKPERMIT", "DOCUMENT_TITLE", ['a b', 'a  b']),
    "EC875": ("EMPWORKPERMIT", "ISSUE_PLACE", ['a b', 'a  b']),
    "EC876": ("PAYMENTINFO", "WORKER", ['a b', 'a  b']),
    "EC877": ("PAYMENTINFO", "PURPOSE", ['a b', 'a  b']),
    "EC878": ("COMPINFO", "PAYROLL_ID", ['a b', 'a  b']),
    "EC879": ("COMPINFO", "PAY_COMPONENT_CURRENCY", ['a b', 'a  b']),
    "EC880": ("COMPINFO", "PAY_COMPONENT_FREQUENCY", ['a b', 'a  b']),
    "EC881": ("COMPINFO", "PAY_COMPONENT_IS_EARNING", ['true', 'yes']),
    "EC882": ("COMPINFO", "SEQ_NUMBER", [5, -5]),
    "EC883": ("COMPINFO", "IS_ELIGIBLE_FOR_BENEFITS", ['true', 'yes']),
    "EC884": ("COMPINFO", "IS_ELIGIBLE_FOR_CAR", ['true', 'yes']),
    "EC885": ("COMPINFO", "IS_HIGHLY_COMPENSATED_EMPLOYEE", ['true', 'yes']),
    "EC886": ("COMPINFO", "IS_INSIDER", ['true', 'yes']),
    "EC887": ("POSITION", "POSITION_TITLE", ['a b', 'a  b']),
    "EC888": ("POSITION", "POSITION_CONTROLLED", ['true', 'yes']),
    "EC889": ("POSITION", "COMMENT", ['a b', 'a  b']),
    "EC890": ("POSITION", "DESCRIPTION", ['a b', 'a  b']),
    "EC891": ("POSITION", "JOB_TITLE", ['a b', 'a  b']),
    "EC892": ("POSITION", "POSITION_MATRIX_RELATIONSHIP", ['a b', 'a  b']),
    "EC893": ("POSITION", "RIGHT_TO_RETURN", ['a b', 'a  b']),
    "EC894": ("FOCOMPANY", "DESCRIPTION", ['a b', 'a  b']),
    "EC895": ("FODIVISION", "NAME", ['a b', 'a  b']),
    "EC896": ("FODIVISION", "HEAD_OF_UNIT", ['a b', 'a  b']),
    "EC897": ("FOBUSINESSUNIT", "NAME", ['a b', 'a  b']),
    "EC898": ("FOBUSINESSUNIT", "DESCRIPTION", ['a b', 'a  b']),
    "EC899": ("FOBUSINESSUNIT", "HEAD_OF_UNIT", ['a b', 'a  b']),
    "EC900": ("FODEPARTMENT", "DESCRIPTION", ['a b', 'a  b']),
    "EC901": ("FODEPARTMENT", "HEAD_OF_UNIT", ['a b', 'a  b']),
    "EC902": ("FOLOCATION", "CITY", ['a b', 'a  b']),
    "EC903": ("FOJOBCODE", "NAME", ['a b', 'a  b']),
    "EC904": ("FOJOBCODE", "DESCRIPTION", ['a b', 'a  b']),
    "EC905": ("FOJOBCODE", "WORKER_COMP_CODE", ['a b', 'a  b']),
    "EC906": ("FOJOBCODE", "DEFAULT_JOB_LEVEL", ['a b', 'a  b']),
    "EC907": ("FOJOBCODE", "STANDARD_WEEKLY_HOURS", ['a b', 'a  b']),
    "EC908": ("FOJOBCODE", "FULLTIME_EMPLOYEE", ['a b', 'a  b']),
}


def frame(table, field, values):
    keys = S4.keys(table)
    cols = {k: "1" for k in keys}
    cols[keys[0]] = ["k1", "k2"]
    cols[field] = values
    return {table: pd.DataFrame({f"{table}.{k}": v for k, v in cols.items()})}


def test_ids_contiguous_and_fully_enriched():
    assert [int(r["id"][2:]) for r in NEW] == list(range(782, 909))
    for r in NEW:
        for k in MANDATORY:
            assert r.get(k), (r["id"], k)
        assert S4.field(*r["field"].split(".")) is not None, r["id"]


def test_every_new_rule_has_a_fixture():
    assert {r["id"] for r in NEW} == set(CASES)


@pytest.mark.parametrize("rid", sorted(CASES))
def test_flags_only_the_bad_row(rid):
    table, field, values = CASES[rid]
    assert BY_ID[rid]["field"] == f"{table}.{field}"
    frames = TableFrames(frame(table, field, values), S4, module="employee_central")
    _, res = run_rule(dict(BY_ID[rid]), frames, {})
    assert res is not None and not res.error, (rid, res and res.error)
    assert res.affected_count == 1, (res.total_count, res.affected_count)
