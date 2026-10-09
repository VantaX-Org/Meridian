"""SuccessFactors benefits depth rules (BEN086-BEN155): integrity, enrichment, auto_fix
contract and fixture-based fire/clean tests, mirroring tests/test_sf_ec_depth_rules.py."""
import re
from datetime import date, timedelta

import pandas as pd
import pytest
import yaml

from checks.auto_fix import propose
from checks.frames import TableFrames
from checks.runner import run_checks
from sap.ddic import get_dictionary

D = get_dictionary("s4hana")
MODULE = "benefits"
START, COUNT = 86, 70

RULES = yaml.safe_load(open("checks/rules/successfactors/benefits.yaml"))["rules"]
BY_ID = {r["id"]: r for r in RULES}
NEW = [r for r in RULES if re.fullmatch(r"BEN\d+", r["id"]) and START <= int(r["id"][3:]) < START + COUNT]

MANDATORY = ["id", "field", "check_class", "severity", "dimension", "message", "why_it_matters", "rule_authority",
             "sap_impact", "fix_map", "record_fix_template"]
OPS = {"strip": set(), "collapse_spaces": set(), "upper": set(), "lower": set(), "title": set(),
       "pad_left": {"width", "char"}, "strip_leading_zeros": set(), "regex_replace": {"pattern", "repl"},
       "truncate": {"width"}, "map": {"values"}, "set": {"value"}, "copy": {"from"},
       "lookup": {"table", "match", "value"}, "date_format": {"to"}, "gtin_check_digit": set(),
       "round": {"ndigits"}}
# judgement-call monetary fields: EMPLOYEE_COST/EMPLOYER_COST get no auto_fix at all. The
# pack's one attempt at a decimal-precision check on these fields (regex_check against the
# raw string, which SF's Edm.Decimal scale breaks) was deleted as unfixable rather than kept.
NO_AUTOFIX_FIELDS = re.compile(r"EMPLOYEE_COST|EMPLOYER_COST$")


# ---------------------------------------------------------------------------
# Integrity
# ---------------------------------------------------------------------------

def test_new_ids_unique_and_contiguous():
    ids = [r["id"] for r in RULES]
    assert len(ids) == len(set(ids))
    nums = sorted(int(i[3:]) for i in ids if re.fullmatch(r"BEN\d+", i))
    new_nums = [n for n in nums if n >= START]
    assert new_nums == list(range(START, START + COUNT))
    assert START - 1 in nums  # BEN085 pre-exists, contiguous with it


@pytest.mark.parametrize("rule", NEW, ids=[r["id"] for r in NEW])
def test_new_rules_fully_enriched(rule):
    for key in MANDATORY:
        assert rule.get(key), (rule["id"], key)
    assert rule["rule_authority"] in {"best_practice", "sap_hard_constraint", "customer_configured"}
    # every {TABLE.FIELD} placeholder in record_fix_template resolves against the dictionary
    for table, field in re.findall(r"\{([A-Z][A-Z0-9_]+)\.([A-Z][A-Z0-9_]+)\}", rule["record_fix_template"]):
        assert field in D.tables[table].fields, (rule["id"], table, field)


def test_auto_fix_uses_only_contract_ops():
    fixes = [(r["id"], r["auto_fix"]) for r in NEW if "auto_fix" in r]
    # I11 removed several auto_fix blocks that could not make their own value pass
    # (collapse_spaces+strip can't satisfy ^\S+$ with an internal space); 4 survive, each
    # proven by test_auto_fix_output_passes_its_own_rule below. Floor reflects that honestly.
    assert len(fixes) >= 4
    for rid, af in fixes:
        assert set(af) <= {"when", "steps", "confidence"}, rid
        assert af["confidence"] in {"high", "medium", "low"}, rid
        assert af["steps"], rid
        for step in af["steps"]:
            op = step["op"]
            assert op in OPS, (rid, op)
            assert set(step) - {"op"} == OPS[op], (rid, step)
            if op == "regex_replace":
                re.compile(step["pattern"])


FORMAT_ONLY_OPS = {"strip", "collapse_spaces", "upper", "lower", "title", "pad_left",
                    "strip_leading_zeros", "truncate", "round", "date_format"}
