"""SuccessFactors compensation, payroll integration and benefits depth rules: integrity, auto_fix contract and fixtures."""
import re
from datetime import date, timedelta

import pandas as pd
import pytest
import yaml

from checks.frames import TableFrames
from checks.runner import run_checks
from sap.ddic import get_dictionary

D = get_dictionary("s4hana")
PACKS = {"compensation": [("COMP", 43, 52)], "benefits": [("BEN", 45, 41), ("BEN", 86, 17)],
         "payroll_integration": [("PAY", 31, 23), ("HPY", 31, 27)]}
MANDATORY = ["id", "field", "check_class", "severity", "dimension", "message", "why_it_matters", "rule_authority",
             "sap_impact", "fix_map", "record_fix_template"]
OPS = {"strip": set(), "collapse_spaces": set(), "upper": set(), "lower": set(), "title": set(),
       "pad_left": {"width", "char"}, "strip_leading_zeros": set(), "regex_replace": {"pattern", "repl"},
       "truncate": {"width"}, "map": {"values"}, "set": {"value"}, "copy": {"from"},
       "lookup": {"table", "match", "value"}, "date_format": {"to"}, "gtin_check_digit": set()}


def _load(module):
    return yaml.safe_load(open(f"checks/rules/successfactors/{module}.yaml"))["rules"]


RULES = {m: _load(m) for m in PACKS}
BY_ID = {r["id"]: r for rs in RULES.values() for r in rs}
NEW = [(m, BY_ID[f"{p}{n:03d}"]) for m, specs in PACKS.items() for p, s, c in specs for n in range(s, s + c)]


@pytest.mark.parametrize("module", list(PACKS))
def test_ids_unique_and_contiguous(module):
    ids = [r["id"] for r in RULES[module]]
    assert len(ids) == len(set(ids))
    for prefix, start, count in PACKS[module]:
        nums = sorted(int(i[len(prefix):]) for i in ids if re.fullmatch(prefix + r"\d+", i))
        new = [n for n in nums if start <= n < start + count]
        assert new == list(range(start, start + count)), prefix
        assert start - 1 in nums, prefix


@pytest.mark.parametrize("module,rule", NEW, ids=[r["id"] for _, r in NEW])
def test_new_rule_metadata(module, rule):
    for key in MANDATORY:
        assert rule.get(key), (rule["id"], key)
    assert rule["rule_authority"] in {"best_practice", "sap_hard_constraint", "customer_configured"}


def test_auto_fix_uses_contract_ops_only():
    fixes = [(r["id"], r["auto_fix"]) for rs in RULES.values() for r in rs if "auto_fix" in r]
    assert len(fixes) >= 30
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


def test_no_auto_fix_on_amounts_or_eligibility():
    for rs in RULES.values():
        for r in rs:
            if "auto_fix" in r:
                col = r["field"].split(".")[1]
                assert col not in {"SALARY", "VALUE", "AMOUNT", "PERCENT", "BETRG", "EMPLOYEE_COST", "EMPLOYER_COST",
                                   "GROSS_PAY", "NET_PAY", "IS_BENEFICIARY_ELIGIBLE", "ANNUAL_SALARY"}, r["id"]


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


def run(module, rule_id, spec):
    frames = TableFrames(_tables(spec, BY_ID[rule_id]), D, module=module)
    res = next((r for r in run_checks(module, frames, "t") if r.check_id == rule_id), None)
    assert res is not None, f"{rule_id} did not run"
    assert res.error is None, (rule_id, res.error)
    return res.total_count, res.affected_count


CI = {"USERID": "u1", "EFFECTIVE_DATE": "20250101", "CURRENCY": "ZAR"}
NR = {"USERID": "u1", "PAY_COMPONENT": "BONUS", "PAY_DATE": "20250301", "VALUE": "1000", "CURRENCY": "ZAR",
      "SEQUENCE_NUMBER": "1"}
DP = {"PERSON_ID": "p1", "RELATED_PERSON_ID": "d1", "RELATIONSHIP_TYPE": "child", "START_DATE": "20100101",
      "DEPENDENT_BIRTH": "20100101", "IS_BENEFICIARY": "true"}
BE = {"USERID": "u1", "PLAN_ID": "MED1", "PLAN_TYPE": "MEDICAL", "ENROL_DATE": "20250101",
      "EFFECTIVE_DATE": "20250201", "STATUS": "A", "COVERAGE_LEVEL": "EMP_ONLY"}
