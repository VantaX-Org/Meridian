"""Golden datasets: the SuccessFactors rule packs (shipped + generated rules, live
picklists and foundation objects, per-table frames) on employees whose correct
findings are known. Clean records — data an Employee Central consultant would sign
off — must produce no finding at all; each seeded defect must be found exactly
where it was put, and nowhere else.

Dates are ISO (the SF connector normalises OData ``/Date(ms)/`` to YYYY-MM-DD),
picklist fields carry external codes. Dates that timeliness rules judge against
"now" are generated relative to today so the dataset does not age."""

from __future__ import annotations

import pandas as pd
import yaml

from checks.frames import TableFrames
from checks.runner import _find_module_yaml, _with_reference, run_checks
from checks.value_placement import generate
from sap.ddic import get_dictionary

D = get_dictionary("s4hana")
TODAY = pd.Timestamp.now(tz="UTC").normalize().tz_localize(None)  # freshness rules judge in UTC


def _day(offset: int) -> str:
    return (TODAY + pd.Timedelta(days=offset)).strftime("%Y-%m-%d")


def _frame(table: str, rows: list[dict]) -> pd.DataFrame:
    """Rows of canonical fields → a ``TABLE.FIELD`` frame (every field must exist)."""
    cols = list(dict.fromkeys(k for r in rows for k in r))
    unknown = [c for c in cols if D.field(table, c) is None]
    assert not unknown, f"not in the canonical schema: {table}.{unknown}"
    return pd.DataFrame([{f"{table}.{c}": r.get(c, "") for c in cols} for r in rows])


def _frames(module: str, tables: dict[str, list[dict]]) -> TableFrames:
    return TableFrames({t: _frame(t, rows) for t, rows in tables.items()}, D, module=module)


# The tenant's own picklists and foundation objects, as config sync reads them
# (PickListValueV2 external codes, FO* externalCode).
LIVE = {
    "EMPEMPLOYMENT.EMPLOYMENT_TYPE": {"REG", "FTC", "INT"},
    "EMPEMPLOYMENT.STATUS": {"A", "U", "P", "T", "R", "S", "D", "O", "F"},
    "EMPEMPLOYMENT.COMPANY": {"ZA01", "US01", "DE01", "HK01", "UG01"},
    "EMPEMPLOYMENT.EVENT_REASON": {"HIRNEW", "DATACHG", "PROMO", "LOAMAT", "TERRES", "TERRET"},
    "PEREMAIL.EMAIL_TYPE": {"B", "P"},
    "PERPHONE.PHONE_TYPE": {"B", "H", "C", "F"},
    "COMPINFO.COMP_FREQUENCY": {"ANN", "MON", "BWK", "HOURLY"},
    "COMPINFO.PAY_TYPE": {"BASE_SAL", "HOURLY_RATE", "CAR_ALLOW", "HOUSING_ALLOW"},
    "COMPINFO.PAY_GRADE": {"GR03", "GR06", "GR07", "GR08", "GR10"},
}


def _run(module: str, frames: TableFrames):
    static = yaml.safe_load(_find_module_yaml(module).read_text())["rules"]
    live = {}
    for r in static:
        if r.get("check_class") in ("referential_check", "domain_value_check") and r["field"] in LIVE:
            key = _with_reference(r, D, {}).get("_reference_key")
            if key:
                live[key] = LIVE[r["field"]]
    results = run_checks(module, frames, "t", reference_values=live,
                         extra_rules=generate(module, static, get_dictionary("s4hana")))
    errors = {r.check_id: r.error for r in results if r.error}
    assert not errors, errors
    return results, {r.check_id: set(r.failing_record_keys or []) for r in results if r.affected_count}


# ── Employee Central ─────────────────────────────────────────────────────────

def _employee(uid: str, **kw) -> dict:
    return {"USERID": uid, "PERSON_ID": uid, "START_DATE": "2016-07-01", "END_DATE": "",
            "CREATED_DATE": "2016-06-14", "LAST_MODIFIED": "2025-04-01", "COMPANY": "ZA01", "DIVISION": "FIN",
            "DEPARTMENT": "FIN-CTRL", "LOCATION": "JNB-HQ", "COST_CENTER": "102100", "JOB_CODE": "FIN-ACC",
            "JOB_TITLE": "Financial Accountant", "MANAGER_ID": "100101", "POSITION": f"POS-{uid}",
            "EMPLOYMENT_TYPE": "REG", "EVENT_REASON": "HIRNEW", "STATUS": "A", **kw}


def _person(pid: str, first: str, last: str, **kw) -> dict:
    return {"PERSON_ID": pid, "FIRSTNAME": first, "LASTNAME": last, "MIDDLENAME": "", "PREFERRED_NAME": first,
            "SALUTATION": "MS" if kw.get("GENDER", "F") == "F" else "MR", "GENDER": "F", "MARITAL_STATUS": "M",
            "NATIONALITY": "ZAF", "DATE_OF_BIRTH": "1986-03-15", "NATIONAL_ID": f"860315{pid[-4:]}087", **kw}