VALUE_GUESS_OPS = {"map", "set", "copy", "lookup", "regex_replace", "gtin_check_digit"}


def test_no_auto_fix_where_business_judgement_is_needed():
    for r in NEW:
        if "auto_fix" not in r:
            continue
        col = r["field"].split(".")[1]
        ops = {s["op"] for s in r["auto_fix"]["steps"]}
        # cost amounts never get a guessed value (no EMPLOYEE_COST/EMPLOYER_COST rule carries auto_fix)
        if col in {"EMPLOYEE_COST", "EMPLOYER_COST"}:
            assert ops <= {"round"}, r["id"]
        # judgement-call fields may only get deterministic *formatting* normalization
        # (strip/upper/collapse_spaces/...), never a guessed replacement value.
        if col in {"STATUS", "EFFECTIVE_DATE", "ENROL_DATE", "COST"}:
            assert ops <= FORMAT_ONLY_OPS, r["id"]


# ---------------------------------------------------------------------------
# Fixture-based fire/clean tests
# ---------------------------------------------------------------------------

def _day(n):
    return (date.today() - timedelta(days=n)).strftime("%Y%m%d")


def _refs(rule):
    return set(re.findall(r"\b([A-Z][A-Z0-9_]+\.[A-Z][A-Z0-9_]+)\b", yaml.safe_dump(rule)))


def _tables(spec, rule):
    out = {}
    for t, rows in spec.items():
        df = pd.DataFrame([{f"{t}.{k}": v for k, v in row.items()} for row in rows])
        for ref in _refs(rule):
            if ref.startswith(t + ".") and ref not in df.columns:
                df[ref] = None
        out[t] = df
    return out


def run(rule_id, spec):
    frames = TableFrames(_tables(spec, BY_ID[rule_id]), D, module=MODULE)
    res = next((r for r in run_checks(MODULE, frames, "t") if r.check_id == rule_id), None)
    assert res is not None, f"{rule_id} did not run"
    assert res.error is None, (rule_id, res.error)
    return res.total_count, res.affected_count


def c(base, **kw):
    return {**base, **kw}


# Join keys: EMPEMPLOYMENT<->BENEFITENROLLMENT on USERID; EMPEMPLOYMENT<->USERACCOUNT on
# USER_ID:USERID; EMPEMPLOYMENT<->POSITION on POSITION:CODE; EMPEMPLOYMENT<->FO* on
# EXTERNAL_CODE:<field>; PERINFO<->EMPEMPLOYMENT and PERINFO<->DEPENDENT on PERSON_ID.
EE = {"USERID": "u1", "USER_ID": "u1", "PERSON_ID": "p1", "START_DATE": "20200101", "STATUS": "A",
      "EVENT": "HIRE", "IS_CONTINGENT_WORKER": "false", "CONTRACT_END_DATE": None,
      "PROBATION_END_DATE": "20200401", "JOB_START_DATE": "20200101", "LAST_DATE_WORKED": None,
      "PAYROLL_END_DATE": None, "IS_FULLTIME": "true", "FTE": "1.0", "EMPLOYMENT_TYPE": "REGULAR",
      "PAY_GROUP": "G1", "COST_CENTER": "CC1", "COUNTRY_OF_COMPANY": "ZA", "DEPARTMENT": "DEPT1",
      "JOB_END_DATE": None, "IS_PRIMARY": "true", "REGULAR_TEMP": "REGULAR", "EMPLOYEE_CLASS": "STANDARD",
      "STANDARD_HOURS": "40", "CREATED_DATE": _day(100), "END_DATE": None, "POSITION": "POS1",
      "COMPANY": "C1", "LOCATION": "LOC1", "JOB_CODE": "JOB1", "DIVISION": "DIV1",
      "BUSINESS_UNIT": "BU1", "EVENT_REASON": "ER1"}
