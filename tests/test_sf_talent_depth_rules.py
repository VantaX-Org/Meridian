"""SuccessFactors talent and time depth rules (PERF044+, SUC051+, LMS046+, REC045+, TIME047+).

Each fixture has one record the rule must flag and one it must pass; plus ID contiguity per pack and the
auto_fix contract (only the listed ops, a confidence, never on ratings/readiness).
"""
import re

import pandas as pd
import pytest
import yaml

from checks.frames import TableFrames
from checks.runner import run_rule
from sap.ddic import get_dictionary

PACKS = ["performance_goals", "succession_planning", "learning_management", "recruiting_onboarding",
         "time_attendance"]
RULES = {m: yaml.safe_load(open(f"checks/rules/successfactors/{m}.yaml"))["rules"] for m in PACKS}
BY_ID = {r["id"]: (m, r) for m, rs in RULES.items() for r in rs}
S4 = get_dictionary("s4hana")
OPS = {"strip", "collapse_spaces", "upper", "lower", "title", "pad_left", "strip_leading_zeros", "regex_replace",
       "truncate", "map", "set", "copy", "lookup", "date_format", "gtin_check_digit"}
JUDGEMENT = re.compile(r"\.(\w*RATING\w*|READINESS|RISK_OF_LOSS|IMPACT_OF_LOSS|NINE_BOX\w*|POTENTIAL\w*|SCORE)$")

T = pd.Timestamp.today().normalize()
D = lambda n: (T + pd.Timedelta(days=n)).strftime("%Y-%m-%d")  # noqa: E731
OLD, FUT = "2000-01-01", D(400)


def frame(table, **cols):
    return pd.DataFrame({f"{table}.{k}": v for k, v in cols.items()})


def affected(rid, tables):
    m, rule = BY_ID[rid]
    _, res = run_rule(dict(rule), TableFrames(tables, S4, module=m), {})
    assert res is not None and not res.error, (rid, res and res.error)
    return res.affected_count


def emp(users, **cols):
    return frame("EMPEMPLOYMENT", USERID=users, **cols)


G2 = dict(GOAL_ID=["g1", "g2"], USERID=["u1", "u2"])
F2 = dict(USERID=["u1", "u2"], REVIEW_PERIOD=["2026-01-01"] * 2, FORM_DATA_ID=["f1", "f2"])
S2 = dict(NOMINEE_ID=["u1", "u2"], POSITION_ID=["P1", "P2"])
LA2 = dict(USERID=["u1", "u2"], COURSE_ID=["c1", "c2"])
LC2 = dict(USERID=["u1", "u2"], COURSE_ID=["c1", "c2"], COMPLETION_DATE=["2026-01-01"] * 2)
JR2 = dict(JOB_REQ_ID=["r1", "r2"])
JO2 = dict(OFFER_ID=["o1", "o2"], JOB_REQ_ID=["r1", "r2"])
OB2 = dict(USERID=["u1", "u2"])
TS2 = dict(USERID=["u1", "u2"], DATE=["2026-01-05"] * 2)