def _za_address(pid: str, **kw) -> dict:
    return {"PERSON_ID": pid, "ADDRESS_TYPE": "home", "ADDRESS_LINE1": "14 Oxford Road",
            "ADDRESS_LINE2": "Parktown", "CITY": "Johannesburg", "STATE": "GP", "ZIPCODE": "2193",
            "COUNTRY": "ZAF", **kw}


def test_employee_central_golden():
    emp = [
        _employee("100100", START_DATE="2012-02-01", CREATED_DATE="2012-01-20", DIVISION="CORP",
                  DEPARTMENT="CORP-EXEC", COST_CENTER="101000", JOB_CODE="EXEC-CEO",
                  JOB_TITLE="Chief Executive Officer", MANAGER_ID="NO_MANAGER", EVENT_REASON="DATACHG"),
        _employee("100101", JOB_CODE="FIN-MGR", JOB_TITLE="Financial Controller", MANAGER_ID="100100",
                  EVENT_REASON="PROMO"),
        _employee("100102", START_DATE="2023-01-09", CREATED_DATE="2022-12-12", COMPANY="US01", DIVISION="SLS",
                  DEPARTMENT="SLS-NA", LOCATION="SFO-01", COST_CENTER="410200", JOB_CODE="SLS-AE",
                  JOB_TITLE="Account Executive", MANAGER_ID="100100"),
        _employee("100103", START_DATE="2019-04-01", CREATED_DATE="2019-03-11", COMPANY="DE01", DIVISION="OPS",
                  DEPARTMENT="OPS-PLAN", LOCATION="STR-01", COST_CENTER="520300", JOB_CODE="SCM-PLN",
                  JOB_TITLE="Supply Chain Planner", MANAGER_ID="100100", EVENT_REASON="LOAMAT", STATUS="P"),
        _employee("100104", START_DATE="2018-03-01", END_DATE="2025-06-30", CREATED_DATE="2018-02-05",
                  EVENT_REASON="TERRES", STATUS="T"),
        _employee("100105", START_DATE="2025-02-03", CREATED_DATE="2025-01-13", COMPANY="HK01", DIVISION="SLS",
                  DEPARTMENT="SLS-APAC", LOCATION="HKG-01", COST_CENTER="610100", JOB_CODE="SLS-AE",
                  JOB_TITLE="Account Executive", MANAGER_ID="100102", EMPLOYMENT_TYPE="FTC"),
        # seeded defects — one each
        _employee("100106", MANAGER_ID=""),                                     # EC011
        _employee("100107", EMPLOYMENT_TYPE="PERM"),                            # EC010 not in picklist
        _employee("100108", START_DATE="2024-05-01", END_DATE="2024-04-30",     # EC025 ends before it starts
                  EVENT_REASON="TERRES", STATUS="T"),
        _employee("100109"), _employee("100110"), _employee("100111"), _employee("100112"),
        _employee("100113", COMPANY="ZA02"),                                    # EC042 no such legal entity
        _employee("100114", START_DATE="2024-08-01", CREATED_DATE="2024-07-08", COMPANY="UG01", DIVISION="SLS",
                  DEPARTMENT="SLS-EA", LOCATION="KLA-01", COST_CENTER="710100", JOB_CODE="SLS-AE",
                  JOB_TITLE="Account Executive", MANAGER_ID="100102"),
    ]
    per = [
        _person("100100", "Sipho", "Dlamini", GENDER="M", DATE_OF_BIRTH="1971-08-02", NATIONAL_ID="7108025800083"),
        _person("100101", "Thandiwe", "Nkosi"),
        _person("100102", "Michael", "Reyes", GENDER="M", NATIONALITY="USA", NATIONAL_ID="512-34-8876",
                DATE_OF_BIRTH="1990-11-23", MARITAL_STATUS="S"),
        _person("100103", "Katharina", "Müller", NATIONALITY="DEU", NATIONAL_ID="65929970489",
                DATE_OF_BIRTH="1988-05-30"),
        _person("100104", "Pieter", "van der Merwe", GENDER="M", MIDDLENAME="Johannes"),
        _person("100105", "Ka Yan", "Wong", PREFERRED_NAME="Karen", NATIONALITY="HKG", NATIONAL_ID="A1234563",
                DATE_OF_BIRTH="1995-01-09", MARITAL_STATUS="S"),
        _person("100106", "Lerato", "Mokoena"), _person("100107", "Ayanda", "Zulu"),
        _person("100108", "Johan", "Botha", GENDER="M"),
        _person("100109", "Nomsa", ""),                                         # EC004 last name missing
        _person("100110", "Zanele", "Khumalo"), _person("100111", "Bongani", "Ndlovu", GENDER="M"),
        _person("100112", "Precious", "Mahlangu"), _person("100113", "Kagiso", "Molefe", GENDER="M"),
        _person("100114", "Brian", "Okello", GENDER="M", NATIONALITY="UGA", NATIONAL_ID="CM9001234567AB",
                DATE_OF_BIRTH="1992-06-14"),
    ]
    pids = [p["PERSON_ID"] for p in per]
    names = {p["PERSON_ID"]: (p["PREFERRED_NAME"] or p["FIRSTNAME"]).lower().replace(" ", "") for p in per}
    domain = {"100102": "meridian-demo.com", "100103": "meridian-demo.de", "100105": "meridian-demo.com.hk",
              "100114": "meridian-demo.co.ug"}
    email = [{"PERSON_ID": p, "EMAIL_TYPE": "B",
              "EMAIL_ADDRESS": f"{names[p]}.{p}@{domain.get(p, 'meridian-demo.co.za')}"} for p in pids]
    email[10]["EMAIL_ADDRESS"] = "zanele.khumalo.meridian-demo.co.za"     # EC018 100110: no @
    email += [{"PERSON_ID": "100101", "EMAIL_TYPE": "P", "EMAIL_ADDRESS": "thandiwe.nkosi@gmail.com"},
              {"PERSON_ID": "100103", "EMAIL_TYPE": "P", "EMAIL_ADDRESS": "k.mueller@web.de"}]
    phone = [{"PERSON_ID": p, "PHONE_TYPE": "B", "PHONE_NUMBER": f"+27 11 555 {p[-4:]}"} for p in pids]
    phone[2]["PHONE_NUMBER"], phone[3]["PHONE_NUMBER"] = "+1 415 555 0102", "+49 711 555 0103"
    phone[5]["PHONE_NUMBER"], phone[14]["PHONE_NUMBER"] = "+852 2555 0105", "+256 41 455 0114"
    phone += [{"PERSON_ID": "100101", "PHONE_TYPE": "C", "PHONE_NUMBER": "+27 82 555 0101"},
              {"PERSON_ID": "100112", "PHONE_TYPE": "M", "PHONE_NUMBER": "+27 83 555 0112"}]  # EC020 'M' not a type
    addr = [_za_address(p) for p in pids]
    addr[2] = {"PERSON_ID": "100102", "ADDRESS_TYPE": "home", "ADDRESS_LINE1": "455 Market Street",
               "ADDRESS_LINE2": "Apt 1204", "CITY": "San Francisco", "STATE": "CA", "ZIPCODE": "94105",
               "COUNTRY": "USA"}
    addr[3] = {"PERSON_ID": "100103", "ADDRESS_TYPE": "home", "ADDRESS_LINE1": "Königstraße 28",
               "ADDRESS_LINE2": "", "CITY": "Stuttgart", "STATE": "", "ZIPCODE": "70173", "COUNTRY": "DEU"}
    addr[5] = {"PERSON_ID": "100105", "ADDRESS_TYPE": "home", "ADDRESS_LINE1": "Flat 12B, Harbour View Court",
               "ADDRESS_LINE2": "18 Harbour Road, Wan Chai", "CITY": "Hong Kong", "STATE": "", "ZIPCODE": "",
               "COUNTRY": "HKG"}                                           # Hong Kong has no postcodes
    addr[14] = {"PERSON_ID": "100114", "ADDRESS_TYPE": "home", "ADDRESS_LINE1": "Plot 24, Kira Road",
                "ADDRESS_LINE2": "Kamwokya", "CITY": "Kampala", "STATE": "", "ZIPCODE": "",
                "COUNTRY": "UGA"}                                          # Uganda has no postcodes either
    addr[11]["ZIPCODE"] = ""                                               # EC033 100111: ZA postcode missing

    results, found = _run("employee_central", _frames("employee_central", {
        "EMPEMPLOYMENT": emp, "PERINFO": per, "PEREMAIL": email, "PERPHONE": phone, "PERADDRESS": addr}))
    assert found == {
        "EC011": {"USERID=100106"},
        "EC010": {"USERID=100107"},
        "EC025": {"USERID=100108"},
        "EC042": {"USERID=100113"},
        "EC004": {"PERSON_ID=100109"},
        "EC018": {"PERSON_ID=100110|EMAIL_TYPE=B"},
        "EC033": {"PERSON_ID=100111|ADDRESS_TYPE=home"},
        "EC020": {"PERSON_ID=100112|PHONE_TYPE=M"},
    }, found
    ran = {r.check_id for r in results}
    assert {"EC014", "EC019", "EC021", "EC032", "EC041", "EC043"} <= ran  # judged, and passed


