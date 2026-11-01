"""Exhaustive material-master gap rules (MM900 upward): IDs, schema contract and firing fixtures.

Each fixture flags a known subset of its records; most hold one failing and one passing record.
"""

import pandas as pd
import pytest
import yaml

from checks.frames import TableFrames
from checks.runner import run_rule
from sap.ddic import get_dictionary

PACK = yaml.safe_load(open("checks/rules/ecc/material_master.yaml"))["rules"]
RULES = {r["id"]: r for r in PACK}
NEW = [r for r in PACK if r["id"][2:].isdigit() and int(r["id"][2:]) >= 900]
DDIC = get_dictionary("ecc6")
OPS = {"strip", "collapse_spaces", "upper", "lower", "title", "pad_left", "strip_leading_zeros", "regex_replace",
       "truncate", "map", "set", "copy", "lookup", "date_format", "gtin_check_digit"}
ENRICHMENT = ("message", "why_it_matters", "rule_authority", "sap_impact", "fix_map", "record_fix_template")


def frame(table, **cols):
    return pd.DataFrame({f"{table}.{k}": v for k, v in cols.items()})


def fire(rid, tables, refs=None):
    frames = TableFrames(tables, DDIC, module="material_master")
    _, res = run_rule(dict(RULES[rid]), frames, refs)
    assert res is not None and not res.error, (rid, res and res.error)
    return res.affected_count, res.total_count


def kssk(**cols):
    base = {"OBJEK": ["M1", "M2"], "MAFID": ["O", "O"], "KLART": ["001", "001"], "CLINT": ["C1", "C2"],
            "LKENZ": ["", ""]}
    return frame("KSSK", **{**base, **cols})


def ausp(**cols):
    base = {"OBJEK": ["M1", "M2"], "ATINN": ["A1", "A2"], "KLART": ["001", "001"], "LKENZ": ["", ""]}
    return frame("AUSP", **{**base, **cols})


def cabn(**cols):
    base = {"ATINN": ["A1", "A2"], "ATNAM": ["COLOR", "SIZE"], "ATFOR": ["CHAR", "CHAR"], "ATTAB": ["", ""]}
    return frame("CABN", **{**base, **cols})


def mast(**cols):
    base = {"MATNR": ["M1", "M2"], "WERKS": ["P1", "P1"], "STLAN": ["1", "1"], "STLNR": ["1", "2"],
            "STLAL": ["01", "01"]}
    return frame("MAST", **{**base, **cols})


def stko(**cols):
    base = {"STLTY": ["M", "M"], "STLNR": ["1", "2"], "STLAL": ["01", "01"], "STKOZ": ["1", "1"],
            "LKENZ": ["", ""]}
    return frame("STKO", **{**base, **cols})


def mcha(**cols):
    base = {"MATNR": ["M1", "M2"], "WERKS": ["P1", "P1"], "CHARG": ["B1", "B2"]}
    return frame("MCHA", **{**base, **cols})


def mchb(**cols):
    base = {"MATNR": ["M1", "M2"], "WERKS": ["P1", "P1"], "LGORT": ["L1", "L1"], "CHARG": ["B1", "B2"]}
    return frame("MCHB", **{**base, **cols})


def eord(**cols):
    base = {"MATNR": ["M1", "M2"], "WERKS": ["P1", "P1"], "ZEORD": ["1", "1"]}
    return frame("EORD", **{**base, **cols})


def qinf(**cols):
    base = {"MATNR": ["M1", "M2"], "ZAEHL": ["1", "2"], "LIEFERANT": ["V1", "V1"], "WERK": ["P1", "P1"],
            "LOEKZ": ["", ""]}
    return frame("QINF", **{**base, **cols})


def marc(**cols):
    base = {"MATNR": ["M1", "M2"], "WERKS": ["P1", "P1"]}
    return frame("MARC", **{**base, **cols})


def mdma(**cols):
    base = {"MATNR": ["M1", "M2"], "WERKS": ["P1", "P1"], "BERID": ["A1", "A1"]}
    return frame("MDMA", **{**base, **cols})


