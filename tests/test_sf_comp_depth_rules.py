"""SuccessFactors Compensation depth rules (COMP095-251): fixtures, ID contiguity, auto_fix contract."""
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
NEW = [r for r in RULES if re.fullmatch(r"COMP\d+", r["id"]) and 95 <= int(r["id"][4:]) <= 251]
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
# Round 2 deleted COMP137 outright (C6: dead or population-wide false positive in every
# tenant, no record-level signal exists — see sf-comp-rereview-1.md). Kept as a commented-out
# tombstone in the YAML. IDs are append-only: nothing may reuse a deleted id.
DELETED = {"COMP137"}


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
    # regex_check
    # ^.{1,N}$ (m6 fix round 2) is length-only so non-ASCII names pass; the "bad" fixture
    # value must be over-length (not merely non-ASCII) to still fail.
    ("COMP118", {"COMPINFO": ci(PAY_SCALE_TYPE=["X" * 40, "A1"])}, 1),
    ("COMP150", {"PAYCOMPNONREC": nr(UNIT_OF_MEASURE=["X" * 40, "HR"])}, 1),
    ("COMP157", {"PAYCOMPNONREC": nr(USERID=["bad user!", "u1"])}, 1),
    ("COMP228", {"COMPINFO": ci(CURRENCY=["usd", "USD"])}, 1),
    ("COMP230", {"COMPINFO": ci(PAY_GRADE=["X" * 150, "G1"])}, 1),
    ("COMP246", {"COMPINFO": ci(PAY_TYPE=["X" * 40, "SALARY"])}, 1),
    # exists_check (target table has only the valid code, so dropping row0 leaves a clean match)
    ("COMP153", {"PAYCOMPNONREC": nr(ALT_COST_CENTER=["CC9", "CC1"]),
                 "FOCOSTCENTER": frame("FOCOSTCENTER", EXTERNAL_CODE=["CC1"])}, 1),
    ("COMP170", {"COMPINFO": ci(USERID=["u9", "u1"]),
                 "EMPEMPLOYMENT": frame("EMPEMPLOYMENT", USERID=["u1"])}, 1),
    ("COMP245", {"COMPINFO": ci(EVENT_REASON=["XXX", "HIRNEW"]),
                 "FOEVENTREASON": frame("FOEVENTREASON", EXTERNAL_CODE=["HIRNEW"])}, 1),
    # single-table cross_field_check
    ("COMP107", {"COMPINFO": ci(RANGE_PENETRATION=[1.5, 0.5])}, 1),
    ("COMP117", {"COMPINFO": ci(PAY_RANGE_MAX=[50.0, 200.0], PAY_RANGE_MIN=[100.0, 100.0])}, 1),
    ("COMP201", {"PAYCOMPNONREC": nr(VALUE=[100.123456, 100.0])}, 1),
    ("COMP218", {"COMPINFO": ci(COMPA_RATIO=[1.0, 1.0], SALARY=[1000.0, 1000.0],
                                ANNUAL_SALARY=[12000.0, 13000.0], PAY_RANGE_MID=[13000.0, 13000.0])}, 1),
    ("COMP238", {"PAYCOMPNONREC": nr(VALUE=[100.0, 100.0], CURRENCY=[None, "USD"])}, 1),
    # cross-table cross_field_check (joined through EMPEMPLOYMENT and foundation objects)
    ("COMP129", {"COMPINFO": ci(PAY_GROUP=["PG1", "PG2"]), "EMPEMPLOYMENT": emp(PAY_GROUP=["PG9", "PG2"])}, 1),
    ("COMP140", {"COMPINFO": ci(SALARY=[1000.0, 1000.0], PAYCOMP_END_DATE=[None, None]),
                 "EMPEMPLOYMENT": emp(POSITION=["P1", "P2"]),
                 "POSITION": frame("POSITION", CODE=["P1", "P2"], VACANT=["true", "false"])}, 1),
    ("COMP141", {"COMPINFO": ci(SALARY=[1000.0, 1000.0], PAYCOMP_END_DATE=[None, None]),
                 "EMPEMPLOYMENT": emp(POSITION=["P1", "P2"]),
                 "POSITION": frame("POSITION", CODE=["P1", "P2"], EFFECTIVE_STATUS=["I", "A"])}, 1),
    ("COMP143", {"COMPINFO": ci(SALARY=[1000.0, 1000.0], COMP_FREQUENCY=["HRL", "HRL"]),
                 "EMPEMPLOYMENT": emp(POSITION=["P1", "P2"], STANDARD_HOURS=[40.0, 40.0]),
                 "POSITION": frame("POSITION", CODE=["P1", "P2"], STANDARD_HOURS=[20.0, 40.0])}, 1),
    ("COMP146", {"COMPINFO": ci(SALARY=[1000.0, 1000.0], PAYCOMP_END_DATE=[None, None]),
                 "EMPEMPLOYMENT": emp(CONTRACT_END_DATE=["2020-01-01", "2099-01-01"])}, 1),
    ("COMP148", {"COMPINFO": ci(SALARY=[1000.0, 1000.0], PAYCOMP_END_DATE=[None, None]),
                 "EMPEMPLOYMENT": emp(PAYROLL_END_DATE=["2020-01-01", "2099-01-01"])}, 1),
    ("COMP159", {"PAYCOMPNONREC": nr(ALT_COST_CENTER=["CC1", "CC2"]), "EMPEMPLOYMENT": emp(POSITION=["P1", "P2"]),
                 "POSITION": frame("POSITION", CODE=["P1", "P2"], COST_CENTER=["CC1", "CC9"])}, 1),
    ("COMP162", {"PAYCOMPNONREC": nr(PAY_DATE=["2025-01-01", "2020-01-01"]),
                 "EMPEMPLOYMENT": emp(CONTRACT_END_DATE=["2024-01-01", "2024-01-01"])}, 1),
    ("COMP172", {"COMPINFO": ci(SALARY=[1000.0, 1000.0], PAYCOMP_END_DATE=[None, None]),
                 "EMPEMPLOYMENT": emp(DEPARTMENT=["D1", "D2"]),
                 "FODEPARTMENT": frame("FODEPARTMENT", EXTERNAL_CODE=["D1", "D2"], STATUS=["I", "A"])}, 1),
    ("COMP177", {"COMPINFO": ci(SALARY=[1000.0, 1000.0], PAYCOMP_END_DATE=[None, None]),
                 "EMPEMPLOYMENT": emp(COST_CENTER=["CC1", "CC2"]),
                 "FOCOSTCENTER": frame("FOCOSTCENTER", EXTERNAL_CODE=["CC1", "CC2"], STATUS=["I", "A"])}, 1),
    ("COMP186", {"COMPINFO": ci(SALARY=[1000.0, 1000.0], PAYCOMP_END_DATE=[None, None]),
                 "EMPEMPLOYMENT": emp(STATUS=["A", "A"]),
                 "USERACCOUNT": frame("USERACCOUNT", USER_ID=["u1", "u2"], STATUS=["I", "A"])}, 1),
    ("COMP188", {"COMPINFO": ci(SALARY=[1000.0, 1000.0], PAYCOMP_END_DATE=[None, None]),
                 "EMPEMPLOYMENT": emp(COMPANY=["1000", "2000"]),
                 "FOCOMPANY": frame("FOCOMPANY", EXTERNAL_CODE=["1000", "2000"],
                                    STATUS=["I", "A"])}, 1),
    # dependency_check (minority row placed first so the default clean-row drop keeps only agreement)
    ("COMP152", {"PAYCOMPNONREC": nr(USERID=["u1", "u1", "u1"], CURRENCY=["EUR", "USD", "USD"])}, 1),
    ("COMP205", {"PAYCOMPNONREC": nr(PAY_COMPONENT=["BON", "BON", "BON"],
                                     UNIT_OF_MEASURE=["HR", "EA", "EA"])}, 1),
    ("COMP206", {"PAYCOMPNONREC": nr(PAY_COMPONENT=["BON", "BON", "BON"],
                                     CURRENCY=["EUR", "USD", "USD"])}, 1),
    ("COMP248", {"COMPINFO": ci(PAY_TYPE=["SALARY", "SALARY", "SALARY"],
                                PAY_COMPONENT_TYPE=["PERCENTAGE", "AMOUNT", "AMOUNT"])}, 1),
    # ruling #12 (fix round 2): dedicated fixtures for rules changed or restored this round.
    ("COMP066", {"COMPINFO": ci(COMP_FREQUENCY=["ANN", "ANN"], ANNUALIZATION_FACTOR=[2.0, 1.0])}, 1),
    ("COMP109", {"COMPINFO": ci(ANNUAL_SALARY=[150000.0, 125000.0], PAY_RANGE_MIN=[100000.0, 100000.0],
                                PAY_RANGE_MAX=[200000.0, 200000.0], RANGE_PENETRATION=[0.1, 0.25])}, 1),
    ("COMP135", {"COMPINFO": ci(ANNUAL_SALARY=[60000.0, 20000.0], PAY_RANGE_MAX=[50000.0, 50000.0],
                                PAY_RANGE_FREQUENCY=["ANN", "ANN"], PAY_RANGE_CURRENCY=["EUR", "EUR"],
                                CURRENCY=["EUR", "EUR"]),
                 "EMPEMPLOYMENT": emp(FTE=[0.5, 0.5])}, 1),
    ("COMP136", {"COMPINFO": ci(COMP_FREQUENCY=["HRL", "HRL"], SALARY=[20.0, 20.0]),
                 "EMPEMPLOYMENT": emp(STANDARD_HOURS=[None, 40.0])}, 1),
    ("COMP155", {"PAYCOMPNONREC": nr(VALUE=[2000000.0, 500.0], CURRENCY=["USD", "USD"])}, 1),
    ("COMP156", {"PAYCOMPNONREC": nr(NUMBER_OF_UNITS=[20000.0, 100.0], CURRENCY=["USD", "USD"])}, 1),
    ("COMP158", {"PAYCOMPNONREC": nr(PAY_DATE=["2020-01-01", "2021-01-01"]),
                 "EMPEMPLOYMENT": emp(ORIGINAL_START_DATE=["2021-01-01", "2021-01-01"])}, 1),
    ("COMP185", {"PAYCOMPNONREC": nr(VALUE=[100.0, 100.0],
                                     PAY_DATE=[pd.Timestamp.now().strftime("%Y-%m-%d")] * 2),
                 "EMPEMPLOYMENT": emp(EVENT_REASON=["R1", "R2"]),
                 "FOEVENTREASON": frame("FOEVENTREASON", EXTERNAL_CODE=["R1", "R2"], STATUS=["I", "A"])}, 1),
    ("COMP213", {"COMPINFO": ci(COMP_FREQUENCY=["HRL", "HRL"], SALARY=[10.0, 10.0]),
                 "EMPEMPLOYMENT": emp(STANDARD_HOURS=[0.0, 40.0])}, 1),
    ("COMP227", {"COMPINFO": ci(PAY_COMPONENT_RECURRING=["true", "true"], PAY_COMPONENT_IS_EARNING=["true", "true"],
                                PAY_COMPONENT_CAN_OVERRIDE=["true", "true"],
                                PAY_COMPONENT_DEFAULT=[None, 100.0])}, 1),
    ("COMP231", {"COMPINFO": ci(ANNUAL_SALARY=[60000.0, 60000.0], PAY_RANGE_MIN=[150000.0, 60000.0],
                                PAY_RANGE_FREQUENCY=["ANN", "ANN"], PAY_RANGE_CURRENCY=["EUR", "EUR"],
                                CURRENCY=["EUR", "EUR"])}, 1),
    ("COMP232", {"COMPINFO": ci(ANNUAL_SALARY=[500000.0, 60000.0], PAY_RANGE_MAX=[200000.0, 60000.0],
                                PAY_RANGE_FREQUENCY=["ANN", "ANN"], PAY_RANGE_CURRENCY=["EUR", "EUR"],
                                CURRENCY=["EUR", "EUR"])}, 1),
    ("COMP234", {"COMPINFO": ci(PAY_COMPONENT_IS_EARNING=["true", "true"],
                                PAY_COMPONENT_CAN_OVERRIDE=["false", "false"],
                                PAY_COMPONENT_DEFAULT=[None, 100.0])}, 1),
    ("COMP171", {"EMPEMPLOYMENT": emp(LAST_MODIFIED=["20200101", pd.Timestamp.now().strftime("%Y%m%d")])}, 1),
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
                PAY_DATE=["2024-01-01"] * 3, VALUE=[100.0, 100.0, 100.0],
                SEQUENCE_NUMBER=[1, 1, 1])
    assert fire("COMP151", {"PAYCOMPNONREC": nonrec}) >= 1
    assert fire("COMP151", {"PAYCOMPNONREC": nonrec.iloc[1:]}) == 0

    nonrec2 = nr(USERID=["u1", "u1", "u2"], PAY_COMPONENT=["BON", "BON", "BON"],
                 PAY_DATE=["2024-01-01"] * 3, VALUE=[100.0, 100.0, 100.0], CURRENCY=["USD"] * 3,
                 SEQUENCE_NUMBER=[1, 1, 1])
    assert fire("COMP217", {"PAYCOMPNONREC": nonrec2}) >= 1
    assert fire("COMP217", {"PAYCOMPNONREC": nonrec2.iloc[1:]}) == 0


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


