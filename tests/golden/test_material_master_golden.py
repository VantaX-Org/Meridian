"""Golden dataset: the whole material-master pipeline (shipped + generated rules,
active population, joins, live configuration) on materials whose correct
findings are known. Clean materials must produce no finding at all — any
failure on them is a false positive; each seeded defect must be found exactly
where it was put.

Clean materials (a senior MM consultant would sign them off):
  100100  FERT  centrifugal pump — produced in 1000, stock-transferred to 1100, sold
  200050  HALB  machined pump housing — produced in 1000, never sold
  300010  ROH   stainless bar 316L — purchased, batch managed, never sold
  400200  HAWA  mechanical seal kit — purchased and resold
  500075  ERSA  deep-groove ball bearing — purchased spare part, reorder point
One seeded defect each:
  100900  MATKL blank                                       MM007   null
  300020  MRP type Z9 not in the system's T438A             MM023   domain (live config)
  400300  net weight above gross weight                      MM041   cross-field
  400310  base unit in MARM converts 10:1 to itself          MM150   cross-object (MARM ↔ MARA)
  500080  EAN-13 with a wrong check digit                    MM018B  format
  500090  supplier URL in the material description           VP-MAKT-MAKTX  generated (misplaced)
  300030  "DO NOT USE" in the description, no status block  ST-MARA generated (status text)
  200060  standard price 0 on a standard-priced plant        MM043   cross-field (valuation)
  500095  price unit 0 in the accounting view                MM151   cross-field (valuation)
  400330  weights maintained without a weight unit            MM159   cross-field (unit of a quantity)
  300040  negative quality-inspection stock in MARD           MM157   cross-field (stock)
  500097  HB lot sizing: maximum stock below reorder point    MM171   cross-field (MRP parameters)
  300050  plant-specific status Z9 not in the system's T141   MM182   referential (live config)
Population:
  300099  flagged for deletion (MARA.LVORM) — and incomplete: excluded, counted
  300010 / plant 1100 flagged for deletion at plant level (MARC.LVORM): excluded, counted
"""

import pandas as pd
import yaml

from checks.frames import TableFrames
from checks.runner import _find_module_yaml, _with_reference, run_checks
from checks.value_placement import generate
from sap.ddic import get_dictionary

D = get_dictionary("ecc6")


def _m(n: int) -> str:
    return f"{n:018d}"  # MATN1 internal format


def _table(name: str, rows: list[dict]) -> pd.DataFrame:
    return pd.DataFrame([{f"{name}.{k}": v for k, v in r.items()} for r in rows])


def _mara(matnr, mtart, matkl, meins, brgew, ntgew, volum, voleh, ean11="", numtp="", pstat="", spart="01",
          prdha="", xchpf="", mfrnr="", mfrpn="", tragr="", mtpos="NORM", ersda="20190312", laeda="20240611",
          lvorm="", mstae="", mbrsh="M", gewei="KG") -> dict:
    return {"MATNR": matnr, "ERSDA": ersda, "ERNAM": "MDM_JNAIDOO", "LAEDA": laeda, "AENAM": "MDM_PSMIT",
            "VPSTA": pstat, "PSTAT": pstat, "LVORM": lvorm, "MTART": mtart, "MBRSH": mbrsh, "MATKL": matkl,
            "MEINS": meins, "BSTME": "", "GEWEI": gewei, "BRGEW": brgew, "NTGEW": ntgew, "VOLUM": volum,
            "VOLEH": voleh, "EAN11": ean11, "NUMTP": numtp, "MSTAE": mstae, "SPART": spart, "PRDHA": prdha,
            "XCHPF": xchpf, "KZKFG": "", "MFRNR": mfrnr, "MFRPN": mfrpn, "QMPUR": "", "TRAGR": tragr,
            "MTPOS_MARA": mtpos, "MHDHB": "0", "MHDRZ": "0"}


