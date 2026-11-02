"""Depth/enrichment/fixture contract for EC450 onward: the exhaustive SuccessFactors
employee_central field-by-field sweep on top of EC239-449 (tests/test_sf_ec_depth_rules2.py).
Same idioms; every fixture value is synthetic."""
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
NEW = [r for r in RULES if re.fullmatch(r"EC\d+", r["id"]) and 450 <= int(r["id"][2:]) <= 616]

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
    assert len(nums) == len(set(nums))
    assert nums == list(range(450, 450 + len(nums)))


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
        cols += [r["field"]] + list(r.get("fields") or []) + list(r.get("dedupe_on") or [])
        cols += list((r.get("applies_when") or {}).keys())
        for f in cols:
            table, field = f.split(".")
            assert S4.field(table, field) is not None, (r["id"], f)
        for f in r.get("target_fields") or []:
            assert S4.field(r["target_table"], f) is not None, (r["id"], f)


def test_new_rules_never_case_fix_sf_codes():
    """SF external codes are case-sensitive: no upper/lower auto_fix on any new rule."""
    for r in NEW:
        ops = {s["op"] for s in (r.get("auto_fix") or {}).get("steps", [])}
        assert not ops & {"upper", "lower", "title"}, r["id"]


def test_no_message_duplicates_existing_rule():
    old = {r["message"].strip().lower() for r in RULES if r not in NEW}
    for r in NEW:
        assert r["message"].strip().lower() not in old, r["id"]


# ── fixtures: (rule_id, tables, expected_affected, slice_tables_for_clean) ──
EM, EML, PH, PI = "PEREMERGENCY", "PEREMAIL", "PERPHONE", "PERINFO"
EE, FD, FC, FL = "EMPEMPLOYMENT", "FODEPARTMENT", "FOCOSTCENTER", "FOLOCATION"
WP, GA = "EMPWORKPERMIT", "EMPGLOBALASSIGNMENT"

