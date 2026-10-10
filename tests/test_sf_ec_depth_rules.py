"""SuccessFactors Employee Central depth rules (EC121+): fixtures, ID contiguity, auto_fix contract."""
import re
from datetime import date, timedelta

import pandas as pd
import pytest
import yaml

from checks.frames import TableFrames
from checks.runner import run_rule
from sap.ddic import get_dictionary

S4 = get_dictionary("s4hana")
RULES = yaml.safe_load(open("checks/rules/successfactors/employee_central.yaml"))["rules"]
BY_ID = {r["id"]: r for r in RULES}
NEW = [r for r in RULES if re.fullmatch(r"EC\d+", r["id"]) and 121 <= int(r["id"][2:]) <= 238]
MANDATORY = ["id", "field", "check_class", "severity", "dimension", "message", "why_it_matters", "rule_authority",
             "sap_impact", "fix_map", "record_fix_template"]
ALLOWED_OPS = {"strip", "collapse_spaces", "upper", "lower", "title", "pad_left", "strip_leading_zeros",
               "regex_replace", "truncate", "map", "set", "copy", "lookup", "date_format", "gtin_check_digit"}
# Business judgement: never auto-fix managers, termination/end dates, pay amounts or identities.
NO_AUTOFIX_FIELDS = re.compile(r"\.(MANAGER_ID|END_DATE|LAST_DATE_WORKED|PAYROLL_END_DATE|CONTRACT_END_DATE|"
                               r"PAY_GROUP|PAY_SCALE_\w+|PERCENT|AMOUNT|SALARY|USERID|PERSON_ID|DATE_OF_\w+)$")
ACTIVE = "A"
SOON = (date.today() + timedelta(days=30)).isoformat()
LATER = (date.today() + timedelta(days=400)).isoformat()


def frame(table, **cols):
    return pd.DataFrame({f"{table}.{k}": v for k, v in cols.items()})


def fire(rid, tables):
    frames = TableFrames(tables, S4, module="employee_central")
    _, res = run_rule(dict(BY_ID[rid]), frames, {})
    assert res is not None and not res.error, (rid, res and res.error)
    return res.affected_count


def per(**cols):
    cols.setdefault("PERSON_ID", [f"p{i + 1}" for i in range(len(next(iter(cols.values()))))])
    return {"PERINFO": frame("PERINFO", **cols)}


def emp(**cols):
    n = len(next(iter(cols.values())))
    cols.setdefault("USERID", [f"u{i + 1}" for i in range(n)])
    cols.setdefault("PERSON_ID", [f"p{i + 1}" for i in range(n)])
    return frame("EMPEMPLOYMENT", **cols)


ZAF = ["ZAF", "ZAF"]

