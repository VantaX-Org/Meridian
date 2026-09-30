"""Wrong-field values, placeholders, swaps, dead-in-text records; active population."""

import pandas as pd
import pytest

from checks.frames import TableFrames
from checks.runner import run_checks, run_rule
from checks.value_placement import DETECTORS, generate, is_placeholder
from sap.ddic import get_dictionary

D = get_dictionary("ecc6")


def hits(detector: str, values: list[str]) -> list[bool]:
    return DETECTORS[detector](pd.Series(values, dtype="string")).tolist()


@pytest.mark.parametrize("detector,yes,no", [
    ("email", ["ap@acme.co.za", "Accounts: ap@acme.com"], ["Design@Home", "ACME (Pty) Ltd", "a@b"]),
    ("iban", ["DE89370400440532013000", "GB82 WEST 1234 5698 7654 32", "Acme NL91ABNA0417164300"],
     ["DE89370400440532013001", "ZA1234567890123", "ACME"]),                 # bad checksum, no ZA IBAN
    ("phone", ["0115551234", "+27 11 555 1234", "(011) 555-1234"],
     ["3M South Africa", "7-Eleven", "2001/012345/07", "12345678"]),           # reg. no. has '/', 8 digits too few
    ("phone_keyword", ["Acme Tel: 011 555 1234", "fax 0115551234"], ["Telkom SA", "Phoenix Ltd"]),
    ("po_box", ["PO Box 1234", "P.O. Box 55", "Private Bag X12", "Postfach 10 20"], ["Boxer Superstores", "Post Office Rd"]),
    ("date", ["2021-02-28", "31.12.2020"], ["2021-02-30", "12.34.2020", "2021"]),
    ("care_of_primary", ["c/o Smith Holdings"], ["Coca-Cola", "Smith c/o"]),
    ("url", ["www.acme.com", "https://acme.co.za/x"], ["acme.com", "WWW Holdings"]),
])
def test_detectors_are_precise(detector, yes, no):
    assert all(hits(detector, yes)), detector
    assert not any(hits(detector, no)), detector


def test_placeholders_by_kind():
    s = pd.Series(["N/A", "TBA", "xxx", "-", "0000000000", "1234567890", "Real Name", "0001"], dtype="string")
    assert is_placeholder(s, "phone").tolist() == [True, True, True, True, True, True, False, False]
    assert is_placeholder(pd.Series(["0001", "9999", "N/A", "none"], dtype="string"), "postcode").tolist() == \
        [False, False, True, True]                                            # numeric postcodes are plausible
    assert is_placeholder(pd.Series(["noemail@acme.com", "ap@acme.com"], dtype="string"), "email").tolist() == \
        [True, False]


def _frames():
    lfa1 = pd.DataFrame({
        "LFA1.LIFNR": ["1", "2", "3", "4", "5", "6"],
        "LFA1.NAME1": ["Acme", "DO NOT USE - Beta", "ZZ-Old Gamma", "Delta", "One-time vendor", "Eps DUPLICATE"],
        "LFA1.NAME2": ["ap@acme.co.za", "", "", "PO Box 12", "", ""],
        "LFA1.STRAS": ["1 Main Rd", "2 Side St", "", "", "", "N/A"],
        "LFA1.ORT01": ["Johannesburg 2196", "Pretoria", "Durban", "2196", "", "Cape Town"],
        "LFA1.PSTLZ": ["", "0001", "4001", "JOHANNESBURG", "", "8001"],
        "LFA1.TELF1": ["0115551234", "N/A", "", "", "", ""],
        "LFA1.KTOKK": ["KRED"] * 6,
        "LFA1.SPERR": ["", "", "X", "", "", ""],
        "LFA1.SPERM": [""] * 6,
        "LFA1.LOEVM": ["", "", "", "", "", "X"],
        "LFA1.XCPDK": ["", "", "", "", "X", ""],
    })
    lfb1 = pd.DataFrame({"LFB1.LIFNR": ["1", "6"], "LFB1.BUKRS": ["1000", "1000"], "LFB1.ZTERM": ["", ""],
                         "LFB1.LOEVM": ["", ""]})
    return TableFrames({"LFA1": lfa1, "LFB1": lfb1}, D, module="accounts_payable")