# ── Compensation ─────────────────────────────────────────────────────────────

def _comp(uid: str, **kw) -> dict:
    # GR08: ZAR 600k–900k, midpoint 750k (annual)
    return {"USERID": uid, "EFFECTIVE_DATE": "2025-04-01", "EFFECTIVE_DATE_COMP": "2025-04-01",
            "PAY_GRADE": "GR08", "PAY_TYPE": "BASE_SAL", "SALARY": "720000.00", "CURRENCY": "ZAR",
            "COMP_FREQUENCY": "ANN", "PAY_RANGE_MIN": "600000.00", "PAY_RANGE_MID": "750000.00",
            "PAY_RANGE_MAX": "900000.00", "COMPA_RATIO": "0.96", **kw}


def test_compensation_golden():
    rows = [
        _comp("100101"),
        # a recurring allowance is its own pay component row; the pay range governs the
        # annualised salary (compa-ratio 0.96), not the allowance on its own
        _comp("100101", PAY_TYPE="CAR_ALLOW", SALARY="96000.00"),
        _comp("100102", EFFECTIVE_DATE="2025-01-01", EFFECTIVE_DATE_COMP="2025-01-01", PAY_GRADE="GR10",
              SALARY="135000.00", CURRENCY="USD", PAY_RANGE_MIN="110000.00", PAY_RANGE_MID="137500.00",
              PAY_RANGE_MAX="165000.00", COMPA_RATIO="0.98"),
        _comp("100103", EFFECTIVE_DATE="2025-01-01", EFFECTIVE_DATE_COMP="2025-01-01", PAY_GRADE="GR07",
              SALARY="6500.00", CURRENCY="EUR", COMP_FREQUENCY="MON", PAY_RANGE_MIN="70000.00",
              PAY_RANGE_MID="82500.00", PAY_RANGE_MAX="95000.00", COMPA_RATIO="0.95"),
        _comp("100105", EFFECTIVE_DATE="2025-02-03", EFFECTIVE_DATE_COMP="2025-02-03", PAY_GRADE="GR06",
              SALARY="52000.00", CURRENCY="HKD", COMP_FREQUENCY="MON", PAY_RANGE_MIN="540000.00",
              PAY_RANGE_MID="660000.00", PAY_RANGE_MAX="780000.00", COMPA_RATIO="0.95"),
        # hourly associate: rate × 2080 h against the annual range (compa-ratio 0.99)
        _comp("100115", EFFECTIVE_DATE="2025-01-01", EFFECTIVE_DATE_COMP="2025-01-01", PAY_GRADE="GR03",
              PAY_TYPE="HOURLY_RATE", SALARY="21.50", CURRENCY="USD", COMP_FREQUENCY="HOURLY",
              PAY_RANGE_MIN="38000.00", PAY_RANGE_MID="45000.00", PAY_RANGE_MAX="52000.00", COMPA_RATIO="0.99"),
        _comp("100106", SALARY="690000.00", COMPA_RATIO="0.92"),
        _comp("100106", PAY_TYPE="HOUSING_ALLOW", SALARY="60000.00", COMPA_RATIO="0.92"),
        # seeded defects — one each
        _comp("100110", SALARY="650000.00", CURRENCY="ZA", COMPA_RATIO="0.87"),          # COMP004
        _comp("100111", COMP_FREQUENCY="YEARLY", SALARY="675000.00", COMPA_RATIO="0.90"),  # COMP006
        _comp("100112", SALARY="1100000.00", COMPA_RATIO="1.47"),                         # COMP011 above max
        _comp("100113", PAY_GRADE="GR05", SALARY="480000.00", PAY_RANGE_MIN="400000.00",  # COMP018 grade retired
              PAY_RANGE_MID="500000.00", PAY_RANGE_MAX="600000.00"),
        _comp("100114", SALARY="700000.00", COMPA_RATIO="0.93"),
        _comp("100114", PAY_TYPE="HOUSING_ALLOW", SALARY=""),                             # COMP005 no amount
    ]
    _, found = _run("compensation", _frames("compensation", {"COMPINFO": rows}))
    assert found == {
        "COMP004": {"USERID=100110|EFFECTIVE_DATE=2025-04-01"},
        "COMP006": {"USERID=100111|EFFECTIVE_DATE=2025-04-01"},
        "COMP011": {"USERID=100112|EFFECTIVE_DATE=2025-04-01"},
        "COMP018": {"USERID=100113|EFFECTIVE_DATE=2025-04-01"},
        "COMP005": {"USERID=100114|EFFECTIVE_DATE=2025-04-01"},
    }, found