def eina(**cols):
    base = {"INFNR": ["I1", "I2"], "MATNR": ["M1", "M2"], "LIFNR": ["V1", "V1"], "LOEKZ": ["", ""]}
    return frame("EINA", **{**base, **cols})


def stpo(**cols):
    base = {"STLTY": ["M", "M"], "STLNR": ["1", "2"], "STLKN": ["1", "1"], "STPOZ": ["1", "1"], "POSNR": ["0010", "0010"],
            "POSTP": ["L", "L"], "IDNRK": ["C1", "C2"], "LKENZ": ["", ""]}
    return frame("STPO", **{**base, **cols})


def mkal(**cols):
    base = {"MATNR": ["M1", "M2"], "WERKS": ["P1", "P1"], "VERID": ["0001", "0001"]}
    return frame("MKAL", **{**base, **cols})


def plko(**cols):
    base = {"PLNTY": ["N"], "PLNNR": ["G1"], "PLNAL": ["01"], "PLNKN": ["1"], "ZAEHL": ["1"]}
    return frame("PLKO", **{**base, **cols})


MARD2 = frame("MARD", MATNR=["M1", "M2"], WERKS=["P1", "P1"], LGORT=["L9", "L2"])
Z = ["0", "0"]



def mara(**cols):
    return frame("MARA", **{"MATNR": ["M1", "M2"], **cols})


def mbew(**cols):
    return frame("MBEW", **{"MATNR": ["M1", "M2"], "BWKEY": ["P1", "P1"], "BWTAR": ["", ""], **cols})


def mvke(**cols):
    return frame("MVKE", **{"MATNR": ["M1", "M2"], "VKORG": ["S1", "S1"], "VTWEG": ["01", "01"], **cols})


def mard(**cols):
    return frame("MARD", **{"MATNR": ["M1", "M2"], "WERKS": ["P1", "P1"], "LGORT": ["L1", "L1"], **cols})


# Referential rules MM998+: (rule, maker, field, check table reference key). Row 1 is unknown, row 2 is configured.
REF4 = [
    ("MM998", marc, "PERIV", "T009.PERIV"), ("MM999", marc, "DISGR", "T438M.MTART"),
    ("MM1000", marc, "LFRHY", "T439G.MRPPP"), ("MM1001", marc, "RDPRF", "RDPR.RDPRF"),
    ("MM1002", marc, "AUFTL", "T439P.AUFTL"), ("MM1003", marc, "STLAN", "T416.STLAN"),
    ("MM1004", marc, "PLNTY", "TCA01.PLNTY"), ("MM1005", marc, "SOBSK", "T460A.SOBSL"),
    ("MM1006", marc, "VRBWK", "T001W.WERKS"), ("MM1007", marc, "VRBMT", "MARA.MATNR"),
    ("MM1008", marc, "STDPD", "MARA.MATNR"), ("MM1009", marc, "MFRGR", "TMFG.MFRGR"),
    ("MM1010", marc, "LOGGR", "TLOG.LOGGR"), ("MM1011", marc, "FPRFM", "TMFPF.FPRFM"),
    ("MM1012", marc, "MEGRU", "TWMEG.MEGRU"), ("MM1013", marc, "STEUC", "T604F.STEUC"),
    ("MM1014", marc, "VSPVB", "PVBE.PRVBE"), ("MM1015", marc, "MDACH", "T46AC.MDACH"),
    ("MM1016", marc, "OCMPF", "TCO48.GPROFILE"), ("MM1017", marc, "BWSCL", "TMBW1.BWSCL"),
    ("MM1026", mara, "PMATA", "MARA.MATNR"), ("MM1027", mara, "RBNRM", "T352B.RBNR"),
    ("MM1028", mara, "KOSCH", "T190S.KOSCH"), ("MM1029", mara, "MPROF", "TMPPF.MPROF"),
    ("MM1030", mara, "HUTYP", "THUTYP.HUTYP"), ("MM1031", mara, "HUTYP_DFLT", "THUTYP.HUTYP"),
    ("MM1032", mara, "QQTIMEUOM", "T006.MSEHI"), ("MM1033", mara, "ADPROF", "TAPROF.ADPROF"),
    ("MM1034", mara, "MEDIUM", "T372M.MEDIU"), ("MM1035", mara, "CWQPROC", "TCWQPROC.CWQPROC"),
    ("MM1036", mara, "CWQTOLGR", "TCWQTOLGR.CWQTOLGR"), ("MM1037", mara, "BWSCL", "TMBW1.BWSCL"),
    ("MM1038", mara, "RMATP", "MARA.MATNR"), ("MM1043", mbew, "OKLAS", "T025.BKLAS"),
    ("MM1044", mbew, "VJBKL", "T025.BKLAS"), ("MM1045", mbew, "BWVA1", "TCK05.BWVAR"),
    ("MM1046", mbew, "BWVA2", "TCK05.BWVAR"), ("MM1047", mbew, "BWVA3", "TCK05.BWVAR"),
    ("MM1054", mvke, "RDPRF", "RDPR.RDPRF"), ("MM1055", mvke, "MEGRU", "TWMEG.MEGRU"),
    ("MM1060", mard, "HERKL", "T005.LAND1"),
]

