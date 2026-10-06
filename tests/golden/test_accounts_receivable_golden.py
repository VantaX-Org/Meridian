"""Golden dataset: the whole accounts-receivable pipeline (shipped + generated rules,
active population, joins, live configuration) on customers whose correct findings
are known. Clean customers must produce no finding at all — any failure on them
is a false positive; each seeded defect must be found exactly where it was put."""

import pandas as pd
import yaml

from checks.frames import TableFrames
from checks.runner import _find_module_yaml, _with_reference, run_checks
from checks.value_placement import generate
from sap.ddic import get_dictionary

D = get_dictionary("ecc6")

# Customers (KNA1.KUNNR, ALPHA internal format)
#   clean:  C1 ZA trade customer, C2 German customer (VAT number only), C3 Dutch customer,
#           C4 French customer, C5 ZA wine distributor (two company codes), C6 private customer
#           (natural person, not VAT-registered: no tax number exists), OT one-time account (CPD)
#   seeded: one defect each (see the expected findings in the test)
#   DEL:    flagged for deletion — would fail several rules, is out of the population
C1, C2, C3, C4, C5, C6, OT = ("0000100001", "0000100002", "0000100003", "0000100004", "0000100005", "0000100006",
                              "0000900001")
D_NAME2, D_ZTERM, D_AKONT, D_AUFSD, D_DUNN, D_TEL, D_SWAP, D_DNU, D_DUP1, D_DUP2 = (
    "0000100011", "0000100012", "0000100013", "0000100014", "0000100015", "0000100016", "0000100017",
    "0000100018", "0000100019", "0000100021")
DEL = "0000100020"

CUSTOMERS = [C1, C2, C3, C4, C5, C6, OT, D_NAME2, D_ZTERM, D_AKONT, D_AUFSD, D_DUNN, D_TEL, D_SWAP, D_DNU,
             D_DUP1, D_DUP2, DEL]


def _col(values: dict[str, str], default: str = "") -> list[str]:
    return [values.get(k, default) for k in CUSTOMERS]