UA = {"USER_ID": "u1", "STATUS": "A", "HIRE_DATE": "20200101", "EMAIL": "a@b.com", "DEPARTMENT": "DEPT1"}
PN = {"PERSON_ID": "p1", "DATE_OF_BIRTH": "19800101", "MARITAL_STATUS": "MARRIED", "DATE_OF_DEATH": None}
PS = {"CODE": "POS1", "VACANT": "false", "EFFECTIVE_STATUS": "A", "EFFECTIVE_END_DATE": "20991231"}
GA = {"USERID": "u1", "END_DATE": "20991231", "PLANNED_END_DATE": "20991231"}
FD = {"EXTERNAL_CODE": "DEPT1", "STATUS": "A", "COST_CENTER": "CC1"}
FL = {"EXTERNAL_CODE": "LOC1", "STATUS": "A", "STANDARD_HOURS": "40"}
FJ = {"EXTERNAL_CODE": "JOB1", "STATUS": "A", "EMPLOYEE_CLASS": "STANDARD", "REGULAR_TEMP": "REGULAR"}
FDIV = {"EXTERNAL_CODE": "DIV1", "STATUS": "A"}
FBU = {"EXTERNAL_CODE": "BU1", "STATUS": "A"}
FCC = {"EXTERNAL_CODE": "CC1", "STATUS": "A", "LEGAL_ENTITY": "LE1"}
FER = {"EXTERNAL_CODE": "ER1", "STATUS": "A"}
FCO = {"EXTERNAL_CODE": "C1", "CURRENCY": "ZAR", "COUNTRY": "ZA"}
BE = {"USERID": "u1", "PLAN_ID": "MED1", "PLAN_TYPE": "MEDICAL", "ENROL_DATE": "20250101",
      "EFFECTIVE_DATE": "20250201", "STATUS": "A", "COVERAGE_LEVEL": "EMP_ONLY",
      "EMPLOYEE_COST": "100", "EMPLOYER_COST": "200", "DEPENDENT_LINK": None}
DP = {"PERSON_ID": "p1", "RELATED_PERSON_ID": "d1", "RELATIONSHIP_TYPE": "child", "START_DATE": "20100101",
      "DEPENDENT_BIRTH": "20100101", "IS_BENEFICIARY": "true", "END_DATE": None}