CASES = {
    "MM900": {"KSSK": kssk(STATU=["", "1"])},
    "MM901": {"KSSK": kssk(OBJEK=["M1", "M1", "M2"], MAFID=["O"] * 3, KLART=["001"] * 3,
                           CLINT=["C1", "C2", "C3"], LKENZ=[""] * 3, STDCL=["X", "X", "X"])},
    "MM902": {"KSSK": kssk(), "KLAH": frame("KLAH", CLINT=["C1", "C2"], KLART=["001", "023"])},
    "MM903": {"KSSK": kssk(), "KLAH": frame("KLAH", CLINT=["C1", "C2"], BISDT=["20000101", "99991231"])},
    "MM904": {"AUSP": ausp(DATUV=["20200101", "20200101"], DATUB=["20190101", "99991231"])},
    "MM905": {"AUSP": ausp(), "CABN": cabn(LKENZ=["X", ""])},
    "MM906": {"AUSP": ausp(ATINN=["A1", "A1"], ATWRT=["RED", "BLUE"]),
              "CAWN": frame("CAWN", ATINN=["A1", "A1"], ATWRT=["RED", "BLUE"], LKENZ=["X", ""])},
    "MM907": {"INOB": frame("INOB", CUOBJ=["1", "2"], OBTAB=["MARA", "MARA"], OBJEK=["", "M1"])},
    "MM908": {"INOB": frame("INOB", CUOBJ=["1", "2", "3"], OBTAB=["MARA"] * 3, OBJEK=["M1", "M1", "M2"],
                            KLART=["001"] * 3)},
    "MM909": {"CABN": cabn(ATINT=["X", "X"], ATFOR=["CHAR", "NUM"])},
    "MM910": {"CABN": cabn(ATVOR=["X", "X"], ATFOR=["DATE", "NUM"])},
    "MM911": {"CABN": cabn(ATKLE=["X", "X"], ATFOR=["NUM", "CHAR"])},
    "MM912": {"CABN": cabn(ANZDZ=["2", "0"])},
    "MM913": {"CABN": cabn(ATTAB=["MARA", "MARA"], ATFEL=["", "BRGEW"])},
    "MM914": {"CABN": cabn(ATNAM=["", "SIZE"])},
    "MM915": {"CABN": cabn(ATFOR=["", "CHAR"])},
    "MM916": {"CAWN": frame("CAWN", ATINN=["A1"] * 3, ATZHL=["1", "2", "3"], ATWRT=["RED", "RED", "BLUE"],
                            LKENZ=[""] * 3)},
    "MM917": {"KLAH": frame("KLAH", CLINT=["1", "2", "3"], KLART=["001"] * 3, CLASS=["PUMPS", "PUMPS", "VALVES"])},
    "MM918": {"MAST": mast(STLAN=["", "1"])},
    "MM919": {"MAST": mast(STLAL=["", "01"])},
    "MM920": {"MAST": mast(MATNR=["M1", "M1", "M2"], WERKS=["P1"] * 3, STLAN=["1"] * 3, STLNR=["1", "2", "3"],
                           STLAL=["01", "02", "01"])},
    "MM921": {"MAST": mast(), "STKO": stko(STLAL=["01", "02"])},
    "MM922": {"MAST": mast(), "MARC": frame("MARC", MATNR=["M1", "M2"], WERKS=["P1", "P1"], LVORM=["X", ""])},
    "MM923": {"MAST": mast(), "STKO": stko(BMEIN=["EA", "EA"]),
              "MARM": frame("MARM", MATNR=["M1", "M2"], MEINH=["KG", "EA"])},
    "MM924": {"STKO": stko(BMENG=["0", "1"])},
    "MM925": {"STKO": stko(BMEIN=["", "EA"])},
    "MM926": {"STKO": stko(STLST=["", "1"])},
    "MM927": {"STKO": stko(DATUV=["", "20200101"])},
    "MM928": {"STKO": stko(STLAL=["", "01"])},
    "MM929": {"MCHA": mcha(), "MARC": marc(MATNR=["M2", "M3"])},
    "MM930": {"MCHA": mcha(HSDAT=["20240101", "20240101"], VFDAT=["20231231", "20250101"])},
    "MM931": {"MCHA": mcha(ERSDA=["20240101", "20240101"], LAEDA=["20231231", "20240201"])},
    "MM932": {"MCHA": mcha(HSDAT=["20240101", "20240101"], LWEDT=["20231231", "20240201"])},
    "MM933": {"MCHA": mcha(HSDAT=["29990101", "20240101"])},
    "MM934": {"MCHA": mcha(LWEDT=["29990101", "20240101"])},
    "MM935": {"MCHA": mcha(VERAB=["20250201", "20240101"], VFDAT=["20250101", "20250101"])},
    "MM936": {"MCHA": mcha(VLCHA=["B9", "B9"], VLMAT=["", "M9"])},
    "MM937": {"MCHA": mcha(LIFNR=["V9", "V1"]), "LFA1": frame("LFA1", LIFNR=["V1"])},
    "MM938": {"MCHA": mcha(VFDAT=["20200101", "20200101"], ZUSTD=["", "X"])},
    "MM939": {"MCHA": mcha(QNDAT=["20200101", "29990101"], ZUSTD=["", ""])},
    "MM940": {"MCHA": mcha(CHAME=["KG", "EA"]), "MARM": frame("MARM", MATNR=["M1", "M2"], MEINH=["EA", "EA"])},
    "MM941": {"MCHB": mchb(), "MCHA": mcha(MATNR=["M2"], WERKS=["P1"], CHARG=["B2"])},
    "MM942": {"MCHB": mchb(), "MARD": frame("MARD", MATNR=["M2"], WERKS=["P1"], LGORT=["L1"])},
    "MM943": {"MCHB": mchb(CEINM=[-1.0, 0.0], CINSM=[0.0, 0.0], CSPEM=[0.0, 0.0], CRETM=[0.0, 0.0],
                           CUMLM=[0.0, 5.0])},
    "MM944": {"MCHB": mchb(LVORM=["X", "X"], CLABS=[5.0, 0.0], CINSM=[0.0, 0.0], CSPEM=[0.0, 0.0],
                           CEINM=[0.0, 0.0], CRETM=[0.0, 0.0]), "MCHA": mcha(LVORM=["", ""])},
    "MM945": {"MCHB": mchb(), "MARC": marc(XCHAR=["", "X"])},
    "MM946": {"MCHB": mchb(CHDLL=["29990101", "20240101"])},
    "MM947": {"MCHB": mchb(ERSDA=["20240101", "20240101"], LAEDA=["20231231", "20240201"])},
    "MM948": {"MCHB": mchb(CLABS=[5.0, 0.0]), "MCHA": mcha(VFDAT=["20200101", "20200101"])},
    "MM949": {"EORD": eord(), "MARC": marc(MATNR=["M2", "M3"])},
    "MM950": {"EORD": eord(NOTKZ=["", ""]), "MARC": marc(LVORM=["X", ""])},
    "MM951": {"EORD": eord(LIFNR=["V1", "V1"], RESWK=["P2", ""])},
    "MM952": {"EORD": eord(RESWK=["P1", "P2"])},
    "MM953": {"EORD": eord(EMATN=["X9", "M1"]), "MARA": frame("MARA", MATNR=["M1", "M2"])},
    "MM954": {"EORD": eord(MATNR=["M1", "M1", "M2"], WERKS=["P1"] * 3, ZEORD=["1", "2", "1"],
                           VDATU=["20240101", "20240601", "20240101"], BDATU=["20241231", "20251231", "20241231"],
                           FLIFN=["X"] * 3, NOTKZ=[""] * 3)},
    "MM955": {"EORD": eord(VDATU=["20240601", "20240101"], BDATU=["20240101", "20241231"])},
    "MM956": {"EORD": eord(MEINS=["KG", "EA"]), "MARM": frame("MARM", MATNR=["M1", "M2"], MEINH=["EA", "EA"])},
    "MM957": {"QINF": qinf(), "MARC": marc(MATNR=["M2", "M3"])},
    "MM958": {"QINF": qinf(), "MARC": marc(LVORM=["X", ""])},
    "MM959": {"MDMA": mdma(EISBE=["50", "5"], MABST=["10", "10"])},
    "MM960": {"MDMA": mdma(MINBE=["5", "5"], DISMM=["PD", "VB"])},
    "MM961": {"MDMA": mdma(EISBE=["5", "5"], DISMM=["ND", "PD"])},
    "MM962": {"MDMA": mdma(SHZET=["02", "00"], SHFLG=["", ""])},
    "MM963": {"MDMA": mdma(SHZET=["00", "02"], SHFLG=["1", "1"])},
    "MM964": {"MDMA": mdma(FXHOR=["005", "000"], DISMM=["ND", "ND"])},
    "MM965": {"MDMA": mdma(FXHOR=["000", "010"], DISMM=["P1", "P1"])},
    "MM966": {"MDMA": mdma(BSTRF=["100", "10"], BSTMA=["50", "50"])},
    "MM967": {"MDMA": mdma(BSTRF=["10", "10"], BSTFE=["25", "30"], DISLS=["FX", "FX"])},
    "MM968": {"MDMA": mdma(BSTFE=["5", "0"], DISLS=["EX", "EX"])},
    "MM969": {"MDMA": mdma(MABST=["5", "0"], DISLS=["EX", "EX"])},
    "MM970": {"MDMA": mdma(MABST=["10", "10"], BSTMI=["20", "5"], DISLS=["HB", "HB"])},
    "MM971": {"MDMA": mdma(MABST=["10", "50"], MINBE=["20", "20"], DISLS=["HB", "HB"], DISMM=["VB", "VB"])},
    "MM972": {"MDMA": mdma(EISBE=["-1", "1"], MINBE=Z, BSTMI=Z, BSTMA=Z, BSTFE=Z, BSTRF=Z, MABST=Z, PLIFZ=Z)},
    "MM973": {"MDMA": mdma(PLIFZ=["400", "10"])},
    "MM974": {"MDMA": mdma(AUSSS=["100", "5"])},
    "MM975": {"MDMA": mdma(LGPRO=["L1", "L2"]), "MARD": MARD2},
    "MM976": {"MDMA": mdma(LGFSB=["L1", "L2"]), "MARD": MARD2},
    "MM977": ({"MDMA": mdma(DISPO=["ZZZ", "001"])}, {"T024D.DISPO": {"001"}}),
    "MM978": ({"MDMA": mdma(SOBSL=["99", "10"])}, {"T460A.SOBSL": {"10"}}),
    "MM979": ({"MDMA": mdma(DISPR=["ZZZZ", "0001"])}, {"MDIP.DISPR": {"0001"}}),
    "MM980": {"MDMA": mdma(SHFLG=["Y", "1"])},
    "MM981": {"MDMA": mdma(AUTRU=["Y", "X"])},
    "MM982": {"MDMA": mdma(AHDIS=["X", "1"])},
    "MM983": {"MDMA": mdma(APOKZ=["9", "1"])},
    "MM984": {"EINA": eina(KOLIF=["V9", "V1"]), "LFA1": frame("LFA1", LIFNR=["V1"])},
    "MM985": {"EINA": eina(LMEIN=["KG", "EA"]), "MARA": frame("MARA", MATNR=["M1", "M2"], MEINS=["EA", "EA"])},
    "MM986": {"EINA": eina(MEINS=["BOX", "BOX"], UMREZ=["10", "12"], UMREN=["1", "1"]),
              "MARM": frame("MARM", MATNR=["M1", "M2"], MEINH=["BOX", "BOX"], UMREZ=["12", "12"], UMREN=["1", "1"])},
    "MM987": {"EINA": eina(URZNR=["C1", "C2"], URZDT=["20200101", "20991231"])},
    "MM988": {"EINE": frame("EINE", INFNR=["I1", "I2"], EKORG=["E1", "E1"], ESOKZ=["0", "0"], WERKS=["P1", "P1"],
                            AMODV=["20240601", "20240101"], AMODB=["20240101", "20241231"])},
    "MM989": {"STPO": stpo(MEINS=["KG", "EA"]), "MARM": frame("MARM", MATNR=["C1", "C2"], MEINH=["EA", "EA"])},
    "MM990": {"STPO": stpo(LGORT=["L1", "L2"], PSWRK=["", ""]), "MAST": mast(), "STKO": stko(),
              "MARD": frame("MARD", MATNR=["C1", "C2"], WERKS=["P1", "P1"], LGORT=["L9", "L2"])},
    "MM991": {"MAPL": frame("MAPL", MATNR=["M1", "M2"], WERKS=["P1", "P1"], PLNTY=["N", "N"], PLNNR=["R1", "R2"],
                            PLNAL=["01", "01"], ANDAT=["20240601", "20240101"], AEDAT=["20240101", "20240601"])},
    "MM992": {"MKAL": mkal(PLNTY=["N", "N"], PLNNR=["R1", "R1"], ALNAL=["01", "01"]),
              "MAPL": frame("MAPL", MATNR=["M1", "M3"], WERKS=["P1", "P1"], PLNTY=["N", "N"], PLNNR=["R1", "R1"],
                            PLNAL=["01", "01"])},
    "MM993": {"MKAL": mkal(PLNNG=["G1", "G1"], PLTYG=["", "N"], ALNAG=["", "01"])},
    "MM994": {"MKAL": mkal(PLNNM=["G1", "G1"], PLTYM=["", "N"], ALNAM=["", "01"])},
    "MM995": {"MKAL": mkal(PLTYG=["N", "N"], PLNNG=["G9", "G1"], ALNAG=["01", "01"]), "PLKO": plko()},
    "MM996": {"MKAL": mkal(PLTYM=["N", "N"], PLNNM=["G9", "G1"], ALNAM=["01", "01"]), "PLKO": plko()},
    "MM997": {"MKAL": mkal(MATKO=["X9", "M1"]), "MARA": frame("MARA", MATNR=["M1", "M2"])},
    "MM1018": {"MARC": marc(PERKZ=["P", "P"], PERIV=["", "K4"])},
    "MM1019": {"MARC": marc(VRBMT=["M9", "M9"], VRBDT=["20200101", "99991231"])},
    "MM1020": {"MARC": marc(STLAL=["01", "01"], STLAN=["", "1"])},
    "MM1021": {"MARC": marc(PLNNR=["G1", "G1"], PLNTY=["", "N"])},
    "MM1022": {"MARC": marc(APLAL=["01", "01"], PLNNR=["", "G1"])},
    "MM1023": {"MARC": marc(STLAN=["1", "1"], STLAL=["02", "01"]), "MAST": mast()},
    "MM1024": {"MARC": marc(PLNTY=["N", "N"], PLNNR=["G9", "G1"], APLAL=["01", "01"]), "PLKO": plko()},
    "MM1025": {"MARC": marc(LFMON=["13", "01"], LFGJA=["2026", "2026"])},
    "MM1039": {"MARA": mara(QQTIME=[5, 5], QQTIMEUOM=["", "TAG"])},
    "MM1040": {"MARA": mara(INHBR=[1.0, 3.0], INHAL=[2.0, 2.0])},
    "MM1041": {"MARA": mara(INHAL=[2.0, 2.0], INHME=["", "L"])},
    "MM1042": {"MARA": mara(MAXL=[1.0, 1.0], MAXB=[0.0, 0.0], MAXH=[0.0, 0.0], MAXDIM_UOM=["", "M"])},
    "MM1048": {"MBEW": mbew(PDATZ=["2026", ""], PPRDZ=["", ""])},
    "MM1049": {"MBEW": mbew(PDATL=["", "2026"], PPRDL=["011", "011"])},
    "MM1050": {"MBEW": mbew(PDATV=["2025", "2025"], PPRDV=["000", "012"])},
    "MM1051": {"MBEW": mbew(KALKZ=["X", "X"], PDATZ=["", "2026"], PPRDZ=["", "012"])},
    "MM1052": {"MBEW": mbew(KALKL=["X", ""], PDATL=["", ""], PPRDL=["", ""])},
    "MM1053": {"MBEW": mbew(KALKV=["X", "X"], PDATV=["0000", "2025"], PPRDV=["000", "012"])},
    "MM1056": {"MVKE": mvke(LDVFL=["20260201", "20260101"], LDBFL=["20260101", "20261231"])},
    "MM1057": {"MVKE": mvke(LDVZL=["20260201", "20260101"], LDBZL=["20260101", "20261231"])},
    "MM1058": {"MVKE": mvke(VDVFL=["20260201", "20260101"], VDBFL=["20260101", "20261231"])},
    "MM1059": {"MVKE": mvke(VDVZL=["20260201", "20260101"], VDBZL=["20260101", "20261231"])},
    "MM1061": {"MARD": mard(LFMON=["00", "12"], LFGJA=["2026", "2026"])},
    "MM1062": {"MARD": mard(ERSDA=["29991231", "20200101"])},
}
CASES.update({rid: ({mk().columns[0].split(".")[0]: mk(**{f: ["ZZ9", "OK"]})}, {ref: {"OK"}})
              for rid, mk, f, ref in REF4})