FIXTURES = {
    # performance & goals
    "PERF045": {"GOALPLAN": frame("GOALPLAN", **G2, GOAL_START_DATE=["2025-12-01", "2026-02-01"],
                                  PLAN_START_DATE=["2026-01-01"] * 2)},
    "PERF047": {"GOALPLAN": frame("GOALPLAN", **G2, PLAN_START_DATE=["2026-01-01"] * 2,
                                  PLAN_END_DATE=["2025-12-31", "2026-12-31"])},
    "PERF048": {"GOALPLAN": frame("GOALPLAN", **G2, GOAL_PLAN_ID=["", "2026"])},
    "PERF049": {"GOALPLAN": frame("GOALPLAN", **G2, GOAL_STATUS=["Active", "Active"], TARGET_DATE=[OLD, D(10)])},
    "PERF050": {"GOALPLAN": frame("GOALPLAN", **G2, GOAL_STATUS=["Active", "Active"]),
                "EMPEMPLOYMENT": emp(["u1", "u2"], END_DATE=[OLD, FUT])},
    "PERF052": {"PMREVIEWRESULT": frame("PMREVIEWRESULT", **F2, FORM_STATUS=["2", "2"],
                                        STEP_DUE_DATE=[OLD, D(5)])},
    "PERF054": {"PMREVIEWRESULT": frame("PMREVIEWRESULT", **F2, REVIEW_END_DATE=["2025-06-30", "2026-12-31"])},
    "PERF058": {"PMREVIEWRESULT": frame("PMREVIEWRESULT", **F2, MANAGER_RATING=[7.0, 4.0])},
    "PERF061": {"PMREVIEWRESULT": frame("PMREVIEWRESULT", **F2, IS_RATED=["false", "true"],
                                        OVERALL_RATING=[3.0, 3.0])},
    "PERF062": {"GOALPLAN": frame("GOALPLAN", **G2, VISIBILITY_FLAG=["2", "1"])},
    "PERF064": {"GOALPLAN": frame("GOALPLAN", **G2, GOAL_NAME=[" Grow  sales", "Grow sales"])},
    "PERF065": {"GOALPLAN": frame("GOALPLAN", **G2, CURRENT_OWNER=["", "u2"])},
    "PERF068": {"GOALPLAN": frame("GOALPLAN", **G2, GOAL_STATUS=["On Track"] * 2, COMPLETION_PERCENT=[100.0, 50.0])},
    "PERF080": {"PMREVIEWRESULT": frame("PMREVIEWRESULT", **F2, FORM_STATUS=["1", "1"],
                                        REVIEW_DUE_DATE=[OLD, D(5)])},
    # succession
    "SUC051": {"SUCCESSIONCANDIDATE": frame("SUCCESSIONCANDIDATE", **S2),
               "EMPEMPLOYMENT": emp(["u1", "u2"], POSITION=["P1", "P9"])},
    "SUC053": {"SUCCESSIONCANDIDATE": frame("SUCCESSIONCANDIDATE", **S2, READINESS=["", "READY_NOW"])},
    "SUC054": {"SUCCESSIONCANDIDATE": frame("SUCCESSIONCANDIDATE", **S2, APPROVAL_STATUS=["PENDING"] * 2,
                                            NOMINATED_DATE=[OLD, D(-5)])},
    "SUC061": {"SUCCESSIONCANDIDATE": frame("SUCCESSIONCANDIDATE", **S2, RANKING=[0, 1])},
    "SUC062": {"SUCCESSIONCANDIDATE": frame("SUCCESSIONCANDIDATE", **S2, EMERGENCY_SUCCESSOR_FLAG=["Y", "Y"],
                                            READINESS=["READY_1_2_YEARS", "READY_NOW"])},
    "SUC065": {"SUCCESSIONCANDIDATE": frame("SUCCESSIONCANDIDATE", **S2, APPROVAL_STATUS=["REJECTED"] * 2,
                                            EMERGENCY_SUCCESSOR_FLAG=["Y", "N"], BACKUP_SUCCESSOR_FLAG=["N", "N"])},
    "SUC068": {"SUCCESSIONCANDIDATE": frame("SUCCESSIONCANDIDATE", **{**S2, "POSITION_ID": ["P 1", "P1"]})},
    "SUC070": {"SUCCESSIONCANDIDATE": frame("SUCCESSIONCANDIDATE", **S2, RETENTION_RISK_SCORE=[85.0, 85.0],
                                            RISK_OF_LOSS=["LOW", "HIGH"])},
    "SUC078": {"SUCCESSIONCANDIDATE": frame("SUCCESSIONCANDIDATE", **S2, EMERGENCY_SUCCESSOR_FLAG=["", "N"])},
    "SUC082": {"SUCCESSIONCANDIDATE": frame("SUCCESSIONCANDIDATE", **S2, NOMINATED_DATE=["2026-01-01"] * 2,
                                            EFFECTIVE_END_DATE=["2025-01-01", "2027-01-01"])},
    # learning
    "LMS046": {"LEARNINGASSIGNMENT": frame("LEARNINGASSIGNMENT", **LA2, ITEM_TYPE=["CURRICULUM"] * 2,
                                           SCHEDULE_ID=["S1", ""])},
    "LMS047": {"LEARNINGASSIGNMENT": frame("LEARNINGASSIGNMENT", **LA2, STATUS=["Completed"] * 2,
                                           REQUIRED=["true"] * 2, EXPIRATION_DATE=[OLD, FUT])},
    "LMS050": {"LEARNINGCOMPLETION": frame("LEARNINGCOMPLETION", **LC2, CPE_HOURS=[9.0, 2.0],
                                           TOTAL_HOURS=[4.0, 4.0])},
    "LMS052": {"LEARNINGCOMPLETION": frame("LEARNINGCOMPLETION", **LC2, TOTAL_HOURS=[-1.0, 4.0])},
    "LMS057": {"LEARNINGASSIGNMENT": frame("LEARNINGASSIGNMENT", **LA2, INSTRUCTOR_ID=["u1", "i9"])},
    "LMS058": {"LEARNINGASSIGNMENT": frame("LEARNINGASSIGNMENT", **LA2, STATUS=["Registered"] * 2,
                                           SCHEDULE_ID=["", "S1"])},
    "LMS063": {"LEARNINGCOMPLETION": frame("LEARNINGCOMPLETION", **LC2, STATUS=["FAILED"] * 2,
                                           CREDIT_HOURS=[2.0, 0.0])},
    "LMS068": {"LEARNINGASSIGNMENT": frame("LEARNINGASSIGNMENT", **LA2, STATUS=["Registered"] * 2,
                                           CLASS_END_DATE=[OLD, D(10)])},
    "LMS075": {"LEARNINGCOMPLETION": frame("LEARNINGCOMPLETION", **LC2, PASSING_SCORE=[150.0, 80.0])},
    "LMS081": {"LEARNINGASSIGNMENT": frame("LEARNINGASSIGNMENT", **LA2, APPROVAL_STATUS=["Rejected"] * 2,
                                           STATUS=["In Progress", "Withdrawn"])},
    # recruiting & onboarding
    "REC047": {"JOBREQUISITION": frame("JOBREQUISITION", **JR2, SALARY_MIN=[90.0, 50.0], SALARY_MAX=[60.0, 70.0])},
    "REC053": {"JOBOFFER": frame("JOBOFFER", **JO2, SALARY=[0.0, 1000.0])},
    "REC055": {"JOBAPPLICATION": frame("JOBAPPLICATION", CANDIDATE_ID=["c1", "c2"], JOB_REQ_ID=["r1", "r1"],
                                       EMAIL=["a@b", "a@example.com"])},
    "REC059": {"JOBREQUISITION": frame("JOBREQUISITION", **JR2, OPENINGS_FILLED=[3, 1], NUM_OPENINGS=[2, 2])},
    "REC063": {"JOBREQUISITION": frame("JOBREQUISITION", **JR2, STATUS=["Closed"] * 2,
                                       CLOSE_DATE=["", "2026-01-01"])},
    "REC073": {"ONBOARDINGCANDIDATEINFO": frame("ONBOARDINGCANDIDATEINFO", **OB2,
                                                CANCELLED_ON=["2026-01-01"] * 2, CANCEL_REASON=["", "NO_SHOW"])},
    "REC077": {"ONBOARDINGCANDIDATEINFO": frame("ONBOARDINGCANDIDATEINFO", **OB2, MANAGER_ID=["u1", "m1"])},
    "REC078": {"ONBOARDINGCANDIDATEINFO": frame("ONBOARDINGCANDIDATEINFO", **OB2,
                                                BACKGROUND_CHECK_STATUS=["Failed", "Passed"], CANCELLED_ON=["", ""])},
    "REC083": {"JOBREQUISITION": frame("JOBREQUISITION", **JR2, CURRENCY=["usd", "USD"])},
    # time & attendance
    "TIME049": {"TIMESHEET": frame("TIMESHEET", **TS2, ACCOUNT_START_DATE=["2026-01-01"] * 2,
                                   ACCOUNT_END_DATE=["2025-12-31", "2026-12-31"])},
    "TIME057": {"TIMESHEET": frame("TIMESHEET", **{**TS2, "DATE": ["2026-02-01", "2026-01-05"]},
                                   ABSENCE_START_DATE=["2026-01-05"] * 2, ABSENCE_END_DATE=["2026-01-09"] * 2)},
    "TIME060": {"TIMESHEET": frame("TIMESHEET", **TS2, ABSENCE_APPROVAL_STATUS=["OK", "APPROVED"])},
    "TIME061": {"TIMESHEET": frame("TIMESHEET", **TS2, ABSENCE_HOURS=[-8.0, 8.0])},
    "TIME068": {"TIMESHEET": frame("TIMESHEET", **{**TS2, "DATE": ["2026-02-01", "2026-01-05"]},
                                   SHEET_START_DATE=["2026-01-05"] * 2, SHEET_END_DATE=["2026-01-11"] * 2)},
    "TIME070": {"TIMESHEET": frame("TIMESHEET", **TS2, WORK_SCHEDULE=["", "WS40"])},
    "TIME076": {"TIMESHEET": frame("TIMESHEET", **TS2, ENTRY_START_TIME=["25:00", "08:00"])},
    "TIME078": {"TIMESHEET": frame("TIMESHEET", **TS2, QUANTITY_IN_DAYS=[1.0, 0.5], HOURS=[8.0, 4.0])},
}