def test_gap_and_open_ended_and_no_record_detected():
    gap = ci(USERID=["u1", "u1"], PAY_TYPE=["SALARY", "SALARY"],
             EFFECTIVE_DATE=["2024-01-01", "2024-08-01"], END_DATE=["2024-01-31", "2024-12-31"])
    assert fire("COMP249", {"COMPINFO": gap}) >= 1
    no_gap = ci(USERID=["u1", "u1"], PAY_TYPE=["SALARY", "SALARY"],
                EFFECTIVE_DATE=["2024-01-01", "2024-02-01"], END_DATE=["2024-01-31", "2024-12-31"])
    assert fire("COMP249", {"COMPINFO": no_gap}) == 0

    ended = ci(USERID=["u1"], PAY_TYPE=["SALARY"], EFFECTIVE_DATE=["2024-01-01"], END_DATE=["2024-12-31"])
    assert fire("COMP250", {"COMPINFO": ended, "EMPEMPLOYMENT": emp(USERID=["u1"], STATUS=["A"])}) >= 1
    open_ended = ci(USERID=["u1"], PAY_TYPE=["SALARY"], EFFECTIVE_DATE=["2024-01-01"], END_DATE=["99991231"])
    assert fire("COMP250", {"COMPINFO": open_ended, "EMPEMPLOYMENT": emp(USERID=["u1"], STATUS=["A"])}) == 0

    assert fire("COMP251", {"EMPEMPLOYMENT": emp(USERID=["u9", "u1"], STATUS=["A", "A"]),
                             "COMPINFO": frame("COMPINFO", USERID=["u1"])}) >= 1
    assert fire("COMP251", {"EMPEMPLOYMENT": emp(USERID=["u1"], STATUS=["A"]),
                             "COMPINFO": frame("COMPINFO", USERID=["u1"])}) == 0