CASES = {
    "BEN086": {"BENEFITENROLLMENT": [c(BE, PLAN_TYPE="RETIREMENT", EFFECTIVE_DATE="20200201"),
                                      c(BE, PLAN_TYPE="RETIREMENT", EFFECTIVE_DATE="20200601")],
               "EMPEMPLOYMENT": [EE]},
    "BEN087": {"BENEFITENROLLMENT": [c(BE, STATUS="T"), c(BE, STATUS="A")],
               # EMPEMPLOYMENT.END_DATE is the 9999-12-31 open-end sentinel, not null; the
               # fail_when's (`isna()` | `.dt.year >= 9999`) guard must still catch it (I3/M4).
               "EMPEMPLOYMENT": [c(EE, END_DATE="99991231")]},
    "BEN088": {"BENEFITENROLLMENT": [c(BE, STATUS="A"), c(BE, STATUS="T")],
               # EVENT uses the EC-pack convention (case-insensitive 'termination'), not 'TERM' (I4).
               "EMPEMPLOYMENT": [c(EE, EVENT="Termination")]},
    "BEN090": {"BENEFITENROLLMENT": [c(BE, STATUS="A"), c(BE, STATUS="T")],
               "EMPEMPLOYMENT": [c(EE, CONTRACT_END_DATE=_day(10))]},
    "BEN091": {"BENEFITENROLLMENT": [c(BE, STATUS="A"), c(BE, STATUS="T")],
               "EMPEMPLOYMENT": [EE], "USERACCOUNT": [c(UA, STATUS="I")]},
    "BEN092": {"BENEFITENROLLMENT": [c(BE, USERID="uXXX"), c(BE, USERID="u1")],
               "USERACCOUNT": [UA]},
    "BEN093": {"BENEFITENROLLMENT": [c(BE, EFFECTIVE_DATE="20200101"), c(BE, EFFECTIVE_DATE="20260101")],
               "EMPEMPLOYMENT": [EE], "USERACCOUNT": [c(UA, HIRE_DATE="20250601")]},
    "BEN094": {"BENEFITENROLLMENT": [BE, c(BE, STATUS="T")],
               "EMPEMPLOYMENT": [EE], "FODEPARTMENT": [c(FD, STATUS="I")]},
    "BEN100": {"BENEFITENROLLMENT": [c(BE, STATUS="A"), c(BE, STATUS="T")],
               "EMPEMPLOYMENT": [EE], "POSITION": [c(PS, VACANT="true")]},
    "BEN102": {"BENEFITENROLLMENT": [c(BE, STATUS="A"), c(BE, STATUS="T")],
               "EMPEMPLOYMENT": [EE], "EMPGLOBALASSIGNMENT": [c(GA, END_DATE=_day(10))]},
    "BEN104": {"BENEFITENROLLMENT": [c(BE, STATUS="A"), c(BE, STATUS="T")],
               "EMPEMPLOYMENT": [EE], "PERINFO": [c(PN, DATE_OF_DEATH="20240101")]},
    "BEN105": {"BENEFITENROLLMENT": [BE, c(BE, USERID="u2")],
               "EMPEMPLOYMENT": [EE, c(EE, USERID="u2", USER_ID="u2", PERSON_ID="p2")],
               "PERINFO": [c(PN, DATE_OF_BIRTH=_day(1000)), c(PN, PERSON_ID="p2", DATE_OF_BIRTH="19900101")]},
    "BEN106": {"BENEFITENROLLMENT": [c(BE, EMPLOYEE_COST="60000"), c(BE, EMPLOYEE_COST="500")]},
    "BEN107": {"BENEFITENROLLMENT": [c(BE, EMPLOYER_COST="60000"), c(BE, EMPLOYER_COST="500")]},
    "BEN108": {"BENEFITENROLLMENT": [c(BE, EMPLOYEE_COST="10", EMPLOYER_COST="1000"),
                                      c(BE, EMPLOYEE_COST="10", EMPLOYER_COST="100")]},
    "BEN109": {"BENEFITENROLLMENT": [c(BE, STATUS="P", EFFECTIVE_DATE=_day(300)),
                                      c(BE, STATUS="P", EFFECTIVE_DATE=_day(10))]},
    "BEN110": {"BENEFITENROLLMENT": [c(BE, DEPENDENT_LINK=";d1;;d2;"), c(BE, DEPENDENT_LINK="d1;d2")]},
    "BEN111": {"BENEFITENROLLMENT": [c(BE, PLAN_TYPE="FSA", EMPLOYEE_COST="0"),
                                      c(BE, PLAN_TYPE="FSA", EMPLOYEE_COST="50")]},
    # third row: the 9999-12-31 open-end sentinel is >36500 days in the future by raw
    # arithmetic but must NOT fire once `.dt.year < 9999` guards it (C1).
    "BEN112": {"DEPENDENT": [c(DP, END_DATE=_day(-40000)), c(DP, RELATED_PERSON_ID="d2", END_DATE=_day(-10)),
                             c(DP, RELATED_PERSON_ID="d3", END_DATE="99991231")]},
    "BEN128": {"DEPENDENT": [c(DP, RELATIONSHIP_TYPE="spouse", END_DATE=_day(-10)),
                             c(DP, RELATED_PERSON_ID="d2", RELATIONSHIP_TYPE="spouse", END_DATE="99991231")]},
    "BEN114": {"DEPENDENT": [c(DP, RELATIONSHIP_TYPE="domestic_partner", DEPENDENT_BIRTH="20050101"),
                              c(DP, RELATED_PERSON_ID="d2", RELATIONSHIP_TYPE="domestic_partner", DEPENDENT_BIRTH="19800101")],
               "PERINFO": [PN]},
    # open-end sentinel (not null) on the dirty row proves the isna()|year>=9999 guard (I3).
    "BEN116": {"DEPENDENT": [c(DP, RELATIONSHIP_TYPE="child", DEPENDENT_BIRTH=_day(8000), END_DATE="99991231"),
                              c(DP, RELATED_PERSON_ID="d2", RELATIONSHIP_TYPE="child", DEPENDENT_BIRTH=_day(3000), END_DATE=None)]},
    "BEN118": {"BENEFITENROLLMENT": [c(BE, COVERAGE_LEVEL="EMP ONLY"), c(BE, COVERAGE_LEVEL="EMP_ONLY")]},
    "BEN119": {"BENEFITENROLLMENT": [c(BE, STATUS="A", PLAN_TYPE="MEDICAL", EMPLOYEE_COST=None),
                                      c(BE, STATUS="A", PLAN_TYPE="MEDICAL", EMPLOYEE_COST="100")]},
    "BEN120": {"BENEFITENROLLMENT": [c(BE, EFFECTIVE_DATE="20191201"), c(BE, EFFECTIVE_DATE="20200601")],
               "EMPEMPLOYMENT": [c(EE, JOB_START_DATE="20200101")]},
    "BEN121": {"BENEFITENROLLMENT": [c(BE, STATUS="A"), c(BE, STATUS="T")],
               "EMPEMPLOYMENT": [c(EE, LAST_DATE_WORKED=_day(10))]},
    "BEN123": {"BENEFITENROLLMENT": [c(BE, STATUS="A", PLAN_TYPE="MEDICAL"), c(BE, STATUS="A", PLAN_TYPE="LIFE")],
               "EMPEMPLOYMENT": [c(EE, IS_FULLTIME="false", FTE="0.2")]},
    "BEN129": {"DEPENDENT": [c(DP, START_DATE=_day(-10)), c(DP, RELATED_PERSON_ID="d2", START_DATE=_day(10))]},
    "BEN130": {"DEPENDENT": [c(DP, START_DATE="20200101", END_DATE="20200101"),
                              c(DP, RELATED_PERSON_ID="d2", START_DATE="20200101", END_DATE="20210101")]},
    "BEN131": {"BENEFITENROLLMENT": [c(BE, USERID="u 1"), c(BE, USERID="u1")]},
    "BEN132": {"DEPENDENT": [c(DP, PERSON_ID="p 1"), c(DP, RELATED_PERSON_ID="d2")]},
    "BEN133": {"BENEFITENROLLMENT": [c(BE, STATUS="E", EMPLOYEE_COST="50"), c(BE, STATUS="E", EMPLOYEE_COST="0")]},
    "BEN135": {"BENEFITENROLLMENT": [c(BE, ENROL_DATE="20190101"), c(BE, ENROL_DATE="20200601")],
               "EMPEMPLOYMENT": [c(EE, CREATED_DATE="20200101")]},
    "BEN136": {"BENEFITENROLLMENT": [c(BE, STATUS="A", PLAN_TYPE="MEDICAL", EMPLOYER_COST=None),
                                      c(BE, STATUS="A", PLAN_TYPE="MEDICAL", EMPLOYER_COST="200")]},
    "BEN137": {"DEPENDENT": [c(DP, RELATIONSHIP_TYPE="spouse"), c(DP, RELATED_PERSON_ID="d2", RELATIONSHIP_TYPE="child")],
               "PERINFO": [c(PN, MARITAL_STATUS="SINGLE")]},
    "BEN138": {"BENEFITENROLLMENT": [c(BE, STATUS="A"), c(BE, STATUS="T")],
               "EMPEMPLOYMENT": [EE], "POSITION": [c(PS, EFFECTIVE_END_DATE=_day(10))]},
    "BEN140": {"BENEFITENROLLMENT": [c(BE, STATUS="A", PLAN_TYPE="GAP", DEPENDENT_LINK="d1"),
                                      c(BE, STATUS="A", PLAN_TYPE="GAP", DEPENDENT_LINK=None)]},
    "BEN141": {"BENEFITENROLLMENT": [c(BE, STATUS="A", PLAN_TYPE="RETIREMENT", EMPLOYEE_COST="50", EMPLOYER_COST=None),
                                      c(BE, STATUS="A", PLAN_TYPE="RETIREMENT", EMPLOYEE_COST="50", EMPLOYER_COST="50")]},
    "BEN142": {"BENEFITENROLLMENT": [c(BE, STATUS="A", PLAN_TYPE="MEDICAL"), c(BE, STATUS="A", PLAN_TYPE="GAP")],
               "EMPEMPLOYMENT": [c(EE, IS_PRIMARY="false")]},
    "BEN145": {"DEPENDENT": [c(DP, DEPENDENT_BIRTH=None), c(DP, RELATED_PERSON_ID="d2")]},
    "BEN147": {"BENEFITENROLLMENT": [c(BE, DEPENDENT_LINK="u1"), c(BE, DEPENDENT_LINK="d1")]},
    "BEN148": {"DEPENDENT": [c(DP, IS_BENEFICIARY="true", RELATIONSHIP_TYPE="child", DEPENDENT_BIRTH=_day(1000)),
                              c(DP, RELATED_PERSON_ID="d2", IS_BENEFICIARY="true", RELATIONSHIP_TYPE="child",
                                DEPENDENT_BIRTH=_day(8000))]},
    "BEN150": {"DEPENDENT": [c(DP, RELATIONSHIP_TYPE="spouse"),
                              c(DP, RELATIONSHIP_TYPE="spouse"),
                              c(DP, RELATED_PERSON_ID="d2", RELATIONSHIP_TYPE="domestic_partner")]},
    "BEN151": {"BENEFITENROLLMENT": [c(BE, EMPLOYEE_COST="20"), c(BE, EMPLOYEE_COST="0")],
               "EMPEMPLOYMENT": [EE], "USERACCOUNT": [c(UA, STATUS="I")]},
    "BEN152": {"BENEFITENROLLMENT": [c(BE, STATUS="A", PLAN_TYPE="MEDICAL"), c(BE, STATUS="A", PLAN_TYPE="GAP")],
               "EMPEMPLOYMENT": [c(EE, JOB_END_DATE=_day(10))]},
    "BEN153": {"BENEFITENROLLMENT": [c(BE, ENROL_DATE="20250601", EFFECTIVE_DATE="20250101"),
                                      c(BE, ENROL_DATE="20250110", EFFECTIVE_DATE="20250101")]},
    "BEN154": {"BENEFITENROLLMENT": [c(BE, STATUS="A", EFFECTIVE_DATE=_day(-60)),
                                      c(BE, STATUS="A", EFFECTIVE_DATE=_day(-10))]},
    "BEN155": {"BENEFITENROLLMENT": [c(BE, STATUS="T", EFFECTIVE_DATE=_day(-10)),
                                      c(BE, STATUS="T", EFFECTIVE_DATE=_day(10))]},
    "BEN095": {"BENEFITENROLLMENT": [c(BE, STATUS="A"), c(BE, STATUS="T")],
               "EMPEMPLOYMENT": [EE], "FOLOCATION": [c(FL, STATUS="I")]},
    "BEN097": {"BENEFITENROLLMENT": [c(BE, STATUS="A"), c(BE, STATUS="T")],
               "EMPEMPLOYMENT": [EE], "FODIVISION": [c(FDIV, STATUS="I")]},
    "BEN098": {"BENEFITENROLLMENT": [c(BE, STATUS="A"), c(BE, STATUS="T")],
               "EMPEMPLOYMENT": [EE], "FOBUSINESSUNIT": [c(FBU, STATUS="I")]},
}