CASES = [
    # PEREMERGENCY ---------------------------------------------------------
    ("EC450", {EM: frame(EM, PERSON_ID=[None, "p1"], NAME=["A Contact", "B Contact"])}, 1, [EM]),
    ("EC451", {EM: frame(EM, PERSON_ID=["p9", "p1"]), PI: frame(PI, PERSON_ID=["p1"])}, 1, [EM]),
    ("EC452", {EM: frame(EM, PERSON_ID=["p1", "p2"], NAME=[None, "B Contact"])}, 1, [EM]),
    ("EC453", {EM: frame(EM, PERSON_ID=["p1", "p2"], NAME=["0820001111", "B Contact"])}, 1, [EM]),
    ("EC454", {EM: frame(EM, PERSON_ID=["p1", "p2"], NAME=[" Unknown ", "B Contact"])}, 1, [EM]),
    ("EC455", {EM: frame(EM, PERSON_ID=["p1", "p2"], PRIMARY_FLAG=["true", "Y"])}, 1, [EM]),
    ("EC456", {EM: frame(EM, PERSON_ID=["p1", "p1", "p2", "p2"], PRIMARY_FLAG=["N", "N", "Y", "N"],
                         NAME=["A", "B", "C", "D"])}, 1, []),
    ("EC457", {EM: frame(EM, PERSON_ID=["p1", "p1", "p2"],
                         NAME=["Alex  Contact", "alex contact", "Alex Contact"])}, 2, [EM]),
    ("EC459", {EM: frame(EM, PERSON_ID=["p1", "p2"], PHONE=["12345", "+27 82 555 0101"])}, 1, [EM]),
    ("EC460", {EM: frame(EM, PERSON_ID=["p1", "p2"], PHONE=["+27 0000000", "+27 82 555 0101"])}, 1, [EM]),
    ("EC461", {EM: frame(EM, PERSON_ID=["p1", "p2"], EMAIL=["contact.example.com", "c@example.com"])}, 1, [EM]),
    ("EC462", {EM: frame(EM, PERSON_ID=["p1", "p2"], PHONE=["+27 82 555 0101", "+27 82 555 0202"]),
               PH: frame(PH, PERSON_ID=["p1", "p2"], PHONE_NUMBER=["+27 82 555 0101", "+27 82 555 0909"])},
     1, [EM]),
    ("EC463", {EM: frame(EM, PERSON_ID=["p1", "p2"], EMAIL=["self@example.com", "c@example.com"]),
               EML: frame(EML, PERSON_ID=["p1", "p2"], EMAIL_ADDRESS=["self@example.com", "p2@example.com"])},
     1, [EM]),
    # PEREMAIL -------------------------------------------------------------
    ("EC464", {EML: frame(EML, PERSON_ID=[None, "p1"], EMAIL_TYPE=["B", "B"])}, 1, [EML]),
    ("EC465", {EML: frame(EML, PERSON_ID=["p9", "p1"]), PI: frame(PI, PERSON_ID=["p1"])}, 1, [EML]),
    ("EC466", {EML: frame(EML, PERSON_ID=["p1", "p1", "p2"], EMAIL_TYPE=["B", "B", "B"])}, 2, [EML]),
    ("EC467", {EML: frame(EML, PERSON_ID=["p1", "p1", "p2"], EMAIL_TYPE=["B", "P", "B"],
                          EMAIL_ADDRESS=["A@example.com", "a@example.com", "a@example.com"])}, 2, [EML]),
    ("EC468", {EML: frame(EML, PERSON_ID=["p1", "p2", "p3"],
                          EMAIL_ADDRESS=["first.@example.com", "a.b@example.com", "a@ex-ample.com"])}, 1, [EML]),
    ("EC469", {EML: frame(EML, PERSON_ID=["p1", "p2", "p3"], EMAIL_TYPE=["B", "B", "P"],
                          EMAIL_ADDRESS=["someone@Gmail.com", "a@example.com", "x@gmail.com"])}, 1, [EML]),
    ("EC470", {"USERACCOUNT": frame("USERACCOUNT", USER_ID=["u1", "u2"], EMAIL=["a@example.com", "b@example.com"]),
               EML: frame(EML, PERSON_ID=["p1", "p2"], EMAIL_ADDRESS=["a@example.com", "b@example.com"],
                          IS_PRIMARY=["false", "true"])}, 1, ["USERACCOUNT"]),
    # PERPHONE -------------------------------------------------------------
    ("EC471", {PH: frame(PH, PERSON_ID=[None, "p1"], PHONE_TYPE=["B", "B"])}, 1, [PH]),
    ("EC472", {PH: frame(PH, PERSON_ID=["p9", "p1"]), PI: frame(PI, PERSON_ID=["p1"])}, 1, [PH]),
    ("EC473", {PH: frame(PH, PERSON_ID=["p1", "p2"], PHONE_TYPE=[None, "B"])}, 1, [PH]),
    ("EC474", {PH: frame(PH, PERSON_ID=["p1", "p1", "p2"], PHONE_TYPE=["C", "C", "C"])}, 2, [PH]),
    ("EC475", {PH: frame(PH, PERSON_ID=["p1", "p1", "p2"], PHONE_TYPE=["B", "C", "C"],
                         PHONE_NUMBER=["82-555-0101", "82 555 0101", "82 555 0101"])}, 2, [PH]),
    ("EC476", {PH: frame(PH, PERSON_ID=["p1", "p2", "p3", "p4"], PHONE_TYPE=["C", "C", "C", "B"],
                         PHONE_NUMBER=["82 555 0101", "82-555-0101", "82 555 0202", "82 555 0202"])}, 2, [PH]),
    ("EC477", {PH: frame(PH, PERSON_ID=["p1", "p2"], PHONE_NUMBER=["555 0101", "555 0202"],
                         COUNTRY_CODE=[None, "27"])}, 1, [PH]),
    ("EC478", {PH: frame(PH, PERSON_ID=["p1", "p2", "p3"], PHONE_NUMBER=["+27 82 555 0101", "82 555 0101",
                                                                         "0027 82 555 0101"],
                         COUNTRY_CODE=["27", "27", None])}, 1, [PH]),
    ("EC479", {PH: frame(PH, PERSON_ID=["p1", "p2"], AREA_CODE=["(082)", "82"])}, 1, [PH]),
    ("EC480", {PH: frame(PH, PERSON_ID=["p1", "p2"], EXTENSION=["x123", "123"])}, 1, [PH]),
    # foundation objects ---------------------------------------------------
    *[(f"EC{481 + i}", {t: frame(t, EXTERNAL_CODE=["X1", "X2", "X3"], STATUS=["active", "A", "I"])}, 1, [t])
      for i, t in enumerate(["FOCOMPANY", "FOBUSINESSUNIT", "FODIVISION", "FODEPARTMENT", "FOLOCATION",
                             "FOJOBCODE", "FOCOSTCENTER", "FOEVENTREASON"])],
    ("EC489", {FD: frame(FD, EXTERNAL_CODE=["D1", "D2", "D3"], COST_CENTER=[None, "C1", None],
                         STATUS=["A", "A", "I"])}, 1, [FD]),
    ("EC490", {FC: frame(FC, EXTERNAL_CODE=["C1", "C2", "C3"], LEGAL_ENTITY=[None, "L1", None],
                         STATUS=["A", "A", "I"])}, 1, [FC]),
    ("EC491", {FL: frame(FL, EXTERNAL_CODE=["L1", "L2", "L3"], STANDARD_HOURS=[None, 40.0, None],
                         STATUS=["A", "A", "I"])}, 1, [FL]),
    ("EC492", {FL: frame(FL, EXTERNAL_CODE=["L1", "L2", "L3"], STANDARD_HOURS=[80.0, 40.0, 60.0])}, 1, [FL]),
    ("EC493", {"FOCOMPANY": frame("FOCOMPANY", EXTERNAL_CODE=["L1", "L2", "L3"], STATUS=["A", "A", "I"]),
               FC: frame(FC, EXTERNAL_CODE=["C1", "C2"], LEGAL_ENTITY=["L1", "L2"], STATUS=["I", "A"])},
     1, ["FOCOMPANY"]),
    ("EC494", {EE: frame(EE, USERID=["u1", "u2", "u3"], JOB_CODE=["J1", "J2", "J1"], STATUS=["A", "A", "T"],
                         IS_FULLTIME=["false", "True", "false"]),
               "FOJOBCODE": frame("FOJOBCODE", EXTERNAL_CODE=["J1", "J2"], IS_FULLTIME=["true", "true"])},
     1, [EE]),
    ("EC495", {EE: frame(EE, USERID=["u1", "u2", "u3"], JOB_CODE=["J1", "J2", "J1"], STATUS=["A", "A", "T"],
                         REGULAR_TEMP=["T", "R", "T"]),
               "FOJOBCODE": frame("FOJOBCODE", EXTERNAL_CODE=["J1", "J2"], REGULAR_TEMP=["R", "R"])},
     1, [EE]),
    ("EC496", {EE: frame(EE, USERID=["u1", "u2", "u3"], LOCATION=["L1", "L2", "L1"], STATUS=["A", "A", "T"],
                         TIMEZONE=["Europe/Berlin", "Africa/Johannesburg", "Europe/Berlin"]),
               FL: frame(FL, EXTERNAL_CODE=["L1", "L2"], TIMEZONE=["Africa/Johannesburg", "Africa/Johannesburg"])},
     1, [EE]),
    # work permits and global assignments ---------------------------------
    ("EC497", {WP: frame(WP, USERID=[None, "u1"], DOCUMENT_TYPE=["visa", "visa"])}, 1, [WP]),
    ("EC498", {WP: frame(WP, USERID=["u9", "u1"]), EE: frame(EE, USERID=["u1"])}, 1, [WP]),
    ("EC499", {WP: frame(WP, USERID=["u1", "u2"], COUNTRY=[None, "DEU"])}, 1, [WP]),
    ("EC500", {WP: frame(WP, USERID=["u1", "u2"], DOCUMENT_TYPE=[None, "visa"])}, 1, [WP]),
    ("EC501", {WP: frame(WP, USERID=["u1", "u2"], ISSUE_DATE=["20990101", "20200101"])}, 1, [WP]),
    ("EC502", {WP: frame(WP, USERID=["u1", "u2", "u3", "u4"],
                         DOCUMENT_NUMBER=["N/A", "AB123456", "A1", "7Q9"])}, 1, [WP]),
    ("EC503", {WP: frame(WP, USERID=["u1", "u2", "u3"], COUNTRY=["DEU", "DEU", "DEU"],
                         DOCUMENT_TYPE=["visa", "visa", "visa"], DOCUMENT_NUMBER=["A-1", "A1", "B2"])}, 2, [WP]),
    ("EC504", {WP: frame(WP, USERID=["u1", "u2", "u3"], IS_VALIDATED=["false", "true", "false"],
                         EXPIRATION_DATE=["20990101", "20990101", "20200101"]),
               EE: frame(EE, USERID=["u1", "u2", "u3"], STATUS=["A", "A", "A"])}, 1, [WP]),
    ("EC505", {WP: frame(WP, USERID=["u1", "u2"], EXPIRATION_DATE=["20990101", "20990101"]),
               EE: frame(EE, USERID=["u1", "u2"], STATUS=["A", "A"],
                         CONTRACT_END_DATE=["20991231", "20980101"])}, 1, [WP]),
    ("EC506", {WP: frame(WP, USERID=["u1", "u2"], ISSUE_DATE=["20240101", "20230101"],
                         EXPIRATION_DATE=["20240101", "20280101"])}, 1, [WP]),
    ("EC507", {GA: frame(GA, USERID=["u1", "u2"], ASSIGNMENT_TYPE=[None, "LT"])}, 1, [GA]),
    ("EC508", {GA: frame(GA, USERID=["u1", "u2"], START_DATE=[None, "20240101"])}, 1, [GA]),
    ("EC509", {GA: frame(GA, USERID=["u1", "u2"], PLANNED_END_DATE=[None, "20260101"])}, 1, [GA]),
    ("EC510", {GA: frame(GA, USERID=["u9", "u1"]), EE: frame(EE, USERID=["u1"])}, 1, [GA]),
    ("EC511", {EE: frame(EE, USERID=["u1", "u2", "u3"], ASSIGNMENT_CLASS=["ST", "GA", "ST"]),
               GA: frame(GA, USERID=["u1", "u2"], START_DATE=["20240101", "20240101"])}, 1, [EE]),
    ("EC512", {GA: frame(GA, USERID=["u1", "u2"], START_DATE=["20190101", "20240101"]),
               EE: frame(EE, USERID=["u1", "u2"], START_DATE=["20200101", "20200101"])}, 1, [GA]),
    ("EC513", {GA: frame(GA, USERID=["u1", "u2"], END_DATE=["20200101", None]),
               EE: frame(EE, USERID=["u1", "u2"], STATUS=["A", "A"])}, 1, [GA]),
    ("EC514", {GA: frame(GA, USERID=["u1", "u2"], START_DATE=["20200101", "20200101"],
                         PLANNED_END_DATE=["20260101", "20220101"])}, 1, [GA]),
]

