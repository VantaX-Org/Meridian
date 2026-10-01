"""Golden dataset: the whole FI general-ledger pipeline (shipped + generated rules,
active population, joins, live configuration) on a chart of accounts and a set of
FI documents whose correct findings are known. Clean accounts and balanced,
correctly tax-coded documents must produce no finding at all — any failure on
them is a false positive; each seeded defect must be found exactly where it was put.

Company code 1000 (ZAR, VAT 15 %) on chart of accounts INT.
"""

import pandas as pd
import yaml

from checks.frames import TableFrames
from checks.runner import _find_module_yaml, _with_reference, run_checks
from checks.value_placement import generate
from sap.ddic import get_dictionary

D = get_dictionary("ecc6")

# ── G/L accounts ─────────────────────────────────────────────────────────
# clean:   113100 bank, 140000 customer recon, 160000 vendor recon, 154000 input tax,
#          175000 output tax, 194500 suspense/clearing, 800000 revenue, 476000 office
#          supplies, 470000 travel (P&L account carrying its own functional area)
# defects: 479000 P&L account without P&L statement type (GL024)
#          196000 reconciliation-account flag 'X' from a migration (GL018)
#          430000 field status group missing (GL017)
#          113300 petty cash: telephone number inside the long text (VP-SKAT-TXT50)
#          481000 company-code segment created in 2091 (DT-SKB1-ERDAT)
#          141000 export receivables: reconciliation account managed on open items (GL033)
#          210000 long-term loans: balance sheet account with a P&L statement type (GL032)
# clean:   113400 USD bank account (account currency USD), 477000 postage (tax category: only V1)
# population: 199999 flagged for deletion centrally (SKA1.XLOEV), no text, no field status group
#             113200 closed bank account flagged for deletion in company code 1000 (SKB1.XLOEB)
ACCOUNTS = [
    # SAKNR,       KTOKS,  XBILK, GVTYP, FUNC_AREA, XLOEV, ERDAT
    ("0000113100", "FIN.", "X", "", "", "", "20180305"),
    ("0000113200", "FIN.", "X", "", "", "", "20180305"),
    ("0000113300", "FIN.", "X", "", "", "", "20180305"),
    ("0000140000", "BILA", "X", "", "", "", "20180301"),
    ("0000160000", "BILA", "X", "", "", "", "20180301"),
    ("0000154000", "BILA", "X", "", "", "", "20180301"),
    ("0000175000", "BILA", "X", "", "", "", "20180301"),
    ("0000194500", "BILA", "X", "", "", "", "20180301"),
    ("0000196000", "BILA", "X", "", "", "", "20190710"),
    ("0000800000", "ERG.", "", "X", "", "", "20180301"),
    ("0000476000", "ERG.", "", "X", "", "", "20180301"),
    ("0000470000", "ERG.", "", "X", "0400", "", "20180301"),
    ("0000430000", "ERG.", "", "X", "", "", "20200214"),
    ("0000479000", "ERG.", "", "", "", "", "20210118"),
    ("0000481000", "ERG.", "", "X", "", "", "20180301"),
    ("0000199999", "BILA", "X", "", "", "X", "20190102"),
    ("0000113400", "FIN.", "X", "", "", "", "20220601"),
    ("0000141000", "BILA", "X", "", "", "", "20230301"),
    ("0000210000", "BILA", "X", "X", "", "", "20230301"),
    ("0000477000", "ERG.", "", "X", "", "", "20180301"),
]
TEXTS = {  # SAKNR → (TXT20, TXT50) in English; 199999 has none
    "0000113100": ("Std Bank current acc", "Standard Bank current account 012345678"),
    "0000113200": ("Nedbank current acc", "Nedbank current account (closed 2023)"),
    "0000113300": ("Petty cash Head Off.", "Petty cash Head Office - custodian Tel 011 555 0199"),
    "0000140000": ("Receivables domestic", "Trade receivables - domestic customers"),
    "0000160000": ("Payables domestic", "Trade payables - domestic vendors"),
    "0000154000": ("Input VAT", "Input VAT 15% - claimable"),
    "0000175000": ("Output VAT", "Output VAT 15% - payable"),
    "0000194500": ("Suspense - migration", "Suspense account for data migration differences"),
    "0000196000": ("Employee advances", "Advances and loans to employees"),
    "0000800000": ("Revenue domestic", "Sales revenue - domestic"),
    "0000476000": ("Office supplies", "Office supplies and stationery"),
    "0000470000": ("Travel expenses", "Travel and accommodation - administration"),
    "0000430000": ("Salaries", "Salaries and wages - monthly staff"),
    "0000479000": ("Sundry expenses", "Sundry operating expenses"),
    "0000481000": ("Bank charges", "Bank charges and fees"),
    "0000113400": ("FNB USD account", "First National Bank USD call account"),
    "0000141000": ("Receivables export", "Trade receivables - export customers"),
    "0000210000": ("Long-term loans", "Long-term loans - Standard Bank facility"),
    "0000477000": ("Postage and courier", "Postage, courier and freight-out (VAT V1 only)"),
}
COMPANY = [
    # SAKNR,       XOPVW, XKRES, FDLEV, XGKON, XINTB, FSTAG,  MITKZ, ZUAWA, MWSKZ, XMWNO, XLOEB, ERDAT
    ("0000113100", "",  "X", "F0", "X", "",  "G005", "",  "001", "",  "",  "",  "20180305"),
    ("0000113200", "",  "X", "",   "X", "",  "G005", "",  "001", "",  "",  "X", "20180305"),
    ("0000113300", "",  "X", "F0", "X", "",  "G001", "",  "001", "",  "",  "",  "20180305"),
    ("0000140000", "",  "",  "",   "",  "",  "G067", "D", "001", "",  "",  "",  "20180301"),
    ("0000160000", "",  "",  "",   "",  "",  "G067", "K", "001", "",  "",  "",  "20180301"),
    ("0000154000", "",  "X", "",   "",  "X", "G001", "",  "001", "<", "",  "",  "20180301"),
    ("0000175000", "",  "X", "",   "",  "X", "G001", "",  "001", ">", "",  "",  "20180301"),
    ("0000194500", "X", "X", "",   "",  "",  "G001", "",  "001", "",  "",  "",  "20180301"),
    ("0000196000", "X", "X", "",   "",  "",  "G001", "X", "001", "",  "",  "",  "20190710"),
    ("0000800000", "",  "X", "",   "",  "",  "G029", "",  "001", "+", "",  "",  "20180301"),
    ("0000476000", "",  "X", "",   "",  "",  "G004", "",  "001", "-", "",  "",  "20180301"),
    ("0000470000", "",  "X", "",   "",  "",  "G004", "",  "001", "-", "X", "",  "20180301"),
    ("0000430000", "",  "X", "",   "",  "",  "",     "",  "001", "",  "",  "",  "20200214"),
    ("0000479000", "",  "X", "",   "",  "",  "G004", "",  "001", "",  "",  "",  "20210118"),
    ("0000481000", "",  "X", "",   "",  "",  "G004", "",  "001", "",  "",  "",  "20910415"),
    ("0000199999", "",  "X", "",   "",  "",  "",     "",  "001", "",  "",  "",  "20190102"),
    ("0000113400", "",  "X", "F0", "X", "",  "G005", "",  "001", "",  "",  "",  "20220601"),
    ("0000141000", "X", "",  "",   "",  "",  "G067", "D", "001", "",  "",  "",  "20230301"),
    ("0000210000", "",  "X", "",   "",  "",  "G001", "",  "001", "",  "",  "",  "20230301"),
    ("0000477000", "",  "X", "",   "",  "",  "G004", "",  "001", "V1", "", "",  "20180301"),
]
ACCOUNT_CURRENCY = {"0000113400": "USD"}   # every other account is kept in company code currency ZAR

