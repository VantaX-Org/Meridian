"""Golden dataset: the whole accounts-payable pipeline (shipped + generated rules,
active population, joins, live configuration) on vendors whose correct findings
are known. Clean vendors must produce no finding at all — any failure on them
is a false positive; each seeded defect must be found exactly where it was put."""

import pandas as pd
import yaml

from checks.frames import TableFrames
from checks.runner import _find_module_yaml, _with_reference, run_checks
from checks.value_placement import generate
from sap.ddic import get_dictionary

D = get_dictionary("ecc6")


def _frames() -> TableFrames:
    v = ["V1", "V2", "V3", "V4", "V5", "V6", "V7"]
    lfa1 = pd.DataFrame({
        "LFA1.LIFNR": v,
        "LFA1.NAME1": ["Acme Pumps (Pty) Ltd", "Müller Hydraulik GmbH", "Gamma Steel", "Delta Supplies", "Epsilon Parts",
                       "", "One-time vendor"],
        "LFA1.NAME2": ["", "", "ap@gamma.co.za", "", "", "", ""],
        "LFA1.STRAS": ["12 Main Rd", "Industriestr. 4", "3 Mill St", "4 Dock Rd", "5 Rail Rd", "", ""],
        "LFA1.ORT01": ["Johannesburg", "Stuttgart", "Durban", "Cape Town", "Pretoria", "", ""],
        "LFA1.PSTLZ": ["2196", "70173", "4001", "8001", "0002", "", ""],
        "LFA1.LAND1": ["ZA", "DE", "ZA", "ZA", "ZA", "ZA", "ZA"],
        "LFA1.KTOKK": ["KRED", "KRED", "KRED", "KRED", "KRED", "KRED", "CPD"],
        "LFA1.STCD1": ["9012345678", "", "9076543210", "9011111111", "9022222222", "", ""],
        "LFA1.STCEG": ["", "DE136695976", "", "", "", "", ""],
        "LFA1.TELF1": ["0115551234", "+49 711 123456", "0315551234", "0215551234", "0125551234", "", ""],
        "LFA1.ERDAT": ["20200115", "20190301", "20210610", "20220202", "20220203", "20100101", "20180101"],
        "LFA1.ADRNR": ["A1", "A2", "A3", "A4", "A5", "A6", "A7"],
        "LFA1.LOEVM": ["", "", "", "", "", "X", ""],
        "LFA1.SPERR": [""] * 7, "LFA1.SPERM": [""] * 7,
        "LFA1.XCPDK": ["", "", "", "", "", "", "X"],
        "LFA1.KUNNR": [""] * 7, "LFA1.LNRZA": [""] * 7,
        "LFA1.SPRAS": ["E", "D", "E", "E", "E", "E", "E"],
    })
    lfb1 = pd.DataFrame({
        "LFB1.LIFNR": v, "LFB1.BUKRS": ["1000"] * 7,
        "LFB1.AKONT": ["0000160000", "0000160000", "0000113100", "0000160000", "0000160000", "0000160000", "0000160000"],
        "LFB1.FDGRV": ["A1"] * 7, "LFB1.ZTERM": ["0001", "0001", "", "0001", "0001", "0001", "0001"],
        "LFB1.ZWELS": ["T", "T", "T", "T", "T", "T", "C"], "LFB1.REPRF": ["X"] * 7, "LFB1.XPORE": [""] * 7,
        "LFB1.LOEVM": [""] * 7, "LFB1.SPERR": [""] * 7, "LFB1.ZAHLS": [""] * 7, "LFB1.LNRZE": [""] * 7,
        "LFB1.LNRZB": [""] * 7,
        "LFB1.XVERR": ["", "", "", "", "X", "", ""],   # V5: clearing with customer, but no customer linked
    })
    lfbk = pd.DataFrame({  # V4 and V5 are paid into one account
        "LFBK.LIFNR": ["V1", "V2", "V3", "V4", "V5", "V6"], "LFBK.BANKS": ["ZA", "DE", "ZA", "ZA", "ZA", "ZA"],
        "LFBK.BANKL": ["250655", "60050101", "198765", "632005", "632005", "250655"],
        "LFBK.BANKN": ["62000000001", "0532013000", "1009988776", "4055555555", "4055555555", "62000000099"],
        # V2's bank details end before they start
        "LFBK.KOVON": ["20200101", "20250101", "20200101", "20200101", "20200101", "20200101"],
        "LFBK.KOBIS": ["99991231", "20241231", "99991231", "99991231", "99991231", "99991231"],
    })
    lfb5 = pd.DataFrame({"LFB5.LIFNR": v, "LFB5.BUKRS": ["1000"] * 7, "LFB5.MABER": [""] * 7, "LFB5.MAHNA": ["0001"] * 7})
    adr6 = pd.DataFrame({"ADR6.ADDRNUMBER": ["A1", "A2", "A3", "A4", "A5", "A6", "A7"], "ADR6.PERSNUMBER": [""] * 7,
                         "ADR6.CONSNUMBER": ["001"] * 7,
                         "ADR6.SMTP_ADDR": ["ap@acme.co.za", "rechnung@mueller.de", "ap@gamma.co.za", "ap@delta.co.za",
                                            "ap@epsilon.co.za", "", ""]})
    skb1 = pd.DataFrame({"SKB1.BUKRS": ["1000", "1000"], "SKB1.SAKNR": ["0000160000", "0000113100"],
                         "SKB1.MITKZ": ["K", ""], "SKB1.XSPEB": ["", "X"], "SKB1.XLOEB": ["", ""]})
    # purchasing data in purchasing organisation 1000 (V6's is covered by its central deletion flag)
    lfm1 = pd.DataFrame({
        "LFM1.LIFNR": v, "LFM1.EKORG": ["1000"] * 7,
        "LFM1.WAERS": ["ZAR", "EUR", "ZAR", "", "ZAR", "", "ZAR"],          # V4: no order currency
        "LFM1.ZTERM": ["0001", "0001", "0001", "0001", "9999", "0001", "0001"],  # V5: terms not in T052
        "LFM1.INCO1": ["FCA", "CIP", "", "FCA", "FCA", "FCA", "EXW"],      # V3: place without Incoterm
        "LFM1.INCO2": ["Johannesburg", "Stuttgart", "Durban", "Cape Town", "Pretoria", "Durban", "Durban"],
        "LFM1.EKGRP": ["001"] * 7, "LFM1.KALSK": ["01"] * 7, "LFM1.SPERM": [""] * 7, "LFM1.LOEVM": [""] * 7,
        "LFM1.WEBRE": ["X"] * 7, "LFM1.XERSY": [""] * 7,
    })
    return TableFrames({"LFA1": lfa1, "LFB1": lfb1, "LFBK": lfbk, "LFB5": lfb5, "ADR6": adr6, "SKB1": skb1,
                        "LFM1": lfm1}, D, module="accounts_payable")