# national IDs: (country, published specimen that passes, same number with one character changed).
# The third row is another country's malformed number, which the country's rule must ignore.
NID_SPECIMENS = [
    ("CAN", "046 454 286", "046 454 287"), ("BRA", "111.444.777-35", "111.444.777-36"),
    ("NLD", "111222333", "111222334"), ("ESP", "X1234567L", "X1234567M"),
    ("CHN", "11010519491231002X", "110105194912310021"), ("IND", "234123412346", "234123412347"),
    ("FRA", "255081416802538", "255081416802539"), ("ITA", "RSSMRA85T10A562S", "RSSMRA85T10A562T"),
    ("AUS", "123456782", "123456783"), ("MEX", "HEGG560427MVZRRL04", "HEGG560427MVZRRL05"),
    ("SGP", "S1234567D", "S1234567E"), ("SWE", "811218-9876", "811218-9877"),
    ("NOR", "01010101006", "01010101007"), ("FIN", "131052-308T", "131052-308U"),
    ("POL", "44051401359", "44051401358"), ("BEL", "85.07.30-033.28", "85.07.30-033.29"),
    ("TUR", "10000000146", "10000000147"), ("CHL", "12.345.678-5", "12.345.678-K"),
    ("CHE", "756.9217.0769.85", "756.9217.0769.86"), ("IRL", "1234567T", "1234567A"),
    ("ROU", "1800101221144", "1800101221145"), ("JPN", "123456789018", "123456789019"),
    ("NZL", "49091850", "49091851"), ("AUT", "1237010180", "1238010180"),
    ("CZE", "7103192745", "7103192746"), ("SVK", "7103192745", "7103192746"),
    ("ISR", "000000018", "000000019"), ("THA", "1101700207030", "1101700207031"),
    ("HRV", "69435151530", "69435151531"), ("BGR", "7523169263", "7523169264"),
    ("GRC", "12345678903", "12345678904"),
]
_NID_RULES = {(r["applies_when"]["PERINFO.NATIONAL_ID_COUNTRY"][0], r["check_class"]): r["id"] for r in NEW
              if r["field"] == "PERINFO.NATIONAL_ID" and r["check_class"] == "format_check"}