def test_fixture_coverage():
    # Floor, not full coverage: NEW (COMP095-251) has ~155 rules; this only asserts a fixture
    # sample doesn't shrink silently. Not every new rule has its own fixture here (M11: floor
    # restored to 50 in fix round 2 after a batch of new/changed-rule fixtures were added).
    assert len({c[0] for c in CASES} | {"COMP151", "COMP217", "COMP168", "COMP169",
                                         "COMP249", "COMP250", "COMP251"}) >= 50


# ---- fix round 2: N1/N2/N4 dedicated fixtures -----------------------------------------------------------------------

def test_n1_pay_range_frequency_guard():
    # COMP135/231/232 compare ANNUAL_SALARY against the pay range, so the guard must require
    # the *range* to be annual, independent of the employee's own comp frequency.
    monthly_range = ci(ANNUAL_SALARY=[60000.0], SALARY=[5000.0], COMP_FREQUENCY=["MON"],
                        PAY_RANGE_FREQUENCY=["MON"], PAY_RANGE_MIN=[4000.0], PAY_RANGE_MID=[5000.0],
                        PAY_RANGE_MAX=[6000.0], CURRENCY=["EUR"], PAY_RANGE_CURRENCY=["EUR"])
    assert fire("COMP232", {"COMPINFO": monthly_range}) == 0
    assert fire("COMP135", {"COMPINFO": monthly_range, "EMPEMPLOYMENT": emp(FTE=[0.8])}) == 0

    annual_range_far_below = ci(ANNUAL_SALARY=[60000.0], SALARY=[60000.0], COMP_FREQUENCY=["MON"],
                                 PAY_RANGE_FREQUENCY=["ANN"], PAY_RANGE_MIN=[150000.0], PAY_RANGE_MID=[200000.0],
                                 PAY_RANGE_MAX=[250000.0], CURRENCY=["EUR"], PAY_RANGE_CURRENCY=["EUR"])
    assert fire("COMP231", {"COMPINFO": annual_range_far_below}) >= 1

    annual_range_inside = ci(ANNUAL_SALARY=[200000.0], SALARY=[200000.0], COMP_FREQUENCY=["MON"],
                              PAY_RANGE_FREQUENCY=["ANN"], PAY_RANGE_MIN=[150000.0], PAY_RANGE_MID=[200000.0],
                              PAY_RANGE_MAX=[250000.0], CURRENCY=["EUR"], PAY_RANGE_CURRENCY=["EUR"])
    assert fire("COMP231", {"COMPINFO": annual_range_inside}) == 0
    assert fire("COMP232", {"COMPINFO": annual_range_inside}) == 0