PI = {"USERID": "u1", "EFFECTIVE_DATE": "20250101", "PAY_TYPE": "MAIN", "PAYMENT_METHOD": "05", "CURRENCY": "EUR",
      "BANK_COUNTRY": "DE", "BANK": "10070000", "ACCOUNT_NUMBER": "1"}
RG = {"PERNR": "00000001", "SEQNR": "1", "ABKRS": "Z1", "FPPER": "202509", "INPER": "202509", "FPBEG": "20250901",
      "PAYDT": "20250925", "MOLGA": "16"}


def c(base, **kw):
    return {**base, **kw}


CASES = {
    "COMP043": ("compensation", {"COMPINFO": [c(CI, END_DATE="20251231"), c(CI, END_DATE="20241231")]}),
    "COMP044": ("compensation", {"COMPINFO": [c(CI, EFFECTIVE_DATE_COMP="20250101", PAYCOMP_END_DATE="20251231"),
                                              c(CI, EFFECTIVE_DATE_COMP="20250101", PAYCOMP_END_DATE="20241231")]}),
    "COMP045": ("compensation", {"COMPINFO": [c(CI, EFFECTIVE_DATE_COMP="20250101"), c(CI, EFFECTIVE_DATE_COMP="20241201")]}),
    "COMP047": ("compensation", {"COMPINFO": [c(CI, PAY_RANGE_CURRENCY="ZAR"), c(CI, PAY_RANGE_CURRENCY="Rand")]}),
    "COMP049": ("compensation", {"COMPINFO": [c(CI, PAY_RANGE_MIN="100", PAY_RANGE_CURRENCY="ZAR"), c(CI, PAY_RANGE_MIN="100")]}),
    "COMP051": ("compensation", {"COMPINFO": [c(CI, PAY_RANGE_STATUS="A"), c(CI, PAY_RANGE_STATUS="I")]}),
    "COMP055": ("compensation", {"COMPINFO": [c(CI, PAY_COMPONENT_TYPE="AMOUNT", PAY_COMPONENT_CURRENCY="ZAR"),
                                              c(CI, PAY_COMPONENT_TYPE="AMOUNT")]}),
    "COMP058": ("compensation", {"COMPINFO": [c(CI, PAY_COMPONENT_TYPE="AMOUNT"), c(CI, PAY_COMPONENT_TYPE="FIXED")]}),
    "COMP059": ("compensation", {"COMPINFO": [c(CI, PAY_COMPONENT_TYPE="PERCENTAGE", SALARY="10"),
                                              c(CI, PAY_COMPONENT_TYPE="PERCENTAGE", SALARY="5000")]}),
    "COMP060": ("compensation", {"COMPINFO": [c(CI, PAY_COMPONENT_CAN_OVERRIDE="false", SALARY="500", PAY_COMPONENT_DEFAULT="500"),
                                              c(CI, PAY_COMPONENT_CAN_OVERRIDE="false", SALARY="700", PAY_COMPONENT_DEFAULT="500")]}),
    "COMP061": ("compensation", {"COMPINFO": [c(CI, PAY_COMPONENT_RECURRING="true"), c(CI, PAY_COMPONENT_RECURRING="Y")]}),
    "COMP066": ("compensation", {"COMPINFO": [c(CI, COMP_FREQUENCY="BWK", ANNUALIZATION_FACTOR="26"),
                                              c(CI, COMP_FREQUENCY="BWK", ANNUALIZATION_FACTOR="24")]}),
    "COMP067": ("compensation", {"COMPINFO": [c(CI, COMP_FREQUENCY="MON", ANNUALIZATION_FACTOR="13"),
                                              c(CI, COMP_FREQUENCY="MON", ANNUALIZATION_FACTOR="1")]}),
    "COMP068": ("compensation", {"COMPINFO": [c(CI, SALARY="1000", ANNUALIZATION_FACTOR="12", ANNUAL_SALARY="12000"),
                                              c(CI, SALARY="1000", ANNUALIZATION_FACTOR="12", ANNUAL_SALARY="11000")]}),
    "COMP071": ("compensation", {"COMPINFO": [c(CI, ANNUAL_SALARY="110", PAY_RANGE_MID="100", COMPA_RATIO="1.1"),
                                              c(CI, ANNUAL_SALARY="110", PAY_RANGE_MID="100", COMPA_RATIO="0.9")]}),
    "COMP074": ("compensation", {"COMPINFO": [c(CI, PAYROLL_SYSTEM_ID="ECP", PAYROLL_ID="00000001"), c(CI, PAYROLL_SYSTEM_ID="ECP")]}),
    "COMP076": ("compensation", {"COMPINFO": [c(CI, PAYROLL_ID="00001234"), c(CI, PAYROLL_ID="1234")]}),
    "COMP081": ("compensation", {"PAYCOMPNONREC": [NR, c(NR, VALUE="-50", SEQUENCE_NUMBER="2")]}),
    "COMP083": ("compensation", {"PAYCOMPNONREC": [NR, c(NR, CURRENCY="R", SEQUENCE_NUMBER="3")]}),
    "COMP085": ("compensation", {"PAYCOMPNONREC": [NR, c(NR, USERID="u2", PAY_DATE="20240101")],
                                 "EMPEMPLOYMENT": [{"USERID": "u1", "START_DATE": "20200101"},
                                                   {"USERID": "u2", "START_DATE": "20240601"}]}),
    "COMP088": ("compensation", {"PAYCOMPNONREC": [NR, NR, c(NR, SEQUENCE_NUMBER="2")]}, (3, 2)),
    "COMP089": ("compensation", {"PAYCOMPNONREC": [c(NR, NUMBER_OF_UNITS="8", UNIT_OF_MEASURE="H"),
                                                   c(NR, NUMBER_OF_UNITS="8", SEQUENCE_NUMBER="2")]}),
    "BEN049": ("benefits", {"DEPENDENT": [DP, c(DP, RELATED_PERSON_ID="p1")]}),
    "BEN050": ("benefits", {"DEPENDENT": [c(DP, END_DATE="20200101"), c(DP, RELATED_PERSON_ID="d2", END_DATE="20090101")]}),
    "BEN052": ("benefits", {"DEPENDENT": [DP, c(DP, RELATED_PERSON_ID="d2", START_DATE="20090101")]}),
    "BEN054": ("benefits", {"DEPENDENT": [DP, c(DP, RELATED_PERSON_ID="d2", IS_BENEFICIARY="yes")]}),
    "BEN056": ("benefits", {"DEPENDENT": [DP, c(DP, RELATED_PERSON_ID="d2", DEPENDENT_BIRTH="")]}),
    "BEN058": ("benefits", {"DEPENDENT": [c(DP, DEPENDENT_BIRTH=_day(5000), START_DATE=_day(5000)),
                                          c(DP, RELATED_PERSON_ID="d2", DEPENDENT_BIRTH=_day(11000), START_DATE=_day(11000))]}),
    "BEN059": ("benefits", {"DEPENDENT": [DP, c(DP, RELATED_PERSON_ID="d2", DEPENDENT_BIRTH="19850101", START_DATE="19850101")],
                            "PERINFO": [{"PERSON_ID": "p1", "DATE_OF_BIRTH": "19800101"}]}),
    "BEN062": ("benefits", {"DEPENDENT": [c(DP, RELATIONSHIP_TYPE="spouse", DEPENDENT_BIRTH="19800101", START_DATE="20050101"),
                                          c(DP, RELATED_PERSON_ID="d2", RELATIONSHIP_TYPE="spouse", DEPENDENT_BIRTH="19950101",
                                            START_DATE="20050101")]}),
    "BEN067": ("benefits", {"DEPENDENT": [c(DP, END_DATE="20991231"), c(DP, RELATED_PERSON_ID="d2", END_DATE="20200101")]}),
    "BEN069": ("benefits", {"DEPENDENT": [DP, DP, c(DP, RELATED_PERSON_ID="d2")]}, (3, 2)),
    "BEN070": ("benefits", {"BENEFITENROLLMENT": [c(BE, COVERAGE_LEVEL="EMP_SPOUSE", DEPENDENT_LINK="d1"),
                                                  c(BE, COVERAGE_LEVEL="EMP_SPOUSE", DEPENDENT_LINK="d1;d2")]}),
    "BEN071": ("benefits", {"BENEFITENROLLMENT": [c(BE, COVERAGE_LEVEL="FAMILY", DEPENDENT_LINK="d1;d2"),
                                                  c(BE, COVERAGE_LEVEL="FAMILY", DEPENDENT_LINK="d1")]}),
    "BEN076": ("benefits", {"BENEFITENROLLMENT": [c(BE, STATUS="P", EMPLOYEE_COST="0"), c(BE, STATUS="P", EMPLOYEE_COST="250")]}),
    "BEN079": ("benefits", {"BENEFITENROLLMENT": [c(BE, DEPENDENT_LINK="d1;d2"),
                                                  c(BE, DEPENDENT_LINK=";".join(f"d{i}" for i in range(11)))]}),
    "BEN080": ("benefits", {"BENEFITENROLLMENT": [c(BE, DEPENDENT_LINK="d1;d2;d3"), c(BE, DEPENDENT_LINK="d1;d2;d1")]}),
    "BEN081": ("benefits", {"BENEFITENROLLMENT": [BE, c(BE, EFFECTIVE_DATE="20250215")]}),
    "PAY031": ("payroll_integration", {"PAYRESULT": [{"USERID": "u1", "PAY_PERIOD": "202509", "GROSS_PAY": "1000", "TAX_AMOUNT": "200"},
                                                     {"USERID": "u2", "PAY_PERIOD": "202509", "GROSS_PAY": "1000", "TAX_AMOUNT": "1200"}]}),
    "PAY037": ("payroll_integration", {"PAYMENTINFO": [PI, c(PI, BANK_COUNTRY="")]}),
    "PAY040": ("payroll_integration", {"PAYMENTINFO": [c(PI, PERCENT="50"), c(PI, PERCENT="150")]}),
    "PAY042": ("payroll_integration", {"PAYMENTINFO": [c(PI, AMOUNT="100"), c(PI, AMOUNT="100", PERCENT="20")]}),
    "PAY043": ("payroll_integration", {"PAYMENTINFO": [c(PI, BIC="COBADEFFXXX"), c(PI, BIC="COBA-DE")]}),
    "PAY044": ("payroll_integration", {"PAYMENTINFO": [c(PI, IBAN="DE89370400440532013000"), c(PI, IBAN="DE8937")]}),
    "PAY048": ("payroll_integration", {"PAYMENTINFO": [c(PI, IBAN="DE89370400440532013000"),
                                                      c(PI, IBAN="NL91ABNA0417164300")]}),
    "PAY052": ("payroll_integration", {"PAYMENTINFO": [PI, PI, c(PI, ACCOUNT_NUMBER="2")]}, (3, 2)),
    "HPY032": ("payroll_integration", {"HRPY_RGDIR": [RG, c(RG, SEQNR="2", FPPER="202599")]}),
    "HPY033": ("payroll_integration", {"HRPY_RGDIR": [RG, c(RG, SEQNR="2", INPER="202508")]}),
    "HPY034": ("payroll_integration", {"HRPY_RGDIR": [RG, c(RG, SEQNR="2", PAYDT="20250701")]}),
    "HPY036": ("payroll_integration", {"HRPY_RGDIR": [c(RG, VOID="X", VOIDR="01"), c(RG, SEQNR="2", VOID="X")]}),
    "HPY040": ("payroll_integration", {"PA0008": [{"PERNR": "1", "ENDDA": "99991231", "DIVGV": "173"},
                                                  {"PERNR": "2", "ENDDA": "99991231", "DIVGV": "0"}]}),
    "HPY046": ("payroll_integration", {"PA0009": [{"PERNR": "1", "SUBTY": "0", "BETRG": "0"},
                                                  {"PERNR": "2", "SUBTY": "0", "BETRG": "500"}]}),
    "HPY047": ("payroll_integration", {"PA0014": [{"PERNR": "1", "LGART": "M100", "ANZHL": "5", "ZEINH": "001"},
                                                  {"PERNR": "2", "LGART": "M100", "ANZHL": "5"}]}),
    "HPY051": ("payroll_integration", {"PA0015": [{"PERNR": "1", "LGART": "M200", "BETRG": "100"},
                                                  {"PERNR": "2", "LGART": "M200", "BETRG": "0"}]}),
    "HPY056": ("payroll_integration", {"PA0003": [{"PERNR": "1", "KOABR": ""}, {"PERNR": "2", "KOABR": "X"}]}),
}


def test_enough_fixtures():
    assert len(CASES) >= 30


@pytest.mark.parametrize("rule_id", list(CASES))
def test_rule_flags_dirty_and_passes_clean(rule_id):
    case = CASES[rule_id]
    expected = case[2] if len(case) > 2 else (2, 1)
    assert run(case[0], rule_id, case[1]) == expected
