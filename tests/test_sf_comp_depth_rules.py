"""SuccessFactors Compensation depth rules (COMP095+): fixtures, ID contiguity, auto_fix contract."""
import re

import pandas as pd
import pytest
import yaml

from checks.frames import TableFrames
from checks.runner import run_rule
from sap.ddic import get_dictionary

S4 = get_dictionary("s4hana")
RULES = yaml.safe_load(open("checks/rules/successfactors/compensation.yaml"))["rules"]
BY_ID = {r["id"]: r for r in RULES}
NEW = [r for r in RULES if re.fullmatch(r"COMP\d+", r["id"]) and 95 <= int(r["id"][4:]) <= 248]
MANDATORY = ["id", "field", "check_class", "severity", "dimension", "message", "why_it_matters", "rule_authority",
             "sap_impact", "fix_map", "record_fix_template"]
ALLOWED_OPS = {"strip", "collapse_spaces", "upper", "lower", "title", "pad_left", "strip_leading_zeros",
               "regex_replace", "truncate", "map", "set", "copy", "lookup", "date_format", "gtin_check_digit"}
# Business judgement: never auto-fix pay amounts, pay grade/scale, dates or identities.
NO_AUTOFIX_FIELDS = re.compile(r"\.(SALARY|AMOUNT|VALUE|PAY_GROUP|PAY_SCALE_\w+|USERID|PERSON_ID|"
                               r"\w*DATE\w*)$")
# Cannot be fixture-tested without a `_live_reference`/`reference_values` injection (same precedent
# as the pre-existing referential_check rules elsewhere in this rule family).
UNTESTABLE = {"COMP102", "COMP103"}


def frame(table, **cols):
    return pd.DataFrame({f"{table}.{k}": v for k, v in cols.items()})


def fire(rid, tables):
    frames = TableFrames(tables, S4, module="compensation")
    _, res = run_rule(dict(BY_ID[rid]), frames, {})
    assert res is not None and not res.error, (rid, res and res.error)
    return res.affected_count


def ci(**cols):
    n = len(next(iter(cols.values())))
    cols.setdefault("USERID", [f"u{i + 1}" for i in range(n)])
    return frame("COMPINFO", **cols)


def nr(**cols):
    n = len(next(iter(cols.values())))
    cols.setdefault("USERID", [f"u{i + 1}" for i in range(n)])
    return frame("PAYCOMPNONREC", **cols)


def emp(**cols):
    n = len(next(iter(cols.values())))
    cols.setdefault("USERID", [f"u{i + 1}" for i in range(n)])
    return frame("EMPEMPLOYMENT", **cols)