# ── Benefits ─────────────────────────────────────────────────────────────────

def _enrol(uid: str, plan: str, **kw) -> dict:
    return {"USERID": uid, "PLAN_ID": plan, "PLAN_TYPE": "MEDICAL", "COVERAGE_LEVEL": "EMP_ONLY",
            "EFFECTIVE_DATE": "2026-01-01", "ENROL_DATE": "2025-11-18", "EMPLOYEE_COST": "2140.00",
            "EMPLOYER_COST": "2140.00", "DEPENDENT_LINK": "", **kw}


def test_benefits_golden():
    rows = [
        # one enrolment per plan year: 2025 and 2026 open enrolment for the same plan
        _enrol("100101", "ZA_MED_DISC", COVERAGE_LEVEL="EMP_SPOUSE_CHILD", EFFECTIVE_DATE="2025-01-01",
               ENROL_DATE="2024-11-20", EMPLOYEE_COST="3420.00", EMPLOYER_COST="3420.00",
               DEPENDENT_LINK="D100101-1;D100101-2"),
        _enrol("100101", "ZA_MED_DISC", COVERAGE_LEVEL="EMP_SPOUSE_CHILD", EMPLOYEE_COST="3690.00",
               EMPLOYER_COST="3690.00", DEPENDENT_LINK="D100101-1;D100101-2"),
        _enrol("100101", "ZA_RET_FUND", PLAN_TYPE="RETIREMENT", EFFECTIVE_DATE="2016-07-01",
               ENROL_DATE="2016-06-20", EMPLOYEE_COST="5400.00", EMPLOYER_COST="5400.00"),
        _enrol("100101", "ZA_GRP_LIFE", PLAN_TYPE="LIFE", EFFECTIVE_DATE="2016-07-01", ENROL_DATE="2016-06-20",
               EMPLOYEE_COST="0.00", EMPLOYER_COST="312.00"),                     # employer-paid
        _enrol("100102", "US_MED_PPO", ENROL_DATE="2025-11-10", EMPLOYEE_COST="186.00", EMPLOYER_COST="742.00"),
        _enrol("100102", "US_401K", PLAN_TYPE="SAVINGS", EFFECTIVE_DATE="2023-02-01", ENROL_DATE="2023-01-20",
               EMPLOYEE_COST="1125.00", EMPLOYER_COST="562.50"),
        _enrol("100103", "DE_BAV", PLAN_TYPE="PENSION", EFFECTIVE_DATE="2019-04-01", ENROL_DATE="2019-03-25",
               EMPLOYEE_COST="150.00", EMPLOYER_COST="22.50"),
        # seeded defects — one each
        _enrol("100105", "HK_MED_AIA", ENROL_DATE="", EMPLOYEE_COST="0.00", EMPLOYER_COST="1450.00"),  # BEN004
        _enrol("100106", "ZA_MED_DISC"), _enrol("100106", "ZA_MED_DISC"),          # BEN011 enrolled twice
        _enrol("100109", "ZA_GAP_COVER", PLAN_TYPE="GAP", EMPLOYEE_COST="", EMPLOYER_COST="0.00"),     # BEN007
    ]
    _, found = _run("benefits", _frames("benefits", {"BENEFITENROLLMENT": rows}))
    assert found == {
        "BEN004": {"USERID=100105|PLAN_ID=HK_MED_AIA"},
        "BEN011": {"USERID=100106|PLAN_ID=ZA_MED_DISC"},
        "BEN007": {"USERID=100109|PLAN_ID=ZA_GAP_COVER"},
    }, found


