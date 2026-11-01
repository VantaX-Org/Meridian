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
NEW = [r for r in RULES if re.fullmatch(r"EC\d+", r["id"]) and int(r["id"][2:]) >= 450]

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