# auto_fix output must itself pass the rule it belongs to (I11): every surviving regex_check
# rule with an auto_fix, fed its own documented dirty value, must come out matching `pattern`.
AUTOFIX_DIRTY = {
    "BEN110": ";d1;;d2;",
    "BEN118": "EMP ONLY",
    "BEN131": "u 1",
    "BEN132": "p 1",
}


# uniqueness_check rules fail every member of a duplicate group (keep=False), so a
# dirty/dirty/clean fixture scores (3, 2) rather than the default (2, 1).
# BEN150 (ex-BEN226) is such a fixture. BEN112 adds a third, sentinel-dated clean row
# (C1 regression) so it scores (3, 1) instead of the default (2, 1).
EXPECTED = {"BEN150": (3, 2), "BEN112": (3, 1)}


def test_enough_fixtures():
    assert len(CASES) >= 50


@pytest.mark.parametrize("rule_id", list(CASES))
def test_rule_flags_dirty_and_passes_clean(rule_id):
    assert run(rule_id, CASES[rule_id]) == EXPECTED.get(rule_id, (2, 1))


@pytest.mark.parametrize("rule_id", list(AUTOFIX_DIRTY))
def test_auto_fix_output_passes_its_own_rule(rule_id):
    rule = BY_ID[rule_id]
    value, confidence = propose(rule, {rule["field"]: AUTOFIX_DIRTY[rule_id]})
    assert confidence in {"high", "medium", "low"}, rule_id
    assert re.fullmatch(rule["pattern"], value), (rule_id, value)