for _cc, _good, _bad in NID_SPECIMENS:
    CASES.append((_NID_RULES[(_cc, "format_check")],
                  {PI: frame(PI, PERSON_ID=["p1", "p2", "p3"], NATIONAL_ID=[_bad, _good, "?"],
                             NATIONAL_ID_COUNTRY=[_cc, _cc, "ATA"])}, 1, [PI]))
CASES.append((next(r["id"] for r in NEW if r["message"] == "Israeli ID number is not 9 digits"),
              {PI: frame(PI, PERSON_ID=["p1", "p2"], NATIONAL_ID=["18", "000000018"],
                         NATIONAL_ID_COUNTRY=["ISR", "ISR"])}, 1, [PI]))

# national ID vs date of birth and gender: (countries, male number, female number), both synthetic and
# both encoding 30 July 1985. Check digits are not valid; these rules read only the encoded date and sex.
NID_PERSONAL = [
    ("POL", "85073012315", "85073012325"), ("ROU", "1850730123456", "2850730123456"),
    ("CHN", "110105198507301234", "110105198507301244"), ("SWE", "850730-1235", "850730-1245"),
    ("NOR", "30078512345", "30078512445"), ("FIN", "300785-123A", "300785-124A"),
    ("BEL", "85.07.30-123.45", "85.07.30-124.45"), ("ITA", "RSSMRA85L30A562S", "RSSMRA85L70A562S"),
    ("MEX", "HEGG850730HVZRRL04", "HEGG850730MVZRRL04"), ("FRA", "185077512345678", "285077512345678"),
    ("KOR", "850730-1234567", "850730-2234567"), ("DNK", "300785-1231", "300785-1232"),
    ("CZE", "850730/1234", "855730/1234"), ("BGR", "8507301206", "8507301216"),
    ("GRC", "30078512345", None), ("AUT", "1234300785", None),
]
_DOB_RULES = {r["applies_when"]["PERINFO.NATIONAL_ID_COUNTRY"][0]: r["id"] for r in NEW
              if r["field"] == "PERINFO.NATIONAL_ID" and r["check_class"] == "cross_field_check"}