def test_c3_hourly_literal_also_checked():
    # COMP136/143/213 must fire on both the dictionary code HRL and the unabbreviated
    # literal HOURLY (COMP006's auto_fix shows tenants send it too); only HRL was
    # checked before this round.
    hourly = ci(COMP_FREQUENCY=["HOURLY"], SALARY=[20.0]), emp(STANDARD_HOURS=[None])
    assert fire("COMP136", {"COMPINFO": hourly[0], "EMPEMPLOYMENT": hourly[1]}) == 1


def test_n2_discontinued_component_on_active_employee_does_not_fire():
    # COMP250 groups by USERID only: a discontinued allowance must not make an otherwise
    # continuous salary record look like a gap.
    discontinued = ci(USERID=["u1"] * 3, PAY_TYPE=["SALARY", "ALLOW", "SALARY"],
                       EFFECTIVE_DATE=["2023-01-01", "2023-01-01", "2024-01-01"],
                       END_DATE=["2023-12-31", "2023-12-31", "99991231"])
    assert fire("COMP250", {"COMPINFO": discontinued, "EMPEMPLOYMENT": emp(USERID=["u1"], STATUS=["A"])}) == 0


def test_n4_open_end_date_recognised_blank_or_9999():
    # One convention for the whole pack: blank and 9999-12-31 both mean "still open".
    blank_open = ci(SALARY=[1000.0], PAYCOMP_END_DATE=[None]), emp(CONTRACT_END_DATE=["2020-01-01"])
    assert fire("COMP146", {"COMPINFO": blank_open[0], "EMPEMPLOYMENT": blank_open[1]}) >= 1
    sentinel_open = ci(SALARY=[1000.0], PAYCOMP_END_DATE=["99991231"]), emp(CONTRACT_END_DATE=["2020-01-01"])
    assert fire("COMP146", {"COMPINFO": sentinel_open[0], "EMPEMPLOYMENT": sentinel_open[1]}) >= 1
    actually_closed = ci(SALARY=[1000.0], PAYCOMP_END_DATE=["2020-06-01"]), emp(CONTRACT_END_DATE=["2020-01-01"])
    assert fire("COMP146", {"COMPINFO": actually_closed[0], "EMPEMPLOYMENT": actually_closed[1]}) == 0


