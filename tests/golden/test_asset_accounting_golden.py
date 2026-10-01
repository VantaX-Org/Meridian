"""Golden dataset: the whole asset-accounting pipeline (shipped + generated rules,
active population, joins incl. the current ANLZ time segment, live configuration)
on fixed assets whose correct findings are known. Clean assets must produce no
finding at all — any failure on them is a false positive; each seeded defect must
be found exactly where it was put.

Company code 1000, depreciation areas 01 (book) and 15 (tax). The company code reports by
profit centre and segment (New G/L) and does not use business areas, so ANLZ.GSBER is blank.
"""

import pandas as pd
import yaml

from checks.frames import TableFrames
from checks.runner import _find_module_yaml, _with_reference, run_checks
from checks.value_placement import generate
from sap.ddic import get_dictionary

D = get_dictionary("ecc6")

# ANLN1, ANLN2, ANLKL, TXT50, TXA50, INVNR, AKTIV, ZUGDT, ERDAT, AEDAT, XLOEV, DEAKT, XSPEB, STADT
ASSETS = [
    # clean
    ("000000300012", "0000", "00003000", "CNC lathe Mazak QT-250", "Serial 251874, line 2", "ZA-PLT-0412",
     "20210315", "20210315", "20210310", "20240105", "", "00000000", "", "Germiston"),
    ("000000310004", "0000", "00003100", "Toyota Hilux 2.8 GD-6 double cab", "Fleet no. 14", "ZA-FLT-0014",
     "20220701", "20220701", "20220628", "00000000", "", "00000000", "", "Germiston"),
    ("000000320021", "0000", "00003200", "Dell Latitude 7440 notebook", "Finance - M. Naidoo", "ZA-IT-2207",
     "20240212", "20240212", "20240209", "00000000", "", "00000000", "", "Johannesburg"),
    ("000000320021", "0001", "00003200", "Dell WD22TB4 docking station", "Finance - M. Naidoo", "ZA-IT-2208",
     "20240212", "20240212", "20240209", "00000000", "", "00000000", "", "Johannesburg"),
    ("000000100003", "0000", "00001000", "Industrial land Erf 4471 Germiston", "Title deed T12345/2019",
     "ZA-LND-0003", "20190601", "20190601", "20190528", "20230301", "", "00000000", "", "Germiston"),
    # clean: marked in text and blocked for acquisitions (consistent)
    ("000000300009", "0000", "00003000", "Do not use - press brake awaiting disposal", "Amada HFE 100-3",
     "ZA-PLT-0398", "20160401", "20160401", "20160330", "20250911", "", "00000000", "X", "Germiston"),
    # defects
    ("000000300013", "0000", "00003000", "CNC milling centre DMG Mori CMX 600V", "Line 2", "ZA-PLT-0413",
     "20230901", "20230901", "20230828", "00000000", "", "00000000", "", "Germiston"),       # AA008 no cost centre
    ("000000300014", "0000", "00003000", "Compressor Atlas Copco GA30", "Workshop", "ZA-PLT-0414",
     "20230115", "20230115", "20230110", "00000000", "", "00000000", "", "Germiston"),       # AA032 dep. key ZL05
    ("000000300015", "0000", "00003000", "Obsolete - forklift Toyota 8FD25", "Warehouse", "ZA-PLT-0415",
     "20150601", "20150601", "20150528", "20200101", "", "00000000", "", "Germiston"),       # ST-ANLA
    ("000000300016", "0000", "00003000", "Hydraulic press Schuler 250t", "Line 1", "ZA-PLT-0416",
     "20190301", "20190301", "20220601", "20190301", "", "00000000", "", "Germiston"),       # DO-ANLA migrated
    ("000000310005", "0000", "00003100", "Isuzu D-Max 1.9 single cab", "Fleet no. 15", "ZA-FLT-0015",
     "20240401", "20240401", "20240328", "00000000", "", "00000000", "", "N/A"),             # PH-ANLA-STADT
    ("000000320022", "0000", "00003200", "HP ZBook Studio G10 workstation", "Engineering", "ZA-IT-2209",
     "20250303", "20250303", "20250228", "00000000", "", "00000000", "", "Johannesburg"),    # AA016 area 15
    ("000000300018", "0000", "00003000", "Bench grinder Metabo DS 200", "Workshop", "ZA-PLT-0412",
     "20220510", "20220510", "20220505", "00000000", "", "00000000", "", "Germiston"),       # AA037 lathe's tag
    # AA033: legacy-loaded scrapped trailer, deactivated (2019) before its capitalisation date (2020)
    ("000000310006", "0000", "00003100", "Trailer Henred 2-axle - scrapped", "Fleet no. 06", "ZA-FLT-0006",
     "20200301", "20200301", "20200225", "20200301", "", "20190131", "", "Germiston"),
    # population: retired (sold) vehicle whose cost centre was closed; asset created in error
    ("000000310001", "0000", "00003100", "Toyota Corolla 1.8 - sold", "Fleet no. 01", "ZA-FLT-0001",
     "20170301", "20170301", "20170227", "20240630", "", "20240630", "", "Germiston"),
    ("000000300017", "0000", "00003000", "Lathe - created in error", "", "",
     "00000000", "00000000", "20250506", "20250507", "X", "00000000", "", ""),
]
# current time segment (BDATU 99991231): KOSTL, PRCTR, GSBER (business areas not used), WERKS, STORT
CURRENT = {
    "000000300012": ("0000004120", "0000001200", "",     "1000", "GER-L2"),
    "000000310004": ("0000004300", "0000001300", "",     "1000", "GER-YARD"),
    "000000320021": ("0000004010", "0000001000", "",     "1100", "JHB-F3"),
    "000000100003": ("0000004900", "0000001000", "",     "1000", "GER-SITE"),
    "000000300009": ("0000004120", "0000001200", "",     "1000", "GER-L1"),
    "000000300013": ("",           "0000001200", "",     "1000", "GER-L2"),
    "000000300014": ("0000004120", "0000001200", "",     "1000", "GER-WS"),
    "000000300015": ("0000004150", "0000001200", "",     "1000", "GER-WH"),
    "000000300016": ("0000004120", "0000001200", "",     "1000", "GER-L1"),
    "000000310005": ("0000004300", "0000001300", "",     "1000", "GER-YARD"),
    "000000320022": ("0000004200", "0000001200", "",     "1100", "JHB-F2"),
    "000000300018": ("0000004150", "0000001200", "",     "1000", "GER-WS"),
    "000000310006": ("0000004300", "0000001300", "",     "1000", "GER-YARD"),
    "000000310001": ("",           "0000001300", "",     "1000", "GER-YARD"),
    "000000300017": ("",           "",           "",     "",     ""),
}
# depreciation areas: (AFABE, AFASL, NDJAR, NDPER) per asset class
AREAS = {
    "00003000": [("01", "LINA", "010", "000"), ("15", "LINA", "005", "000")],
    "00003100": [("01", "LINA", "005", "000"), ("15", "LINA", "004", "000")],
    "00003200": [("01", "LINA", "003", "000"), ("15", "LINA", "003", "000")],
    "00001000": [("01", "0000", "000", "000"), ("15", "0000", "000", "000")],
}