def _frames() -> TableFrames:
    n = len(CUSTOMERS)
    adrnr = [f"{int(k) - 77000:010d}" for k in CUSTOMERS]  # central address numbers (ADRC)
    kna1 = pd.DataFrame({
        "KNA1.KUNNR": CUSTOMERS,
        "KNA1.NAME1": _col({
            C1: "Protea Engineering (Pty) Ltd", C2: "Brenner Maschinenbau GmbH",
            C3: "Van Dijk Installatietechniek B.V.", C4: "Société Lyonnaise de Robinetterie SAS",
            C5: "Kaap Wynverspreiders CC", C6: "Johan Pretorius", OT: "One-time customers ZA",
            D_NAME2: "Highveld Mining Supplies (Pty) Ltd", D_ZTERM: "Umgeni Paper Converters (Pty) Ltd",
            D_AKONT: "Karoo Agri Co-operative Ltd", D_AUFSD: "Limpopo Fresh Produce (Pty) Ltd",
            D_DUNN: "Bosveld Cold Storage (Pty) Ltd", D_TEL: "Garden Route Hardware CC",
            D_SWAP: "Natal Sugar Engineering (Pty) Ltd", D_DNU: "DO NOT USE - Coastal Pumps (Pty) Ltd",
            D_DUP1: "Rietfontein Bottling (Pty) Ltd", D_DUP2: "Rietfontein Bottling Pty Ltd",
            DEL: "Brenner Maschinenbau GmbH"}),
        "KNA1.NAME2": _col({C3: "Afdeling Projecten", D_NAME2: "Tel 011 452 7781"}),
        "KNA1.NAME3": [""] * n, "KNA1.NAME4": [""] * n,
        "KNA1.PSON1": [""] * n, "KNA1.PSON2": [""] * n, "KNA1.PSON3": [""] * n,
        "KNA1.STRAS": _col({
            C1: "14 Electron Avenue", C2: "Heilbronner Straße 150", C3: "Kanaalweg 21", C4: "18 Rue de la Villette",
            C5: "7 Dorp Street", C6: "23 Kerk Street", D_NAME2: "22 Reef Road", D_ZTERM: "3 Sydney Road",
            D_AKONT: "1 Voortrekker Road",
            D_AUFSD: "45 Hans van Rensburg Street", D_DUNN: "9 Bok Street", D_TEL: "61 Main Road",
            D_SWAP: "120 Point Road", D_DNU: "5 Marine Drive", D_DUP1: "2 Fabriek Street",
            D_DUP2: "2 Fabriek Street", DEL: "Heilbronner Straße 150"}),
        "KNA1.ORT01": _col({
            C1: "Isando", C2: "Stuttgart", C3: "Utrecht", C4: "Lyon", C5: "Stellenbosch", C6: "Bethlehem",
            D_NAME2: "Germiston", D_ZTERM: "Pinetown", D_AKONT: "Upington", D_AUFSD: "Polokwane",
            D_DUNN: "Mbombela", D_TEL: "George",
            D_SWAP: "4001", D_DNU: "Gqeberha", D_DUP1: "Brits", D_DUP2: "Brits", DEL: "Stuttgart"}),
        "KNA1.ORT02": _col({C1: "Kempton Park"}),
        "KNA1.PSTLZ": _col({
            C1: "1600", C2: "70191", C3: "3542 AD", C4: "69003", C5: "7600", C6: "9701", D_NAME2: "1401",
            D_ZTERM: "3610", D_AKONT: "8801", D_AUFSD: "0699", D_DUNN: "1201", D_TEL: "6529", D_SWAP: "Durban",
            D_DNU: "6001",
            D_DUP1: "0250", D_DUP2: "0250", DEL: "70191"}),
        "KNA1.PFORT": _col({C1: "Kempton Park"}),
        "KNA1.PSTL2": _col({C1: "1620"}),
        "KNA1.LAND1": _col({C2: "DE", C3: "NL", C4: "FR", DEL: "DE"}, "ZA"),
        "KNA1.SPRAS": _col({C2: "D", C3: "N", C4: "F", DEL: "D"}, "E"),
        "KNA1.KTOKD": _col({OT: "CPD"}, "0001"),
        # ZA: VAT registration number in tax number 1; EU partners: VAT registration number (STCEG)
        "KNA1.STCD1": _col({
            C1: "4150204561", C5: "4420187736", D_NAME2: "4730112458", D_ZTERM: "4160219873", D_AKONT: "4880143320",
            D_AUFSD: "4290175546", D_DUNN: "4570198812", D_TEL: "4110232279", D_SWAP: "4650127734",
            D_DNU: "4930166651", D_DUP1: "4380154420", D_DUP2: "4380154420"}),
        "KNA1.STCD2": [""] * n, "KNA1.STCD3": [""] * n, "KNA1.STCD4": [""] * n,
        # DEL is the old duplicate of C2 (same VAT number) — flagged for deletion, so no duplicate finding
        "KNA1.STCEG": _col({C2: "DE136695976", C3: "NL853746291B01", C4: "FR40303265045", DEL: "DE136695976"}),
        "KNA1.TELF1": _col({
            C1: "0113921500", C2: "+49 711 8204 0", C3: "+31 30 241 5500", C4: "+33 4 72 10 35 00",
            C5: "0218871234", C6: "0823194470",
            D_NAME2: "0114527781", D_ZTERM: "0317014400", D_AKONT: "0543370200", D_AUFSD: "0152913300",
            D_DUNN: "0137526600", D_TEL: "0000000000", D_SWAP: "0313375100", D_DNU: "0415842200",
            D_DUP1: "0122522000", D_DUP2: "0122522000"}),
        "KNA1.TELF2": [""] * n,
        "KNA1.TELFX": _col({C1: "0113921599", C2: "+49 711 8204 199"}),
        "KNA1.KNURL": _col({C1: "www.protea-eng.co.za", C2: "https://www.brenner-maschinenbau.de"}),
        "KNA1.ERDAT": _col({C2: "20120514", C3: "20190903", C4: "20210111", C6: "20240212", OT: "20080301",
                            DEL: "20090220"}, "20170622"),
        "KNA1.ADRNR": adrnr,
        "KNA1.LOEVM": _col({DEL: "X"}),
        "KNA1.SPERR": _col({DEL: "X"}),
        "KNA1.AUFSD": _col({D_AUFSD: "99", DEL: "01"}),
        "KNA1.LIFSD": _col({DEL: "01"}),
        "KNA1.FAKSD": _col({DEL: "01"}),
        "KNA1.CASSD": [""] * n,
        "KNA1.STKZN": _col({C6: "X"}),
        "KNA1.XCPDK": _col({OT: "X"}),
        "KNA1.LIFNR": [""] * n, "KNA1.KNRZA": [""] * n,
    })
    kna1.loc[kna1["KNA1.KUNNR"] == OT, ["KNA1.STRAS", "KNA1.ORT01", "KNA1.PSTLZ", "KNA1.TELF1", "KNA1.STCD1"]] = ""
    kna1.loc[kna1["KNA1.KUNNR"] == DEL, "KNA1.TELF1"] = ""

    knb1 = pd.DataFrame({
        "KNB1.KUNNR": CUSTOMERS, "KNB1.BUKRS": ["1000"] * n,
        "KNB1.AKONT": _col({D_AKONT: "0000113100"}, "0000140000"),
        "KNB1.ZTERM": _col({D_ZTERM: "", OT: "0001", C2: "ZB30", C3: "ZB30", C4: "ZB30"}, "Z030"),
        "KNB1.ZWELS": _col({OT: "C"}, "E"),
        "KNB1.TLFNS": _col({C1: "011 392 1543", C2: "+49 711 8204 233"}),
        "KNB1.TLFXS": [""] * n,
        "KNB1.ERDAT": kna1["KNA1.ERDAT"].tolist(),
        "KNB1.LOEVM": [""] * n, "KNB1.SPERR": [""] * n, "KNB1.ZAHLS": [""] * n,
        "KNB1.KNRZE": [""] * n, "KNB1.KNRZB": [""] * n,
        "KNB1.XVERR": _col({D_TEL: "X"}),   # clearing with vendor, but no vendor linked
    })
    knb1.loc[knb1["KNB1.KUNNR"] == DEL, "KNB1.ZTERM"] = ""   # would fail AR021 if it were judged
    c5_2000 = knb1[knb1["KNB1.KUNNR"] == C5].assign(**{"KNB1.BUKRS": "2000", "KNB1.ERDAT": "20220301"})
    knb1 = pd.concat([knb1, c5_2000], ignore_index=True)
    # dunning data: every live customer except D_DUNN, which carries a credit limit and no dunning procedure
    dunned = [k for k in CUSTOMERS if k not in (D_DUNN, DEL)]
    knb5 = pd.DataFrame({"KNB5.KUNNR": dunned + [C5], "KNB5.BUKRS": ["1000"] * len(dunned) + ["2000"],
                         "KNB5.MABER": [""] * (len(dunned) + 1), "KNB5.MAHNA": ["0001"] * (len(dunned) + 1)})
    # credit management: one credit control area; the one-time account runs at a zero limit (cash / prepayment)
    credit = [k for k in CUSTOMERS if k != DEL]
    knkk = pd.DataFrame({
        "KNKK.KUNNR": credit, "KNKK.KKBER": ["1000"] * len(credit),
        "KNKK.KLIMK": ["0.00" if k == OT else "250000.00" for k in credit],
        "KNKK.ERDAT": [kna1.set_index("KNA1.KUNNR").at[k, "KNA1.ERDAT"] for k in credit],
        # D_DUNN has a credit limit but no risk category; the one-time account (zero limit) needs none
        "KNKK.CTLPC": ["" if k in (D_DUNN, OT) else "001" for k in credit],
        "KNKK.DTREV": ["20250310"] * len(credit),
        # D_NAME2: next review planned before the last review took place
        "KNKK.NXTRV": ["20250101" if k == D_NAME2 else "20260310" for k in credit],
        "KNKK.CRBLB": [""] * len(credit),
    })
    emails = {C1: "accounts@protea-eng.co.za", C2: "rechnungseingang@brenner-maschinenbau.de",
              C3: "crediteuren@vandijk-installatie.nl", C4: "comptabilite@slr-robinetterie.fr",
              C5: "accounts@kaapwyn.co.za", C6: "johan.pretorius@webmail.co.za",
              D_NAME2: "creditors@highveldmining.co.za",
              D_ZTERM: "ap@umgenipaper.co.za", D_AKONT: "rekeninge@karooagri.co.za",
              D_AUFSD: "accounts@limpopofresh.co.za", D_DUNN: "finance@bosveldcold.co.za",
              D_TEL: "accounts@grhardware.co.za", D_SWAP: "ap@natalsugareng.co.za",
              D_DNU: "accounts@coastalpumps.co.za", D_DUP1: "ap@rietfonteinbottling.co.za",
              D_DUP2: "ap@rietfonteinbottling.co.za"}
    with_mail = [(a, k) for a, k in zip(adrnr, CUSTOMERS) if k in emails]
    adr6 = pd.DataFrame({
        "ADR6.ADDRNUMBER": [a for a, _ in with_mail], "ADR6.PERSNUMBER": [""] * len(with_mail),
        "ADR6.DATE_FROM": ["00010101"] * len(with_mail), "ADR6.CONSNUMBER": ["001"] * len(with_mail),
        "ADR6.FLGDEFAULT": ["X"] * len(with_mail), "ADR6.SMTP_ADDR": [emails[k] for _, k in with_mail],
    })
    skb1 = pd.DataFrame({"SKB1.BUKRS": ["1000", "1000", "2000"],
                         "SKB1.SAKNR": ["0000140000", "0000113100", "0000140000"],
                         "SKB1.MITKZ": ["D", "", "D"], "SKB1.ERDAT": ["20050101", "20050101", "20210601"],
                         "SKB1.XLOEB": ["", "", ""], "SKB1.XSPEB": ["", "X", ""]})
    # bank details (direct debit): D_DNU has no bank key; DEL's incomplete details are out of the population
    knbk = pd.DataFrame({
        "KNBK.KUNNR": [C1, C2, D_DNU, DEL], "KNBK.BANKS": ["ZA", "DE", "ZA", "DE"],
        "KNBK.BANKL": ["250655", "60050101", "", ""], "KNBK.BANKN": ["62012345678", "0532013000", "62087654321", ""],
        "KNBK.KOVON": ["20170622", "20120514", "20170622", ""], "KNBK.KOBIS": ["99991231", "99991231", "99991231", ""],
    })
    # open items (BSID), company code 1000 in ZAR, 2000 for C5's second company code
    #   clean:  invoices on 30 days net (Z030) and on ZB30 (3% 14 / 2% 30 / net 45), a EUR invoice translated
    #           into ZAR, a payment on account (SHKZG H), an invoice under dunning block R (in dispute), a
    #           one-time customer's invoice, a down payment (special G/L A on its own reconciliation account
    #           170000) and a down-payment request (noted item, F / BSTAT S)
    #   seeded: one defect each (see the expected findings in the test)
    open_items = [
        _open_item(C1, "0090012001", "S", "48750.00", "48750.00"),
        _open_item(C2, "0090012002", "S", "364000.00", "18200.00", waers="EUR", days=("14", "30", "45"),
                   zterm="ZB30"),
        _open_item(C1, "1400000301", "H", "10000.00", "10000.00", blart="DZ", days=("0", "0", "0"),
                   zterm=""),                                                       # payment on account
        _open_item(C3, "0090012003", "S", "196000.00", "9800.00", waers="EUR", days=("14", "30", "45"),
                   zterm="ZB30", mansp="R"),                                         # disputed: dunning block
        _open_item(OT, "0090012004", "S", "3250.00", "3250.00", days=("0", "0", "0"), zterm="0001"),
        _open_item(C5, "0090012005", "S", "21400.00", "21400.00", bukrs="2000"),
        _open_item(C6, "0090012006", "S", "1890.00", "1890.00", zlspr="A"),         # payment block (direct debit)
        _open_item(C1, "1800000041", "H", "15000.00", "15000.00", umskz="A", hkont="0000170000", blart="DA",
                   days=("0", "0", "0"), zterm=""),
        _open_item(C1, "1800000042", "S", "20000.00", "20000.00", umskz="F", bstat="S", hkont="0000170000",
                   blart="DA", days=("0", "0", "0"), zterm=""),
        # seeded defects
        _open_item(C1, "0090012010", "S", "5200.00", "5200.00", augdt="20260910", augbl="1400000310"),  # AR056
        _open_item(C2, "0090012011", "S", "0.00", "4100.00", waers="EUR", days=("14", "30", "45"),
                   zterm="ZB30"),                                                   # AR057
        _open_item(C1, "0090012012", "S", "7300.00", "7300.00", hkont="0000140090"),  # AR058
        _open_item(DEL, "0090012013", "S", "6600.00", "6600.00"),        # AR059
        _open_item(C1, "0090012014", "S", "2600.00", "2600.00", zfbdt="00000000"),    # AR060
        _open_item(C1, "0090012015", "S", "1450.00-", "1450.00-"),                    # AR061
        _open_item(C2, "0090012016", "S", "120000.00", "6000.00", waers="EUR", days=("30", "14", "45"),
                   zterm="ZB30"),                                                   # AR062
        _open_item(C1, "0090012017", "S", "3900.00", "3900.00", zlspr="Z"),           # AR063
        _open_item(C1, "1800000043", "H", "8000.00", "8000.00", umskz="Q", hkont="0000170000", blart="DA",
                   days=("0", "0", "0"), zterm=""),                                 # AR064
        _open_item(C1, "0090012018", "S", "4400.00", "4400.00", mansp="9"),           # AR067
    ]
    bsid = pd.DataFrame([{f"BSID.{k}": x for k, x in r.items()} for r in open_items])
    # cleared items (BSAD): invoices cleared by incoming payments, the payment lines themselves
    bsad = pd.DataFrame([{f"BSAD.{k}": x for k, x in r.items()} for r in [
        _open_item(C1, "0090011901", "S", "12500.00", "12500.00", budat="20260715", augdt="20260812",
                   augbl="1400000290"),
        _open_item(C1, "1400000290", "H", "12500.00", "12500.00", budat="20260812", augdt="20260812",
                   augbl="1400000290", blart="DZ"),
        _open_item(C5, "0090011902", "S", "8800.00", "8800.00", bukrs="2000", budat="20260801", augdt="20260801",
                   augbl="0090011903"),                                              # credited the same day
        _open_item(C5, "0090011903", "H", "8800.00", "8800.00", bukrs="2000", budat="20260801", augdt="20260801",
                   augbl="0090011903", blart="DG"),
        # seeded defects
        _open_item(C1, "0090011904", "S", "3100.00", "3100.00", budat="20260820", augdt="20260817",
                   augbl="1400000291"),                                              # AR065
        _open_item(C1, "0090011905", "S", "2200.00", "2200.00", budat="20260821"),   # AR066
    ]])
    return TableFrames({"KNA1": kna1, "KNB1": knb1, "KNB5": knb5, "KNKK": knkk, "ADR6": adr6, "SKB1": skb1,
                        "KNBK": knbk, "BSID": bsid, "BSAD": bsad}, D, module="accounts_receivable")


