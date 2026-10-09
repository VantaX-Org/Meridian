"""SuccessFactors benefits depth rules (BEN086-BEN233): integrity, enrichment, auto_fix
contract and fixture-based fire/clean tests, mirroring tests/test_sf_ec_depth_rules.py."""
import re
from datetime import date, timedelta

import pandas as pd
import pytest
import yaml

from checks.frames import TableFrames
from checks.runner import run_checks
from sap.ddic import get_dictionary

D = get_dictionary("s4hana")
MODULE = "benefits"
START, COUNT = 86, 148

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
NO_AUTOFIX_FIELDS = re.compile(r"EMPLOYEE_COST|EMPLOYER_COST$")  # judgement-call monetary fields; EMPLOYEE_COST/
# EMPLOYER_COST get no auto_fix at all (BEN176/177 are regex_check, decimal precision is flagged, never guessed).


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
    assert len(fixes) >= 10
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
        # cost amounts never get a guessed value (BEN176/177 carry no auto_fix at all)
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
    "BEN086": {"BENEFITENROLLMENT": [c(BE, ENROL_DATE="20250101"), c(BE, ENROL_DATE="20100201")],
               "EMPEMPLOYMENT": [c(EE, START_DATE="20100101")]},
    "BEN087": {"BENEFITENROLLMENT": [c(BE, PLAN_TYPE="RETIREMENT", EFFECTIVE_DATE="20200201"),
                                      c(BE, PLAN_TYPE="RETIREMENT", EFFECTIVE_DATE="20200601")],
               "EMPEMPLOYMENT": [EE]},
    "BEN088": {"BENEFITENROLLMENT": [c(BE, STATUS="T"), c(BE, STATUS="A")],
               "EMPEMPLOYMENT": [EE]},
    "BEN089": {"BENEFITENROLLMENT": [c(BE, EFFECTIVE_DATE="20250101"), c(BE, EFFECTIVE_DATE="20200201")],
               "EMPEMPLOYMENT": [c(EE, START_DATE="20200101")]},
    "BEN090": {"BENEFITENROLLMENT": [c(BE, STATUS="A"), c(BE, STATUS="T")],
               "EMPEMPLOYMENT": [c(EE, EVENT="TERM")]},
    "BEN092": {"BENEFITENROLLMENT": [c(BE, STATUS="A"), c(BE, STATUS="T")],
               "EMPEMPLOYMENT": [c(EE, CONTRACT_END_DATE=_day(10))]},
    "BEN093": {"BENEFITENROLLMENT": [c(BE, STATUS="A"), c(BE, STATUS="T")],
               "EMPEMPLOYMENT": [EE], "USERACCOUNT": [c(UA, STATUS="I")]},
    "BEN094": {"BENEFITENROLLMENT": [c(BE, USERID="uXXX"), c(BE, USERID="u1")],
               "USERACCOUNT": [UA]},
    "BEN095": {"BENEFITENROLLMENT": [c(BE, EFFECTIVE_DATE="20200101"), c(BE, EFFECTIVE_DATE="20260101")],
               "EMPEMPLOYMENT": [EE], "USERACCOUNT": [c(UA, HIRE_DATE="20250601")]},
    "BEN096": {"BENEFITENROLLMENT": [BE, c(BE, STATUS="T")],
               "EMPEMPLOYMENT": [EE], "FODEPARTMENT": [c(FD, STATUS="I")]},
    "BEN102": {"BENEFITENROLLMENT": [c(BE, STATUS="A"), c(BE, STATUS="T")],
               "EMPEMPLOYMENT": [EE], "POSITION": [c(PS, VACANT="true")]},
    "BEN104": {"BENEFITENROLLMENT": [c(BE, STATUS="A"), c(BE, STATUS="T")],
               "EMPEMPLOYMENT": [EE], "EMPGLOBALASSIGNMENT": [c(GA, END_DATE=_day(10))]},
    "BEN106": {"BENEFITENROLLMENT": [c(BE, STATUS="A"), c(BE, STATUS="T")],
               "EMPEMPLOYMENT": [EE], "PERINFO": [c(PN, DATE_OF_DEATH="20240101")]},
    "BEN107": {"BENEFITENROLLMENT": [BE, c(BE, USERID="u2")],
               "EMPEMPLOYMENT": [EE, c(EE, USERID="u2", USER_ID="u2", PERSON_ID="p2")],
               "PERINFO": [c(PN, DATE_OF_BIRTH="19200101"), c(PN, PERSON_ID="p2", DATE_OF_BIRTH="19900101")]},
    "BEN108": {"BENEFITENROLLMENT": [BE, c(BE, USERID="u2")],
               "EMPEMPLOYMENT": [EE, c(EE, USERID="u2", USER_ID="u2", PERSON_ID="p2")],
               "PERINFO": [c(PN, DATE_OF_BIRTH=_day(1000)), c(PN, PERSON_ID="p2", DATE_OF_BIRTH="19900101")]},
    "BEN109": {"BENEFITENROLLMENT": [c(BE, EMPLOYEE_COST="60000"), c(BE, EMPLOYEE_COST="500")]},
    "BEN110": {"BENEFITENROLLMENT": [c(BE, EMPLOYER_COST="60000"), c(BE, EMPLOYER_COST="500")]},
    "BEN111": {"BENEFITENROLLMENT": [c(BE, EMPLOYEE_COST="10", EMPLOYER_COST="1000"),
                                      c(BE, EMPLOYEE_COST="10", EMPLOYER_COST="100")]},
    "BEN112": {"BENEFITENROLLMENT": [c(BE, PLAN_ID="MED 1"), c(BE, PLAN_ID="MED1")]},
    "BEN113": {"BENEFITENROLLMENT": [c(BE, PLAN_TYPE=" medical"), c(BE, PLAN_TYPE="MEDICAL")]},
    "BEN114": {"BENEFITENROLLMENT": [c(BE, STATUS=" a"), c(BE, STATUS="A")]},
    "BEN115": {"BENEFITENROLLMENT": [c(BE, PLAN_ID="MED1"), c(BE, PLAN_ID="MED1"), c(BE, PLAN_ID="MED2")]},
    "BEN116": {"BENEFITENROLLMENT": [c(BE, COVERAGE_LEVEL="FAMILY", DEPENDENT_LINK="d1"),
                                      c(BE, COVERAGE_LEVEL="FAMILY", DEPENDENT_LINK="d1;d2")]},
    "BEN117": {"BENEFITENROLLMENT": [c(BE, STATUS="P", EFFECTIVE_DATE=_day(300)),
                                      c(BE, STATUS="P", EFFECTIVE_DATE=_day(10))]},
    "BEN118": {"BENEFITENROLLMENT": [c(BE, DEPENDENT_LINK=";d1;;d2;"), c(BE, DEPENDENT_LINK="d1;d2")]},
    "BEN119": {"BENEFITENROLLMENT": [c(BE, EMPLOYER_COST="0", EMPLOYEE_COST="0"),
                                      c(BE, EMPLOYER_COST="100", EMPLOYEE_COST="50")]},
    "BEN120": {"BENEFITENROLLMENT": [c(BE, PLAN_TYPE="LIFE", DEPENDENT_LINK=None),
                                      c(BE, PLAN_TYPE="LIFE", DEPENDENT_LINK="d1")]},
    "BEN121": {"BENEFITENROLLMENT": [c(BE, PLAN_TYPE="FSA", EMPLOYEE_COST="0"),
                                      c(BE, PLAN_TYPE="FSA", EMPLOYEE_COST="50")]},
    "BEN122": {"BENEFITENROLLMENT": [c(BE, PLAN_TYPE="RETIREMENT", COVERAGE_LEVEL="FAMILY"),
                                      c(BE, PLAN_TYPE="RETIREMENT", COVERAGE_LEVEL="EMP_ONLY")]},
    "BEN123": {"DEPENDENT": [c(DP, RELATIONSHIP_TYPE="sibling"), c(DP, RELATIONSHIP_TYPE="child", RELATED_PERSON_ID="d2")]},
    "BEN124": {"DEPENDENT": [c(DP, RELATED_PERSON_ID="d1"), c(DP, RELATED_PERSON_ID="d1"), c(DP, RELATED_PERSON_ID="d2")]},
    "BEN125": {"DEPENDENT": [c(DP, RELATED_PERSON_ID=None), c(DP, RELATED_PERSON_ID="d2")]},
    "BEN126": {"DEPENDENT": [c(DP, RELATIONSHIP_TYPE=None), c(DP, RELATED_PERSON_ID="d2")]},
    "BEN127": {"DEPENDENT": [c(DP, START_DATE=None), c(DP, RELATED_PERSON_ID="d2")]},
    "BEN128": {"DEPENDENT": [c(DP, END_DATE=_day(-40000)), c(DP, RELATED_PERSON_ID="d2", END_DATE=_day(-10))]},
    "BEN129": {"DEPENDENT": [c(DP, PERSON_ID="pX"), c(DP, RELATED_PERSON_ID="d2")],
               "PERINFO": [PN]},
    "BEN130": {"DEPENDENT": [c(DP, RELATIONSHIP_TYPE="spouse", END_DATE=None),
                              c(DP, RELATED_PERSON_ID="d2", RELATIONSHIP_TYPE="spouse", END_DATE="20200101")]},
    "BEN132": {"DEPENDENT": [c(DP, RELATIONSHIP_TYPE="domestic_partner", DEPENDENT_BIRTH="20050101"),
                              c(DP, RELATED_PERSON_ID="d2", RELATIONSHIP_TYPE="domestic_partner", DEPENDENT_BIRTH="19800101")],
               "PERINFO": [PN]},
    "BEN134": {"DEPENDENT": [c(DP, RELATIONSHIP_TYPE="child", DEPENDENT_BIRTH=_day(8000), END_DATE=None),
                              c(DP, RELATED_PERSON_ID="d2", RELATIONSHIP_TYPE="child", DEPENDENT_BIRTH=_day(3000), END_DATE=None)]},
    "BEN135": {"DEPENDENT": [c(DP, RELATIONSHIP_TYPE="parent", DEPENDENT_BIRTH=_day(60000)),
                              c(DP, RELATED_PERSON_ID="d2", RELATIONSHIP_TYPE="parent", DEPENDENT_BIRTH=_day(20000))]},
    "BEN136": {"DEPENDENT": [c(DP, RELATIONSHIP_TYPE="child", START_DATE="20050101", DEPENDENT_BIRTH="20100101"),
                              c(DP, RELATED_PERSON_ID="d2", RELATIONSHIP_TYPE="child", START_DATE="20150101",
                                DEPENDENT_BIRTH="20100101")]},
    "BEN137": {"DEPENDENT": [c(DP, PERSON_ID="pX", END_DATE=None),
                             c(DP, PERSON_ID="u1", RELATED_PERSON_ID="d2", END_DATE=None)],
               "BENEFITENROLLMENT": [BE], "PERINFO": [PN]},
    "BEN140": {"DEPENDENT": [c(DP, RELATIONSHIP_TYPE="child extra"), c(DP, RELATED_PERSON_ID="d2", RELATIONSHIP_TYPE="child")]},
    "BEN141": {"BENEFITENROLLMENT": [c(BE, COVERAGE_LEVEL="EMP ONLY"), c(BE, COVERAGE_LEVEL="EMP_ONLY")]},
    "BEN142": {"BENEFITENROLLMENT": [c(BE, STATUS="A", PLAN_TYPE="MEDICAL", EMPLOYEE_COST=None),
                                      c(BE, STATUS="A", PLAN_TYPE="MEDICAL", EMPLOYEE_COST="100")]},
    "BEN152": {"BENEFITENROLLMENT": [c(BE, EFFECTIVE_DATE="20191201"), c(BE, EFFECTIVE_DATE="20200601")],
               "EMPEMPLOYMENT": [c(EE, JOB_START_DATE="20200101")]},
    "BEN153": {"BENEFITENROLLMENT": [c(BE, STATUS="A"), c(BE, STATUS="T")],
               "EMPEMPLOYMENT": [c(EE, LAST_DATE_WORKED=_day(10))]},
    "BEN155": {"BENEFITENROLLMENT": [c(BE, STATUS="A", PLAN_TYPE="MEDICAL"), c(BE, STATUS="A", PLAN_TYPE="LIFE")],
               "EMPEMPLOYMENT": [c(EE, IS_FULLTIME="false", FTE="0.2")]},
    "BEN157": {"BENEFITENROLLMENT": [c(BE, STATUS="A"), c(BE, STATUS="T")],
               "EMPEMPLOYMENT": [EE], "USERACCOUNT": [c(UA, EMAIL=None)]},
    "BEN161": {"DEPENDENT": [c(DP, RELATIONSHIP_TYPE="spouse", DEPENDENT_BIRTH=_day(40000)),
                              c(DP, RELATED_PERSON_ID="d2", RELATIONSHIP_TYPE="spouse", DEPENDENT_BIRTH="19800101")]},
    "BEN167": {"DEPENDENT": [c(DP, START_DATE=_day(-10)), c(DP, RELATED_PERSON_ID="d2", START_DATE=_day(10))]},
    "BEN168": {"DEPENDENT": [c(DP, START_DATE="20200101", END_DATE="20200101"),
                              c(DP, RELATED_PERSON_ID="d2", START_DATE="20200101", END_DATE="20210101")]},
    "BEN169": {"BENEFITENROLLMENT": [c(BE, USERID="u 1"), c(BE, USERID="u1")]},
    "BEN170": {"DEPENDENT": [c(DP, PERSON_ID="p 1"), c(DP, RELATED_PERSON_ID="d2")]},
    "BEN172": {"BENEFITENROLLMENT": [c(BE, PLAN_TYPE="HEALTH"), c(BE, PLAN_TYPE="MEDICAL")]},
    "BEN173": {"BENEFITENROLLMENT": [c(BE, EMPLOYEE_COST="100.567"), c(BE, EMPLOYEE_COST="100.50")]},
    "BEN175": {"BENEFITENROLLMENT": [c(BE, STATUS="E", EMPLOYEE_COST="50"), c(BE, STATUS="E", EMPLOYEE_COST="0")]},
    "BEN177": {"BENEFITENROLLMENT": [c(BE, COVERAGE_LEVEL="EMP_CHILD", DEPENDENT_LINK="d1;d2"),
                                      c(BE, COVERAGE_LEVEL="EMP_CHILD", DEPENDENT_LINK="d1")]},
    "BEN178": {"BENEFITENROLLMENT": [c(BE, ENROL_DATE="20190101"), c(BE, ENROL_DATE="20200601")],
               "EMPEMPLOYMENT": [c(EE, CREATED_DATE="20200101")]},
    "BEN179": {"BENEFITENROLLMENT": [c(BE, STATUS="A", PLAN_TYPE="MEDICAL", EMPLOYER_COST=None),
                                      c(BE, STATUS="A", PLAN_TYPE="MEDICAL", EMPLOYER_COST="200")]},
    "BEN189": {"DEPENDENT": [c(DP, START_DATE="20200101", END_DATE="20201231"),
                              c(DP, START_DATE="20200601", END_DATE="20210101")]},
    "BEN190": {"DEPENDENT": [c(DP, RELATIONSHIP_TYPE="spouse"), c(DP, RELATED_PERSON_ID="d2", RELATIONSHIP_TYPE="child")],
               "PERINFO": [c(PN, MARITAL_STATUS="SINGLE")]},
    "BEN191": {"BENEFITENROLLMENT": [c(BE, STATUS="A"), c(BE, STATUS="T")],
               "EMPEMPLOYMENT": [EE], "POSITION": [c(PS, EFFECTIVE_END_DATE=_day(10))]},
    "BEN193": {"BENEFITENROLLMENT": [c(BE, STATUS="A", PLAN_TYPE="GAP", DEPENDENT_LINK="d1"),
                                      c(BE, STATUS="A", PLAN_TYPE="GAP", DEPENDENT_LINK=None)]},
    "BEN194": {"BENEFITENROLLMENT": [c(BE, STATUS="A", PLAN_TYPE="RETIREMENT", EMPLOYEE_COST="50", EMPLOYER_COST=None),
                                      c(BE, STATUS="A", PLAN_TYPE="RETIREMENT", EMPLOYEE_COST="50", EMPLOYER_COST="50")]},
    "BEN195": {"BENEFITENROLLMENT": [c(BE, STATUS="A", PLAN_TYPE="FSA", EMPLOYER_COST="10"),
                                      c(BE, STATUS="A", PLAN_TYPE="FSA", EMPLOYER_COST=None)]},
    "BEN196": {"BENEFITENROLLMENT": [c(BE, STATUS="A", PLAN_TYPE="MEDICAL"), c(BE, STATUS="A", PLAN_TYPE="GAP")],
               "EMPEMPLOYMENT": [c(EE, IS_PRIMARY="false")]},
    "BEN199": {"DEPENDENT": [c(DP, DEPENDENT_BIRTH=None), c(DP, RELATED_PERSON_ID="d2")]},
    "BEN200": {"DEPENDENT": [c(DP, IS_BENEFICIARY=None), c(DP, RELATED_PERSON_ID="d2")]},
    "BEN201": {"BENEFITENROLLMENT": [c(BE, EMPLOYEE_COST="-10"), c(BE, EMPLOYEE_COST="10")]},
    "BEN202": {"BENEFITENROLLMENT": [c(BE, EMPLOYER_COST="-10"), c(BE, EMPLOYER_COST="10")]},
    "BEN203": {"BENEFITENROLLMENT": [c(BE, COVERAGE_LEVEL="EMP_SPOUSE", DEPENDENT_LINK="d1;d2"),
                                      c(BE, COVERAGE_LEVEL="EMP_SPOUSE", DEPENDENT_LINK="d1")]},
    "BEN205": {"BENEFITENROLLMENT": [c(BE, STATUS="W", EMPLOYEE_COST="20"), c(BE, STATUS="W", EMPLOYEE_COST=None)]},
    "BEN207": {"DEPENDENT": [c(DP, RELATED_PERSON_ID="p1"), c(DP, RELATED_PERSON_ID="d2")]},
    "BEN208": {"BENEFITENROLLMENT": [c(BE, DEPENDENT_LINK="u1"), c(BE, DEPENDENT_LINK="d1")]},
    "BEN209": {"BENEFITENROLLMENT": [c(BE, STATUS="A", PLAN_TYPE="MEDICAL"),
                                      c(BE, STATUS="A", PLAN_TYPE="MEDICAL"),
                                      c(BE, STATUS="A", PLAN_TYPE="LIFE")]},
    "BEN210": {"DEPENDENT": [c(DP, IS_BENEFICIARY="true", END_DATE=_day(10)),
                              c(DP, RELATED_PERSON_ID="d2", IS_BENEFICIARY="true", END_DATE=_day(-10))]},
    "BEN211": {"DEPENDENT": [c(DP, IS_BENEFICIARY="true", RELATIONSHIP_TYPE="child", DEPENDENT_BIRTH=_day(1000)),
                              c(DP, RELATED_PERSON_ID="d2", IS_BENEFICIARY="true", RELATIONSHIP_TYPE="child",
                                DEPENDENT_BIRTH=_day(8000))]},
    "BEN212": {"BENEFITENROLLMENT": [c(BE, STATUS="A"), c(BE, STATUS="T")],
               "EMPEMPLOYMENT": [EE], "FOCOMPANY": [c(FCO, CURRENCY=None)]},
    "BEN214": {"BENEFITENROLLMENT": [c(BE, STATUS="A"), c(BE, STATUS="T")],
               "EMPEMPLOYMENT": [c(EE, COUNTRY_OF_COMPANY="US")], "FOCOMPANY": [FCO]},
    "BEN217": {"BENEFITENROLLMENT": [c(BE, PLAN_ID="bad id!"), c(BE, PLAN_ID="MED1")]},
    "BEN218": {"BENEFITENROLLMENT": [c(BE, STATUS="A"), c(BE, STATUS="T")],
               "EMPEMPLOYMENT": [c(EE, EMPLOYEE_CLASS="STANDARD")], "FOJOBCODE": [c(FJ, EMPLOYEE_CLASS="EXECUTIVE")]},
    "BEN221": {"BENEFITENROLLMENT": [c(BE, PLAN_TYPE="MEDICAL", EFFECTIVE_DATE="20200201"),
                                      c(BE, PLAN_TYPE="MEDICAL", EFFECTIVE_DATE="20200601")],
               "EMPEMPLOYMENT": [c(EE, PROBATION_END_DATE="20200401")]},
    "BEN223": {"BENEFITENROLLMENT": [c(BE, STATUS="A"), c(BE, STATUS="T")],
               "EMPEMPLOYMENT": [c(EE, END_DATE=_day(10))]},
    "BEN224": {"BENEFITENROLLMENT": [c(BE, STATUS="A"), c(BE, STATUS="T")],
               "EMPEMPLOYMENT": [EE], "FOCOSTCENTER": [c(FCC, LEGAL_ENTITY=None)]},
    "BEN225": {"BENEFITENROLLMENT": [c(BE, STATUS="A"), c(BE, STATUS="T")],
               "EMPEMPLOYMENT": [c(EE, COST_CENTER="CC1")], "FODEPARTMENT": [c(FD, COST_CENTER="CC2")]},
    "BEN226": {"DEPENDENT": [c(DP, RELATIONSHIP_TYPE="spouse"),
                              c(DP, RELATIONSHIP_TYPE="spouse"),
                              c(DP, RELATED_PERSON_ID="d2", RELATIONSHIP_TYPE="domestic_partner")]},
    "BEN227": {"BENEFITENROLLMENT": [c(BE, EMPLOYEE_COST="20"), c(BE, EMPLOYEE_COST="0")],
               "EMPEMPLOYMENT": [EE], "USERACCOUNT": [c(UA, STATUS="I")]},
    "BEN228": {"BENEFITENROLLMENT": [c(BE, STATUS="A", PLAN_TYPE="MEDICAL"), c(BE, STATUS="A", PLAN_TYPE="GAP")],
               "EMPEMPLOYMENT": [c(EE, JOB_END_DATE=_day(10))]},
    "BEN229": {"BENEFITENROLLMENT": [c(BE, STATUS="A"), c(BE, STATUS="T")],
               "EMPEMPLOYMENT": [c(EE, CONTRACT_END_DATE=_day(10))]},
    "BEN230": {"BENEFITENROLLMENT": [c(BE, ENROL_DATE="20250601", EFFECTIVE_DATE="20250101"),
                                      c(BE, ENROL_DATE="20250110", EFFECTIVE_DATE="20250101")]},
    "BEN231": {"BENEFITENROLLMENT": [c(BE, STATUS="A", EFFECTIVE_DATE=_day(-60)),
                                      c(BE, STATUS="A", EFFECTIVE_DATE=_day(-10))]},
    "BEN232": {"BENEFITENROLLMENT": [c(BE, STATUS="T", EFFECTIVE_DATE=_day(-10)),
                                      c(BE, STATUS="T", EFFECTIVE_DATE=_day(10))]},
    "BEN233": {"BENEFITENROLLMENT": [c(BE, STATUS="A"), c(BE, STATUS="T")],
               "USERACCOUNT": [c(UA, DEPARTMENT="SALES")], "EMPEMPLOYMENT": [c(EE, DEPARTMENT="DEPT1")]},
}


# uniqueness_check rules fail every member of a duplicate group (keep=False), so a
# dirty/dirty/clean fixture scores (3, 2) rather than the default (2, 1).
EXPECTED = {"BEN115": (3, 2), "BEN124": (3, 2), "BEN209": (3, 2), "BEN226": (3, 2)}


def test_enough_fixtures():
    assert len(CASES) >= 50


@pytest.mark.parametrize("rule_id", list(CASES))
def test_rule_flags_dirty_and_passes_clean(rule_id):
    assert run(rule_id, CASES[rule_id]) == EXPECTED.get(rule_id, (2, 1))