# (rule, tables with one bad row first and clean rows after, expected affected count)
CASES = [
    ("EC121", per(DATE_OF_BIRTH=["2099-01-01", "1980-05-05"]), 1),
    ("EC122", per(DATE_OF_BIRTH=["1900-01-01", "1980-05-05"]), 1),
    ("EC124", per(DATE_OF_BIRTH=["1980-01-01"] * 2, DATE_OF_DEATH=["1970-01-01", "2020-01-01"]), 1),
    ("EC126", per(COUNTRY_OF_BIRTH=["ZA", "ZAF"]), 1),
    ("EC127", per(FIRSTNAME=["Anna  Marie", "Anna Marie"]), 1),
    ("EC128", per(FIRSTNAME=["J0hn", "John"]), 1),
    ("EC129", per(FIRSTNAME=["JOHN", "John"]), 1),
    ("EC133", per(FIRSTNAME=["Test", "John"], LASTNAME=["Smith", "Smith"]), 1),
    ("EC134", per(FIRSTNAME=["Lee", "John"], LASTNAME=["LEE", "Smith"]), 1),
    ("EC135", per(SALUTATION=["MR", "MR"], GENDER=["F", "M"]), 1),
    ("EC138", per(NATIONAL_ID=["8013015009087", "8001015009087"], NATIONAL_ID_COUNTRY=ZAF), 1),
    ("EC139", per(NATIONAL_ID=["8001015009387", "8001015009087"], NATIONAL_ID_COUNTRY=ZAF), 1),
    ("EC140", per(NATIONAL_ID=["ABCDE1234", "ABCDE1234F"], NATIONAL_ID_COUNTRY=["IND", "IND"]), 1),
    ("EC145", per(NATIONAL_ID=["S1234567", "S1234567D"], NATIONAL_ID_COUNTRY=["SGP", "SGP"]), 1),
    ("EC146", per(NATIONAL_ID=["8001015009087"] * 2, DATE_OF_BIRTH=["1981-01-01", "1980-01-01"],
                  NATIONAL_ID_COUNTRY=ZAF), 1),
    ("EC147", per(NATIONAL_ID=["8001015009087", "8001014009087"], GENDER=["F", "F"], NATIONAL_ID_COUNTRY=ZAF), 1),
    ("EC148", per(NATIONAL_ID=["8001014009087", "8001015009087"], GENDER=["M", "M"], NATIONAL_ID_COUNTRY=ZAF), 1),
    ("EC149", {"PEREMAIL": frame("PEREMAIL", PERSON_ID=["p1", "p2"], EMAIL_ADDRESS=["a b@x.com", "ab@x.com"])}, 1),
    ("EC150", {"PEREMAIL": frame("PEREMAIL", PERSON_ID=["p1", "p2"], EMAIL_ADDRESS=["a..b@x.com", "a.b@x.com"])}, 1),
    ("EC152", {**per(FIRSTNAME=["A", "B"]), "EMPEMPLOYMENT": emp(STATUS=[ACTIVE] * 2),
               "PEREMAIL": frame("PEREMAIL", PERSON_ID=["p2"], IS_PRIMARY=["true"])}, 1),
    ("EC155", {"PERPHONE": frame("PERPHONE", PERSON_ID=["p1", "p2"], PHONE_NUMBER=["0000000", "0825550199"])}, 1),
    ("EC157", {"PERADDRESS": frame("PERADDRESS", PERSON_ID=["p1", "p2"], COUNTRY=["USA"] * 2, STATE=["XX", "CA"])}, 1),
    ("EC164", {"PERADDRESS": frame("PERADDRESS", PERSON_ID=["p1", "p2"], COUNTRY=["POL"] * 2,
                                   ZIPCODE=["00950", "00-950"])}, 1),
    ("EC166", {"PERADDRESS": frame("PERADDRESS", PERSON_ID=["p1", "p2"], COUNTRY=["IRL"] * 2,
                                   ZIPCODE=["123", "A65 F4E2"])}, 1),
    ("EC167", {"EMPEMPLOYMENT": emp(START_DATE=["2020-01-01"] * 2, JOB_START_DATE=["2019-01-01", "2021-01-01"])}, 1),
    ("EC169", {"EMPEMPLOYMENT": emp(EVENT_REASON=["XXX", "HIRNEW"], EVENT=["H", "H"]),
               "FOEVENTREASON": frame("FOEVENTREASON", EXTERNAL_CODE=["HIRNEW"], EVENT=["H"], STATUS=["A"])}, 1),
    ("EC170", {"EMPEMPLOYMENT": emp(STATUS=["A", "T"], EVENT_REASON=["TERRES"] * 2),
               "FOEVENTREASON": frame("FOEVENTREASON", EXTERNAL_CODE=["TERRES"], EMPL_STATUS=["T"])}, 1),
    ("EC172", {"EMPEMPLOYMENT": emp(STATUS=[ACTIVE] * 2, DIVISION=["D9", "D1"]),
               "FODIVISION": frame("FODIVISION", EXTERNAL_CODE=["D1"], STATUS=["A"])}, 1),
    ("EC177", {"EMPEMPLOYMENT": emp(COST_CENTER=["CC1", "CC2"], COMPANY=["1000"] * 2),
               "FOCOSTCENTER": frame("FOCOSTCENTER", EXTERNAL_CODE=["CC1", "CC2"], LEGAL_ENTITY=["2000", "1000"])}, 1),
    ("EC178", {"EMPEMPLOYMENT": emp(STATUS=[ACTIVE] * 2, FTE=[0.0, 1.0])}, 1),
    ("EC182", {"EMPEMPLOYMENT": emp(STATUS=[ACTIVE] * 2, IS_FULLTIME=["true"] * 2, FTE=[0.5, 1.0])}, 1),
    ("EC184", {"EMPEMPLOYMENT": emp(STATUS=[ACTIVE] * 2, LOCATION=["L1"] * 2, FTE=[1.0, 0.5],
                                    STANDARD_HOURS=[20.0, 20.0]),
               "FOLOCATION": frame("FOLOCATION", EXTERNAL_CODE=["L1"], STANDARD_HOURS=[40.0])}, 1),
    ("EC188", {"EMPEMPLOYMENT": emp(COMPANY=["1000"] * 2, COUNTRY_OF_COMPANY=["DEU", "ZAF"]),
               "FOCOMPANY": frame("FOCOMPANY", EXTERNAL_CODE=["1000"], COUNTRY=["ZAF"])}, 1),
    ("EC191", {"EMPEMPLOYMENT": emp(STATUS=[ACTIVE] * 2, CONTRACT_END_DATE=["2020-01-01", "2099-01-01"])}, 1),
    ("EC200", {"EMPEMPLOYMENT": emp(ASSIGNMENT_CLASS=["GA", "GA"]),
               "EMPGLOBALASSIGNMENT": frame("EMPGLOBALASSIGNMENT", USERID=["u2"])}, 1),
    ("EC206", {"EMPEMPLOYMENT": emp(START_DATE=["2020-01-01"] * 2),
               "EMPJOBHIST": frame("EMPJOBHIST", USERID=["u1", "u2"], START_DATE=["2019-01-01", "2021-01-01"])}, 1),
    ("EC208", {"EMPJOBHIST": frame("EMPJOBHIST", USERID=["u1", "u2"], MANAGER_ID=["u1", "m1"])}, 1),
    ("EC210", {"POSITION": frame("POSITION", CODE=["P1", "P2"], TARGET_FTE=[2.0, 2.0],
                                 MULTIPLE_INCUMBENTS=["false", "true"])}, 1),
    ("EC213", {"EMPEMPLOYMENT": emp(STATUS=[ACTIVE] * 2),
               "EMPWORKPERMIT": frame("EMPWORKPERMIT", USERID=["u1", "u2"], EXPIRATION_DATE=["2020-01-01", LATER])}, 1),
    ("EC214", {"EMPEMPLOYMENT": emp(STATUS=[ACTIVE] * 2),
               "EMPWORKPERMIT": frame("EMPWORKPERMIT", USERID=["u1", "u2"], EXPIRATION_DATE=[SOON, LATER])}, 1),
    ("EC219", {"PAYMENTINFO": frame("PAYMENTINFO", USERID=["u1", "u2"],
                                    IBAN=["GB82WEST12345698765433", "GB82WEST12345698765432"])}, 1),
    ("EC220", {"PAYMENTINFO": frame("PAYMENTINFO", USERID=["u1", "u2"], BANK_COUNTRY=["GBR"] * 2,
                                    IBAN=[None, "GB82WEST12345698765432"])}, 1),
    ("EC221", {"PAYMENTINFO": frame("PAYMENTINFO", USERID=["u1", "u2"], BIC=["DEUTDEF", "DEUTDEFF"])}, 1),
    ("EC226", {"PAYMENTINFO": frame("PAYMENTINFO", USERID=["u1", "u2"], BANK=["B1"] * 2, IBAN=[None, None],
                                    ACCOUNT_NUMBER=[None, "123456"])}, 1),
    ("EC229", {"PAYMENTINFO": frame("PAYMENTINFO", USERID=["u1", "u2"], PERCENT=[150.0, 100.0])}, 1),
    ("EC230", {"EMPEMPLOYMENT": emp(STATUS=[ACTIVE] * 2, IS_CONTINGENT_WORKER=["false"] * 2),
               "PAYMENTINFO": frame("PAYMENTINFO", USERID=["u2"])}, 1),
    ("EC234", {**per(FIRSTNAME=["A", "B"]), "EMPEMPLOYMENT": emp(STATUS=[ACTIVE] * 2),
               "PEREMERGENCY": frame("PEREMERGENCY", PERSON_ID=["p2"], PHONE=["+27825550199"])}, 1),
    ("EC236", {"EMPGLOBALASSIGNMENT": frame("EMPGLOBALASSIGNMENT", USERID=["u1", "u2"],
                                            START_DATE=["2021-01-01"] * 2, END_DATE=["2020-01-01", "2022-01-01"])}, 1),
    ("EC238", {"EMPEMPLOYMENT": emp(STATUS=["T", "T"]),
               "EMPGLOBALASSIGNMENT": frame("EMPGLOBALASSIGNMENT", USERID=["u1", "u2"],
                                            END_DATE=[None, "2021-01-01"])}, 1),
]