def _open_item(kunnr, belnr, shkzg, dmbtr, wrbtr, waers="ZAR", bukrs="1000", budat="20260904", zfbdt="20260904",
               days=("30", "0", "0"), zterm="Z030", umskz="", bstat="", hkont="0000140000", zlspr="", mansp="",
               augdt="00000000", augbl="", blart="RV") -> dict:
    """One customer line item (BSID / BSAD layout)."""
    return {"BUKRS": bukrs, "KUNNR": kunnr, "UMSKS": "", "UMSKZ": umskz, "AUGDT": augdt, "AUGBL": augbl,
            "ZUONR": belnr, "GJAHR": "2026", "BELNR": belnr, "BUZEI": "001", "BUDAT": budat, "BLDAT": budat,
            "WAERS": waers, "XBLNR": "", "BLART": blart, "SHKZG": shkzg, "DMBTR": dmbtr, "WRBTR": wrbtr,
            "HKONT": hkont, "ZFBDT": zfbdt, "ZTERM": zterm, "ZBD1T": days[0], "ZBD2T": days[1], "ZBD3T": days[2],
            "ZLSPR": zlspr, "MANSP": mansp, "BSTAT": bstat}


def _live_config(rules) -> dict[str, set[str]]:
    """The system's own check tables, as discovery would read them."""
    values = {"KTOKD": {"0001", "0002", "0003", "0004", "CPD", "CPDA"},
              "AUFSD": {"01", "02", "03", "08", "10"}, "LIFSD": {"01", "02", "03", "08"},
              "FAKSD": {"01", "02", "08"}, "BUKRS": {"1000", "2000"}, "ZTERM": {"0001", "Z030", "ZB30"},
              "ZWELS": {"C", "E"}, "MAHNA": {"0001"}, "KKBER": {"1000"}, "CTLPC": {"001", "002", "003"},
              "LAND1": {"ZA", "DE", "NL", "FR"}, "BANKS": {"ZA", "DE", "NL", "FR"},
              "ZLSPR": {"*", "A", "B", "R", "V"},                  # T008 payment block reasons
              "UMSKZ": {"A", "F", "I", "W"},                       # T074U special G/L (customers)
              "MANSP": {"A", "B", "R"}}                            # T040S dunning block reasons
    out = {}
    for r in rules:
        if r.get("check_class") in ("referential_check", "domain_value_check") and r["field"].split(".")[1] in values:
            key = _with_reference(r, D, {}).get("_reference_key")
            if key:
                out[key] = values[r["field"].split(".")[1]]
    return out