# ── FI documents (fiscal year 2026, ZAR) ─────────────────────────────────
# BELNR, BLART, BSTAT, BUDAT, lines: (BSCHL, KOART, SHKZG, HKONT, DMBTR, MWSKZ, KOSTL, LIFNR, KUNNR)
DOCS = [
    # clean vendor invoice: 1 000.00 net + 150.00 VAT (V1 = input tax 15 %)
    ("1900000101", "KR", "", "20260803", [
        ("31", "K", "H", "0000160000", "1150.00", "",   "",           "0000100023", ""),
        ("40", "S", "S", "0000476000", "1000.00", "V1", "0000004120", "",           ""),
        ("40", "S", "S", "0000154000", "150.00",  "V1", "",           "",           "")]),
    # clean customer invoice: 2 000.00 net + 300.00 VAT (A1 = output tax 15 %)
    ("1800000077", "DR", "", "20260810", [
        ("01", "D", "S", "0000140000", "2300.00", "",   "", "", "0000200045"),
        ("50", "S", "H", "0000800000", "2000.00", "A1", "", "", ""),
        ("50", "S", "H", "0000175000", "300.00",  "A1", "", "", "")]),
    # clean outgoing payment of the vendor invoice
    ("1500000012", "KZ", "", "20260831", [
        ("25", "K", "S", "0000160000", "1150.00", "", "", "0000100023", ""),
        ("50", "S", "H", "0000113100", "1150.00", "", "", "",           "")]),
    # clean travel claim: account allows posting without tax code (XMWNO)
    ("0100000044", "SA", "", "20260814", [
        ("40", "S", "S", "0000470000", "865.40", "", "0000004120", "", ""),
        ("50", "S", "H", "0000113100", "865.40", "", "",           "", "")]),
    # clean down-payment request: a noted item (BSTAT S) is one-sided by design
    ("1700000003", "KA", "S", "20260820", [
        ("39", "K", "H", "0000160000", "11500.00", "", "", "0000100023", "")]),
    # defect XP2P003: interface-loaded invoice, expense line without tax code
    ("1900000102", "KR", "", "20260805", [
        ("31", "K", "H", "0000160000", "640.00", "", "",           "0000100023", ""),
        ("40", "S", "S", "0000476000", "640.00", "", "0000004120", "",           "")]),
    # defect XFI001: migrated document out of balance by 10.00
    ("0100000045", "SA", "", "20260630", [
        ("40", "S", "S", "0000113100", "5000.00", "", "", "", ""),
        ("50", "S", "H", "0000194500", "4990.00", "", "", "", "")]),
    # defect GL029: migrated document with a document type that is not configured
    ("0100000046", "ZM", "", "20260630", [
        ("40", "S", "S", "0000194500", "250.00", "", "", "", ""),
        ("50", "S", "H", "0000113100", "250.00", "", "", "", "")]),
    # clean: USD receipt on the USD bank account (document currency USD, ZAR 18.50 / USD)
    ("1400000020", "SA", "", "20260815", [
        ("40", "S", "S", "0000113400", "18500.00", "", "", "", ""),
        ("50", "S", "H", "0000194500", "18500.00", "", "", "", "")]),
    # clean: postage with the account's own tax code V1
    ("0100000049", "SA", "", "20260703", [
        ("40", "S", "S", "0000477000", "80.00", "V1", "0000004120", "", ""),
        ("50", "S", "H", "0000113100", "80.00", "",   "",           "", "")]),
    # defect GL052: the USD bank account posted in ZAR
    ("1400000021", "SA", "", "20260816", [
        ("40", "S", "S", "0000113400", "5000.00", "", "", "", ""),
        ("50", "S", "H", "0000194500", "5000.00", "", "", "", "")]),
    # defect GL054: ZAR document whose second line carries a different document-currency amount
    ("0100000047", "SA", "", "20260701", [
        ("40", "S", "S", "0000194500", "300.00", "", "", "", ""),
        ("50", "S", "H", "0000113100", "300.00", "", "", "", "")]),
    # defect GL053: postage posted with tax code V2 although the account only allows V1
    ("0100000048", "SA", "", "20260702", [
        ("40", "S", "S", "0000477000", "120.00", "V2", "0000004120", "", ""),
        ("50", "S", "H", "0000113100", "120.00", "",   "",           "", "")]),
    # defect GL050: interface-built vendor line on the suspense account (not a reconciliation account)
    ("1900000103", "KR", "", "20260806", [
        ("31", "K", "H", "0000194500", "400.00", "", "",           "0000100023", ""),
        ("40", "S", "S", "0000470000", "400.00", "", "0000004120", "",           "")]),
    # defect GL049: invoice posted 20 Aug but cleared by a payment dated 10 Aug
    ("1900000104", "KR", "", "20260820", [
        ("31", "K", "H", "0000160000", "230.00", "", "",           "0000100023", ""),
        ("40", "S", "S", "0000470000", "230.00", "", "0000004120", "",           "")]),
    ("1500000013", "KZ", "", "20260810", [
        ("25", "K", "S", "0000160000", "230.00", "", "", "0000100023", ""),
        ("50", "S", "H", "0000113100", "230.00", "", "", "",           "")]),
]
DOC_CURRENCY = {"1400000020": "USD"}                       # every other document is in ZAR
WRBTR = {("1400000020", "001"): "1000.00", ("1400000020", "002"): "1000.00",
         ("0100000047", "002"): "30.00"}                   # amount in document currency where it differs