# ── Payroll integration ──────────────────────────────────────────────────────

def _pay(uid: str, period: str, pay_date: str, gross: str, tax: str, ded: str, **kw) -> dict:
    net = f"{float(gross) - float(tax) - float(ded):.2f}"
    return {"USERID": uid, "USERID_PAY": uid, "PAY_PERIOD": period, "PAY_DATE": pay_date, "PAYROLL_AREA": "Z1",
            "COMPANY": "ZA01", "COST_CENTRE": "102100", "GROSS_PAY": gross, "NET_PAY": net, "TAX_AMOUNT": tax,
            "DEDUCTIONS": ded, "CURRENCY": "ZAR", "DELTA_FLAG": "", **kw}


def test_payroll_integration_golden():
    rows = [
        _pay("100101", "202508", "2025-08-25", "60000.00", "15180.00", "3570.00"),
        _pay("100101", "202509", "2025-09-25", "60000.00", "15180.00", "3570.00"),
        _pay("100101", "202509", "2025-09-15", "30000.00", "11700.00", "0.00"),    # off-cycle bonus run
        _pay("100101", "202508", "2025-08-25", "1200.00", "380.00", "0.00", DELTA_FLAG="X"),  # retro delta
        _pay("100104", "202506", "2025-06-25", "48500.00", "10120.00", "2910.00"),  # final pay on leaving
        _pay("100120", "202509", "2025-09-25", "4500.00", "0.00", "45.00"),          # below the tax threshold
        # seeded defects — one each
        {**_pay("100109", "202509", "2025-09-25", "52000.00", "12400.00", "3100.00"), "NET_PAY": "58000.00"},  # PAY010
        _pay("100110", "202509", "2025-09-25", "41000.00", "8350.00", "2460.00", CURRENCY="R"),  # PAY004
        _pay("100111", "202509", "2025-09-25", "39000.00", "7620.00", "2340.00", COST_CENTRE=""),  # PAY005
        _pay("100112", "202509", "2025-09-25", "45000.00", "9480.00", "2700.00"),    # PAY016 result loaded twice
        _pay("100112", "202509", "2025-09-25", "45000.00", "9480.00", "2700.00"),
    ]
    _, found = _run("payroll_integration", _frames("payroll_integration", {"PAYRESULT": rows}))
    assert found == {
        "PAY010": {"USERID=100109|PAY_PERIOD=202509"},
        "PAY004": {"USERID=100110|PAY_PERIOD=202509"},
        "PAY005": {"USERID=100111|PAY_PERIOD=202509"},
        "PAY016": {"USERID=100112|PAY_PERIOD=202509"},
    }, found