@pytest.mark.parametrize("rid", sorted(FIXTURES))
def test_fixture_fails_bad_and_passes_good(rid):
    assert affected(rid, FIXTURES[rid]) == 1


def test_enough_fixtures():
    assert len(FIXTURES) >= 40


@pytest.mark.parametrize("module", PACKS)
def test_ids_contiguous_and_80_plus(module):
    ids = [r["id"] for r in RULES[module]]
    pre = re.match(r"[A-Z]+", ids[0]).group()
    nums = [int(i[len(pre):]) for i in ids]
    assert len(ids) >= 80 and len(set(ids)) == len(ids)
    new = sorted(n for n in nums if n > 40)
    assert new == list(range(new[0], new[-1] + 1)), module


@pytest.mark.parametrize("module", PACKS)
def test_auto_fix_contract(module):
    for r in RULES[module]:
        af = r.get("auto_fix")
        if af is None:
            continue
        assert set(af) <= {"when", "steps", "confidence"}, r["id"]
        assert af["confidence"] in {"high", "medium", "low"}, r["id"]
        assert isinstance(af["steps"], list) and af["steps"], r["id"]
        for s in af["steps"]:
            assert isinstance(s, dict) and s.get("op") in OPS, (r["id"], s)
        assert not JUDGEMENT.search(r["field"]), f"{r['id']}: no auto_fix on judgement fields"


