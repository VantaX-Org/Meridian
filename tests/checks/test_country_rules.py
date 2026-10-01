"""Rules from the system's own country settings (T005) and bank directory (BNKA)."""

import pandas as pd

from checks.country_rules import generate, violates
from checks.frames import TableFrames
from checks.runner import run_rule
from sap.ddic import get_dictionary

D = get_dictionary("ecc6")
CONFIG = {
    "T005": [
        {"LAND1": "ZA", "LNPLZ": "04", "PRPLZ": "4", "XPLZS": "X", "LNST1": "10", "PRST1": "4",
         "LNBKN": "11", "PRBKN": "2", "LNBLZ": "06", "PRBLZ": "4"},
        {"LAND1": "GB", "LNPLZ": "08", "PRPLZ": "5", "XPLZS": "X"},   # max 8, gaps allowed ('SW1A 1AA')
        {"LAND1": "HK", "LNPLZ": "00", "PRPLZ": "", "XPLZS": ""},    # no postal code system
        {"LAND1": "US", "LNPLZ": "10", "PRPLZ": "9", "XPLZS": "X"},   # country edit format: not replicated
    ],
    "BNKA": [{"BANKS": "ZA", "BANKL": "250655"}, {"BANKS": "ZA", "BANKL": "632005"}],
}


def test_sap_check_rules():
    assert not violates("2196", 4, "4") and violates("219", 4, "4") and violates("21 96", 4, "4")
    assert not violates("SW1A 1AA", 8, "5") and violates("SW1A 1AA X", 8, "5")
    assert violates("21A6", 4, "4") and not violates("1234567", 11, "2")


def _rules():
    static = [{"field": f, "check_class": "null_check"} for f in ("LFA1.LIFNR", "LFBK.BANKN")]
    return {r["id"]: r for r in generate("accounts_payable", static, CONFIG, D)}


def test_postal_code_format_and_requirement_per_country():
    lfa1 = pd.DataFrame({"LFA1.LIFNR": list("123456"), "LFA1.LAND1": ["ZA", "ZA", "GB", "HK", "US", "ZA"],
                         "LFA1.PSTLZ": ["2196", "219", "SW1A 1AA", "", "ABC", ""],
                         "LFA1.STRAS": ["1 Main", "2 Main", "10 Downing St", "1 Queen's Rd", "1 Elm", "3 Main"]})
    f = TableFrames({"LFA1": lfa1}, D, module="accounts_payable")
    rules = _rules()
    _, fmt = run_rule(rules["CF-LFA1-PSTLZ"], f)
    assert fmt.failing_record_keys == ["LIFNR=2"] and fmt.total_count == 3  # US uses an edit format: not judged
    _, req = run_rule(rules["CR-LFA1-PSTLZ"], f)
    assert req.failing_record_keys == ["LIFNR=6"]                            # HK has no postal codes


def test_bank_details_against_country_rules_and_bank_directory():
    lfbk = pd.DataFrame({"LFBK.LIFNR": ["1", "2", "3", "4"], "LFBK.BANKS": ["ZA", "ZA", "ZA", "DE"],
                         "LFBK.BANKL": ["250655", "999999", "632005", "10010010"],
                         "LFBK.BANKN": ["62000000001", "4055555555", "40-555", "0532013000"]})
    f = TableFrames({"LFBK": lfbk}, D, module="accounts_payable")
    rules = _rules()
    _, bk = run_rule(rules["BK-LFBK"], f)
    assert bk.failing_record_keys == ["LIFNR=2|BANKS=ZA|BANKL=999999|BANKN=4055555555"]  # DE: no directory loaded
    _, acct = run_rule(rules["CF-LFBK-BANKN"], f)
    assert acct.failing_record_keys == ["LIFNR=3|BANKS=ZA|BANKL=632005|BANKN=40-555"]


def test_nothing_without_the_systems_tables():
    assert generate("accounts_payable", [{"field": "LFA1.LIFNR", "check_class": "null_check"}], {}, D) == []


def test_postal_codes_against_the_customers_official_list():
    config = {"REF_POSTAL": [{"COUNTRY": "ZA", "POSTCODE": "2196"}, {"COUNTRY": "ZA", "POSTCODE": "0700"},
                             {"COUNTRY": "GB", "POSTCODE": "SW1A 1AA"}]}
    static = [{"field": "LFA1.LIFNR", "check_class": "null_check"}]
    rule = {r["id"]: r for r in generate("accounts_payable", static, config, D)}["PX-LFA1-PSTLZ"]
    lfa1 = pd.DataFrame({"LFA1.LIFNR": list("12345"), "LFA1.LAND1": ["ZA", "ZA", "GB", "DE", "ZA"],
                         "LFA1.PSTLZ": ["2196", "9999", "sw1a 1aa", "10115", ""]})
    _, r = run_rule(rule, TableFrames({"LFA1": lfa1}, D, module="accounts_payable"))
    # 9999 is not a South African postal code; lower case is the same code; DE has no list loaded
    assert r.failing_record_keys == ["LIFNR=2"] and r.total_count == 3
    assert r.details["reference"] == "REF_POSTAL"