def _marc(matnr, werks, beskz, pstat, dismm="PD", dispo="101", disls="EX", sobsl="", prctr="0000010100",
          abcin="B", fevor="", awsls="", lgfsb="", plifz="0", minbe="0.000", mabst="0.000", bstfe="0.000",
          bstmi="0.000", bstma="0.000", herkl="ZA", ladgr="", xchpf="", sernp="", lvorm="", mmsta="",
          eisbe="0.000") -> dict:
    return {"MATNR": matnr, "WERKS": werks, "PSTAT": pstat, "LVORM": lvorm, "DISMM": dismm, "DISPO": dispo,
            "DISLS": disls, "BESKZ": beskz, "SOBSL": sobsl, "PRCTR": prctr, "ABCIN": abcin, "FEVOR": fevor,
            "SERNP": sernp, "AWSLS": awsls, "BSTFE": bstfe, "MABST": mabst, "MINBE": minbe, "BSTMI": bstmi,
            "BSTMA": bstma, "FHORI": "000", "HERKL": herkl, "KORDB": "", "LADGR": ladgr, "LGFSB": lgfsb,
            "PERKZ": "M", "PLIFZ": plifz, "FABKZ": "", "EKGRP": "001", "XCHPF": xchpf, "MMSTA": mmsta,
            "EISBE": eisbe, "XMCNG": ""}


def _mbew(matnr, bwkey, vprsv, stprs, verpr, bklas, ekalr="", lvorm="", peinh="1", lbkum="1.000") -> dict:
    return {"MATNR": matnr, "BWKEY": bwkey, "BWTAR": "", "LVORM": lvorm, "VPRSV": vprsv, "STPRS": stprs,
            "VERPR": verpr, "PEINH": peinh, "BKLAS": bklas, "EKALR": ekalr, "LBKUM": lbkum}


