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
    # open items (BSIK) in company code 1000 (local currency ZAR)
    #   clean:  V1 invoices (2%/14, net 30 and 3%/10, 2%/20, net 30), a payment-blocked invoice (block A),
    #           a credit memo carrying the reference and amount of the invoice it credits (SHKZG S: not a
    #           duplicate invoice), a down payment (special G/L A on its own reconciliation account 160100) and a
    #           down-payment request (noted item, F / BSTAT S); V2 a EUR invoice translated into ZAR
    #   seeded: one defect each (see the expected findings in the test)
    def item(lifnr, belnr, xblnr, shkzg, dmbtr, wrbtr, waers="ZAR", budat="20260904", zfbdt="20260904",
             days=("14", "30", "0"), zterm="ZB14", umskz="", bstat="", hkont="0000160000", zlspr="",
             augdt="00000000", augbl="", blart="RE", buzei="001") -> dict:
        return {"BUKRS": "1000", "LIFNR": lifnr, "UMSKS": "", "UMSKZ": umskz, "AUGDT": augdt, "AUGBL": augbl,
                "ZUONR": xblnr, "GJAHR": "2026", "BELNR": belnr, "BUZEI": buzei, "BUDAT": budat, "BLDAT": budat,
                "WAERS": waers, "XBLNR": xblnr, "BLART": blart, "SHKZG": shkzg, "DMBTR": dmbtr, "WRBTR": wrbtr,
                "HKONT": hkont, "ZFBDT": zfbdt, "ZTERM": zterm, "ZBD1T": days[0], "ZBD2T": days[1],
                "ZBD3T": days[2], "ZLSPR": zlspr, "BSTAT": bstat}
    bsik = pd.DataFrame([{f"BSIK.{k}": x for k, x in r.items()} for r in [
        item("V1", "5100000101", "SI-77810", "H", "11500.00", "11500.00"),
        item("V1", "5100000102", "SI-77904", "H", "4600.00", "4600.00", days=("10", "20", "30"), zterm="ZB10"),
        item("V1", "5100000103", "SI-77955", "H", "2875.00", "2875.00", zlspr="A"),   # blocked: price query
        # credit memo for the whole of SI-77810, same reference and amount: both open until cleared together
        item("V1", "5100000104", "SI-77810", "S", "11500.00", "11500.00", blart="KG"),
        item("V1", "1700000011", "DP-2026-04", "S", "25000.00", "25000.00", umskz="A", hkont="0000160100",
             blart="KA", days=("0", "0", "0"), zterm=""),
        item("V1", "1700000012", "DP-2026-05", "S", "40000.00", "40000.00", umskz="F", bstat="S",
             hkont="0000160100", blart="KA", days=("0", "0", "0"), zterm=""),
        item("V2", "5100000105", "RE-2026-0815", "H", "47600.00", "2380.00", waers="EUR"),
        # seeded defects
        item("V1", "5100000110", "SI-78001", "H", "3450.00", "3450.00", augdt="20260915",
             augbl="1500000220"),                                                      # AP072
        item("V2", "5100000111", "RE-2026-0902", "H", "0.00", "1190.00", waers="EUR"),  # AP073
        item("V1", "5100000112", "SI-78007", "H", "6900.00", "6900.00", hkont="0000160090"),  # AP074
        item("V6", "5100000113", "TX-55120", "H", "1840.00", "1840.00"),               # AP075: vendor deleted
        item("V1", "5100000114", "SI-78011", "H", "2300.00", "2300.00", zfbdt="00000000"),  # AP076
        item("V1", "5100000115", "SI-78013", "H", "920.00-", "920.00-"),                # AP077
        item("V1", "5100000116", "SI-78019", "H", "5750.00", "5750.00", days=("30", "14", "0")),  # AP078
        item("V1", "5100000117", "SI-78023", "H", "1380.00", "1380.00", zlspr="Z"),     # AP079
        item("V1", "1700000013", "BG-2026-01", "S", "15000.00", "15000.00", umskz="Q", hkont="0000160100",
             blart="KA", days=("0", "0", "0"), zterm=""),                              # AP080
        item("V2", "5100000118", "INV-1001", "H", "47600.00", "2380.00", waers="EUR"),  # AP083
        item("V2", "5100000119", "INV1001", "H", "47600.00", "2380.00", waers="EUR"),   # AP083
    ]])
    # cleared items (BSAK): invoices cleared by payment run documents, the payments themselves
    def cleared(lifnr, belnr, budat, augdt, augbl, shkzg="H", blart="RE") -> dict:
        return {"BSAK.BUKRS": "1000", "BSAK.LIFNR": lifnr, "BSAK.UMSKS": "", "BSAK.UMSKZ": "",
                "BSAK.AUGDT": augdt, "BSAK.AUGBL": augbl, "BSAK.ZUONR": "", "BSAK.GJAHR": "2026",
                "BSAK.BELNR": belnr, "BSAK.BUZEI": "001", "BSAK.BUDAT": budat, "BSAK.BLDAT": budat,
                "BSAK.WAERS": "ZAR", "BSAK.SHKZG": shkzg, "BSAK.BLART": blart, "BSAK.DMBTR": "8050.00",
                "BSAK.WRBTR": "8050.00"}
    bsak = pd.DataFrame([
        cleared("V1", "5100000090", "20260803", "20260902", "1500000210"),
        cleared("V1", "1500000210", "20260902", "20260902", "1500000210", shkzg="S", blart="KZ"),  # payment
        cleared("V2", "5100000091", "20260810", "20260810", "5100000092"),  # cleared by a credit memo same day
        cleared("V2", "5100000092", "20260810", "20260810", "5100000092", shkzg="S", blart="KG"),
        # seeded defects
        cleared("V1", "5100000093", "20260820", "20260818", "1500000211"),        # AP081: cleared before posting
        cleared("V1", "5100000094", "20260821", "00000000", ""),                  # AP082: no clearing reference
    ])
    return TableFrames({"LFA1": lfa1, "LFB1": lfb1, "LFBK": lfbk, "LFB5": lfb5, "ADR6": adr6, "SKB1": skb1,
                        "LFM1": lfm1, "BSIK": bsik, "BSAK": bsak}, D, module="accounts_payable")