def test_n4_comp250_blank_string_end_date_is_open_not_a_false_positive():
    # Round 2 regression (N4): COMP250's interval_check path dropped a "" end date as
    # invalid rather than open, so a genuinely-closed earlier row became the group's
    # (wrongly) "last" row and was flagged. Only the open_ended_only path is affected;
    # fixed in checks/types/interval_check.py.
    blank_current = ci(USERID=["u1", "u1"], EFFECTIVE_DATE=["2023-01-01", "2024-01-01"],
                        END_DATE=["2023-12-31", ""])
    assert fire("COMP250", {"COMPINFO": blank_current, "EMPEMPLOYMENT": emp(USERID=["u1"], STATUS=["A"])}) == 0


# ---- integrity -----------------------------------------------------------------------------------------------------

def test_new_ids_unique_and_contiguous():
    # Not strictly contiguous any more: a fix round deleted several rules found broken by
    # review (duplicates, unfixable domains, mislabeled conditions) rather than renumbering
    # everything after them. This still guards uniqueness and the declared id-range bounds.
    ids = [r["id"] for r in RULES]
    assert len(ids) == len(set(ids))
    nums = [int(r["id"][4:]) for r in NEW]
    assert nums == sorted(set(nums))
    assert nums[0] == 95
    assert len(NEW) >= 125


