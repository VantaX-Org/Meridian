"""SuccessFactors benefits depth rules (BEN086-BEN102): integrity, enrichment
and fixture-based fire/clean tests, mirroring tests/test_sf_ec_depth_rules.py.

Round 3 (re-review 2 response): the new-range rule count dropped from 28 to
17 after deleting duplicates/subsets and EC-owned checks (M1, M2, M4),
invented relationship-type literals that never shipped on any real tenant
(H4: BEN096/BEN101's and BEN109's 'domestic_partner' variants), a rule that
duplicated a base-pack check (H1: BEN113 duplicated BEN080), a strict subset
of a base uniqueness check (H2: BEN098), and two rules whose fail_when
thresholds the proof suite's fixed date-probe pool can never reach (H3:
BEN095, BEN100 -- both "or delete them" per the controller's ruling; no
amount of YAML editing fixes an unreachable probe range, and padding the
count back up is explicitly out of scope this round). The offboarding
cluster (BEN086) was further trimmed (M3) to drop the CONTRACT_END_DATE and
LAST_DATE_WORKED branches, which fire while an employee is still correctly
active. Quality over count per the controller's ruling: no new rules were
added to pad the number back up.
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
START, COUNT = 86, 17

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
    # I11 (round 2): the only two auto_fix rules that ever survived (old
    # BEN131/BEN132, now BEN094/BEN095) had their auto_fix removed because
    # collapse_spaces+strip cannot make "u 1" satisfy ^\S+$ (an internal
    # space has no deterministic single fix).
    assert not any("auto_fix" in r for r in NEW)


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
    # BEN086: offboarding-cluster collapse, now trimmed to EVENT + PAYROLL_END_DATE
    # only (M3 dropped CONTRACT_END_DATE/LAST_DATE_WORKED). EVENT mixed case to
    # prove the case-insensitive 'termination' match.
    "BEN086": {"BENEFITENROLLMENT": [c(BE, STATUS="A"), c(BE, STATUS="T")],
               "EMPEMPLOYMENT": [c(EE, EVENT="Termination")]},
    # L3: PLAN_TYPE matched case-insensitively now; lower-case dirty value proves it.
    "BEN087": {"BENEFITENROLLMENT": [c(BE, PLAN_TYPE="retirement"), c(BE, PLAN_TYPE="MEDICAL")],
               "EMPEMPLOYMENT": [c(EE, IS_CONTINGENT_WORKER="true")]},
    "BEN088": {"BENEFITENROLLMENT": [c(BE, STATUS="A"), c(BE, STATUS="T")],
               "EMPEMPLOYMENT": [EE], "PERINFO": [c(PN, DATE_OF_DEATH="20240101")]},
    "BEN089": {"BENEFITENROLLMENT": [c(BE, EMPLOYEE_COST="60000"), c(BE, EMPLOYEE_COST="500")]},
    "BEN090": {"BENEFITENROLLMENT": [c(BE, EMPLOYER_COST="60000"), c(BE, EMPLOYER_COST="500")]},
    "BEN091": {"BENEFITENROLLMENT": [c(BE, EMPLOYEE_COST="10", EMPLOYER_COST="1000"),
                                      c(BE, EMPLOYEE_COST="10", EMPLOYER_COST="100")]},
    # L2: dirty row carries the open-end 99991231 sentinel (year>=9999), not a blank
    # END_DATE -- the isna() branch was dropped, so a blank END_DATE must NOT fire.
    "BEN092": {"DEPENDENT": [c(DP, RELATIONSHIP_TYPE="Child", DEPENDENT_BIRTH=_day(9500), END_DATE="99991231"),
                              c(DP, RELATED_PERSON_ID="d2", RELATIONSHIP_TYPE="child", DEPENDENT_BIRTH=_day(9500),
                                END_DATE=None)]},
    # L3: PLAN_TYPE matched case-insensitively now; lower-case dirty value proves it.
    "BEN093": {"BENEFITENROLLMENT": [c(BE, STATUS="A", PLAN_TYPE="medical"), c(BE, STATUS="A", PLAN_TYPE="LIFE")],
               "EMPEMPLOYMENT": [c(EE, IS_FULLTIME="false", FTE="0.2")]},
    "BEN094": {"BENEFITENROLLMENT": [c(BE, USERID="u 1"), c(BE, USERID="u1")]},
    "BEN095": {"DEPENDENT": [c(DP, PERSON_ID="p 1"), c(DP, RELATED_PERSON_ID="d2")]},
    # L3: PLAN_TYPE matched case-insensitively now; lower-case dirty value proves it.
    "BEN096": {"BENEFITENROLLMENT": [c(BE, STATUS="A", PLAN_TYPE="medical"), c(BE, STATUS="A", PLAN_TYPE="GAP")],
               "EMPEMPLOYMENT": [c(EE, IS_PRIMARY="false")]},
    # L1 rework: null_check -> cross_field_check excluding spouse/child. Dirty row is
    # a non-spouse/child relationship (parent) with no date of birth; clean row is a
    # spouse with no date of birth, proving the exclusion (BEN056 owns that case, not
    # this rule) rather than a populated-DOB clean row.
    "BEN097": {"DEPENDENT": [c(DP, RELATIONSHIP_TYPE="parent", DEPENDENT_BIRTH=None),
                              c(DP, RELATED_PERSON_ID="d2", RELATIONSHIP_TYPE="Spouse", DEPENDENT_BIRTH=None)]},
    "BEN098": {"BENEFITENROLLMENT": [c(BE, DEPENDENT_LINK="u1"), c(BE, DEPENDENT_LINK="d1")]},
    # interval_check, group_by=PERSON_ID: p1's pair is a properly closed-out marriage
    # followed by a new one (no overlap, second row carries the open-end sentinel
    # handled natively by interval_check) so neither fails; p2's pair genuinely
    # overlaps (both open-ended) so the later-starting row fails. H4 removed the
    # domestic_partner variants from applies_when, so both rows in each pair are now
    # spouse (mixed case, still case-enumerated per applies_when).
    "BEN099": {"DEPENDENT": [
        c(DP, PERSON_ID="p1", RELATED_PERSON_ID="d1", RELATIONSHIP_TYPE="Spouse",
          START_DATE="20100101", END_DATE="20150101"),
        c(DP, PERSON_ID="p1", RELATED_PERSON_ID="d2", RELATIONSHIP_TYPE="SPOUSE",
          START_DATE="20160101", END_DATE="99991231"),
        c(DP, PERSON_ID="p2", RELATED_PERSON_ID="d3", RELATIONSHIP_TYPE="spouse",
          START_DATE="20100101", END_DATE="99991231"),
        c(DP, PERSON_ID="p2", RELATED_PERSON_ID="d4", RELATIONSHIP_TYPE="Spouse",
          START_DATE="20120101", END_DATE="99991231"),
    ]},
    "BEN100": {"BENEFITENROLLMENT": [c(BE, STATUS="T", EFFECTIVE_DATE=_day(-10)),
                                      c(BE, STATUS="T", EFFECTIVE_DATE=_day(10))]},
    # a non-child dependent (mixed-case 'Spouse') cannot start after the employee's
    # date of death; a child dependent is exempt (may be born/added after death; see BEN102).
    "BEN101": {"DEPENDENT": [c(DP, RELATIONSHIP_TYPE="Spouse", START_DATE="20240601"),
                              c(DP, RELATED_PERSON_ID="d2", RELATIONSHIP_TYPE="CHILD", START_DATE="20240601")],
               "PERINFO": [c(PN, DATE_OF_DEATH="20240101")]},
    # a child born more than ~300 days after the employee's date of death is
    # implausible; a child born 300 days or less after is biologically plausible.
    "BEN102": {"DEPENDENT": [c(DP, RELATIONSHIP_TYPE="child", DEPENDENT_BIRTH="20250301"),
                              c(DP, RELATED_PERSON_ID="d2", RELATIONSHIP_TYPE="Child", DEPENDENT_BIRTH="20240301")],
               "PERINFO": [c(PN, DATE_OF_DEATH="20240101")]},
}

# interval_check rules can fail more than one row and/or run against more than 2
# rows; every other rule uses the default 2-row (dirty, clean) fixture that
# scores (total=2, affected=1).
EXPECTED = {"BEN099": (4, 1)}


def test_enough_fixtures():
    assert len(CASES) == COUNT
    assert set(CASES) == {r["id"] for r in NEW}


@pytest.mark.parametrize("rule_id", list(CASES))
def test_rule_flags_dirty_and_passes_clean(rule_id):
    assert run(rule_id, CASES[rule_id]) == EXPECTED.get(rule_id, (2, 1))