@pytest.mark.parametrize("module", PACKS)
def test_domain_rules_carry_labels(module):
    for r in RULES[module]:
        if r["check_class"] == "domain_value_check" and int(re.sub(r"\D", "", r["id"])) > 43:
            assert r.get("allowed_values") and r.get("valid_values_with_labels"), r["id"]


# SUCCESSIONCANDIDATE *_FLAG fields are BOOLEAN-typed in the dictionary, so the SF
# connector lowercases them: a source 'Y' arrives as 'y', an Edm.Boolean as 'true'.
# Every flag rule must treat 'Y'/'y'/'true'/'True' alike (and 'N'/'n'/'false').
YES_FORMS, NO_FORMS = ["Y", "y", "true", "True"], ["N", "n", "false", "False"]
SUC_FLAGS = {"SUC037": "EMERGENCY_SUCCESSOR_FLAG", "SUC038": "BACKUP_SUCCESSOR_FLAG", "SUC039": "MOBILITY_FLAG",
             "SUC040": "DIVERSITY_CANDIDATE_FLAG", "SUC041": "ELIGIBLE_SUCCESSOR_FLAG"}


@pytest.mark.parametrize("rid,flag", sorted(SUC_FLAGS.items()))
def test_suc_flag_domain_accepts_y_and_lowercased_forms(rid, flag):
    vals = YES_FORMS + NO_FORMS + ["X"]
    sc = frame("SUCCESSIONCANDIDATE", NOMINEE_ID=[f"u{i}" for i in range(len(vals))],
               POSITION_ID=["P1"] * len(vals), **{flag: vals})
    assert affected(rid, {"SUCCESSIONCANDIDATE": sc}) == 1  # only 'X'


@pytest.mark.parametrize("yes", YES_FORMS)
def test_suc_y_gated_rules_fire_on_every_yes_form(yes):
    sc = lambda **c: {"SUCCESSIONCANDIDATE": frame("SUCCESSIONCANDIDATE", **S2, **c)}  # noqa: E731
    assert affected("SUC062", sc(EMERGENCY_SUCCESSOR_FLAG=[yes, "N"], READINESS=["READY_1_2_YEARS"] * 2)) == 1
    assert affected("SUC063", {"SUCCESSIONCANDIDATE": frame(
        "SUCCESSIONCANDIDATE", NOMINEE_ID=["u1", "u2"], POSITION_ID=["P1", "P1"],
        EMERGENCY_SUCCESSOR_FLAG=[yes, yes], APPROVAL_STATUS=["APPROVED"] * 2)}) == 2
    assert affected("SUC065", sc(APPROVAL_STATUS=["REJECTED"] * 2, EMERGENCY_SUCCESSOR_FLAG=["N", "N"],
                                 BACKUP_SUCCESSOR_FLAG=[yes, "N"])) == 1
    assert affected("SUC083", {**sc(EMERGENCY_SUCCESSOR_FLAG=[yes, "N"]),
                               "EMPEMPLOYMENT": emp(["u1", "u2"], STATUS=["U", "U"])}) == 1


@pytest.mark.parametrize("no", NO_FORMS)
def test_suc072_fires_on_every_no_form(no):
    assert affected("SUC072", {"SUCCESSIONCANDIDATE": frame(
        "SUCCESSIONCANDIDATE", **S2, APPROVAL_STATUS=["APPROVED"] * 2, ELIGIBLE_SUCCESSOR_FLAG=[no, "Y"])}) == 1