def _start(aktiv: str) -> str:
    """Ordinary depreciation start: first day of the capitalisation period (period control 01)."""
    return "00000000" if aktiv == "00000000" else aktiv[:6] + "01"


def _frames() -> TableFrames:
    cols = ["ANLN1", "ANLN2", "ANLKL", "TXT50", "TXA50", "INVNR", "AKTIV", "ZUGDT", "ERDAT", "AEDAT", "XLOEV",
            "DEAKT", "XSPEB", "STADT"]
    anla = pd.DataFrame({f"ANLA.{c}": [a[i] for a in ASSETS] for i, c in enumerate(cols)})
    anla.insert(0, "ANLA.BUKRS", "1000")
    anla["ANLA.ERNAM"] = ["TNKOSI"] * len(ASSETS)
    # quantity and unit (the docking station is a single piece; everything else carries no quantity)
    anla["ANLA.MENGE"] = ["1.000" if a[0] == "000000320021" and a[1] == "0001" else "0.000" for a in ASSETS]
    anla["ANLA.MEINS"] = ["ST" if a[0] == "000000320021" and a[1] == "0001" else "" for a in ASSETS]

    anlb_rows = []
    for a in ASSETS:
        for afabe, afasl, ndjar, ndper in AREAS[a[2]]:
            if a[0] == "000000300014":
                afasl = "ZL05"  # defect AA032: depreciation key not defined in the chart of depreciation
            afabg = _start(a[6])
            if a[0] == "000000320022" and afabe == "15":
                afabg = "00000000"  # defect AA016: tax area never got its depreciation start date
            saprz, safbg, aedat = "0.0000", "00000000", "00000000"
            if a[0] == "000000300012":
                aedat = a[9]
                if afabe == "15":  # special tax depreciation 20 % from the capitalisation period
                    saprz, safbg = "20.0000", afabg
            anlb_rows.append(("1000", a[0], a[1], afabe, "99991231", "19000101", afasl, ndjar, ndper, afabg, safbg,
                              saprz, a[8], aedat))
    anlb = pd.DataFrame(anlb_rows, columns=[f"ANLB.{c}" for c in (
        "BUKRS", "ANLN1", "ANLN2", "AFABE", "BDATU", "ADATU", "AFASL", "NDJAR", "NDPER", "AFABG", "SAFBG", "SAPRZ",
        "ERDAT", "AEDAT")])

    anlz_rows = [("1000", a[0], a[1], "99991231", a[6] if a[6] != "00000000" else a[8], *CURRENT[a[0]])
                 for a in ASSETS]
    # history: the lathe moved from cost centre 4100 to 4120 on 1 Jan 2024 (old segment must be ignored)
    anlz_rows.append(("1000", "000000300012", "0000", "20231231", "20210315", "", "", "", "", ""))
    # defect AA034: the docking station's first segment ends (29 Feb) before it starts (1 Mar)
    anlz_rows.append(("1000", "000000320021", "0001", "20240229", "20240301", "0000004010", "0000001000", "",
                      "1100", "JHB-F3"))
    anlz = pd.DataFrame(anlz_rows, columns=[f"ANLZ.{c}" for c in (
        "BUKRS", "ANLN1", "ANLN2", "BDATU", "ADATU", "KOSTL", "PRCTR", "GSBER", "WERKS", "STORT")])
    return TableFrames({"ANLA": anla, "ANLB": anlb, "ANLZ": anlz}, D, module="asset_accounting")