EXPECT = {"MM901": (2, 3), "MM908": (2, 3), "MM916": (2, 3), "MM917": (2, 3), "MM920": (2, 3), "MM954": (1, 3)}


def test_ids_contiguous_from_900():
    ids = [int(r["id"][2:]) for r in NEW]
    assert ids == list(range(900, 900 + len(ids)))
    assert PACK[-len(NEW):] == NEW


def test_schema_contract():
    for r in NEW:
        assert all(r.get(k) for k in ENRICHMENT), r["id"]
        assert r["severity"] in ("critical", "high", "medium", "low"), r["id"]
        assert r["rule_authority"] in ("sap_hard_constraint", "best_practice"), r["id"]
        af = r.get("auto_fix")
        if af:
            assert af["confidence"] in ("high", "medium", "low"), r["id"]
            assert af["steps"] and all(s["op"] in OPS for s in af["steps"]), r["id"]


def test_every_new_rule_has_a_fixture():
    assert sorted(CASES, key=lambda i: int(i[2:])) == [r["id"] for r in NEW]


@pytest.mark.parametrize("rid", sorted(CASES))
def test_rule_fires(rid):
    case = CASES[rid]
    tables, refs = case if isinstance(case, tuple) else (case, None)
    assert fire(rid, tables, refs) == EXPECT.get(rid, (1, 2))