_SEX_RULES = {(r["applies_when"]["PERINFO.NATIONAL_ID_COUNTRY"][0], r["applies_when"]["PERINFO.GENDER"][0]): r["id"]
              for r in NEW if r["field"] == "PERINFO.NATIONAL_ID" and "PERINFO.GENDER" in (r.get("applies_when") or {})}
for _cc, _m, _f in NID_PERSONAL:
    # wrong birth date, matching birth date, another country's number
    CASES.append((_DOB_RULES[_cc], {PI: frame(PI, PERSON_ID=["p1", "p2", "p3"], NATIONAL_ID=[_m, _f or _m, _m],
                                              DATE_OF_BIRTH=["19700615", "19850730", "19700615"],
                                              NATIONAL_ID_COUNTRY=[_cc, _cc, "ATA"])}, 1, [PI]))
    if _f is None:
        continue
    for _g, _wrong, _right in (("F", _m, _f), ("M", _f, _m)):
        # other sex's number, own sex's number, other sex's number on the other gender (out of scope)
        CASES.append((_SEX_RULES[(_cc, _g)], {PI: frame(PI, PERSON_ID=["p1", "p2", "p3"],
                                                        NATIONAL_ID=[_wrong, _right, _wrong],
                                                        GENDER=[_g, _g, "M" if _g == "F" else "F"],
                                                        NATIONAL_ID_COUNTRY=[_cc, _cc, _cc])}, 1, [PI]))