def _live_config(rules) -> dict[str, set[str]]:
    """The system's own check tables, as discovery would read them."""
    values = {"AFASL": {"LINA", "LINR", "DG20", "GWG", "0000"}}
    out = {}
    for r in rules:
        if r.get("check_class") in ("referential_check", "domain_value_check") and r["field"].split(".")[1] in values:
            key = _with_reference(r, D, {}).get("_reference_key")
            if key:
                out[key] = values[r["field"].split(".")[1]]
    return out


def test_asset_accounting_golden():
    static = yaml.safe_load(_find_module_yaml("asset_accounting").read_text())["rules"]
    results = run_checks("asset_accounting", _frames(), "t", reference_values=_live_config(static),
                         extra_rules=generate("asset_accounting", static, D))
    errors = {r.check_id: r.error for r in results if r.error}
    assert not errors, errors
    found = {r.check_id: set(r.failing_record_keys or []) for r in results if r.affected_count}
    assert found == {
        "AA008": {"BUKRS=1000|ANLN1=000000300013|ANLN2=0000"},             # no cost centre
        "AA032": {"BUKRS=1000|ANLN1=000000300014|ANLN2=0000|AFABE=01|BDATU=99991231",
                  "BUKRS=1000|ANLN1=000000300014|ANLN2=0000|AFABE=15|BDATU=99991231"},  # key ZL05 not in T090NA
        "ST-ANLA": {"BUKRS=1000|ANLN1=000000300015|ANLN2=0000"},           # 'Obsolete' but not blocked
        "DO-ANLA": {"BUKRS=1000|ANLN1=000000300016|ANLN2=0000"},           # changed before created
        "PH-ANLA-STADT": {"BUKRS=1000|ANLN1=000000310005|ANLN2=0000"},     # 'N/A' as municipality
        "AA016": {"BUKRS=1000|ANLN1=000000320022|ANLN2=0000|AFABE=15|BDATU=99991231"},  # no dep. start date
        "AA033": {"BUKRS=1000|ANLN1=000000310006|ANLN2=0000"},             # deactivated before capitalised
        "AA034": {"BUKRS=1000|ANLN1=000000320021|ANLN2=0001|BDATU=20240229"},  # segment ends before it starts
        "AA037": {"BUKRS=1000|ANLN1=000000300012|ANLN2=0000",
                  "BUKRS=1000|ANLN1=000000300018|ANLN2=0000"},             # two main assets, one tag
    }, found
    # the sold vehicle and the scrapped trailer are deactivated and the lathe created in error is
    # flagged for deletion: out of the population, counted
    for check_id in ("AA008", "AA014", "AA009"):
        r = next(r for r in results if r.check_id == check_id)
        assert r.details["population_excluded"] == {"deleted": 1, "deactivated": 2}, check_id
    areas = next(r for r in results if r.check_id == "AA005")
    assert areas.details["population_excluded"] == {"deleted": 2, "deactivated": 4}
