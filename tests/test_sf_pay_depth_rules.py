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
PACKS = {"compensation": [("COMP", 43, 52)], "benefits": [("BEN", 45, 41)],
         "payroll_integration": [("PAY", 31, 189), ("HPY", 31, 27)]}
# Ids minted on this branch that were later found to be undeliverable and removed (append-only
# numbering is preserved — the id is retired, not reused): PAY157/158 compared a SF foundation
# object code to a raw ECC payroll-export key with no mapping table between the two domains.
# PAY206: freshness_check cannot express "current record per employee only" (see
# checks/types/freshness_check.py — per-row only, no group-by), so it flagged every
# historical PAYMENTINFO record, not just stale current bank details.
# PAY209: exact duplicate of PAY127 (same BIC format regex). PAY210: hard-coded ~30-code
# "ISO 4217" subset omitted dozens of real active currencies and no full ISO 4217 source
# exists in this repo. PAY211: compared a picklist/foundation-object code field to an
# unverifiable English label with no real picklist code on record anywhere in this repo.
# PAY213: exact duplicate of EC202/EC378 in employee_central.yaml. PAY214: exact duplicate
# of PAY125 (same field, same regex, same country scope).
DELETED = {"payroll_integration": {"PAY157", "PAY158", "PAY206", "PAY209", "PAY210", "PAY211", "PAY213", "PAY214"}}
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
NEW = [(m, BY_ID[f"{p}{n:03d}"]) for m, specs in PACKS.items() for p, s, c in specs for n in range(s, s + c)
       if f"{p}{n:03d}" not in DELETED.get(m, set())]


@pytest.mark.parametrize("module", list(PACKS))
def test_ids_unique_and_contiguous(module):
    ids = [r["id"] for r in RULES[module]]
    assert len(ids) == len(set(ids))
    deleted = DELETED.get(module, set())
    for prefix, start, count in PACKS[module]:
        nums = sorted(int(i[len(prefix):]) for i in ids if re.fullmatch(prefix + r"\d+", i))
        new = [n for n in nums if n >= start]
        expected = [n for n in range(start, start + count) if f"{prefix}{n:03d}" not in deleted]
        assert new == expected, prefix
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
      "BANK_COUNTRY": "DEU", "BANK": "10070000", "ACCOUNT_NUMBER": "1"}
RG = {"PERNR": "00000001", "SEQNR": "1", "ABKRS": "Z1", "FPPER": "202509", "INPER": "202509", "FPBEG": "20250901",
      "PAYDT": "20250925", "MOLGA": "16"}
EE = {"USERID": "u1", "PERSON_ID": "p1", "START_DATE": "20200101", "END_DATE": "", "COMPANY": "ACME", "POSITION": "POS1"}
PR = {"USERID": "u1", "PAY_PERIOD": "202509", "PAY_DATE": "20250925", "GROSS_PAY": "1000", "NET_PAY": "800",
      "COMPANY": "ACME", "COST_CENTRE": "CC1", "CURRENCY": "ZAR"}
FE = {"PERSON_ID": "p1", "DATE_OF_BIRTH": "19900101", "DATE_OF_DEATH": "", "NATIONAL_ID": "8001015009087",
      "NATIONAL_ID_COUNTRY": "ZAF"}