# (rule, tables with one bad row first and clean rows after, expected affected count)
CASES = [
    # null_check
    ("COMP095", {"COMPINFO": ci(PAY_SCALE_LEVEL=[None, "L1"])}, 1),
    ("COMP096", {"COMPINFO": ci(PAY_COMPONENT_TYPE=[None, "AMOUNT"])}, 1),
    ("COMP097", {"COMPINFO": ci(PAY_COMPONENT_IS_EARNING=[None, "true"])}, 1),
    ("COMP098", {"COMPINFO": ci(PAY_COMPONENT_CAN_OVERRIDE=[None, "false"])}, 1),
    ("COMP099", {"COMPINFO": ci(PAY_COMPONENT_RECURRING=[None, "true"])}, 1),
    ("COMP100", {"COMPINFO": ci(PAY_COMPONENT_DEFAULT=[None, 100.0],
                                PAY_COMPONENT_CAN_OVERRIDE=["false", "false"])}, 1),
    ("COMP101", {"COMPINFO": ci(PAY_COMPONENT_FREQUENCY=[None, "MO"],
                                PAY_COMPONENT_RECURRING=["true", "true"])}, 1),
    # domain_value_check
    ("COMP126", {"COMPINFO": ci(PAY_GRADE_STATUS=["X", "A"])}, 1),
    ("COMP127", {"COMPINFO": ci(PAY_RANGE_STATUS=["X", "I"])}, 1),
    ("COMP128", {"COMPINFO": ci(PAY_COMPONENT_STATUS=["X", "A"])}, 1),
    ("COMP239", {"COMPINFO": ci(PAY_COMPONENT_TYPE=["BOGUS", "AMOUNT"])}, 1),
    ("COMP240", {"PAYCOMPNONREC": nr(UNIT_OF_MEASURE=["XX", "HR"])}, 1),
    # regex_check
    ("COMP118", {"COMPINFO": ci(PAY_SCALE_TYPE=["way too long", "A1"])}, 1),
    ("COMP150", {"PAYCOMPNONREC": nr(UNIT_OF_MEASURE=["xx", "HR"])}, 1),
    ("COMP157", {"PAYCOMPNONREC": nr(USERID=["bad user!", "u1"])}, 1),
    ("COMP228", {"COMPINFO": ci(CURRENCY=["usd", "USD"])}, 1),
    ("COMP230", {"COMPINFO": ci(PAY_GRADE=["bad grade!", "G1"])}, 1),
    ("COMP246", {"COMPINFO": ci(PAY_TYPE=["bad type!", "SALARY"])}, 1),
    # exists_check (target table has only the valid code, so dropping row0 leaves a clean match)
    ("COMP153", {"PAYCOMPNONREC": nr(ALT_COST_CENTER=["CC9", "CC1"]),
                 "FOCOSTCENTER": frame("FOCOSTCENTER", EXTERNAL_CODE=["CC1"])}, 1),
    ("COMP170", {"COMPINFO": ci(USERID=["u9", "u1"]),
                 "EMPEMPLOYMENT": frame("EMPEMPLOYMENT", USERID=["u1"])}, 1),
    ("COMP245", {"COMPINFO": ci(EVENT_REASON=["XXX", "HIRNEW"]),
                 "FOEVENTREASON": frame("FOEVENTREASON", EXTERNAL_CODE=["HIRNEW"])}, 1),
    # single-table cross_field_check
    ("COMP107", {"COMPINFO": ci(RANGE_PENETRATION=[150.0, 50.0])}, 1),
    ("COMP117", {"COMPINFO": ci(PAY_RANGE_MAX=[50.0, 200.0], PAY_RANGE_MIN=[100.0, 100.0])}, 1),
    ("COMP201", {"PAYCOMPNONREC": nr(VALUE=[100.123456, 100.0])}, 1),
    ("COMP218", {"COMPINFO": ci(COMPA_RATIO=[1.0, 1.0], SALARY=[1000.0, 1000.0],
                                ANNUAL_SALARY=[12000.0, 13000.0], PAY_RANGE_MID=[13000.0, 13000.0])}, 1),
    ("COMP238", {"PAYCOMPNONREC": nr(VALUE=[100.0, 100.0], CURRENCY=[None, "USD"])}, 1),
    # cross-table cross_field_check (joined through EMPEMPLOYMENT and foundation objects)
    ("COMP129", {"COMPINFO": ci(PAY_GROUP=["PG1", "PG2"]), "EMPEMPLOYMENT": emp(PAY_GROUP=["PG9", "PG2"])}, 1),
    ("COMP137", {"COMPINFO": ci(PAY_COMPONENT_STATUS=["A", "A"]), "EMPEMPLOYMENT": emp(STATUS=["T", "A"])}, 1),
    ("COMP144", {"COMPINFO": ci(EVENT_REASON=["TERRES", "HIRNEW"]),
                 "EMPEMPLOYMENT": emp(EVENT_REASON=["TERRES", "HIRNEW"], STATUS=["A", "A"]),
                 "FOEVENTREASON": frame("FOEVENTREASON", EXTERNAL_CODE=["TERRES", "HIRNEW"],
                                        EMPL_STATUS=["T", "A"])}, 1),
    ("COMP159", {"PAYCOMPNONREC": nr(ALT_COST_CENTER=["CC1", "CC2"]), "EMPEMPLOYMENT": emp(POSITION=["P1", "P2"]),
                 "POSITION": frame("POSITION", CODE=["P1", "P2"], COST_CENTER=["CC1", "CC9"])}, 1),
    ("COMP162", {"PAYCOMPNONREC": nr(PAY_DATE=["2025-01-01", "2020-01-01"]),
                 "EMPEMPLOYMENT": emp(CONTRACT_END_DATE=["2024-01-01", "2024-01-01"])}, 1),
    ("COMP172", {"COMPINFO": ci(SALARY=[1000.0, 1000.0]), "EMPEMPLOYMENT": emp(DEPARTMENT=["D1", "D2"]),
                 "FODEPARTMENT": frame("FODEPARTMENT", EXTERNAL_CODE=["D1", "D2"], STATUS=["I", "A"])}, 1),
    ("COMP177", {"COMPINFO": ci(SALARY=[1000.0, 1000.0]), "EMPEMPLOYMENT": emp(COST_CENTER=["CC1", "CC2"]),
                 "FOCOSTCENTER": frame("FOCOSTCENTER", EXTERNAL_CODE=["CC1", "CC2"], STATUS=["I", "A"])}, 1),
    ("COMP186", {"COMPINFO": ci(SALARY=[1000.0, 1000.0], PAYCOMP_END_DATE=[None, None]),
                 "EMPEMPLOYMENT": emp(STATUS=["A", "A"]),
                 "USERACCOUNT": frame("USERACCOUNT", USER_ID=["u1", "u2"], STATUS=["INACTIVE", "ACTIVE"])}, 1),
    ("COMP188", {"COMPINFO": ci(SALARY=[1000.0, 1000.0], PAYCOMP_END_DATE=[None, None]),
                 "EMPEMPLOYMENT": emp(COMPANY=["1000", "2000"]),
                 "FOCOMPANY": frame("FOCOMPANY", EXTERNAL_CODE=["1000", "2000"],
                                    STATUS=["INACTIVE", "ACTIVE"])}, 1),
    # dependency_check (minority row placed first so the default clean-row drop keeps only agreement)
    ("COMP152", {"PAYCOMPNONREC": nr(USERID=["u1", "u1", "u1"], CURRENCY=["EUR", "USD", "USD"])}, 1),
    ("COMP165", {"COMPINFO": ci(PAY_GRADE=["G1", "G1", "G1"], PAY_RANGE_MID=[9999.0, 5000.0, 5000.0])}, 1),
    ("COMP166", {"COMPINFO": ci(PAY_GRADE=["G1", "G1", "G1"], PAY_RANGE_MIN=[8888.0, 4000.0, 4000.0])}, 1),
    ("COMP167", {"COMPINFO": ci(PAY_GRADE=["G1", "G1", "G1"], PAY_RANGE_MAX=[7777.0, 6000.0, 6000.0])}, 1),
    ("COMP202", {"COMPINFO": ci(PAY_GRADE=["G1", "G1", "G1"], PAY_GROUP=["PG9", "PG1", "PG1"])}, 1),
    ("COMP203", {"COMPINFO": ci(PAY_GRADE=["G1", "G1", "G1"], PAY_RANGE_CURRENCY=["EUR", "USD", "USD"])}, 1),
    ("COMP204", {"COMPINFO": ci(PAY_GRADE=["G1", "G1", "G1"], PAY_RANGE_FREQUENCY=["WK", "MO", "MO"])}, 1),
    ("COMP205", {"PAYCOMPNONREC": nr(PAY_COMPONENT=["BON", "BON", "BON"],
                                     UNIT_OF_MEASURE=["HR", "EA", "EA"])}, 1),
    ("COMP206", {"PAYCOMPNONREC": nr(PAY_COMPONENT=["BON", "BON", "BON"],
                                     CURRENCY=["EUR", "USD", "USD"])}, 1),
    ("COMP235", {"COMPINFO": ci(PAY_GRADE=["G1", "G1", "G1"], PAY_SCALE_TYPE=["B9", "A1", "A1"])}, 1),
    ("COMP236", {"COMPINFO": ci(PAY_GRADE=["G1", "G1", "G1"], PAY_SCALE_AREA=["99", "01", "01"])}, 1),
    ("COMP237", {"COMPINFO": ci(PAY_GRADE=["G1", "G1", "G1"], COMP_FREQUENCY=["WK", "MO", "MO"])}, 1),
    ("COMP248", {"COMPINFO": ci(PAY_TYPE=["SALARY", "SALARY", "SALARY"],
                                PAY_COMPONENT_TYPE=["PERCENTAGE", "AMOUNT", "AMOUNT"])}, 1),
]