# EMPEMPLOYMENT dates, PERINFO names/birth, PERADDRESS line 2 (EC591 onward); first row is the bad one
PA = "PERADDRESS"


def _ee(**cols):
    return {EE: frame(EE, USERID=[f"u{i + 1}" for i in range(len(next(iter(cols.values()))))], **cols)}


def _ee_pi(field, vals, pi_field="DATE_OF_BIRTH", pi_val="19850730"):
    return {EE: frame(EE, USERID=["u1", "u2"], PERSON_ID=["p1", "p2"], **{field: vals}),
            PI: frame(PI, PERSON_ID=["p1", "p2"], **{pi_field: [pi_val, pi_val]})}


def _pi(**cols):
    return {PI: frame(PI, PERSON_ID=[f"p{i + 1}" for i in range(len(next(iter(cols.values()))))], **cols)}


CASES += [
    ("EC591", _ee(SERVICE_DATE=["29990101", "20100101"]), 1, [EE]),
    ("EC592", _ee(SERVICE_DATE=["20200101", "20100101"], END_DATE=["20150101", "20150101"]), 1, [EE]),
    ("EC593", _ee(SENIORITY_DATE=["20200101", "20100101"], END_DATE=["20150101", "20150101"]), 1, [EE]),
    ("EC594", _ee_pi("ORIGINAL_START_DATE", ["19800101", "20100101"]), 1, [EE]),
    ("EC595", _ee_pi("SERVICE_DATE", ["19850730", "20100101"]), 1, [EE]),
    ("EC596", _ee_pi("SENIORITY_DATE", ["19700101", "20100101"]), 1, [EE]),
    ("EC597", _ee(LAST_DATE_WORKED=["20090101", "20200101"], START_DATE=["20100101", "20100101"]), 1, [EE]),
    ("EC598", _ee(PAYROLL_END_DATE=["20090101", "20200101"], START_DATE=["20100101", "20100101"]), 1, [EE]),
    ("EC599", _ee(PAYROLL_END_DATE=["20200101", None, "20200101"], STATUS=["A", "A", "T"]), 1, [EE]),
    ("EC600", _ee_pi("END_DATE", ["20250101", "20200101"], "DATE_OF_DEATH", "20200101"), 1, [EE]),
    ("EC601", _ee(OK_TO_REHIRE=[None, "true", None], STATUS=["T", "T", "A"]), 1, [EE]),
    ("EC602", _ee(OK_TO_REHIRE=["false", None, "false"], STATUS=["A", "A", "T"]), 1, [EE]),
    ("EC603", _ee(JOB_END_DATE=["20090101", "20200101"], JOB_START_DATE=["20100101", "20100101"]), 1, [EE]),
    ("EC604", _ee(CREATED_DATE=["29990101", "20100101"]), 1, [EE]),
    ("EC605", _pi(NATIONALITY=["ZAF", "ZAF"], SECOND_NATIONALITY=["ZAF", "GBR"]), 1, [PI]),
    ("EC606", _pi(PLACE_OF_BIRTH=["Sample Town 2", "Sample Town"]), 1, [PI]),
    ("EC607", _pi(PLACE_OF_BIRTH=["Sample Town", "Sample Town", None], COUNTRY_OF_BIRTH=[None, "ZAF", None]), 1, [PI]),
    ("EC608", _pi(MIDDLENAME=["Ann2", "Ann-Lee"]), 1, [PI]),
    ("EC609", _pi(MIDDLENAME=["Ann  Lee", "Ann Lee"]), 1, [PI]),
    ("EC610", _pi(PREFERRED_NAME=["Sam#", "Sam"]), 1, [PI]),
    ("EC611", _pi(PREFERRED_NAME=["Sam  Lee", "Sam Lee"]), 1, [PI]),
    ("EC612", _pi(MIDDLENAME=[" NMN ", "Ann"]), 1, [PI]),
    ("EC613", _pi(PREFERRED_NAME=["Dummy", "Sam"]), 1, [PI]),
    ("EC614", _pi(PERSON_UUID=["U1", "U1", "U2", None]), 2, [PI]),
    ("EC615", {PA: frame(PA, PERSON_ID=["p1", "p2"], ADDRESS_LINE1=["1 Main Rd", "1 Main Rd"],
                         ADDRESS_LINE2=["1 main rd ", "Unit 4"])}, 1, [PA]),
    ("EC616", {PA: frame(PA, PERSON_ID=["p1", "p2"], CITY=["Sampleton", "Sampleton"],
                         ADDRESS_LINE2=["SAMPLETON", "Unit 4"])}, 1, [PA]),
]