def _frames() -> TableFrames:
    pump, housing, bar, seal, bearing = _m(100100), _m(200050), _m(300010), _m(400200), _m(500075)
    no_matkl, bad_dismm, heavy_net, bad_marm = _m(100900), _m(300020), _m(400300), _m(400310)
    bad_ean, url_text, dead_text, zero_std, deleted = _m(500080), _m(500090), _m(300030), _m(200060), _m(300099)
    zero_peinh, no_gewei, neg_insp, max_below_rop, bad_mmsta = _m(500095), _m(400330), _m(300040), _m(500097), _m(300050)

    mara = _table("MARA", [
        _mara(pump, "FERT", "PUMPS", "ST", "48.500", "42.000", "96.000", "L", "6009876000101", "HE",
              "KVEDLBGAPQ", prdha="000100001000000010", tragr="0001"),
        _mara(housing, "HALB", "CASTINGS", "ST", "18.200", "18.200", "9.500", "L", pstat="KDLABG"),
        _mara(bar, "ROH", "STEEL", "KG", "1.000", "1.000", "0.125", "L", pstat="KECDLBQ", xchpf="X"),
        _mara(seal, "HAWA", "SEALS", "ST", "0.450", "0.380", "0.600", "L", "6009876000200", "HE", "KVEDLB",
              prdha="000100003000000020", mfrnr="0000300012", mfrpn="MG1/35-G60", tragr="0001"),
        _mara(bearing, "ERSA", "BEARINGS", "ST", "0.120", "0.110", "0.090", "L", "6009876000309", "HE", "KEDLB",
              mfrnr="0000300045", mfrpn="6205-2RSH"),
        # seeded defects — one each
        _mara(no_matkl, "FERT", "", "ST", "61.000", "55.000", "120.000", "L", pstat="KDLABG"),
        _mara(bad_dismm, "ROH", "STEEL", "KG", "1.000", "1.000", "0.125", "L", pstat="KEDLB", xchpf="X"),
        _mara(heavy_net, "HAWA", "SEALS", "ST", "4.800", "5.200", "6.000", "L", pstat="KEDLB",
              mfrnr="0000300012", mfrpn="MG12/60-G60"),
        _mara(bad_marm, "HAWA", "SEALS", "ST", "0.500", "0.420", "0.600", "L", pstat="KEDLB",
              mfrnr="0000300012", mfrpn="MG1/40-G60"),
        _mara(bad_ean, "ERSA", "BEARINGS", "ST", "0.150", "0.140", "0.100", "L", "6009876000409", "HE", "KEDLB",
              mfrnr="0000300045", mfrpn="6206-2RSH"),
        _mara(url_text, "ERSA", "BELTS", "ST", "0.300", "0.280", "0.400", "L", pstat="KEDLB",
              mfrnr="0000300077", mfrpn="SPA 1250 LW"),
        _mara(dead_text, "ROH", "STEEL", "KG", "1.000", "1.000", "0.125", "L", pstat="KEDLB"),
        _mara(zero_std, "HALB", "CASTINGS", "ST", "22.000", "22.000", "11.000", "L", pstat="KDLABG"),
        _mara(zero_peinh, "ERSA", "BEARINGS", "ST", "0.180", "0.170", "0.110", "L", pstat="KEDLB",
              mfrnr="0000300045", mfrpn="6207-2RSH"),
        _mara(no_gewei, "HAWA", "SEALS", "ST", "0.520", "0.450", "0.600", "L", pstat="KEDLB", gewei="",
              mfrnr="0000300012", mfrpn="MG1/45-G60"),
        _mara(neg_insp, "ROH", "STEEL", "KG", "1.000", "1.000", "0.125", "L", pstat="KEDLB"),
        _mara(max_below_rop, "ERSA", "BEARINGS", "ST", "0.250", "0.230", "0.150", "L", pstat="KEDLB",
              mfrnr="0000300045", mfrpn="6208-2RSH"),
        _mara(bad_mmsta, "ROH", "STEEL", "KG", "1.000", "1.000", "0.125", "L", pstat="KEDLB"),
        # flagged for deletion — and incomplete (no material group): out of the population
        _mara(deleted, "ROH", "", "KG", "1.000", "1.000", "0.125", "L", pstat="KEDLB", lvorm="X",
              ersda="20110405", laeda="20230118"),
    ])
    makt = _table("MAKT", [{"MATNR": m, "SPRAS": "E", "MAKTX": t} for m, t in [
        (pump, "Centrifugal pump CP-200 stainless"), (housing, "Pump housing CP-200 machined"),
        (bar, "Round bar 316L 50mm"), (seal, "Mechanical seal kit MG1 35mm"),
        (bearing, "Deep groove ball bearing 6205-2RSH"), (no_matkl, "Centrifugal pump CP-300 stainless"),
        (bad_dismm, "Round bar 304 40mm"), (heavy_net, "Mechanical seal kit MG12 60mm"),
        (bad_marm, "Mechanical seal kit MG1 40mm"), (bad_ean, "Deep groove ball bearing 6206-2RSH"),
        (url_text, "V-belt SPA 1250 see www.optibelt.com"), (dead_text, "Plate 316L 10mm DO NOT USE"),
        (zero_std, "Impeller CP-300 cast"), (deleted, "Round bar 316L 60mm"),
        (zero_peinh, "Deep groove ball bearing 6207-2RSH"), (no_gewei, "Mechanical seal kit MG1 45mm"),
        (neg_insp, "Plate 316L 12mm"), (max_below_rop, "Deep groove ball bearing 6208-2RSH"),
        (bad_mmsta, "Round bar 304 60mm"),
    ]])
    marc = _table("MARC", [
        _marc(pump, "1000", "E", "VDLABGQ", fevor="001", awsls="000001", abcin="A", ladgr="0001", sernp="0001"),
        _marc(pump, "1100", "F", "VDLB", sobsl="40", lgfsb="0001", plifz="3", dispo="201", ladgr="0001",
              sernp="0001"),
        _marc(housing, "1000", "E", "DLABG", fevor="001", awsls="000001"),
        _marc(bar, "1000", "F", "EDLBQ", lgfsb="0001", plifz="21", herkl="ZA", xchpf="X", abcin="A"),
        # plant 1100 stopped using the bar: deleted at plant level, its MRP data never completed
        _marc(bar, "1100", "F", "EDLB", prctr="", dispo="", lgfsb="0001", plifz="21", lvorm="X"),
        _marc(seal, "1000", "F", "VEDLB", lgfsb="0001", plifz="28", herkl="DE", ladgr="0001", disls="FX",
              bstfe="50.000"),
        _marc(bearing, "1000", "F", "EDLB", dismm="VB", disls="HB", minbe="20.000", mabst="100.000",
              lgfsb="0002", plifz="10", herkl="IT", abcin="C", bstmi="10.000", bstma="200.000"),
        _marc(no_matkl, "1000", "E", "DLABG", fevor="001", awsls="000001"),
        _marc(bad_dismm, "1000", "F", "EDLB", dismm="Z9", lgfsb="0001", plifz="21", xchpf="X"),
        _marc(heavy_net, "1000", "F", "EDLB", lgfsb="0001", plifz="28", herkl="DE"),
        _marc(bad_marm, "1000", "F", "EDLB", lgfsb="0001", plifz="28", herkl="DE"),
        _marc(bad_ean, "1000", "F", "EDLB", dismm="VB", disls="HB", minbe="10.000", mabst="60.000", lgfsb="0002",
              plifz="10", herkl="IT", abcin="C"),
        _marc(url_text, "1000", "F", "EDLB", lgfsb="0002", plifz="7", herkl="DE", abcin="C"),
        _marc(dead_text, "1000", "F", "EDLB", lgfsb="0001", plifz="21"),
        _marc(zero_std, "1000", "E", "DLABG", fevor="001", awsls="000001"),
        _marc(deleted, "1000", "F", "EDLB", prctr="", lgfsb="0001", plifz="21"),
        _marc(zero_peinh, "1000", "F", "EDLB", lgfsb="0002", plifz="10", herkl="IT", abcin="C"),
        _marc(no_gewei, "1000", "F", "EDLB", lgfsb="0001", plifz="28", herkl="DE"),
        _marc(neg_insp, "1000", "F", "EDLB", lgfsb="0001", plifz="21", mmsta="01"),
        _marc(max_below_rop, "1000", "F", "EDLB", dismm="VB", disls="HB", minbe="20.000", mabst="15.000",
              eisbe="5.000", lgfsb="0002", plifz="10", herkl="IT", abcin="C"),
        _marc(bad_mmsta, "1000", "F", "EDLB", lgfsb="0001", plifz="21", mmsta="Z9"),
    ])
    mbew = _table("MBEW", [
        _mbew(pump, "1000", "S", "18450.00", "18450.00", "7920", ekalr="X"),
        _mbew(pump, "1100", "S", "18450.00", "18450.00", "7920", ekalr="X"),
        _mbew(housing, "1000", "S", "3120.00", "3120.00", "7900", ekalr="X"),
        _mbew(bar, "1000", "V", "0.00", "62.50", "3000"),
        _mbew(bar, "1100", "V", "0.00", "61.80", "3000", lvorm="X"),
        _mbew(seal, "1000", "V", "0.00", "1240.00", "3100"),
        _mbew(bearing, "1000", "V", "0.00", "86.40", "3040"),
        _mbew(no_matkl, "1000", "S", "24900.00", "24900.00", "7920", ekalr="X"),
        _mbew(bad_dismm, "1000", "V", "0.00", "48.10", "3000"),
        _mbew(heavy_net, "1000", "V", "0.00", "2980.00", "3100"),
        _mbew(bad_marm, "1000", "V", "0.00", "1390.00", "3100"),
        _mbew(bad_ean, "1000", "V", "0.00", "104.20", "3040"),
        _mbew(url_text, "1000", "V", "0.00", "212.00", "3040"),
        _mbew(dead_text, "1000", "V", "0.00", "75.30", "3000"),
        _mbew(zero_std, "1000", "S", "0.00", "0.00", "7900", ekalr="X"),
        _mbew(deleted, "1000", "V", "0.00", "60.00", "3000"),
        _mbew(zero_peinh, "1000", "V", "0.00", "0.00", "3040", peinh="0", lbkum="0.000"),
        _mbew(no_gewei, "1000", "V", "0.00", "1450.00", "3100"),
        _mbew(neg_insp, "1000", "V", "0.00", "71.20", "3000"),
        _mbew(max_below_rop, "1000", "V", "0.00", "131.00", "3040"),
        _mbew(bad_mmsta, "1000", "V", "0.00", "52.40", "3000"),
    ])
    mvke = _table("MVKE", [
        {"MATNR": m, "VKORG": "1000", "VTWEG": "10", "LVORM": "", "DWERK": "1000", "KTGRM": "01",
         "MTPOS": "NORM", "PRODH": p, "VERSG": "1"}
        for m, p in [(pump, "000100001000000010"), (seal, "000100003000000020")]
    ])
    marm = _table("MARM", [{"MATNR": m, "MEINH": u, "UMREZ": z, "UMREN": n} for m, u, z, n in [
        (pump, "ST", "1", "1"), (pump, "PAL", "4", "1"),
        (housing, "ST", "1", "1"),
        (bar, "KG", "1", "1"), (bar, "M", "154", "10"),
        (seal, "ST", "1", "1"), (seal, "KAR", "10", "1"),
        (bearing, "ST", "1", "1"), (bearing, "PAK", "10", "1"),
        (no_matkl, "ST", "1", "1"), (bad_dismm, "KG", "1", "1"), (heavy_net, "ST", "1", "1"),
        (bad_marm, "ST", "10", "1"),
        (bad_ean, "ST", "1", "1"), (url_text, "ST", "1", "1"), (dead_text, "KG", "1", "1"),
        (zero_std, "ST", "1", "1"), (deleted, "KG", "1", "1"),
        (zero_peinh, "ST", "1", "1"), (no_gewei, "ST", "1", "1"), (neg_insp, "KG", "1", "1"),
        (max_below_rop, "ST", "1", "1"), (bad_mmsta, "KG", "1", "1"),
    ]])
    # storage-location stock (MARD): 300040 has negative quality-inspection stock (defect)
    mard = _table("MARD", [
        {"MATNR": m, "WERKS": "1000", "LGORT": lg, "LVORM": "", "LABST": lab, "INSME": ins, "SPEME": "0.000",
         "RETME": "0.000", "EINME": "0.000", "UMLME": "0.000", "DISKZ": "", "LBSTF": "0.000", "ERSDA": "20190312"}
        for m, lg, lab, ins in [(pump, "0001", "6.000", "0.000"), (bar, "0001", "1250.000", "40.000"),
                                (seal, "0001", "64.000", "0.000"), (bearing, "0002", "85.000", "0.000"),
                                (neg_insp, "0001", "300.000", "5.000-")]
    ])
    # every default procurement storage location is extended (MM235), even where nothing is in stock yet
    have = set(zip(mard["MARD.MATNR"], mard["MARD.WERKS"], mard["MARD.LGORT"]))
    empty = {**mard.iloc[0].to_dict(), "MARD.LABST": "0.000", "MARD.INSME": "0.000"}
    mard = pd.concat([mard, pd.DataFrame([
        {**empty, "MARD.MATNR": m, "MARD.WERKS": w, "MARD.LGORT": lg}
        for m, w, lg in zip(marc["MARC.MATNR"], marc["MARC.WERKS"], marc["MARC.LGFSB"]) if lg and (m, w, lg) not in have
    ])], ignore_index=True)
    # a plant row with the storage view (L) has at least one storage location row
    located = set(mard["MARD.MATNR"] + "|" + mard["MARD.WERKS"])
    bare = marc[marc["MARC.PSTAT"].str.contains("L") & ~(marc["MARC.MATNR"] + "|" + marc["MARC.WERKS"]).isin(located)]
    mard = pd.concat([mard, pd.DataFrame([
        {**empty, "MARD.MATNR": m, "MARD.WERKS": w, "MARD.LGORT": "0001"}
        for m, w in zip(bare["MARC.MATNR"], bare["MARC.WERKS"])
    ])], ignore_index=True)

    # the valuated quantity covers the storage location stock (unrestricted, quality inspection, blocked)
    def qty(s: str) -> float:
        return 0.0 if s.endswith("-") else float(s)  # the seeded negative stock is a defect of its own (MM157)
    stock: dict[tuple[str, str], float] = {}
    for _, r in mard.iterrows():
        k = (r["MARD.MATNR"], r["MARD.WERKS"])
        stock[k] = stock.get(k, 0.0) + sum(qty(r[f"MARD.{c}"]) for c in ("LABST", "INSME", "SPEME"))
    mbew["MBEW.LBKUM"] = [f"{stock[k]:.3f}" if stock.get(k, 0) > 1 else v
                          for k, v in zip(zip(mbew["MBEW.MATNR"], mbew["MBEW.BWKEY"]), mbew["MBEW.LBKUM"])]
    return TableFrames({"MARA": mara, "MAKT": makt, "MARC": marc, "MBEW": mbew, "MVKE": mvke, "MARM": marm,
                        "MARD": mard}, D,
                       module="material_master")