def test_deleted_ids_not_reused():
    # No live rule may carry a deleted id, and no deleted id leaks into any other rule's own
    # fields (e.g. a stray reference in a fail_when or fix_map would be a reuse-adjacent bug).
    ids = {r["id"] for r in RULES}
    assert not (ids & DELETED)
    for r in RULES:
        for v in r.values():
            if isinstance(v, str):
                assert not (DELETED & set(re.findall(r"COMP\d+", v))), (r["id"], v)


def test_new_rules_fully_enriched():
    for r in NEW:
        for k in MANDATORY:
            assert r.get(k), (r["id"], k)
        for f in re.findall(r"\{([A-Z0-9]+\.[A-Z0-9_]+)\}", r["record_fix_template"]):
            assert S4.field(*f.split(".")), (r["id"], f)


def test_every_referential_check_rule_is_covered_except_untestable():
    # Scoped to referential_check only: that check_class needs a live reference injection to
    # fire at all, so UNTESTABLE is the complete, exact exception list, not a sample. Other check
    # classes (cross_field_check, regex_check, etc.) are fixture-testable in principle but not all
    # have a fixture here; CASES is a representative sample, not full coverage (see M11 in the
    # review this task is addressing).
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
    # COMP246/247 lost their auto_fix this round (m5): strip+upper can't repair an
    # over-length value, so no safe auto_fix exists for a length/newline violation.
])
def test_auto_fix_proposal_passes_the_rule(rid, dirty, fixed):
    r = BY_ID[rid]
    out = _apply(r["auto_fix"]["steps"], dirty)
    assert out == fixed
    if r.get("pattern"):
        assert re.match(r["pattern"], out)
    if r.get("allowed_values"):
        assert out in r["allowed_values"]