@pytest.mark.parametrize("cc,nid,dob,bad", [
    ("POL", "05230112345", "20050301", False), ("POL", "05030112345", "20050301", True),
    ("BGR", "0543011206", "20050301", False), ("BGR", "0503011206", "20050301", True),
    ("CZE", "047730/1234", "20040730", False), ("CZE", "852730/1234", "19850730", False),
    ("SWE", "19850730-1235", "19850730", False), ("SWE", "850790-1235", "19850730", False),
    ("NOR", "70078512345", "19850730", False), ("BEL", "85270712345", "19850730", False),
    ("ITA", "RSSMRA86L30A562S", "19850730", True), ("FRA", "185137512345678", "19850730", False),
    ("POL", "85073012315", None, False),
])
def test_nid_birth_date_edge_cases(cc, nid, dob, bad):
    """Century offsets pass; D/H/coordination/bis numbers and unknown months are not checked; no DOB, no finding."""
    tables = {PI: frame(PI, PERSON_ID=["p1"], NATIONAL_ID=[nid], DATE_OF_BIRTH=[dob], NATIONAL_ID_COUNTRY=[cc])}
    assert fire(_DOB_RULES[cc], tables) == int(bad)


def clean(tables, slice_tables):
    return {t: (df.iloc[1:].reset_index(drop=True) if t in slice_tables else df) for t, df in tables.items()}


@pytest.mark.parametrize("rid,tables,expected,slice_tables", CASES, ids=[c[0] for c in CASES])
def test_fixture_flags_only_the_bad_record(rid, tables, expected, slice_tables):
    assert fire(rid, tables) == expected


@pytest.mark.parametrize("rid,tables,expected,slice_tables", [c for c in CASES if c[3]],
                         ids=[c[0] for c in CASES if c[3]])
def test_fixture_clean_rows_pass(rid, tables, expected, slice_tables):
    assert fire(rid, clean(tables, slice_tables)) == 0


def test_ec456_clean_when_every_person_has_a_primary():
    tables = {EM: frame(EM, PERSON_ID=["p1", "p1"], PRIMARY_FLAG=["N", "Y"], NAME=["A", "B"])}
    assert fire("EC456", tables) == 0


def test_ec458_relationship_checked_against_live_picklist():
    tables = {EM: frame(EM, PERSON_ID=["p1", "p2", "p3"], RELATIONSHIP=["cousin_x", "spouse", None])}
    assert fire("EC458", tables, {"PICKLIST.relation": {"spouse", "parent"}}) == 1
    assert fire("EC458", tables, {"PICKLIST.relation": {"spouse", "parent", "cousin_x"}}) == 0


def test_every_new_rule_has_a_fixture():
    covered = {c[0] for c in CASES} | {"EC456", "EC458"}
    assert {r["id"] for r in NEW} <= covered


@pytest.mark.parametrize("addr,bad", [(".a@example.com", True), ("a.@example.com", True), ("a@.example.com", True),
                                      ("a@-example.com", True), ("a@example-.com", True), ("a@example.com.", True),
                                      ("a.b-c@ex-ample.co.za", False)])
def test_ec468_dot_hyphen_positions(addr, bad):
    assert fire("EC468", {EML: frame(EML, PERSON_ID=["p1"], EMAIL_ADDRESS=[addr])}) == int(bad)
