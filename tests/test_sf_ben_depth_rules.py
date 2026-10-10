"""SuccessFactors benefits depth rules (BEN086-BEN113): integrity, enrichment
and fixture-based fire/clean tests, mirroring tests/test_sf_ec_depth_rules.py.

Round 2 (re-review response): the new-range rule count dropped from 70 to 28
after deleting duplicates/subsets (C3), EC-owned/offboarding-cluster checks
(I10), unfixable auto_fix blocks (I11, both surviving auto_fix rules had
their auto_fix removed entirely rather than repaired), and literal/relation
assumptions that don't hold across tenants (I2, I4). Quality over count per
the controller's ruling: a small net-new set is fine. No rule in this range
carries auto_fix any more -- the two rules that used to (old BEN131/BEN132,
now BEN104/BEN105) had it stripped per I11, and the other two auto_fix
rules from round 1 (old BEN110, BEN118) were deleted outright as
duplicates/subsets per C3.
"""
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
START, COUNT = 86, 28

RULES = yaml.safe_load(open("checks/rules/successfactors/benefits.yaml"))["rules"]
BY_ID = {r["id"]: r for r in RULES}
NEW = [r for r in RULES if re.fullmatch(r"BEN\d+", r["id"]) and START <= int(r["id"][3:]) < START + COUNT]

MANDATORY = ["id", "field", "check_class", "severity", "dimension", "message", "why_it_matters", "rule_authority",
             "sap_impact", "fix_map", "record_fix_template"]


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


def test_no_rule_in_this_range_carries_auto_fix():
    # I11: the only two auto_fix rules that survived the re-review (old
    # BEN131/BEN132, now BEN104/BEN105) had their auto_fix removed because
    # collapse_spaces+strip cannot make "u 1" satisfy ^\S+$ (an internal
    # space has no deterministic single fix). The other two auto_fix rules
    # from round 1 (old BEN110, BEN118) were deleted as duplicates/subsets.
    assert not any("auto_fix" in r for r in NEW)


def test_df_eval_accepts_p4_backreference_regex():
    # Proof for proposal P4 (new BEN113): df.eval must accept a raw-string
    # backreference regex inside str.contains(regex=True) exactly as written
    # in the rule's fail_when, finding a dependent id repeated in a
    # semicolon-separated list.
    df = pd.DataFrame({"BENEFITENROLLMENT.DEPENDENT_LINK": ["u1;u2", "u1;u2;u1", "u1;u1", "a;b;c", None]})
    res = df.eval(BY_ID["BEN113"]["fail_when"])
    assert res.tolist() == [False, True, True, False, False]


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
# USER_ID:USERID; EMPEMPLOYMENT<->POSITION on POSITION:CODE; PERINFO<->DEPENDENT on PERSON_ID.
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
BE = {"USERID": "u1", "PLAN_ID": "MED1", "PLAN_TYPE": "MEDICAL", "ENROL_DATE": "20250101",
      "EFFECTIVE_DATE": "20250201", "STATUS": "A", "COVERAGE_LEVEL": "EMP_ONLY",
      "EMPLOYEE_COST": "100", "EMPLOYER_COST": "200", "DEPENDENT_LINK": None}
DP = {"PERSON_ID": "p1", "RELATED_PERSON_ID": "d1", "RELATIONSHIP_TYPE": "child", "START_DATE": "20100101",
      "DEPENDENT_BIRTH": "20100101", "IS_BENEFICIARY": "true", "END_DATE": None}