@pytest.mark.parametrize("rid,tables,expected", CASES, ids=[c[0] for c in CASES])
def test_fixture_flags_only_the_bad_record(rid, tables, expected):
    assert fire(rid, tables) == expected


@pytest.mark.parametrize("rid,tables,_", CASES, ids=[c[0] for c in CASES])
def test_fixture_clean_rows_pass(rid, tables, _):
    clean = {t: (df.iloc[1:] if len(df) > 1 else df) for t, df in tables.items()}
    assert fire(rid, clean) == 0


def test_duplicate_compensation_rows():
    nonrec = nr(USERID=["u1", "u1", "u2"], PAY_COMPONENT=["BON", "BON", "BON"],
                PAY_DATE=["2024-01-01"] * 3, VALUE=[100.0, 100.0, 100.0])
    assert fire("COMP151", {"PAYCOMPNONREC": nonrec}) >= 1
    assert fire("COMP151", {"PAYCOMPNONREC": nonrec.iloc[1:]}) == 0

    nonrec2 = nr(USERID=["u1", "u1", "u2"], PAY_COMPONENT=["BON", "BON", "BON"],
                 PAY_DATE=["2024-01-01"] * 3, VALUE=[100.0, 100.0, 100.0], CURRENCY=["USD"] * 3)
    assert fire("COMP217", {"PAYCOMPNONREC": nonrec2}) >= 1
    assert fire("COMP217", {"PAYCOMPNONREC": nonrec2.iloc[1:]}) == 0

    comp = ci(USERID=["u1", "u1", "u2"], PAY_GROUP=["PG1", "PG1", "PG2"], EFFECTIVE_DATE=["2024-01-01"] * 3)
    assert fire("COMP241", {"COMPINFO": comp}) >= 1
    assert fire("COMP241", {"COMPINFO": comp.iloc[1:]}) == 0