def _live_config(rules) -> dict[str, set[str]]:
    """The system's own check tables, as discovery would read them."""
    units = {"ST", "KG", "G", "TO", "L", "ML", "M3", "CDM", "M", "MM", "PAL", "KAR", "PAK", "H", "MIN"}
    values = {
        "MTART": {"FERT", "HALB", "ROH", "HAWA", "ERSA", "VERP", "DIEN", "NLAG", "HERS"},
        "MATKL": {"PUMPS", "CASTINGS", "STEEL", "SEALS", "BEARINGS", "BELTS", "PACKAGING"},
        "MEINS": units, "GEWEI": units, "VOLEH": units,
        "MBRSH": {"M", "C", "P", "A"},
        "MSTAE": {"01", "02"},
        "DISMM": {"PD", "VB", "V1", "VV", "ND"},
        "SERNP": {"0001"},
        "ABCIN": {"A", "B", "C"},
        "MMSTA": {"01", "02"},
    }
    out = {}
    for r in rules:
        if r.get("check_class") in ("referential_check", "domain_value_check") and r["field"].split(".")[1] in values:
            key = _with_reference(r, D, {}).get("_reference_key")
            if key:
                out[key] = values[r["field"].split(".")[1]]
    return out


def test_material_master_golden():
    static = yaml.safe_load(_find_module_yaml("material_master").read_text())["rules"]
    results = run_checks("material_master", _frames(), "t", reference_values=_live_config(static),
                         extra_rules=generate("material_master", static, D))
    errors = {r.check_id: r.error for r in results if r.error}
    assert not errors, errors
    found = {r.check_id: set(r.failing_record_keys or []) for r in results if r.affected_count}
    assert found == {
        "MM007": {"MATNR=000000000000100900"},                   # material group missing
        "MM023": {"MATNR=000000000000300020|WERKS=1000"},        # MRP type Z9 is not configured (T438A)
        "MM041": {"MATNR=000000000000400300"},                   # net weight 5.2 kg > gross 4.8 kg
        "MM150": {"MATNR=000000000000400310|MEINH=ST"},          # base unit converts 10:1 to itself
        "MM018B": {"MATNR=000000000000500080"},                  # EAN-13 check digit wrong
        "VP-MAKT-MAKTX": {"MATNR=000000000000500090"},           # supplier URL in the description
        "ST-MARA": {"MATNR=000000000000300030"},                 # "DO NOT USE" but no MSTAE block
        "MM043": {"MATNR=000000000000200060|WERKS=1000"},        # standard price 0 under price control S
        "MM151": {"MATNR=000000000000500095|WERKS=1000"},        # price unit 0 in the accounting view
        "MM159": {"MATNR=000000000000400330"},                   # weights without a weight unit
        "MM157": {"MATNR=000000000000300040|WERKS=1000|LGORT=0001"},  # negative quality-inspection stock
        "MM380": {"MATNR=000000000000300099|WERKS=1000"},        # plant row active though the material is flagged for deletion
        "MM399": {"MATNR=000000000000300010|WERKS=1100"},        # deleted plant row is still planned by MRP (PD)
        "MM521": {"MATNR=000000000000300040|WERKS=1000|LGORT=0001"},  # same defect as MM157: negative quality-inspection stock
        "MM171": {"MATNR=000000000000500097|WERKS=1000"},        # max stock 15 below reorder point 20 (HB)
        "MM182": {"MATNR=000000000000300050|WERKS=1000"},        # plant status Z9 not configured (T141)
    }, found
    # 300099 is flagged for deletion: out of every MARA-, MAKT- and plant-level rule, counted
    group = next(r for r in results if r.check_id == "MM007")
    assert group.details["population_excluded"] == {"deleted": 1}
    # at plant level the deleted material's plant and the bar's deleted plant 1100 are both excluded
    prctr = next(r for r in results if r.check_id == "MM029")
    assert prctr.details["population_excluded"] == {"deleted": 2}
    assert prctr.total_count == 19