# ── Performance & goals ──────────────────────────────────────────────────────

def test_performance_goals_golden():
    forms = [  # formDataStatus 3 = completed, 2 = in progress (en route)
        {"USERID": "100101", "REVIEW_PERIOD": "2025-01-01", "REVIEW_DATE": "2026-02-27", "FORM_STATUS": "3",
         "OVERALL_RATING": "4.0", "MANAGER_RATING": "4.0", "SELF_RATING": "4.5"},
        {"USERID": "100102", "REVIEW_PERIOD": "2025-01-01", "REVIEW_DATE": "2026-02-20", "FORM_STATUS": "3",
         "OVERALL_RATING": "3.0", "MANAGER_RATING": "3.0", "SELF_RATING": "3.5"},
        {"USERID": "100103", "REVIEW_PERIOD": "2025-01-01", "REVIEW_DATE": "2026-03-02", "FORM_STATUS": "3",
         "OVERALL_RATING": "3.5", "MANAGER_RATING": "3.5", "SELF_RATING": "3.0"},
        # current cycle, still at the self-assessment step: no manager/overall rating yet
        {"USERID": "100102", "REVIEW_PERIOD": "2026-01-01", "REVIEW_DATE": "2026-09-18", "FORM_STATUS": "2",
         "OVERALL_RATING": "", "MANAGER_RATING": "", "SELF_RATING": "4.0"},
        # seeded defect: completed form without its final rating
        {"USERID": "100105", "REVIEW_PERIOD": "2025-01-01", "REVIEW_DATE": "2026-02-25", "FORM_STATUS": "3",
         "OVERALL_RATING": "", "MANAGER_RATING": "3.5", "SELF_RATING": "3.5"},             # PERF002
    ]
    goals = [
        {"GOAL_ID": "5001", "USERID": "100101", "GOAL_NAME": "Close month-end within 5 working days",
         "GOAL_METRIC": "Average close <= 5 WD over FY2026", "GOAL_STATUS": "On Track", "GOAL_WEIGHT": "40",
         "TARGET_DATE": "2026-12-31"},
        {"GOAL_ID": "5002", "USERID": "100101", "GOAL_NAME": "Reduce audit findings",
         "GOAL_METRIC": "No repeat external-audit findings", "GOAL_STATUS": "On Track", "GOAL_WEIGHT": "60",
         "TARGET_DATE": "2026-12-31"},
        {"GOAL_ID": "5003", "USERID": "100102", "GOAL_NAME": "Grow North-America new business",
         "GOAL_METRIC": "USD 1.2m new ARR", "GOAL_STATUS": "Behind", "GOAL_WEIGHT": "100",
         "TARGET_DATE": "2026-12-31"},
        {"GOAL_ID": "5004", "USERID": "100103", "GOAL_NAME": "Forecast accuracy",
         "GOAL_METRIC": "MAPE <= 15% on A-items", "GOAL_STATUS": "Completed", "GOAL_WEIGHT": "100",
         "TARGET_DATE": "2026-06-30"},
        {"GOAL_ID": "5005", "USERID": "100105", "GOAL_NAME": "",                            # PERF008
         "GOAL_METRIC": "HKD 3m pipeline", "GOAL_STATUS": "On Track", "GOAL_WEIGHT": "100",
         "TARGET_DATE": "2026-12-31"},
    ]
    _, found = _run("performance_goals", _frames("performance_goals",
                                                 {"PMREVIEWRESULT": forms, "GOALPLAN": goals}))
    assert found == {
        "PERF002": {"USERID=100105|REVIEW_PERIOD=2025-01-01"},
        "PERF008": {"GOAL_ID=5005"},
    }, found


# ── Succession ───────────────────────────────────────────────────────────────

def test_succession_planning_golden():
    def nom(nominee, pos, age_days, readiness="READY_1_2_YEARS", rank="1", **kw):
        return {"NOMINEE_ID": nominee, "POSITION_ID": pos, "NOMINATED_DATE": _day(-age_days),
                "READINESS": readiness, "RANKING": rank, "RISK_OF_LOSS": "LOW", "IMPACT_OF_LOSS": "HIGH", **kw}
    rows = [
        nom("100101", "POS-100100", 200),
        nom("100102", "POS-100100", 150, "READY_3_5_YEARS", "2", RISK_OF_LOSS="MEDIUM"),
        nom("100101", "POS-100099", 400, "READY_NOW"),                    # one nominee, two positions
        nom("100105", "POS-100102", 90, "READY_NOW", IMPACT_OF_LOSS="MEDIUM"),
        # seeded defects — one each
        nom("J Smith", "POS-100103", 120),                                # SUC008 not a user id
        nom("100106", "POS-100101", 3 * 365 + 30),                        # SUC010 not reviewed in 3 years
    ]
    _, found = _run("succession_planning", _frames("succession_planning", {"SUCCESSIONCANDIDATE": rows}))
    assert found == {
        "SUC008": {"NOMINEE_ID=J Smith|POSITION_ID=POS-100103"},
        "SUC010": {"NOMINEE_ID=100106|POSITION_ID=POS-100101"},
    }, found