@pytest.mark.parametrize("rid,tables,expected", CASES, ids=[c[0] for c in CASES])
def test_fixture_flags_only_the_bad_record(rid, tables, expected):
    assert fire(rid, tables) == expected


@pytest.mark.parametrize("rid,tables,_", CASES, ids=[c[0] for c in CASES])
def test_fixture_clean_rows_pass(rid, tables, _):
    clean = {t: (df.iloc[1:] if len(df) > 1 else df) for t, df in tables.items()}
    if rid in ("EC152", "EC200", "EC230", "EC234"):  # exists checks: keep only the record that has its target
        clean = {t: (df.iloc[1:] if t in ("PERINFO", "EMPEMPLOYMENT") else df) for t, df in tables.items()}
    if rid in ("EC169", "EC172"):
        clean = {t: (df.iloc[1:] if t == "EMPEMPLOYMENT" else df) for t, df in tables.items()}
    if rid in ("EC170", "EC177", "EC184", "EC188"):
        clean = {t: (df.iloc[1:] if t == "EMPEMPLOYMENT" else df) for t, df in tables.items()}
    if rid in ("EC206", "EC213", "EC214", "EC238"):
        clean = {t: df.iloc[1:] for t, df in tables.items()}
    assert fire(rid, clean) == 0


def test_job_history_gap_detected():
    hist = frame("EMPJOBHIST", USERID=["u1", "u1", "u2", "u2"], SEQ_NUMBER=["1"] * 4,
                 START_DATE=["2020-01-01", "2020-07-01", "2020-01-01", "2020-07-01"],
                 END_DATE=["2020-03-31", "9999-12-31", "2020-06-30", "9999-12-31"])
    assert fire("EC202", {"EMPJOBHIST": hist}) >= 1
    assert fire("EC202", {"EMPJOBHIST": hist.iloc[2:]}) == 0