def _live_config(rules) -> dict[str, set[str]]:
    """The system's own check tables, as discovery would read them."""
    values = {"KTOKK": {"KRED", "CPD"}, "ZTERM": {"0001"}, "ZWELS": {"C", "T"}, "MAHNA": {"0001"},
              "WAERS": {"ZAR", "EUR", "USD"}, "INCO1": {"EXW", "FCA", "CIP", "DAP"}, "EKORG": {"1000"},
              "EKGRP": {"001", "002"}, "KALSK": {"01"}, "BUKRS": {"1000"}, "LAND1": {"ZA", "DE"},
              "BANKS": {"ZA", "DE"}, "ZAHLS": {"A", "B"}, "REGIO": {"GP", "WC"}}
    out = {}
    for r in rules:
        if r.get("check_class") in ("referential_check", "domain_value_check") and r["field"].split(".")[1] in values:
            key = _with_reference(r, D, {}).get("_reference_key")
            if key:
                out[key] = values[r["field"].split(".")[1]]
    return out


def test_accounts_payable_golden():
    static = yaml.safe_load(_find_module_yaml("accounts_payable").read_text())["rules"]
    results = run_checks("accounts_payable", _frames(), "t", reference_values=_live_config(static),
                         extra_rules=generate("accounts_payable", static, D))
    errors = {r.check_id: r.error for r in results if r.error}
    assert not errors, errors
    found = {r.check_id: set(r.failing_record_keys or []) for r in results if r.affected_count}
    assert found == {
        "VP-LFA1-NAME2": {"LIFNR=V3"},                         # e-mail in the second name line
        "AP016": {"LIFNR=V3|BUKRS=1000"},                      # payment terms missing
        "XREC001": {"LIFNR=V3|BUKRS=1000"},                    # 113100 is not a vendor reconciliation account
        "XDUP003": {"LIFNR=V4|BANKS=ZA|BANKL=632005|BANKN=4055555555",
                    "LIFNR=V5|BANKS=ZA|BANKL=632005|BANKN=4055555555"},  # one account, two vendors
        "AP040": {"LIFNR=V4|EKORG=1000"},                      # purchasing data without order currency
        "AP042": {"LIFNR=V5|EKORG=1000"},                      # purchasing payment terms not in T052
        "AP044": {"LIFNR=V3|EKORG=1000"},                      # Incoterms location without an Incoterm
        "AP059": {"LIFNR=V5|BUKRS=1000"},                      # clearing with customer, no customer linked
        "AP063": {"LIFNR=V3|BUKRS=1000"},                      # reconciliation account blocked for posting
        "AP066": {"LIFNR=V2|BANKS=DE|BANKL=60050101|BANKN=0532013000"},  # bank details end before they start
    }, found
    # V6 is flagged for deletion and V7 is a one-time account: out of the population, counted
    name = next(r for r in results if r.check_id == "AP003")
    assert name.details["population_excluded"] == {"deleted": 1}
    tax = next(r for r in results if r.check_id == "AP007")
    assert tax.details["population_excluded"] == {"deleted": 1, "one_time_account": 1}
    currency = next(r for r in results if r.check_id == "AP040")  # V6's purchasing data: central deletion flag
    assert currency.details["population_excluded"] == {"deleted": 1}


def test_branch_accounts_share_their_head_offices_vat_number():
    """A branch account (LFB1.LNRZE = head office) legitimately carries the head office's
    VAT number; only accounts without a head office are compared, per company code."""
    from checks.runner import run_rule
    rule = next(r for r in yaml.safe_load(_find_module_yaml("accounts_payable").read_text())["rules"] if r["id"] == "XDUP001")
    lfa1 = pd.DataFrame({"LFA1.LIFNR": ["H1", "B1", "D1", "D2"],
                         "LFA1.STCEG": ["DE111111111", "DE111111111", "DE222222222", "DE222222222"]})
    lfb1 = pd.DataFrame({"LFB1.LIFNR": ["H1", "B1", "D1", "D2"], "LFB1.BUKRS": ["1000"] * 4,
                         "LFB1.LNRZE": ["", "H1", "", ""]})
    _, r = run_rule({**rule, "module": "accounts_payable"},
                    TableFrames({"LFA1": lfa1, "LFB1": lfb1}, D, module="accounts_payable"))
    assert sorted(r.failing_record_keys) == ["LIFNR=D1|BUKRS=1000", "LIFNR=D2|BUKRS=1000"]