# ── Recruiting & onboarding ──────────────────────────────────────────────────

def test_recruiting_onboarding_golden():
    reqs = [
        {"JOB_REQ_ID": "1201", "TITLE": "Payroll Administrator", "STATUS": "Open", "HIRING_MANAGER": "100101",
         "RECRUITER": "200301", "OPEN_DATE": "2026-08-03", "CLOSE_DATE": ""},
        {"JOB_REQ_ID": "1202", "TITLE": "Account Executive - APAC", "STATUS": "Closed",
         "HIRING_MANAGER": "100102", "RECRUITER": "200302", "OPEN_DATE": "2024-12-02", "CLOSE_DATE": "2025-01-20"},
        {"JOB_REQ_ID": "1203", "TITLE": "Supply Chain Planner", "STATUS": "Open", "HIRING_MANAGER": "100100",
         "RECRUITER": "200301", "OPEN_DATE": "2026-09-14", "CLOSE_DATE": ""},
        # seeded defects — one each
        {"JOB_REQ_ID": "1204", "TITLE": "Tax Specialist", "STATUS": "Closed", "HIRING_MANAGER": "100101",
         "RECRUITER": "200301", "OPEN_DATE": "2026-05-10", "CLOSE_DATE": "2026-04-30"},          # REC010
        {"JOB_REQ_ID": "1205", "TITLE": "Warehouse Supervisor", "STATUS": "Open", "HIRING_MANAGER": "",
         "RECRUITER": "200302", "OPEN_DATE": "2026-09-01", "CLOSE_DATE": ""},                    # REC008
    ]
    apps = [
        {"CANDIDATE_ID": "70001", "JOB_REQ_ID": "1201", "STATUS": "Interview", "SOURCE": "Career Site",
         "APPLICATION_DATE": "2026-08-10", "RATING": "4.0"},
        {"CANDIDATE_ID": "70002", "JOB_REQ_ID": "1201", "STATUS": "Screening", "SOURCE": "LinkedIn",
         "APPLICATION_DATE": "2026-08-12", "RATING": ""},
        {"CANDIDATE_ID": "70003", "JOB_REQ_ID": "1202", "STATUS": "Hired", "SOURCE": "Agency",
         "APPLICATION_DATE": "2024-12-10", "RATING": "4.5"},
        {"CANDIDATE_ID": "70003", "JOB_REQ_ID": "1201", "STATUS": "Withdrawn", "SOURCE": "Career Site",
         "APPLICATION_DATE": "2026-08-04", "RATING": ""},                 # one candidate, two requisitions
        {"CANDIDATE_ID": "70004", "JOB_REQ_ID": "1203", "STATUS": "Applied", "SOURCE": "Employee Referral",
         "APPLICATION_DATE": "2026-09-20", "RATING": ""},
        {"CANDIDATE_ID": "70005", "JOB_REQ_ID": "1201", "STATUS": "Applied", "SOURCE": "",          # REC005
         "APPLICATION_DATE": "2026-08-15", "RATING": ""},
    ]
    onb = [
        {"USERID": "100130", "HIRE_DATE": "2026-10-12", "STATUS": "IN_PROGRESS", "DEPARTMENT": "FIN-CTRL",
         "MANAGER_ID": "100101", "TASK_COMPLETION": ""},
        {"USERID": "100131", "HIRE_DATE": "2026-09-01", "STATUS": "COMPLETED", "DEPARTMENT": "SLS-APAC",
         "MANAGER_ID": "100102", "TASK_COMPLETION": ""},
        {"USERID": "100132", "HIRE_DATE": "2026-10-19", "STATUS": "IN_PROGRESS", "DEPARTMENT": "OPS-PLAN",
         "MANAGER_ID": "", "TASK_COMPLETION": ""},                                                # REC014
    ]
    # one analysis covers EC and recruiting together, so the employee extract sits in the same frames:
    # long-standing employees have no onboarding process and must not be judged by onboarding rules
    emp = [{"USERID": u, "PERSON_ID": u, "START_DATE": d, "STATUS": "A"}
           for u, d in (("100100", "2012-02-01"), ("100101", "2016-07-01"), ("100102", "2023-01-09"),
                        ("100131", "2026-09-01"))]
    _, found = _run("recruiting_onboarding", _frames("recruiting_onboarding", {
        "EMPEMPLOYMENT": emp, "JOBREQUISITION": reqs, "JOBAPPLICATION": apps, "ONBOARDINGCANDIDATEINFO": onb}))
    assert found == {
        "REC010": {"JOB_REQ_ID=1204"},
        "REC008": {"JOB_REQ_ID=1205"},
        "REC005": {"CANDIDATE_ID=70005|JOB_REQ_ID=1201"},
        "REC014": {"USERID=100132"},
    }, found