def _live_config(rules) -> dict[str, set[str]]:
    """The system's own check tables, as discovery would read them."""
    values = {"KTOKK": {"KRED", "CPD"}, "ZTERM": {"0001"}, "ZWELS": {"C", "T"}, "MAHNA": {"0001"},
              "WAERS": {"ZAR", "EUR", "USD"}, "INCO1": {"EXW", "FCA", "CIP", "DAP"}, "EKORG": {"1000"},
              "EKGRP": {"001", "002"}, "KALSK": {"01"}, "BUKRS": {"1000"}, "LAND1": {"ZA", "DE"},
              "BANKS": {"ZA", "DE"}, "ZAHLS": {"*", "A", "B", "R", "V"}, "ZLSPR": {"*", "A", "B", "R", "V"},  # T008
              "UMSKZ": {"A", "F", "I", "P", "W"}, "REGIO": {"GP", "WC"}}                         # T074U (vendors)
    out = {}
    for r in rules:
        if r.get("check_class") in ("referential_check", "domain_value_check") and r["field"].split(".")[1] in values:
            key = _with_reference(r, D, {}).get("_reference_key")
            if key:
                out[key] = values[r["field"].split(".")[1]]
    return out


def _open(lifnr: str, belnr: str, zuonr: str, augdt: str = "00000000", augbl: str = "", umskz: str = "") -> str:
    """BSIK key: company code, vendor, special G/L, clearing, assignment, document, line."""
    return (f"BUKRS=1000|LIFNR={lifnr}|UMSKS=|UMSKZ={umskz}|AUGDT={augdt}|AUGBL={augbl}|ZUONR={zuonr}"
            f"|GJAHR=2026|BELNR={belnr}|BUZEI=001")


def _cleared(lifnr: str, belnr: str, augdt: str, augbl: str) -> str:
    return f"BUKRS=1000|LIFNR={lifnr}|UMSKS=|UMSKZ=|AUGDT={augdt}|AUGBL={augbl}|ZUONR=|GJAHR=2026|BELNR={belnr}|BUZEI=001"


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
        "AP072": {_open("V1", "5100000110", "SI-78001", augdt="20260915", augbl="1500000220")},  # open, yet cleared
        "AP073": {_open("V2", "5100000111", "RE-2026-0902")},     # EUR 1 190.00 translated to ZAR 0.00
        "AP074": {_open("V1", "5100000112", "SI-78007")},         # still on the old reconciliation account
        "AP075": {_open("V6", "5100000113", "TX-55120")},         # open item on a vendor flagged for deletion
        "AP076": {_open("V1", "5100000114", "SI-78011")},         # no baseline date for payment
        "AP077": {_open("V1", "5100000115", "SI-78013")},         # amount stored negative (RFC "920.00-")
        "AP078": {_open("V1", "5100000116", "SI-78019")},         # discount days 30, then 14
        "AP079": {_open("V1", "5100000117", "SI-78023")},         # payment block Z is not in T008
        "AP080": {_open("V1", "1700000013", "BG-2026-01", umskz="Q")},  # special G/L Q is not in T074U
        "AP081": {_cleared("V1", "5100000093", "20260818", "1500000211")},  # cleared two days before posting
        "AP082": {_cleared("V1", "5100000094", "00000000", "")},  # cleared item without a clearing reference
        # 'INV-1001' and 'INV1001': one EUR 2 380.00 invoice entered twice; the credit memo on SI-77810
        # (same reference and amount as its invoice, SHKZG S) is no duplicate invoice
        "AP083": {_open("V2", "5100000118", "INV-1001"), _open("V2", "5100000119", "INV1001")},
        "AP202": {"LIFNR=V2"},                                    # bank details expired at the end of 2024
        # the two INV-1001 lines and RE-2026-0815: same vendor, amount, currency and baseline date
        "AP209": {_open("V2", "5100000118", "INV-1001"), _open("V2", "5100000119", "INV1001"),
                  _open("V2", "5100000105", "RE-2026-0815")},
        # V6 is flagged for deletion centrally but carries no posting or purchasing block, and its
        # company code and purchasing organisation views are not flagged
        "AP221": {"LIFNR=V6"},
        "AP253": {"LIFNR=V6|BUKRS=1000"},
        "AP261": {"LIFNR=V6|EKORG=1000"},
    }, found
    # V6 is flagged for deletion and V7 is a one-time account: out of the population, counted
    name = next(r for r in results if r.check_id == "AP003")
    assert name.details["population_excluded"] == {"deleted": 1}
    tax = next(r for r in results if r.check_id == "AP007")
    assert tax.details["population_excluded"] == {"deleted": 1, "one_time_account": 1}
    currency = next(r for r in results if r.check_id == "AP040")  # V6's purchasing data: central deletion flag
    assert currency.details["population_excluded"] == {"deleted": 1}
    # only invoices (SHKZG H) without a special G/L indicator are compared for duplicates: 14 of 18 open items
    duplicate = next(r for r in results if r.check_id == "AP083")
    assert duplicate.total_count == 14
    # down payments and down-payment requests sit on their own reconciliation account by design
    recon = next(r for r in results if r.check_id == "AP074")
    assert recon.total_count == 15


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