def _rules():
    return {r["id"]: r for r in generate("accounts_payable", [{"field": "LFA1.LIFNR", "check_class": "null_check"},
                                                               {"field": "LFB1.ZTERM", "check_class": "null_check"}], D)}


def test_misplaced_values_name_the_right_field():
    _, r = run_rule(_rules()["VP-LFA1-NAME2"], _frames())
    assert r.failing_record_keys == ["LIFNR=1", "LIFNR=4"]
    assert r.details["detected"] == {"email": 1, "po_box": 1} and "SMTP_ADDR" in r.details["belongs_in"]["email"]


def test_postcode_city_swaps_and_merges():
    _, r = run_rule(_rules()["SW-LFA1-PSTLZ-ORT01"], _frames())
    assert r.failing_record_keys == ["LIFNR=1", "LIFNR=4"]  # "Johannesburg 2196"; city/postcode swapped


def test_dead_in_text_but_not_blocked():
    _, r = run_rule(_rules()["ST-LFA1"], _frames())
    # 2 marked & unblocked → finding; 3 marked & blocked → consistent; 6 deleted → out of population
    assert r.failing_record_keys == ["LIFNR=2"] and r.total_count == 5
    assert r.details["population_excluded"] == {"deleted": 1}


def test_placeholder_is_missing_data():
    _, r = run_rule(_rules()["PH-LFA1-TELF1"], _frames())
    assert r.failing_record_keys == ["LIFNR=2"]


def test_one_time_accounts_only_leave_address_rules():
    f = _frames()
    _, street = run_rule({"id": "X1", "field": "LFA1.STRAS", "check_class": "null_check", "module": "accounts_payable"}, f)
    assert "LIFNR=5" not in street.failing_record_keys
    assert street.details["population_excluded"] == {"one_time_account": 1, "deleted": 1}
    _, name = run_rule({"id": "X2", "field": "LFA1.KTOKK", "check_class": "null_check", "module": "accounts_payable"}, f)
    assert name.total_count == 5 and name.details["population_excluded"] == {"deleted": 1}


def test_central_deletion_flag_cascades_and_own_flag_is_not_filtered():
    f = _frames()
    _, zterm = run_rule({"id": "X3", "field": "LFB1.ZTERM", "check_class": "null_check", "module": "accounts_payable"}, f)
    assert zterm.failing_record_keys == ["LIFNR=1|BUKRS=1000"] and zterm.details["population_excluded"] == {"deleted": 1}
    _, flag = run_rule({"id": "X4", "field": "LFA1.LOEVM", "check_class": "domain_value_check",
                        "allowed_values": ["", "X"], "module": "accounts_payable"}, f)
    assert flag.total_count >= 1 and "population_excluded" not in flag.details
    _, all_ = run_rule({"id": "X5", "field": "LFA1.KTOKK", "check_class": "null_check", "population": "all",
                        "module": "accounts_payable"}, f)
    assert all_.total_count == 6


def test_fields_with_a_format_rule_get_no_duplicate_rule():
    rules = generate("accounts_payable", [{"field": "LFA1.TELF1", "check_class": "regex_check", "pattern": "x"}], D)
    assert not any(r["field"] == "LFA1.TELF1" for r in rules)


def test_module_run_includes_generated_rules():
    from checks.value_placement import generate as g
    import yaml
    from checks.runner import _find_module_yaml
    static = yaml.safe_load(_find_module_yaml("accounts_payable").read_text())["rules"]
    extra = g("accounts_payable", static, D)
    ids = {r.check_id for r in run_checks("accounts_payable", _frames(), "t", extra_rules=extra)}
    assert {"ST-LFA1", "SW-LFA1-PSTLZ-ORT01"} <= ids