CASES = {
    # BEN086: offboarding-cluster collapse (I10). EVENT uses mixed case to prove
    # the EC-pack convention's case-insensitive 'termination' match.
    "BEN086": {"BENEFITENROLLMENT": [c(BE, STATUS="A"), c(BE, STATUS="T")],
               "EMPEMPLOYMENT": [c(EE, EVENT="Termination")]},
    "BEN087": {"BENEFITENROLLMENT": [c(BE, PLAN_TYPE="RETIREMENT"), c(BE, PLAN_TYPE="MEDICAL")],
               "EMPEMPLOYMENT": [c(EE, IS_CONTINGENT_WORKER="true")]},
    "BEN088": {"BENEFITENROLLMENT": [c(BE, USERID="uXXX"), c(BE, USERID="u1")],
               "USERACCOUNT": [UA]},
    "BEN089": {"BENEFITENROLLMENT": [c(BE, STATUS="A"), c(BE, STATUS="T")],
               "EMPEMPLOYMENT": [EE], "POSITION": [c(PS, VACANT="true")]},
    "BEN090": {"BENEFITENROLLMENT": [c(BE, STATUS="A"), c(BE, STATUS="T")],
               "EMPEMPLOYMENT": [EE], "PERINFO": [c(PN, DATE_OF_DEATH="20240101")]},
    "BEN091": {"BENEFITENROLLMENT": [c(BE, EMPLOYEE_COST="60000"), c(BE, EMPLOYEE_COST="500")]},
    "BEN092": {"BENEFITENROLLMENT": [c(BE, EMPLOYER_COST="60000"), c(BE, EMPLOYER_COST="500")]},
    "BEN093": {"BENEFITENROLLMENT": [c(BE, EMPLOYEE_COST="10", EMPLOYER_COST="1000"),
                                      c(BE, EMPLOYEE_COST="10", EMPLOYER_COST="100")]},
    "BEN094": {"BENEFITENROLLMENT": [c(BE, PLAN_TYPE="FSA", EMPLOYEE_COST="0"),
                                      c(BE, PLAN_TYPE="FSA", EMPLOYEE_COST="50")]},
    # third row: the 9999-12-31 open-end sentinel is >36500 days in the future by raw
    # arithmetic but must NOT fire once `.dt.year < 9999` guards it.
    "BEN095": {"DEPENDENT": [c(DP, END_DATE=_day(-40000)), c(DP, RELATED_PERSON_ID="d2", END_DATE=_day(-10)),
                             c(DP, RELATED_PERSON_ID="d3", END_DATE="99991231")]},
    "BEN096": {"DEPENDENT": [c(DP, RELATIONSHIP_TYPE="domestic_partner", DEPENDENT_BIRTH="20050101"),
                              c(DP, RELATED_PERSON_ID="d2", RELATIONSHIP_TYPE="Domestic_Partner",
                                DEPENDENT_BIRTH="19800101")],
               "PERINFO": [PN]},
    # P1 rework: dirty row carries the open-end sentinel (not null) to prove the
    # isna()|year>=9999 guard fires on it; relationship type is mixed-case 'Child'.
    "BEN097": {"DEPENDENT": [c(DP, RELATIONSHIP_TYPE="Child", DEPENDENT_BIRTH=_day(9500), END_DATE="99991231"),
                              c(DP, RELATED_PERSON_ID="d2", RELATIONSHIP_TYPE="child", DEPENDENT_BIRTH=_day(3000),
                                END_DATE=None)]},
    # uniqueness_check: two rows share PERSON_ID+RELATED_PERSON_ID+START_DATE (duplicate,
    # case-enumerated 'CHILD'/'Child'); third row has a different START_DATE (effective-dated
    # history, not a duplicate) so it stays clean.
    "BEN098": {"DEPENDENT": [c(DP, RELATIONSHIP_TYPE="CHILD", START_DATE="20100101"),
                              c(DP, RELATIONSHIP_TYPE="Child", START_DATE="20100101"),
                              c(DP, RELATIONSHIP_TYPE="child", START_DATE="20150101")]},
    "BEN099": {"BENEFITENROLLMENT": [c(BE, STATUS="A", PLAN_TYPE="MEDICAL"), c(BE, STATUS="A", PLAN_TYPE="LIFE")],
               "EMPEMPLOYMENT": [c(EE, IS_FULLTIME="false", FTE="0.2")]},
    "BEN100": {"DEPENDENT": [c(DP, RELATIONSHIP_TYPE="parent", DEPENDENT_BIRTH=_day(42000)),
                              c(DP, RELATED_PERSON_ID="d2", RELATIONSHIP_TYPE="Parent", DEPENDENT_BIRTH=_day(20000))]},
    "BEN101": {"DEPENDENT": [c(DP, RELATIONSHIP_TYPE="domestic_partner", DEPENDENT_BIRTH=_day(3000)),
                              c(DP, RELATED_PERSON_ID="d2", RELATIONSHIP_TYPE="DOMESTIC_PARTNER",
                                DEPENDENT_BIRTH=_day(10000))]},
    # mixed-case 'Spouse'/'spouse'; sentinel end date on the clean row proves the
    # `.dt.year < 9999` guard still excludes an open-ended spouse record.
    "BEN102": {"DEPENDENT": [c(DP, RELATIONSHIP_TYPE="Spouse", END_DATE=_day(-10)),
                              c(DP, RELATED_PERSON_ID="d2", RELATIONSHIP_TYPE="spouse", END_DATE="99991231")]},
    "BEN103": {"DEPENDENT": [c(DP, START_DATE="20200101", END_DATE="20200101"),
                              c(DP, RELATED_PERSON_ID="d2", START_DATE="20200101", END_DATE="20210101")]},
    "BEN104": {"BENEFITENROLLMENT": [c(BE, USERID="u 1"), c(BE, USERID="u1")]},
    "BEN105": {"DEPENDENT": [c(DP, PERSON_ID="p 1"), c(DP, RELATED_PERSON_ID="d2")]},
    "BEN106": {"BENEFITENROLLMENT": [c(BE, STATUS="A", PLAN_TYPE="MEDICAL"), c(BE, STATUS="A", PLAN_TYPE="GAP")],
               "EMPEMPLOYMENT": [c(EE, IS_PRIMARY="false")]},
    "BEN107": {"DEPENDENT": [c(DP, DEPENDENT_BIRTH=None), c(DP, RELATED_PERSON_ID="d2")]},
    "BEN108": {"BENEFITENROLLMENT": [c(BE, DEPENDENT_LINK="u1"), c(BE, DEPENDENT_LINK="d1")]},
    # interval_check, group_by=PERSON_ID: p1's pair is a properly closed-out marriage
    # followed by a new one (no overlap, second row carries the open-end sentinel
    # handled natively by interval_check) so neither fails; p2's pair genuinely
    # overlaps (both open-ended) so the later-starting row (domestic partner, mixed
    # case) fails. Relationship types are case-enumerated per applies_when.
    "BEN109": {"DEPENDENT": [
        c(DP, PERSON_ID="p1", RELATED_PERSON_ID="d1", RELATIONSHIP_TYPE="Spouse",
          START_DATE="20100101", END_DATE="20150101"),
        c(DP, PERSON_ID="p1", RELATED_PERSON_ID="d2", RELATIONSHIP_TYPE="SPOUSE",
          START_DATE="20160101", END_DATE="99991231"),
        c(DP, PERSON_ID="p2", RELATED_PERSON_ID="d3", RELATIONSHIP_TYPE="spouse",
          START_DATE="20100101", END_DATE="99991231"),
        c(DP, PERSON_ID="p2", RELATED_PERSON_ID="d4", RELATIONSHIP_TYPE="Domestic_Partner",
          START_DATE="20120101", END_DATE="99991231"),
    ]},
    "BEN110": {"BENEFITENROLLMENT": [c(BE, STATUS="T", EFFECTIVE_DATE=_day(-10)),
                                      c(BE, STATUS="T", EFFECTIVE_DATE=_day(10))]},
    # P2: a non-child dependent (mixed-case 'Spouse') cannot start after the employee's
    # date of death; a child dependent is exempt (may be born/added after death).
    "BEN111": {"DEPENDENT": [c(DP, RELATIONSHIP_TYPE="Spouse", START_DATE="20240601"),
                              c(DP, RELATED_PERSON_ID="d2", RELATIONSHIP_TYPE="CHILD", START_DATE="20240601")],
               "PERINFO": [c(PN, DATE_OF_DEATH="20240101")]},
    # P3: a child born more than ~300 days after the employee's date of death is
    # implausible; a child born 300 days or less after is biologically plausible.
    "BEN112": {"DEPENDENT": [c(DP, RELATIONSHIP_TYPE="child", DEPENDENT_BIRTH="20250301"),
                              c(DP, RELATED_PERSON_ID="d2", RELATIONSHIP_TYPE="Child", DEPENDENT_BIRTH="20240301")],
               "PERINFO": [c(PN, DATE_OF_DEATH="20240101")]},
    # P4: the same dependent id repeated in the ';'-separated DEPENDENT_LINK list.
    "BEN113": {"BENEFITENROLLMENT": [c(BE, DEPENDENT_LINK="u1;u2;u1"), c(BE, DEPENDENT_LINK="u1;u2")]},
}

# uniqueness_check and interval_check rules can fail more than one row and/or run
# against more than 2 rows; every other rule uses the default 2-row (dirty, clean)
# fixture that scores (total=2, affected=1).
EXPECTED = {"BEN095": (3, 1), "BEN098": (3, 2), "BEN109": (4, 1)}


def test_enough_fixtures():
    assert len(CASES) == COUNT
    assert set(CASES) == {r["id"] for r in NEW}


@pytest.mark.parametrize("rule_id", list(CASES))
def test_rule_flags_dirty_and_passes_clean(rule_id):
    assert run(rule_id, CASES[rule_id]) == EXPECTED.get(rule_id, (2, 1))