CLEARING = {  # (BELNR, BUZEI) → (clearing document, clearing date)
    ("1900000101", "001"): ("1500000012", "20260831"), ("1500000012", "001"): ("1500000012", "20260831"),
    ("1900000104", "001"): ("1500000013", "20260810"), ("1500000013", "001"): ("1500000013", "20260810"),
}


def _frames() -> TableFrames:
    ska1 = pd.DataFrame({
        "SKA1.KTOPL": ["INT"] * len(ACCOUNTS),
        "SKA1.SAKNR": [a[0] for a in ACCOUNTS],
        "SKA1.KTOKS": [a[1] for a in ACCOUNTS],
        "SKA1.XBILK": [a[2] for a in ACCOUNTS],
        "SKA1.GVTYP": [a[3] for a in ACCOUNTS],
        "SKA1.FUNC_AREA": [a[4] for a in ACCOUNTS],
        "SKA1.XLOEV": [a[5] for a in ACCOUNTS],
        "SKA1.XSPEA": [""] * len(ACCOUNTS),
        "SKA1.XSPEB": [""] * len(ACCOUNTS),
        "SKA1.XSPEP": [""] * len(ACCOUNTS),
        "SKA1.ERDAT": [a[6] for a in ACCOUNTS],
        "SKA1.ERNAM": ["MNAIDOO"] * len(ACCOUNTS),
    })
    # English texts, plus the German text of the bank account (the English one is preferred)
    texts = [("E", k, t20, t50) for k, (t20, t50) in TEXTS.items()]
    texts.append(("D", "0000113100", "Std Bank Kontokorr.", "Standard Bank Kontokorrentkonto 012345678"))
    skat = pd.DataFrame({
        "SKAT.SPRAS": [t[0] for t in texts], "SKAT.KTOPL": ["INT"] * len(texts),
        "SKAT.SAKNR": [t[1] for t in texts], "SKAT.TXT20": [t[2] for t in texts],
        "SKAT.TXT50": [t[3] for t in texts],
    })
    cols = ["SAKNR", "XOPVW", "XKRES", "FDLEV", "XGKON", "XINTB", "FSTAG", "MITKZ", "ZUAWA", "MWSKZ", "XMWNO",
            "XLOEB", "ERDAT"]
    skb1 = pd.DataFrame({f"SKB1.{c}": [row[i] for row in COMPANY] for i, c in enumerate(cols)})
    skb1.insert(0, "SKB1.BUKRS", "1000")
    skb1["SKB1.WAERS"] = [ACCOUNT_CURRENCY.get(row[0], "ZAR") for row in COMPANY]
    skb1["SKB1.ERNAM"] = "MNAIDOO"

    bkpf = pd.DataFrame({
        "BKPF.BUKRS": ["1000"] * len(DOCS), "BKPF.BELNR": [d[0] for d in DOCS], "BKPF.GJAHR": ["2026"] * len(DOCS),
        "BKPF.BLART": [d[1] for d in DOCS], "BKPF.BSTAT": [d[2] for d in DOCS],
        "BKPF.BUDAT": [d[3] for d in DOCS], "BKPF.BLDAT": [d[3] for d in DOCS],
        "BKPF.WAERS": [DOC_CURRENCY.get(d[0], "ZAR") for d in DOCS], "BKPF.HWAER": ["ZAR"] * len(DOCS),
        "BKPF.USNAM": ["MNAIDOO"] * len(DOCS), "BKPF.STBLG": [""] * len(DOCS), "BKPF.STJAH": ["0000"] * len(DOCS),
    })
    bldat = {d[0]: d[3] for d in DOCS}
    lines = [(d[0], f"{i:03d}", *ln) for d in DOCS for i, ln in enumerate(d[4], start=1)]
    bseg = pd.DataFrame({
        "BSEG.BUKRS": ["1000"] * len(lines), "BSEG.BELNR": [x[0] for x in lines],
        "BSEG.GJAHR": ["2026"] * len(lines), "BSEG.BUZEI": [x[1] for x in lines],
        "BSEG.BSCHL": [x[2] for x in lines], "BSEG.KOART": [x[3] for x in lines],
        "BSEG.SHKZG": [x[4] for x in lines], "BSEG.HKONT": [x[5] for x in lines],
        "BSEG.DMBTR": [x[6] for x in lines], "BSEG.WRBTR": [WRBTR.get((x[0], x[1]), x[6]) for x in lines],
        "BSEG.MWSKZ": [x[7] for x in lines], "BSEG.KOSTL": [x[8] for x in lines],
        "BSEG.LIFNR": [x[9] for x in lines], "BSEG.KUNNR": [x[10] for x in lines],
        "BSEG.STCEG": [""] * len(lines),
        "BSEG.ZFBDT": [bldat[x[0]] if x[3] in ("D", "K") else "00000000" for x in lines],
        "BSEG.AUGBL": [CLEARING.get((x[0], x[1]), ("", ""))[0] for x in lines],
        "BSEG.AUGDT": [CLEARING.get((x[0], x[1]), ("", "00000000"))[1] for x in lines],
    })
    return TableFrames({"SKA1": ska1, "SKAT": skat, "SKB1": skb1, "BKPF": bkpf, "BSEG": bseg}, D, module="fi_gl")