def test_sap_number_formats():
    from checks.base import sap_number
    got = sap_number(pd.Series(["1234.50-", "1,234.50", "1.234,50", "12,5", "7", "", "x", "0.000", "1.000",
                                "1.234.567"])).tolist()
    assert got[:5] == [-1234.5, 1234.5, 1234.5, 12.5, 7.0] and pd.isna(got[5]) and pd.isna(got[6]) and got[7] == 0
    assert got[8] == 1.0 and got[9] == 1234567  # RFC QUAN "1.000" is one, not a thousand


def test_uploads_are_brought_to_internal_format():
    from checks.frames import TableFrames
    f = TableFrames.from_flat(pd.DataFrame({"LFB1.LIFNR": ["100001"], "LFB1.BUKRS": ["1000"], "LFB1.AKONT": ["140000"],
                                            "MARA.MATNR": ["4711"], "LFA1.LIFNR": ["ABC"]}), D)
    assert f.frames["LFB1"]["LFB1.AKONT"].iloc[0] == "0000140000"
    assert f.frames["LFB1"]["LFB1.LIFNR"].iloc[0] == "0000100001"
    assert f.flat["MARA.MATNR"].iloc[0] == "000000000000004711" and f.flat["LFA1.LIFNR"].iloc[0] == "ABC"


def test_fi_document_balance():
    import yaml
    from checks.runner import _find_module_yaml
    rule = next(r for r in yaml.safe_load(_find_module_yaml("fi_gl").read_text())["rules"] if r["id"] == "XFI001")
    bkpf = pd.DataFrame({"BKPF.BUKRS": ["1000"] * 3, "BKPF.BELNR": ["1", "2", "3"], "BKPF.GJAHR": ["2026"] * 3,
                         "BKPF.BSTAT": ["", "", "S"]})
    bseg = pd.DataFrame({"BSEG.BUKRS": ["1000"] * 5, "BSEG.BELNR": ["1", "1", "2", "2", "3"], "BSEG.GJAHR": ["2026"] * 5,
                         "BSEG.BUZEI": ["001", "002", "001", "002", "001"],
                         "BSEG.DMBTR": ["1234.50", "1234.50", "100.00", "99.00", "50.00"],
                         "BSEG.SHKZG": ["S", "H", "S", "H", "S"]})
    _, r = run_rule({**rule, "module": "fi_gl"}, TableFrames({"BKPF": bkpf, "BSEG": bseg}, D, module="fi_gl"))
    # doc 1 balances, doc 2 is off by 1.00, doc 3 is a noted item (no posting)
    assert (r.total_count, r.affected_count) == (2, 1) and r.failing_record_keys == ["BUKRS=1000|BELNR=2|GJAHR=2026|BUZEI=001"]
    assert r.details["largest_imbalance"] == 1.0


def test_upload_external_codes_become_internal_through_the_systems_tables():
    from checks.frames import TableFrames
    from sap.field_status_config import conversion_maps
    maps = conversion_maps({
        "T006A": [{"SPRAS": "E", "MSEHI": "ST", "MSEH3": "PC"}, {"SPRAS": "D", "MSEHI": "ST", "MSEH3": "ST"},
                  {"SPRAS": "E", "MSEHI": "KG", "MSEH3": "KG"}],
        "TAUUM": [{"SPRAS": "E", "AUART": "TA", "AUART_SPR": "OR"}],
    })
    assert maps == {"CUNIT": {"PC": "ST"}, "AUART": {"OR": "TA"}}
    f = TableFrames.from_flat(pd.DataFrame({"MARA.MATNR": ["1", "2"], "MARA.MEINS": ["PC", "KG"],
                                            "VBAK.VBELN": ["1", "2"], "VBAK.AUART": ["OR", "ZOR"]}), D, conversions=maps)
    assert f.flat["MARA.MEINS"].tolist() == ["ST", "KG"] and f.flat["VBAK.AUART"].tolist() == ["TA", "ZOR"]