def _key(kunnr: str, belnr: str, augdt: str = "00000000", augbl: str = "", umskz: str = "") -> str:
    """BSID / BSAD key: company code, customer, special G/L, clearing, assignment, document, line."""
    return (f"BUKRS=1000|KUNNR={kunnr}|UMSKS=|UMSKZ={umskz}|AUGDT={augdt}|AUGBL={augbl}|ZUONR={belnr}"
            f"|GJAHR=2026|BELNR={belnr}|BUZEI=001")


def test_accounts_receivable_golden():
    static = yaml.safe_load(_find_module_yaml("accounts_receivable").read_text())["rules"]
    results = run_checks("accounts_receivable", _frames(), "t", reference_values=_live_config(static),
                         extra_rules=generate("accounts_receivable", static, D))
    errors = {r.check_id: r.error for r in results if r.error}
    assert not errors, errors
    found = {r.check_id: set(r.failing_record_keys or []) for r in results if r.affected_count}
    assert found == {
        "VP-KNA1-NAME2": {f"KUNNR={D_NAME2}"},                    # telephone number in the second name line
        "AR021": {f"KUNNR={D_ZTERM}|BUKRS=1000"},                 # payment terms missing
        "XREC002": {f"KUNNR={D_AKONT}|BUKRS=1000"},               # 113100 is a bank account, not a customer recon
        "AR012": {f"KUNNR={D_AUFSD}"},                            # order block 99 is not in TVAST
        # credit limit but no dunning data at all: no dunning procedure, and credit without dunning
        "AR020": {f"KUNNR={D_DUNN}|BUKRS=1000"},
        "AR024": {f"KUNNR={D_DUNN}|BUKRS=1000"},
        "PH-KNA1-TELF1": {f"KUNNR={D_TEL}"},                      # 0000000000 is a placeholder
        "SW-KNA1-PSTLZ-ORT01": {f"KUNNR={D_SWAP}"},               # city in the postal code, code in the city
        "ST-KNA1": {f"KUNNR={D_DNU}"},                            # "DO NOT USE" in the name, nothing blocked
        "XDUP005": {f"KUNNR={D_DUP1}|BUKRS=1000", f"KUNNR={D_DUP2}|BUKRS=1000"},        # one legal entity created twice
        "ND-KNA1": {f"KUNNR={D_DUP1}", f"KUNNR={D_DUP2}"},       # same name (legal form aside), postal code, country
        "AR037": {f"KUNNR={D_TEL}|BUKRS=1000"},                   # clearing with vendor, no vendor linked
        "AR041": {f"KUNNR={D_AKONT}|BUKRS=1000"},                 # 113100 is also blocked for posting
        "AR045": {f"KUNNR={D_DUNN}"},                             # credit limit without risk category
        "AR047": {f"KUNNR={D_NAME2}"},                            # next credit review before the last one
        "AR049": {f"KUNNR={D_DNU}"},                              # bank details without a bank key
        "AR056": {_key(C1, "0090012010", augdt="20260910", augbl="1400000310")},  # open item with clearing data
        "AR057": {_key(C2, "0090012011")},                        # EUR 4 100.00 translated to ZAR 0.00
        "AR058": {_key(C1, "0090012012")},                        # still on the old reconciliation account
        "AR059": {_key(DEL, "0090012013")},                       # open item on a customer flagged for deletion
        "AR060": {_key(C1, "0090012014")},                        # no baseline date for payment
        "AR061": {_key(C1, "0090012015")},                        # amount stored negative (RFC "1450.00-")
        "AR062": {_key(C2, "0090012016")},                        # discount days 30, then 14
        "AR063": {_key(C1, "0090012017")},                        # payment block Z is not in T008
        "AR064": {_key(C1, "1800000043", umskz="Q")},             # special G/L Q is not in T074U
        "AR065": {_key(C1, "0090011904", augdt="20260817", augbl="1400000291")},  # cleared before it was posted
        "AR066": {_key(C1, "0090011905")},                        # cleared item without a clearing reference
        "AR067": {_key(C1, "0090012018")},                        # dunning block 9 is not in T040S
        "AR071": {_key(DEL, "0090012013")},                       # open item on a blocked customer
        # next credit review (20260310 / 20250101) passed long ago; OT runs at a zero limit
        "AR074": {f"KUNNR={k}" for k in CUSTOMERS if k not in (OT, DEL)},
        "AR225": {f"KUNNR={DEL}|BUKRS=1000"},                     # deleted centrally, company code not flagged
        "AR236": {f"KUNNR={D_DUP1}", f"KUNNR={D_DUP2}"},          # near-identical names in the same city
    }, found
    # DEL is flagged for deletion and OT is a one-time account: out of the population, counted
    name = next(r for r in results if r.check_id == "AR003")
    assert name.details["population_excluded"] == {"deleted": 1}
    tax = next(r for r in results if r.check_id == "AR007")
    assert tax.details["population_excluded"] == {"deleted": 1, "one_time_account": 1}
    mail = next(r for r in results if r.check_id == "AR008")
    assert mail.details["population_excluded"] == {"deleted": 1, "one_time_account": 1}
    vat = next(r for r in results if r.check_id == "XDUP004")   # DEL shares C2's VAT number
    assert vat.details["population_excluded"] == {"deleted": 1, "one_time_account": 1}
    bank = next(r for r in results if r.check_id == "AR049")   # DEL's incomplete bank details are not judged
    assert bank.details["population_excluded"] == {"deleted": 1}
    terms = next(r for r in results if r.check_id == "AR021")   # central deletion flag covers company code 1000
    assert terms.details["population_excluded"] == {"deleted": 1}
    # down payments and down-payment requests sit on their own reconciliation account by design: 16 of 19
    recon = next(r for r in results if r.check_id == "AR058")
    assert recon.total_count == 16