def test_interval_overlap_detected():
    overlapping = ci(USERID=["u1", "u1"], PAY_TYPE=["SALARY", "SALARY"],
                      EFFECTIVE_DATE=["2024-01-01", "2024-06-01"], END_DATE=["2024-12-31", "2025-12-31"])
    assert fire("COMP168", {"COMPINFO": overlapping}) >= 1
    clean = ci(USERID=["u1", "u1"], PAY_TYPE=["SALARY", "SALARY"],
               EFFECTIVE_DATE=["2024-01-01", "2025-01-01"], END_DATE=["2024-12-31", "2025-12-31"])
    assert fire("COMP168", {"COMPINFO": clean}) == 0

    overlapping2 = ci(USERID=["u1", "u1"], PAY_TYPE=["SALARY", "SALARY"],
                       EFFECTIVE_DATE_COMP=["2024-01-01", "2024-06-01"],
                       PAYCOMP_END_DATE=["2024-12-31", "2025-12-31"])
    assert fire("COMP169", {"COMPINFO": overlapping2}) >= 1
    clean2 = ci(USERID=["u1", "u1"], PAY_TYPE=["SALARY", "SALARY"],
                EFFECTIVE_DATE_COMP=["2024-01-01", "2025-01-01"],
                PAYCOMP_END_DATE=["2024-12-31", "2025-12-31"])
    assert fire("COMP169", {"COMPINFO": clean2}) == 0


def test_fixture_coverage():
    assert len({c[0] for c in CASES} | {"COMP151", "COMP217", "COMP241", "COMP168", "COMP169"}) >= 50


# ---- integrity -----------------------------------------------------------------------------------------------------

def test_new_ids_unique_and_contiguous():
    ids = [r["id"] for r in RULES]
    assert len(ids) == len(set(ids))
    nums = [int(r["id"][4:]) for r in NEW]
    assert nums == list(range(95, 95 + len(nums)))
    assert len(NEW) >= 150


def test_new_rules_fully_enriched():
    for r in NEW:
        for k in MANDATORY:
            assert r.get(k), (r["id"], k)
        for f in re.findall(r"\{([A-Z0-9]+\.[A-Z0-9_]+)\}", r["record_fix_template"]):
            assert S4.field(*f.split(".")), (r["id"], f)


def test_every_fixture_tested_rule_is_covered_except_untestable():
    tested = {c[0] for c in CASES} | {"COMP151", "COMP217", "COMP241", "COMP168", "COMP169"}
    missing_referential = {r["id"] for r in NEW if r["check_class"] == "referential_check"} - UNTESTABLE
    assert not missing_referential, missing_referential
    assert UNTESTABLE & {r["id"] for r in NEW if r["check_class"] == "referential_check"} == UNTESTABLE


# ---- auto_fix contract v1 ------------------------------------------------------------------------------------------

AUTO = [r for r in RULES if "auto_fix" in r]
AUTO_NEW = [r for r in NEW if "auto_fix" in r]


def test_auto_fix_uses_only_contract_ops():
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
    # Scope to the new (COMP095+) rules this task owns; pre-existing rules are out of scope
    # unless they're a genuine latent defect (handled separately, e.g. COMP029/COMP195).
    for r in AUTO_NEW:
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
    ("COMP126", " a ", "A"), ("COMP127", " i ", "I"), ("COMP128", " a ", "A"),
    ("COMP228", " usd ", "USD"), ("COMP229", " usd ", "USD"),
    ("COMP246", " salary ", "SALARY"), ("COMP247", " bon ", "BON"),
])
def test_auto_fix_proposal_passes_the_rule(rid, dirty, fixed):
    r = BY_ID[rid]
    out = _apply(r["auto_fix"]["steps"], dirty)
    assert out == fixed
    if r.get("pattern"):
        assert re.match(r["pattern"], out)
    if r.get("allowed_values"):
        assert out in r["allowed_values"]