def test_duplicate_primary_email_and_employment():
    em = frame("PEREMAIL", PERSON_ID=["p1", "p1", "p2"], IS_PRIMARY=["true"] * 3)
    assert fire("EC151", {"PEREMAIL": em}) >= 1
    assert fire("EC151", {"PEREMAIL": em.iloc[1:]}) == 0
    e = emp(PERSON_ID=["p1", "p1", "p2"], STATUS=[ACTIVE] * 3, IS_PRIMARY=["true"] * 3)
    assert fire("EC198", {"EMPEMPLOYMENT": e}) >= 1
    assert fire("EC198", {"EMPEMPLOYMENT": e.iloc[1:]}) == 0


def test_fixture_coverage():
    assert len({c[0] for c in CASES} | {"EC202", "EC151", "EC198"}) >= 30


# ---- integrity -----------------------------------------------------------------------------------------------------

def test_new_ids_unique_and_contiguous():
    ids = [r["id"] for r in RULES]
    assert len(ids) == len(set(ids))
    nums = [int(r["id"][2:]) for r in NEW]
    assert nums == list(range(121, 121 + len(nums)))
    assert 80 <= len(NEW) <= 120


def test_new_rules_fully_enriched():
    for r in NEW:
        for k in MANDATORY:
            assert r.get(k), (r["id"], k)
        for f in re.findall(r"\{([A-Z0-9]+\.[A-Z0-9_]+)\}", r["record_fix_template"]):
            assert S4.field(*f.split(".")), (r["id"], f)