UA = {"USER_ID": "u1", "STATUS": "A", "EMAIL": "a@x.com", "HIRE_DATE": "20200101"}
PO = {"CODE": "POS1", "COMPANY": "ACME", "COST_CENTER": "CC1", "VACANT": "false", "EFFECTIVE_STATUS": "A"}
FC = {"EXTERNAL_CODE": "ACME", "COUNTRY": "ZAF", "CURRENCY": "ZAR", "STATUS": "A"}


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
    # --- PAY054-203 depth additions ---
    "PAY054": ("payroll_integration", {"PAYMENTINFO": [c(PI, BANK_COUNTRY="AND", IBAN="AD11AAAAAAAAAAAAAAAAAAAA"[:-1]),
                                                       c(PI, BANK_COUNTRY="AND", IBAN="AD11AAAAAAAAAAAAAAAAAAAA")]}),
    "PAY061": ("payroll_integration", {"PAYMENTINFO": [c(PI, BANK_COUNTRY="DEU", IBAN="DE11AAAAAAAAAAAAAAAAAA"[:-1]),
                                                       c(PI, BANK_COUNTRY="DEU", IBAN="DE11AAAAAAAAAAAAAAAAAA")]}),
    "PAY067": ("payroll_integration", {"PAYMENTINFO": [c(PI, BANK_COUNTRY="GBR", IBAN="GB11AAAAAAAAAAAAAAAAAA"[:-1]),
                                                       c(PI, BANK_COUNTRY="GBR", IBAN="GB11AAAAAAAAAAAAAAAAAA")]}),
    "PAY081": ("payroll_integration", {"PAYMENTINFO": [c(PI, BANK_COUNTRY="NLD", IBAN="NL11AAAAAAAAAAAAAA"[:-1]),
                                                       c(PI, BANK_COUNTRY="NLD", IBAN="NL11AAAAAAAAAAAAAA")]}),
    "PAY090": ("payroll_integration", {"PAYMENTINFO": [c(PI, BANK_COUNTRY="ARG", IBAN=None, ACCOUNT_NUMBER="1" * 21),
                                                       c(PI, BANK_COUNTRY="ARG", IBAN=None, ACCOUNT_NUMBER="1" * 22)]}),
    "PAY100": ("payroll_integration", {"PAYMENTINFO": [c(PI, BANK_COUNTRY="IND", IBAN=None, ACCOUNT_NUMBER="1" * 8),
                                                       c(PI, BANK_COUNTRY="IND", IBAN=None, ACCOUNT_NUMBER="1" * 9)]}),
    "PAY112": ("payroll_integration", {"PAYMENTINFO": [c(PI, BANK_COUNTRY="USA", IBAN=None, ACCOUNT_NUMBER="1" * 3),
                                                       c(PI, BANK_COUNTRY="USA", IBAN=None, ACCOUNT_NUMBER="1" * 4)]}),
    "PAY114": ("payroll_integration", {"PAYMENTINFO": [c(PI, BANK_COUNTRY="ZAF", IBAN=None, ACCOUNT_NUMBER="1" * 8),
                                                       c(PI, BANK_COUNTRY="ZAF", IBAN=None, ACCOUNT_NUMBER="1" * 9)]}),
    "PAY115": ("payroll_integration", {"PAYMENTINFO": [c(PI, BANK_COUNTRY="AUS", ROUTING_NUMBER="11111"), c(PI, BANK_COUNTRY="AUS", ROUTING_NUMBER="111111")]}),
    "PAY120": ("payroll_integration", {"PAYMENTINFO": [c(PI, BANK_COUNTRY="HKG", ROUTING_NUMBER="11"), c(PI, BANK_COUNTRY="HKG", ROUTING_NUMBER="111")]}),
    "PAY126": ("payroll_integration", {"PAYMENTINFO": [c(PI, BANK_COUNTRY="ZAF", ROUTING_NUMBER="11111"), c(PI, BANK_COUNTRY="ZAF", ROUTING_NUMBER="111111")]}),
    "PAY127": ("payroll_integration", {"PAYMENTINFO": [c(PI, BIC="DEUTDEFF500"),
                                                       c(PI, BIC="DEUTDE")]}),
    "PAY128": ("payroll_integration", {"PAYMENTINFO": [c(PI, ACCOUNT_NUMBER="123", ACCOUNT_OWNER=None),
                                                       c(PI, ACCOUNT_NUMBER="123", ACCOUNT_OWNER="Alice Smith")]}),
    "PAY129": ("payroll_integration", {"PAYMENTINFO": [c(PI, IBAN="DE89370400440532013000", ACCOUNT_NUMBER=None, ACCOUNT_OWNER=None),
                                                       c(PI, IBAN="DE89370400440532013000", ACCOUNT_NUMBER=None, ACCOUNT_OWNER="Alice Smith")]}),
    "PAY130": ("payroll_integration", {"PAYMENTINFO": [c(PI, EXTERNAL_CODE=None), c(PI, EXTERNAL_CODE="PAY1")]}),
    "PAY131": ("payroll_integration", {"PAYMENTINFO": [c(PI, EFFECTIVE_DATE=None), c(PI, EFFECTIVE_DATE="20250101")]}),
    "PAY132": ("payroll_integration", {"PAYMENTINFO": [c(PI, EFFECTIVE_DATE=_day(-400)), c(PI, EFFECTIVE_DATE=_day(0))]}),
    "PAY133": ("payroll_integration", {"PAYMENTINFO": [PI, PI]}, (2, 2)),
    "PAY134": ("payroll_integration", {"PAYMENTINFO": [c(PI, ACCOUNT_OWNER="12345"), c(PI, ACCOUNT_OWNER="Alice Smith")]}),
    "PAY135": ("payroll_integration", {"PAYMENTINFO": [c(PI, EFFECTIVE_DATE=_day(-200)), c(PI, EFFECTIVE_DATE="20200201")],
                                       "EMPEMPLOYMENT": [c(EE, END_DATE="20200101")]}),
    "PAY136": ("payroll_integration", {"PAYMENTINFO": [c(PI, USERID="u1", ACCOUNT_NUMBER="999"),
                                                       c(PI, USERID="u2", ACCOUNT_NUMBER="999"),
                                                       # u1's own effective-dated history on a different account: not a duplicate
                                                       c(PI, USERID="u1", ACCOUNT_NUMBER="888", EFFECTIVE_DATE=_day(-200)),
                                                       c(PI, USERID="u1", ACCOUNT_NUMBER="888", EFFECTIVE_DATE=_day(0))]}, (4, 2)),
    "PAY137": ("payroll_integration", {"PAYMENTINFO": [c(PI, USERID="u1", IBAN="DE89370400440532013000"),
                                                       c(PI, USERID="u2", IBAN="DE89370400440532013000"),
                                                       # u1's own effective-dated history on a different IBAN: not a duplicate
                                                       c(PI, USERID="u1", IBAN="GB29NWBK60161331926819", EFFECTIVE_DATE=_day(-200)),
                                                       c(PI, USERID="u1", IBAN="GB29NWBK60161331926819", EFFECTIVE_DATE=_day(0))]}, (4, 2)),
    "PAY138": ("payroll_integration", {"PERINFO": [c(FE, NATIONAL_ID=None), c(FE, PERSON_ID="p2", NATIONAL_ID="8001015009087")],
                                       "EMPEMPLOYMENT": [EE, c(EE, USERID="u2", PERSON_ID="p2")],
                                       "PAYRESULT": [PR, c(PR, USERID="u2")]}),
    "PAY139": ("payroll_integration", {"PERINFO": [c(FE, NATIONAL_ID="8001015009087", NATIONAL_ID_COUNTRY=None),
                                                   c(FE, PERSON_ID="p2", NATIONAL_ID="8001015009087", NATIONAL_ID_COUNTRY="ZAF")]}),
    "PAY140": ("payroll_integration", {"PERINFO": [c(FE, DATE_OF_DEATH="20240101"), c(FE, PERSON_ID="p2", DATE_OF_DEATH=None)],
                                       "EMPEMPLOYMENT": [EE, c(EE, USERID="u2", PERSON_ID="p2")],
                                       "PAYRESULT": [c(PR, PAY_DATE="20250925"), c(PR, USERID="u2", PAY_DATE="20250925")]}),
    "PAY141": ("payroll_integration", {"PERINFO": [c(FE, DATE_OF_DEATH="20240101"), c(FE, PERSON_ID="p2", DATE_OF_DEATH=None)],
                                       "EMPEMPLOYMENT": [EE, c(EE, USERID="u2", PERSON_ID="p2")],
                                       "PAYMENTINFO": [c(PI, EFFECTIVE_DATE="20250101"), c(PI, USERID="u2", EFFECTIVE_DATE="20250101")]}),
    "PAY142": ("payroll_integration", {"PERINFO": [c(FE, NATIONAL_ID_COUNTRY="ZAF"), c(FE, PERSON_ID="p2", NATIONAL_ID_COUNTRY="DEU")],
                                       "EMPEMPLOYMENT": [EE, c(EE, USERID="u2", PERSON_ID="p2")],
                                       "PAYMENTINFO": [c(PI, BANK_COUNTRY="DEU"), c(PI, USERID="u2", BANK_COUNTRY="DEU")]}),
    "PAY143": ("payroll_integration", {"PAYMENTINFO": [c(PI, BANK_COUNTRY="DEU"), c(PI, USERID="u2", BANK_COUNTRY="ZAF")],
                                       "EMPEMPLOYMENT": [EE, c(EE, USERID="u2", PERSON_ID="p2")],
                                       "FOCOMPANY": [FC]}),
    "PAY144": ("payroll_integration", {"PAYMENTINFO": [c(PI, CURRENCY="EUR"), c(PI, USERID="u2", CURRENCY="ZAR")],
                                       "EMPEMPLOYMENT": [EE, c(EE, USERID="u2", PERSON_ID="p2")],
                                       "FOCOMPANY": [FC]}),
    "PAY145": ("payroll_integration", {"PERINFO": [c(FE, DATE_OF_BIRTH="20150101"), c(FE, PERSON_ID="p2", DATE_OF_BIRTH="19900101")],
                                       "EMPEMPLOYMENT": [EE, c(EE, USERID="u2", PERSON_ID="p2")],
                                       "PAYRESULT": [c(PR, PAY_DATE="20250925"), c(PR, USERID="u2", PAY_DATE="20250925")]}),
    "PAY146": ("payroll_integration", {"PERINFO": [c(FE, DATE_OF_BIRTH=None), c(FE, PERSON_ID="p2", DATE_OF_BIRTH="19900101")],
                                       "EMPEMPLOYMENT": [EE, c(EE, USERID="u2", PERSON_ID="p2")],
                                       "PAYRESULT": [PR, c(PR, USERID="u2")]}),
    "PAY148": ("payroll_integration", {"PERINFO": [c(FE, NATIONAL_ID="8001015009087", NATIONAL_ID_CARD_TYPE=None),
                                                   c(FE, PERSON_ID="p2", NATIONAL_ID="8001015009087", NATIONAL_ID_CARD_TYPE="PASSPORT")]}),
    "PAY149": ("payroll_integration", {"PERINFO": [c(FE, NATIONAL_ID="8001015009087"),
                                                   c(FE, PERSON_ID="p2", NATIONAL_ID="8001015009087")]}, (2, 2)),
    "PAY150": ("payroll_integration", {"USERACCOUNT": [c(UA, STATUS="I"), c(UA, USER_ID="u2", STATUS="A")],
                                       "EMPEMPLOYMENT": [EE, c(EE, USERID="u2", PERSON_ID="p2")],
                                       "PAYRESULT": [c(PR, GROSS_PAY="1000"), c(PR, USERID="u2", GROSS_PAY="1000")]}),
    "PAY151": ("payroll_integration", {"USERACCOUNT": [c(UA, STATUS="I"), c(UA, USER_ID="u2", STATUS="A")],
                                       "EMPEMPLOYMENT": [EE, c(EE, USERID="u2", PERSON_ID="p2")],
                                       "PAYMENTINFO": [c(PI, ACCOUNT_NUMBER="1", IBAN=None),
                                                       c(PI, USERID="u2", ACCOUNT_NUMBER="1", IBAN=None)]}),
    # Dirty: HIRE_DATE after the employment segment's START_DATE (impossible for a genuine
    # hire). Clean: HIRE_DATE before the segment's START_DATE — a legitimate rehire opening
    # a later segment without changing the original HIRE_DATE, which must not be flagged.
    "PAY152": ("payroll_integration", {"USERACCOUNT": [c(UA, HIRE_DATE="20200601"), c(UA, USER_ID="u2", HIRE_DATE="20190101")],
                                       "EMPEMPLOYMENT": [c(EE, START_DATE="20200101"), c(EE, USERID="u2", PERSON_ID="p2", START_DATE="20200101")]}),
    "PAY153": ("payroll_integration", {"USERACCOUNT": [c(UA, EMAIL=None), c(UA, USER_ID="u2", EMAIL="b@x.com")],
                                       "EMPEMPLOYMENT": [EE, c(EE, USERID="u2", PERSON_ID="p2")],
                                       "PAYMENTINFO": [PI, c(PI, USERID="u2")]}),
    "PAY154": ("payroll_integration", {"USERACCOUNT": [c(UA, STATUS="A"), c(UA, USER_ID="u2", STATUS="A")],
                                       "EMPEMPLOYMENT": [c(EE, END_DATE="20200101"), c(EE, USERID="u2", PERSON_ID="p2", END_DATE=None)]}),
    "PAY155": ("payroll_integration", {"POSITION": [c(PO, VACANT="true")], "EMPEMPLOYMENT": [EE, c(EE, USERID="u2", PERSON_ID="p2")],
                                       "PAYRESULT": [c(PR, GROSS_PAY="1000", PAY_DATE=_day(-10)), c(PR, USERID="u2", GROSS_PAY="0", PAY_DATE=_day(-10))]}),
    "PAY156": ("payroll_integration", {"POSITION": [c(PO, EFFECTIVE_STATUS="I")], "EMPEMPLOYMENT": [EE, c(EE, USERID="u2", PERSON_ID="p2")],
                                       "PAYRESULT": [c(PR, GROSS_PAY="1000", PAY_DATE=_day(-10)), c(PR, USERID="u2", GROSS_PAY="0", PAY_DATE=_day(-10))]}),
    "PAY159": ("payroll_integration", {"POSITION": [c(PO, VACANT="true")], "EMPEMPLOYMENT": [EE, c(EE, USERID="u2", PERSON_ID="p2")],
                                       "PAYMENTINFO": [c(PI, ACCOUNT_NUMBER="1", IBAN=None), c(PI, USERID="u2", ACCOUNT_NUMBER=None, IBAN=None)]}),
    "PAY160": ("payroll_integration", {"PERINFO": [c(FE, NATIONAL_ID_COUNTRY="ARG", NATIONAL_ID="1111111111"),
                                                   c(FE, PERSON_ID="p2", NATIONAL_ID_COUNTRY="ARG", NATIONAL_ID="11111111111")]}),
    "PAY166": ("payroll_integration", {"PERINFO": [c(FE, NATIONAL_ID_COUNTRY="CAN", NATIONAL_ID="11111111"),
                                                   c(FE, PERSON_ID="p2", NATIONAL_ID_COUNTRY="CAN", NATIONAL_ID="111111111")]}),
    "PAY171": ("payroll_integration", {"PERINFO": [c(FE, NATIONAL_ID_COUNTRY="DEU", NATIONAL_ID="1111111111"),
                                                   c(FE, PERSON_ID="p2", NATIONAL_ID_COUNTRY="DEU", NATIONAL_ID="11111111111")]}),
    "PAY176": ("payroll_integration", {"PERINFO": [c(FE, NATIONAL_ID_COUNTRY="GBR", NATIONAL_ID="AA111111"),
                                                   c(FE, PERSON_ID="p2", NATIONAL_ID_COUNTRY="GBR", NATIONAL_ID="AA111111A")]}),
    "PAY182": ("payroll_integration", {"PERINFO": [c(FE, NATIONAL_ID_COUNTRY="IND", NATIONAL_ID="AAAAA1111"),
                                                   c(FE, PERSON_ID="p2", NATIONAL_ID_COUNTRY="IND", NATIONAL_ID="AAAAA1111A")]}),
    "PAY187": ("payroll_integration", {"PERINFO": [c(FE, NATIONAL_ID_COUNTRY="MEX", NATIONAL_ID="AAAAAAAAAAAAAAAAA"),
                                                   c(FE, PERSON_ID="p2", NATIONAL_ID_COUNTRY="MEX", NATIONAL_ID="AAAAAAAAAAAAAAAAAA")]}),
    "PAY194": ("payroll_integration", {"PERINFO": [c(FE, NATIONAL_ID_COUNTRY="POL", NATIONAL_ID="1111111111"),
                                                   c(FE, PERSON_ID="p2", NATIONAL_ID_COUNTRY="POL", NATIONAL_ID="11111111111")]}),
    "PAY198": ("payroll_integration", {"PERINFO": [c(FE, NATIONAL_ID_COUNTRY="SGP", NATIONAL_ID="A1111111"),
                                                   c(FE, PERSON_ID="p2", NATIONAL_ID_COUNTRY="SGP", NATIONAL_ID="A1111111A")]}),
    "PAY201": ("payroll_integration", {"PERINFO": [c(FE, NATIONAL_ID_COUNTRY="USA", NATIONAL_ID="11111111"),
                                                   c(FE, PERSON_ID="p2", NATIONAL_ID_COUNTRY="USA", NATIONAL_ID="111111111")]}),
    "PAY203": ("payroll_integration", {"PERINFO": [c(FE, NATIONAL_ID_COUNTRY="ZAF", NATIONAL_ID="111111111111"),
                                                   c(FE, PERSON_ID="p2", NATIONAL_ID_COUNTRY="ZAF", NATIONAL_ID="1111111111111")]}),
    # Hand-written alpha-3 fixtures (Round 2): applies_when used to gate on the alpha-2
    # literal "NO", which never matches a dictionary-typed BANK_COUNTRY/NATIONAL_ID_COUNTRY
    # value (always alpha-3) and so never applied to any row. A regression back to the
    # alpha-2 literal makes both of these fixtures fail (the dirty row no longer fires).
    "PAY082": ("payroll_integration", {"PAYMENTINFO": [c(PI, BANK_COUNTRY="NOR", IBAN="DE89370400440532013000"),
                                                        c(PI, BANK_COUNTRY="NOR", IBAN="NO9386011117947")]}),
    "PAY191": ("payroll_integration", {"PERINFO": [c(FE, NATIONAL_ID_COUNTRY="NOR", NATIONAL_ID="ABC"),
                                                   c(FE, PERSON_ID="p2", NATIONAL_ID_COUNTRY="NOR", NATIONAL_ID="01129955131")]}),
    "PAY204": ("payroll_integration", {"PAYRESULT": [c(PR, NET_PAY="-50"), c(PR, NET_PAY="800")]}),
    "PAY205": ("payroll_integration", {"PAYRESULT": [c(PR, GROSS_PAY="1000", NET_PAY="800", TAX_AMOUNT="150", DEDUCTIONS="100"),
                                                      c(PR, GROSS_PAY="1000", NET_PAY="800", TAX_AMOUNT="150", DEDUCTIONS="50")]}),
    # Dirty: two non-split (PERCENT/AMOUNT blank) records for the same employee/pay
    # type/effective date. Clean: a legitimate split payment (both rows carry a
    # PERCENT share) for the same employee/pay type/effective date — the applies_when
    # filter removes these from the population entirely, so they must not be counted
    # or flagged. A regression dropping applies_when makes total/affected (4, 4).
    "PAY207": ("payroll_integration", {"PAYMENTINFO": [c(PI, PERCENT=None, AMOUNT=None),
                                                        c(PI, PERCENT=None, AMOUNT=None),
                                                        c(PI, PERCENT="50", AMOUNT=None),
                                                        c(PI, PERCENT="50", AMOUNT=None)]}, (2, 2)),
    "PAY216": ("payroll_integration", {"PAYMENTINFO": [c(PI, BIC="DEUTFRFF500", BANK_COUNTRY="DEU"),
                                                        c(PI, BIC="DEUTDEFF500", BANK_COUNTRY="DEU")]}),
    # Round 2 additions: PAY212/PAY215 had no hand-written fixtures (generic proof harness
    # only); PAY217/PAY218/PAY219 are new rules. Each pair is designed so a wrong
    # implementation fails the test (ruling #11).
    "PAY212": ("payroll_integration", {"PAYRESULT": [c(PR, USERID="u1"), c(PR, USERID="u9")],
                                       "EMPJOBHIST": [{"USERID": "u1"}]}),
    "PAY215": ("payroll_integration", {"PAYRESULT": [c(PR, DELTA_FLAG="X", PAY_DATE=_day(-10)),
                                                      c(PR, USERID="u2", DELTA_FLAG="X", PAY_DATE=_day(10))]}),
    "PAY217": ("payroll_integration", {"PAYRESULT": [c(PR, USERID="u1", PAY_DATE="20190101"),
                                                      c(PR, USERID="u2", PAY_DATE="20250925")],
                                       "EMPEMPLOYMENT": [c(EE, USERID="u1", START_DATE="20200101"),
                                                         c(EE, USERID="u2", START_DATE="20200101")]}),
    "PAY218": ("payroll_integration", {"PAYRESULT": [c(PR, USERID="u1", PAY_DATE=_day(0)),
                                                      c(PR, USERID="u2", PAY_DATE=_day(0))],
                                       "EMPEMPLOYMENT": [c(EE, USERID="u1", END_DATE=_day(200)),
                                                         c(EE, USERID="u2", END_DATE=_day(30))]}),
    "PAY219": ("payroll_integration", {"PAYRESULT": [c(PR, USERID="u1", COMPANY="ACME"),
                                                      c(PR, USERID="u2", COMPANY="FAKE")],
                                       "FOCOMPANY": [FC]}),
}


def test_enough_fixtures():
    assert len(CASES) >= 30


@pytest.mark.parametrize("rule_id", list(CASES))
def test_rule_flags_dirty_and_passes_clean(rule_id):
    case = CASES[rule_id]
    expected = case[2] if len(case) > 2 else (2, 1)
    assert run(case[0], rule_id, case[1]) == expected