# ── Learning ─────────────────────────────────────────────────────────────────

def test_learning_management_golden():
    def item(uid, course, title, due, required="true", status="Not Started", assigned=-30):
        return {"USERID": uid, "COURSE_ID": course, "COURSE_TITLE": title, "ASSIGNED_DATE": _day(assigned),
                "DUE_DATE": due, "STATUS": status, "REQUIRED": required}
    assignments = [
        item("100101", "POPIA-2026", "POPIA Data Privacy Awareness 2026", _day(60)),
        item("100102", "COC-2026", "Code of Conduct Attestation 2026", _day(30)),
        item("100103", "EXCEL-ADV", "Advanced Excel for Planners", "", required="false"),  # optional, no due date
        item("100105", "AML-101", "Anti-Money-Laundering Essentials", _day(14), status="In Progress"),
        item("100104", "HSE-REFRESH", "Health and Safety Refresher", _day(0), status="In Progress"),  # due today
        # seeded defects — one each
        item("100106", "POPIA-2026", "POPIA Data Privacy Awareness 2026", _day(-20), assigned=-90),  # LMS014
        item("100107", "COC-2026", "Code of Conduct Attestation 2026", _day(30), required="Yes"),    # LMS006
        item("100108", "HSE-101", "Health and Safety Induction", ""),                                # LMS003
    ]
    history = [
        {"USERID": "100101", "COURSE_ID": "POPIA-2025", "COMPLETION_DATE": "2025-03-14", "STATUS": "COMPLETE",
         "SCORE": "92", "CREDIT_HOURS": "1.0"},
        {"USERID": "100102", "COURSE_ID": "COC-2025", "COMPLETION_DATE": "2025-02-10", "STATUS": "COMPLETE",
         "SCORE": "100", "CREDIT_HOURS": "0.5"},
        {"USERID": "100103", "COURSE_ID": "FORKLIFT-SAFE", "COMPLETION_DATE": "2024-11-05", "STATUS": "COMPLETE",
         "SCORE": "", "CREDIT_HOURS": "4.0"},
        {"USERID": "100104", "COURSE_ID": "HSE-101", "COMPLETION_DATE": "", "STATUS": "COMPLETE",   # LMS009
         "SCORE": "", "CREDIT_HOURS": "2.0"},
    ]
    _, found = _run("learning_management", _frames("learning_management", {
        "LEARNINGASSIGNMENT": assignments, "LEARNINGCOMPLETION": history}))
    assert found == {
        "LMS014": {"USERID=100106|COURSE_ID=POPIA-2026"},
        "LMS006": {"USERID=100107|COURSE_ID=COC-2026"},
        "LMS003": {"USERID=100108|COURSE_ID=HSE-101"},
        "LMS009": {"USERID=100104|COURSE_ID=HSE-101|COMPLETION_DATE="},
    }, found


# ── Time & attendance ────────────────────────────────────────────────────────

def test_time_attendance_golden():
    def entry(uid, date, hours="8.0", status="APPROVED", **kw):
        return {"USERID": uid, "DATE": date, "HOURS": hours, "OVERTIME_HOURS": "0.0", "COST_CENTER": "102100",
                "APPROVAL_STATUS": status, "ABSENCE_TYPE": "", "TIME_ACCOUNT_TYPE": "", "BALANCE": "", **kw}
    rows = [
        entry("100101", "2026-09-21"),
        entry("100101", "2026-09-22", "9.5", OVERTIME_HOURS="1.5"),
        entry("100102", "2026-09-21", status="PENDING", COST_CENTER="410200"),
        entry("100103", "2026-09-21", ABSENCE_TYPE="VACATION", TIME_ACCOUNT_TYPE="VAC_ANNUAL", BALANCE="18.5",
              COST_CENTER="520300"),
        entry("100105", "2026-09-28", status="CANCELLED", COST_CENTER="610100"),
        entry("100104", "2025-06-27", status="PENDING_CANCELLATION"),
        # seeded defects — one each
        entry("100106", "2026-09-21", status="SUBMITTED"),                # TIME005
        entry("100107", "2026-09-21", "8h"),                              # TIME012
        entry("100108", "2026-09-21", ""),                                # TIME003
    ]
    _, found = _run("time_attendance", _frames("time_attendance", {"TIMESHEET": rows}))
    assert found == {
        "TIME005": {"USERID=100106|DATE=2026-09-21"},
        "TIME012": {"USERID=100107|DATE=2026-09-21"},
        "TIME003": {"USERID=100108|DATE=2026-09-21"},
    }, found