# ---- auto_fix contract v1 ------------------------------------------------------------------------------------------

AUTO = [r for r in RULES if "auto_fix" in r]


def test_auto_fix_uses_only_contract_ops():
    assert len(AUTO) >= 40
    for r in AUTO:
        af = r["auto_fix"]
        assert set(af) <= {"when", "steps", "confidence"}, r["id"]
        assert af["confidence"] in {"high", "medium", "low"}, r["id"]
        assert af["steps"], r["id"]
        for s in af["steps"]:
            assert s["op"] in ALLOWED_OPS, (r["id"], s)
            if s["op"] == "regex_replace":
                re.compile(s["pattern"])
            if s["op"] == "pad_left":
                assert isinstance(s["width"], int) and len(s["char"]) == 1, r["id"]


def test_no_auto_fix_where_business_judgement_is_needed():
    for r in AUTO:
        assert not NO_AUTOFIX_FIELDS.search(r["field"]), r["id"]


def _apply(steps, v):
    for s in steps:
        op = s["op"]
        if op == "strip":
            v = v.strip()
        elif op == "collapse_spaces":
            v = re.sub(r"\s+", " ", v)
        elif op in ("upper", "lower", "title"):
            v = getattr(v, op)()
        elif op == "pad_left":
            v = v.rjust(s["width"], s["char"])
        elif op == "regex_replace":
            v = re.sub(s["pattern"], s["repl"], v)
        elif op == "set":
            v = s["value"]
    return v


@pytest.mark.parametrize("rid,dirty,fixed", [
    ("EC127", " Anna   Marie ", "Anna Marie"), ("EC137", " zaf", "ZAF"), ("EC149", "a b@x.com", "ab@x.com"),
    ("EC150", "a...b@x.com", "a.b@x.com"), ("EC154", "0027", "+27"), ("EC157", " ca", "CA"),
    ("EC164", "00 950", "00-950"), ("EC165", "1000 001", "1000-001"), ("EC166", "a65 f4e2", "A65 F4E2"),
    ("EC219", "gb82 west 1234 5698 7654 32", "GB82WEST12345698765432"), ("EC221", "deut de ff", "DEUTDEFF"),
    ("EC222", "021-000-021", "021000021"), ("EC225", "sbin 0001234", "SBIN0001234"),
    ("EC064", "12345 6789", "12345-6789"), ("EC067", "1234", "01234"), ("EC094", "12345678-z", "12345678Z"),
    ("HCM027", "de89 3704 0044 0532 0130 00", "DE89370400440532013000"),
])
def test_auto_fix_proposal_passes_the_rule(rid, dirty, fixed):
    r = BY_ID.get(rid) or next(x for x in yaml.safe_load(open("checks/rules/ecc/hcm.yaml"))["rules"] if x["id"] == rid)
    out = _apply(r["auto_fix"]["steps"], dirty)
    assert out == fixed
    if r.get("pattern"):
        assert not re.match(r["pattern"], dirty) and re.match(r["pattern"], out)