def _live_config(rules) -> dict[str, set[str]]:
    """The system's own check tables, as discovery would read them."""
    values = {"KTOPL": {"INT"}, "BLART": {"SA", "AB", "KR", "KZ", "KA", "DR", "DZ", "RV", "RE", "WE"}}
    out = {}
    for r in rules:
        if r.get("check_class") in ("referential_check", "domain_value_check") and r["field"].split(".")[1] in values:
            key = _with_reference(r, D, {}).get("_reference_key")
            if key:
                out[key] = values[r["field"].split(".")[1]]
    return out


def test_fi_gl_golden():
    static = yaml.safe_load(_find_module_yaml("fi_gl").read_text())["rules"]
    results = run_checks("fi_gl", _frames(), "t", reference_values=_live_config(static),
                         extra_rules=generate("fi_gl", static, D))
    errors = {r.check_id: r.error for r in results if r.error}
    assert not errors, errors
    found = {r.check_id: set(r.failing_record_keys or []) for r in results if r.affected_count}
    assert found == {
        "GL024": {"KTOPL=INT|SAKNR=0000479000"},                  # P&L account without P&L statement type
        "GL018": {"BUKRS=1000|SAKNR=0000196000"},                 # 'X' is not a reconciliation account type
        "GL017": {"BUKRS=1000|SAKNR=0000430000"},                 # field status group missing
        "VP-SKAT-TXT50": {"KTOPL=INT|SAKNR=0000113300"},          # telephone number in the long text
        "DT-SKB1-ERDAT": {"BUKRS=1000|SAKNR=0000481000"},         # created in 2091
        "XP2P003": {"BUKRS=1000|BELNR=1900000102|GJAHR=2026|BUZEI=002"},  # tax code missing
        "XFI001": {"BUKRS=1000|BELNR=0100000045|GJAHR=2026|BUZEI=001"},   # debits != credits
        "GL029": {"BUKRS=1000|BELNR=0100000046|GJAHR=2026"},      # document type ZM not in T003
        "GL032": {"KTOPL=INT|SAKNR=0000210000"},                  # balance sheet account with P&L type
        "GL033": {"BUKRS=1000|SAKNR=0000141000"},                 # reconciliation account on open items
        "GL049": {"BUKRS=1000|BELNR=1900000104|GJAHR=2026|BUZEI=001"},    # cleared before it was posted
        "GL050": {"BUKRS=1000|BELNR=1900000103|GJAHR=2026|BUZEI=001"},    # vendor line on a non-recon account
        "GL052": {"BUKRS=1000|BELNR=1400000021|GJAHR=2026|BUZEI=001"},    # USD account posted in ZAR
        "GL053": {"BUKRS=1000|BELNR=0100000048|GJAHR=2026|BUZEI=001"},    # tax code V2, account allows V1
        "GL054": {"BUKRS=1000|BELNR=0100000047|GJAHR=2026|BUZEI=002"},    # ZAR document, DMBTR != WRBTR
    }, found
    # 199999 is flagged for deletion centrally, 113200 in company code 1000 only: out of the
    # population, counted. The noted item (BSTAT S) is outside the balance rule's scope.
    text = next(r for r in results if r.check_id == "GL007")
    assert text.details["population_excluded"] == {"deleted": 1}
    fsg = next(r for r in results if r.check_id == "GL017")
    assert fsg.details["population_excluded"] == {"deleted": 2}
    balance = next(r for r in results if r.check_id == "XFI001")
    assert balance.details["groups"] == 15
