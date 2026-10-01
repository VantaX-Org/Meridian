"""Golden dataset: on-premise SAP HCM (ECC infotypes + payroll directory) through the
whole pipeline — the shipped HCM/HPY rules of employee_central and payroll_integration,
the rules generated from the system's own configuration (T582A time constraints,
T005/BNKA country formats, misplaced values), live check tables, the locked-record and
superseded-result populations — on South African employees whose correct findings are
known. The clean workforce must produce no finding at all in either module; each seeded
defect must be found exactly where it was put, and nowhere else.

Data is in SAP's internal format as RFC delivers it: dates YYYYMMDD, open-ended records
to 99991231, PERNR NUMC 8, RGDIR/RT SEQNR NUMC 5, amounts as decimal strings."""

from __future__ import annotations

import copy

import pandas as pd
import yaml

from checks import config_rules, country_rules, value_placement
from checks.frames import TableFrames
from checks.runner import _find_module_yaml, _with_reference, run_checks
from sap.ddic import get_dictionary

D = get_dictionary("ecc6")
OPEN = "99991231"
MODULES = ("employee_central", "payroll_integration")

# ── The system's own configuration ───────────────────────────────────────────

# check tables as config sync reads them (company code 1000, MOLGA 16 South Africa)
LIVE = {
    "T529A.MASSN": {"01", "02", "10", "12", "17"},            # hire, org change, leaving, pay change, re-entry
    "T500P.PERSA": {"ZA01", "ZA02"},                          # Isando head office, Rustenburg branch
    "T001P.BTRTL": {"0001", "0002"},                          # head office / workshop, parts warehouse
    "T501.PERSG": {"1", "2", "9"},                            # permanent, fixed-term, retiree/pensioner
    "T503K.PERSK": {"M1", "S1", "H1", "E1"},                  # management, salaried, hourly, expatriate
    "T549A.ABKRS": {"ZM", "ZW"},                              # monthly, weekly
    "T005.LAND1": {"ZA", "GB", "ZW", "MZ", "BW", "NA", "DE", "US"},
    "T510A.TRFAR": {"01", "02"},                              # salaried / hourly pay scale type
    "T512Z.LGART": {"1000", "1001", "2100", "2200", "3000", "3100", "4100", "4200"},
}
CONFIG = {
    # time constraints: 1 = unbroken from hire to 31.12.9999, 2 = no overlap,
    # T = per subtype (T591A, not judged), 3 = any number of records
    "T582A": [{"INFTY": "0000", "ZEITB": "1"}, {"INFTY": "0001", "ZEITB": "1"},
              {"INFTY": "0002", "ZEITB": "1"}, {"INFTY": "0105", "ZEITB": "2"},
              {"INFTY": "0009", "ZEITB": "T"}, {"INFTY": "0006", "ZEITB": "T"},
              {"INFTY": "0014", "ZEITB": "T"}, {"INFTY": "0015", "ZEITB": "3"}],
    # ZA: 4-digit numeric postal code, required for a street address; 6-digit branch code;
    # account numbers up to 11 digits. GB: edit-format postcodes (9 = not judged), 6-digit
    # sort code, 8-digit account.
    "T005": [{"LAND1": "ZA", "LNPLZ": "4", "PRPLZ": "4", "XPLZS": "X", "LNBLZ": "6", "PRBLZ": "4",
              "LNBKN": "11", "PRBKN": "2"},
             {"LAND1": "GB", "LNPLZ": "8", "PRPLZ": "9", "XPLZS": "X", "LNBLZ": "6", "PRBLZ": "4",
              "LNBKN": "8", "PRBKN": "4"}],
    # the ZA bank directory (universal branch codes); no GB directory is kept
    "BNKA": [{"BANKS": "ZA", "BANKL": b} for b in ("250655", "632005", "051001", "198765", "470010")],
}

# ── Infotype records ─────────────────────────────────────────────────────────


def _it(pernr: str, begda: str, endda: str = OPEN, subty: str = "", sprps: str = "", **kw) -> dict:
    aedtm = kw.pop("AEDTM", begda if "20080101" <= begda <= "20260930" else "20260914")
    return {"PERNR": pernr, "SUBTY": subty, "OBJPS": "", "SPRPS": sprps, "ENDDA": endda, "BEGDA": begda,
            "SEQNR": "000", "AEDTM": aedtm, "UNAME": "HRADMIN01", **kw}


def _p0000(pernr, begda, endda, massn, stat2, massg="01"):
    return _it(pernr, begda, endda, MASSN=massn, MASSG=massg, STAT1="", STAT2=stat2, STAT3="1")


def _p0001(pernr, begda, endda, werks, btrtl, persg, persk, abkrs, kostl, plans, stell, ename, **kw):
    return _it(pernr, begda, endda, BUKRS="1000", WERKS=werks, BTRTL=btrtl, PERSG=persg, PERSK=persk,
               ABKRS=abkrs, KOSTL=kostl, KOKRS="1000", GSBER="", ORGEH=f"{plans[:5]}000", PLANS=plans,
               STELL=stell, ENAME=ename, SNAME=ename.upper()[:30], SACHP="P01", **kw)


def _p0002(pernr, begda, endda, vorna, nachn, gesch, gbdat, perid, hired, natio="ZA", famst="1", **kw):
    return _it(pernr, begda, endda, AEDTM=hired, VORNA=vorna, NACHN=nachn, RUFNM=vorna,
               ANRED="1" if gesch == "1" else "2", GESCH=gesch, GBDAT=gbdat, GBLND=natio,
               GBORT=kw.pop("GBORT", "Johannesburg"), NATIO=natio, SPRSL="E", FAMST=famst, PERID=perid, **kw)


def _p0006(pernr, begda, stras, ort02, ort01, pstlz, state, telnr, land1="ZA"):
    return _it(pernr, begda, subty="1", ANSSA="1", STRAS=stras, ORT02=ort02, ORT01=ort01, PSTLZ=pstlz,
               LAND1=land1, STATE=state, TELNR=telnr, ADR03="", ADR04="")


def _p0007(pernr, begda, empct="100.00", wostd="45.00", schkz="NORM45"):
    hours = float(wostd)
    return _it(pernr, begda, SCHKZ=schkz, ZTERF="9", EMPCT=empct, WOSTD=wostd, ARBST=f"{hours / 5:.2f}",
               MOSTD=f"{hours * 4.33:.2f}", WKWDY="5.00")


def _p0008(pernr, begda, trfar, trfgr, lga, bet, bsgrd="100.00", **kw):
    return _it(pernr, begda, subty="0", TRFAR=trfar, TRFGB="01", TRFGR=trfgr, TRFST="01", WAERS="ZAR",
               BSGRD=bsgrd, DIVGV="195.00", LGA01=lga, BET01=bet, ANZ01="0.00", **kw)


def _p0009(pernr, begda, banks, bankl, bankn, subty="0", iban="", waers="ZAR", betrg="0.00", emftx=""):
    return _it(pernr, begda, subty=subty, BNKSA=subty, ZLSCH="T", BANKS=banks, BANKL=bankl, BANKN=bankn,
               IBAN=iban, WAERS=waers, BETRG=betrg, EMFTX=emftx, STCD1="", STCD2="")


def _p0105(pernr, begda, subty, uid, endda=OPEN):
    return _it(pernr, begda, endda, subty=subty, USRTY=subty,
               USRID=uid if subty == "0001" else "", USRID_LONG=uid if subty == "0010" else "")


def _p0185(pernr, begda, ictyp, icnum, iscot="ZA", **kw):
    return _it(pernr, begda, subty=ictyp, ICTYP=ictyp, ICNUM=icnum, ISCOT=iscot, **kw)


def _pay(pernr, begda, lgart, betrg, endda=OPEN, waers="ZAR"):
    return _it(pernr, begda, endda, subty=lgart, LGART=lgart, BETRG=betrg, WAERS=waers, ANZHL="0.00")


def _rgdir(pernr, seqnr, fpper, fpbeg, fpend, inper, paydt, abkrs="ZM", srtza="A", payty="", payid=""):
    return {"PERNR": pernr, "SEQNR": seqnr, "ABKRS": abkrs, "FPPER": fpper, "FPBEG": fpbeg, "FPEND": fpend,
            "IABKRS": abkrs, "INPER": inper, "SRTZA": srtza, "PAYTY": payty, "PAYID": payid, "VOID": "",
            "PAYDT": paydt, "RUNDT": paydt, "MOLGA": "16"}


MONTH = {"202605": ("20260501", "20260531", "20260525"), "202606": ("20260601", "20260630", "20260625"),
         "202608": ("20260801", "20260831", "20260825"), "202609": ("20260901", "20260930", "20260925")}
WEEK = {"202638": ("20260914", "20260920", "20260924"), "202639": ("20260921", "20260927", "20261001")}


def _workforce() -> dict[str, list[dict]]:
    """Eight employees of company code 1000: a payroll administrator would sign every record off."""
    t: dict[str, list[dict]] = {k: [] for k in ("PA0000", "PA0001", "PA0002", "PA0006", "PA0007", "PA0008",
                                                 "PA0009", "PA0014", "PA0015", "PA0105", "PA0185")}
    # 00010001 managing director since 2016 (position change without an action)
    t["PA0000"] += [_p0000("00010001", "20080201", OPEN, "01", "3")]
    t["PA0001"] += [
        _p0001("00010001", "20080201", "20151231", "ZA01", "0001", "1", "M1", "ZM", "0000101000", "50000010",
               "60000010", "Sipho Dlamini"),
        _p0001("00010001", "20160101", OPEN, "ZA01", "0001", "1", "M1", "ZM", "0000101000", "50000001",
               "60000001", "Sipho Dlamini")]
    # 00010002 transferred from the Rustenburg workshop to head-office payroll on 1 March 2021;
    # married in April 2019 (name change: a second infotype 0002 record)
    t["PA0000"] += [_p0000("00010002", "20140602", "20210228", "01", "3"),
                    _p0000("00010002", "20210301", OPEN, "02", "3", massg="02")]
    t["PA0001"] += [
        _p0001("00010002", "20140602", "20210228", "ZA02", "0001", "1", "S1", "ZM", "0000310200", "50000210",
               "60000210", "Thandiwe Zulu"),
        _p0001("00010002", "20210301", OPEN, "ZA01", "0001", "1", "S1", "ZM", "0000102100", "50000120",
               "60000120", "Thandiwe Nkosi")]
    # 00010003 diesel mechanic, promoted to salaried foreman in 2018, resigned 30 June 2026:
    # the withdrawal action leaves infotypes 0000/0001 open to 31.12.9999 with status 0.
    # With OM integration the leaving action moves the withdrawn employee to the default
    # position 99999999 (vacating the real one): not a finding for a leaver (HCM009).
    t["PA0000"] += [_p0000("00010003", "20110110", "20180630", "01", "3"),
                    _p0000("00010003", "20180701", "20260630", "02", "3", massg="03"),
                    _p0000("00010003", "20260701", OPEN, "10", "0", massg="01")]
    t["PA0001"] += [
        _p0001("00010003", "20110110", "20180630", "ZA02", "0001", "1", "H1", "ZW", "0000310200", "50000230",
               "60000230", "Pieter van der Merwe"),
        _p0001("00010003", "20180701", "20260630", "ZA02", "0001", "1", "S1", "ZM", "0000310200", "50000220",
               "60000220", "Pieter van der Merwe"),
        _p0001("00010003", "20260701", OPEN, "ZA02", "0001", "1", "S1", "ZM", "0000310200", "99999999",
               "60000220", "Pieter van der Merwe")]
    for pernr, hired, werks, btrtl, persg, persk, abkrs, kostl, plans, name in (
            ("00010004", "20190801", "ZA01", "0001", "1", "S1", "ZM", "0000102100", "50000130", "Lerato Mokoena"),
            ("00010005", "20160404", "ZA01", "0002", "1", "H1", "ZW", "0000320100", "50000310", "Johan Botha"),
            ("00010006", "20220117", "ZA01", "0001", "1", "S1", "ZM", "0000410100", "50000410",
             "Nomvula Mahlangu"),
            ("00010007", "20230901", "ZA01", "0001", "2", "E1", "ZM", "0000101000", "50000020",
             "James Whitfield"),
            ("00010008", "20250203", "ZA02", "0001", "1", "S1", "ZM", "0000310200", "50000240", "Ayanda Zulu")):
        t["PA0000"].append(_p0000(pernr, hired, OPEN, "01", "3"))
        t["PA0001"].append(_p0001(pernr, hired, OPEN, werks, btrtl, persg, persk, abkrs, kostl, plans,
                                  f"6{plans[1:]}", name))
    # personal data: infotype 0002 starts on the date of birth
    t["PA0002"] += [
        _p0002("00010001", "19740512", OPEN, "Sipho", "Dlamini", "1", "19740512", "7405125800083", "20080201"),
        _p0002("00010002", "19850923", "20190412", "Thandiwe", "Zulu", "2", "19850923", "8509230456082",
               "20140602", famst="0"),
        _p0002("00010002", "20190413", OPEN, "Thandiwe", "Nkosi", "2", "19850923", "8509230456082",
               "20190415", NAME2="Zulu"),
        _p0002("00010003", "19791102", OPEN, "Pieter", "van der Merwe", "1", "19791102", "7911025123089",
               "20110110", GBORT="Rustenburg"),
        _p0002("00010004", "19920214", OPEN, "Lerato", "Mokoena", "2", "19920214", "9202140789085",
               "20190801", famst="0", GBORT="Polokwane"),
        _p0002("00010005", "19880730", OPEN, "Johan", "Botha", "1", "19880730", "8807305098081", "20160404",
               GBORT="Pretoria"),
        _p0002("00010006", "19901205", OPEN, "Nomvula", "Mahlangu", "2", "19901205", "9012050654087",
               "20220117"),
        _p0002("00010007", "19830319", OPEN, "James", "Whitfield", "1", "19830319", "", "20230901",
               natio="GB", GBORT="Leeds"),
        _p0002("00010008", "19961008", OPEN, "Ayanda", "Zulu", "1", "19961008", "9610085321086", "20250203",
               famst="0", GBORT="Durban"),
    ]
    t["PA0006"] += [
        _p0006("00010001", "20080201", "12 Fourth Avenue", "Houghton Estate", "Johannesburg", "2198", "GP",
               "011 555 0101"),
        _p0006("00010002", "20140602", "7 Beyers Naude Drive", "Cashan", "Rustenburg", "0299", "NW",
               "014 555 0102"),
        _p0006("00010003", "20110110", "45 Heystek Street", "Rustenburg Central", "Rustenburg", "0300", "NW",
               "014 555 0103"),
        _p0006("00010004", "20190801", "21 Rhodes Avenue", "Kempton Park", "Kempton Park", "1619", "GP",
               "011 555 0104"),
        _p0006("00010005", "20160404", "9 Pretoria Road", "Rynfield", "Benoni", "1501", "GP", "011 555 0105"),
        _p0006("00010006", "20220117", "118 Oak Avenue", "Ferndale", "Randburg", "2194", "GP", "011 555 0106"),
        _p0006("00010007", "20230901", "3 Ninth Street", "Melville", "Johannesburg", "2092", "GP",
               "011 555 0107"),
        _p0006("00010008", "20250203", "62 Boom Street", "Rustenburg Central", "Rustenburg", "0299", "NW",
               "014 555 0108"),
    ]
    t["PA0007"] += [_p0007(p, h) for p, h in (("00010001", "20080201"), ("00010002", "20140602"),
                                              ("00010003", "20110110"), ("00010004", "20190801"),
                                              ("00010007", "20230901"), ("00010008", "20250203"))]
    t["PA0007"] += [_p0007("00010005", "20160404", schkz="SHIFT2"),
                    _p0007("00010006", "20220117", empct="50.00", wostd="22.50", schkz="PART50")]  # part-time
    t["PA0008"] += [
        _p0008("00010001", "20250401", "01", "M1", "1000", "185000.00", ANSAL="2220000.00"),
        _p0008("00010002", "20250401", "01", "S3", "1000", "38500.00", ANSAL="462000.00"),
        _p0008("00010003", "20250401", "01", "S4", "1000", "42000.00", "100.00", ANSAL="504000.00",
               ENDDA="20260630"),
        _p0008("00010004", "20250401", "01", "S3", "1000", "36000.00", ANSAL="432000.00"),
        _p0008("00010005", "20250401", "02", "H2", "1001", "148.50"),                 # hourly rate
        _p0008("00010006", "20250401", "01", "S2", "1000", "14750.00", "50.00", ANSAL="177000.00"),
        _p0008("00010007", "20250401", "01", "M1", "1000", "160000.00", ANSAL="1920000.00"),
        _p0008("00010008", "20250401", "01", "S2", "1000", "26500.00", ANSAL="318000.00"),
    ]
    # bank details: ZA has no IBAN, accounts are branch code + account number;
    # the expatriate splits his pay to his UK account (other bank, fixed amount in GBP)
    t["PA0009"] += [
        _p0009("00010001", "20080201", "ZA", "250655", "62012345678"),
        _p0009("00010002", "20140602", "ZA", "632005", "4055512345"),
        _p0009("00010003", "20110110", "ZA", "051001", "001234567"),
        _p0009("00010004", "20190801", "ZA", "470010", "1452367809"),
        _p0009("00010005", "20160404", "ZA", "198765", "1012345678"),
        _p0009("00010006", "20220117", "ZA", "250655", "62098765432"),
        _p0009("00010007", "20230901", "ZA", "051001", "002345678"),
        _p0009("00010007", "20230901", "GB", "123456", "98765432", subty="2", iban="GB82WEST12345698765432",
               waers="GBP", betrg="2500.00", emftx="J WHITFIELD"),
        _p0009("00010008", "20250203", "ZA", "632005", "4061198765"),
    ]
    # communication: office staff log on to SAP (subtype 0001), workshop staff get their payslips
    # by e-mail (0010); office staff have an e-mail address as well — the time constraint applies
    # per subtype, so an SAP user and an e-mail address valid on the same day do not overlap.
    for pernr, hired, subty, uid in (
            ("00010001", "20080201", "0001", "SDLAMINI"), ("00010002", "20140602", "0001", "TNKOSI"),
            ("00010004", "20190801", "0001", "LMOKOENA"), ("00010006", "20220117", "0001", "NMAHLANGU"),
            ("00010007", "20230901", "0001", "JWHITFIELD"),
            ("00010003", "20110110", "0010", "pieter.vandermerwe@meridian-demo.co.za"),
            ("00010005", "20160404", "0010", "johan.botha@meridian-demo.co.za"),
            ("00010008", "20250203", "0010", "ayanda.zulu@meridian-demo.co.za"),
            ("00010001", "20080201", "0010", "sipho.dlamini@meridian-demo.co.za")):
        end = "20260630" if pernr == "00010003" else OPEN               # the leaver's address is delimited
        t["PA0105"].append(_p0105(pernr, hired, subty, uid, end))
    for r in t["PA0002"]:
        if r["ENDDA"] == OPEN and r["PERID"]:
            hired = min(x["BEGDA"] for x in t["PA0000"] if x["PERNR"] == r["PERNR"])
            t["PA0185"].append(_p0185(r["PERNR"], hired, "01", r["PERID"]))
    t["PA0185"].append(_p0185("00010007", "20230901", "02", "533401987", "GB", FPDAT="20210319",
                              EXPID="20310318"))                               # UK passport
    t["PA0014"] += [
        _pay("00010001", "20250401", "2100", "12500.00"),                          # car allowance
        _pay("00010002", "20250101", "4100", "2150.00"),                           # medical aid
        _pay("00010006", "20220201", "4100", "1980.00"),
        _pay("00010007", "20230901", "2200", "22000.00", endda="20260831"),        # housing, secondment term
    ]
    t["PA0015"] += [
        _pay("00010001", "20260915", "3000", "185000.00", endda="20260915"),       # annual bonus, off-cycle
        _pay("00010005", "20260918", "3100", "2400.00", endda="20260918"),         # long-service award
        _pay("00010008", "20260815", "4200", "1500.00", endda="20260815"),         # salary advance recovery
    ]
    # payroll directory: monthly employees August and September; the weekly storeman weeks 38/39;
    # the leaver's last two months; 00010008's August was recalculated in September (retro):
    # the original result is 'P' (previous), the recalculation 'A'
    rg = t["HRPY_RGDIR"] = []
    for pernr in ("00010001", "00010002", "00010004", "00010006", "00010007"):
        for i, per in enumerate(("202608", "202609"), 1):
            rg.append(_rgdir(pernr, f"{i:05d}", per, *MONTH[per][:2], per, MONTH[per][2]))
    rg.append(_rgdir("00010001", "00003", "202609", *MONTH["202609"][:2], "202609", "20260915",
                     payty="A", payid="1"))                                      # off-cycle bonus run
    for i, per in enumerate(("202605", "202606"), 1):
        rg.append(_rgdir("00010003", f"{i:05d}", per, *MONTH[per][:2], per, MONTH[per][2]))
    for i, per in enumerate(("202638", "202639"), 1):
        rg.append(_rgdir("00010005", f"{i:05d}", per, *WEEK[per][:2], per, WEEK[per][2], abkrs="ZW"))
    rg += [_rgdir("00010008", "00001", "202608", *MONTH["202608"][:2], "202608", "20260825", srtza="P"),
           _rgdir("00010008", "00002", "202608", *MONTH["202608"][:2], "202609", "20260925"),
           _rgdir("00010008", "00003", "202609", *MONTH["202609"][:2], "202609", "20260925")]
    # wage-type totals per result: /101 total gross, /559 bank transfer, /560 amount paid
    net = {"00010001": ("216300.00", "128450.00"), "00010002": ("38500.00", "27610.00"),
           "00010003": ("42000.00", "30020.00"), "00010004": ("36000.00", "26240.00"),
           "00010005": ("26730.00", "21180.00"), "00010006": ("14750.00", "11890.00"),
           "00010007": ("182000.00", "109870.00"), "00010008": ("26500.00", "20840.00")}
    rt = t["ZMERIDIAN_PAYRT"] = []
    for r in rg:
        gross, paid = net[r["PERNR"]]
        if r["PAYTY"] == "A":
            gross, paid = "185000.00", "101750.00"                              # bonus run
        if r["PERNR"] == "00010005":
            gross, paid = "6682.50", "5295.00"                                  # one week
        transfer = paid if r["PERNR"] != "00010005" else "4795.00"              # R500 paid in cash
        if r["SRTZA"] == "P":                                                   # advance recovered twice
            gross, paid, transfer = "26500.00", "0.00", "0.00"
        for lgart, betrg in (("/101", gross), ("/559", transfer), ("/560", paid)):
            rt.append({"PERNR": r["PERNR"], "SEQNR": r["SEQNR"], "LGART": lgart, "FPPER": r["FPPER"],
                       "INPER": r["INPER"], "PAYDT": r["PAYDT"], "BETRG": betrg, "ANZHL": "0.00",
                       "WAERS": "ZAR"})
        if r["SRTZA"] == "P":                                                   # the claim, since corrected
            rt.append({**rt[-1], "LGART": "/561", "BETRG": "1500.00"})
    # a pending promotion, entered locked until approved: not yet a valid record
    t["PA0001"].append(_p0001("00010004", "20261101", OPEN, "ZA01", "0001", "1", "S1", "ZM", "", "99999999",
                              "60000140", "Lerato Mokoena", SPRPS="X"))
    return t


def _key(pernr: str, begda: str, endda: str = OPEN, subty: str = "", sprps: str = "") -> str:
    return f"PERNR={pernr}|SUBTY={subty}|OBJPS=|SPRPS={sprps}|ENDDA={endda}|BEGDA={begda}|SEQNR=000"


def _frames(tables: dict[str, list[dict]], module: str) -> TableFrames:
    """One flat TABLE.FIELD upload of every table, split by DDIC key (every field must exist)."""
    parts = []
    for table, rows in tables.items():
        cols = list(dict.fromkeys(k for r in rows for k in r))
        unknown = [c for c in cols if D.field(table, c) is None]
        assert not unknown, f"not in the ECC 6.0 dictionary: {table}.{unknown}"
        parts.append(pd.DataFrame([{f"{table}.{c}": r.get(c, "") for c in cols} for r in rows]))
    return TableFrames.from_flat(pd.concat(parts, ignore_index=True), D, module=module)


def _run(tables: dict[str, list[dict]]):
    results = []
    for module in MODULES:
        static = yaml.safe_load(_find_module_yaml(module).read_text())["rules"]
        live = {}
        for r in static:
            if r.get("check_class") == "referential_check" and r["field"].split(".")[0].startswith(("PA", "HRPY")):
                key = _with_reference(r, D, {}).get("_reference_key")
                assert key in LIVE, (r["id"], key)  # every HR value list is judged against live config
                live[key] = LIVE[key]
        generated = (value_placement.generate(module, static, D)
                     + country_rules.generate(module, static, CONFIG, D)
                     + config_rules.generate(module, CONFIG, D))
        results += run_checks(module, _frames(tables, module), "t", reference_values=live,
                              extra_rules=generated)
    errors = {r.check_id: r.error for r in results if r.error}
    assert not errors, errors
    return results, {r.check_id: set(r.failing_record_keys or []) for r in results if r.affected_count}


def test_clean_workforce_has_no_findings():
    results, found = _run(_workforce())
    assert found == {}, found
    ran = {r.check_id for r in results}
    hcm = {f"HCM{i:03d}" for i in range(1, 31)} | {f"HPY{i:03d}" for i in range(1, 19)}
    # every HR rule judged real records — except HPY017: the only claim (/561) sits on 00010008's
    # superseded August result, which is out of the population, so no current result has one
    assert hcm - ran == {"HPY017"}, sorted(hcm - ran)
    assert {"TC-PA0000", "TC-PA0001", "TC-PA0002", "TC-PA0105"} <= ran
    assert not {"TC-PA0006", "TC-PA0009", "TC-PA0014", "TC-PA0015"} & ran   # T / 3: not judged
    assert {"CF-PA0006-PSTLZ", "CR-PA0006-PSTLZ", "CF-PA0009-BANKN", "CF-PA0009-BANKL", "BK-PA0009"} <= ran
    # judged and passed: the locked pending promotion (overlapping, no cost centre, default
    # position) is out of the population, counted, on every org-assignment rule
    for check_id in ("TC-PA0001", "HCM008", "HCM009", "HCM003"):
        r = next(r for r in results if r.check_id == check_id)
        assert r.details["population_excluded"] == {"locked": 1}, (check_id, r.details)
    # 00010008's original August result was recalculated: only the current one counts
    for check_id in ("HPY012", "HPY013"):
        r = next(r for r in results if r.check_id == check_id)
        assert r.details["population_excluded"] == {"superseded": 1}, (check_id, r.details)
    for check_id in ("HPY015", "HPY016"):                       # its /101 and /560 wage types
        r = next(r for r in results if r.check_id == check_id)
        assert r.details["population_excluded"] == {"superseded": 4}, (check_id, r.details)


# ── Seeded defects ───────────────────────────────────────────────────────────


def _one(t: dict[str, list[dict]], table: str, pernr: str, begda: str | None = None, subty: str | None = None,
         seqnr: str | None = None, lgart: str | None = None) -> dict:
    hits = [r for r in t[table] if r["PERNR"] == pernr and begda in (None, r.get("BEGDA"))
            and subty in (None, r.get("SUBTY")) and seqnr in (None, r.get("SEQNR"))
            and lgart in (None, r.get("LGART"))]
    assert len(hits) == 1, (table, pernr, begda, subty, seqnr, lgart, len(hits))
    return hits[0]


def _defective() -> dict[str, list[dict]]:
    t = copy.deepcopy(_workforce())
    # actions
    _one(t, "PA0000", "00010005")["MASSN"] = ""                                  # HCM001
    _one(t, "PA0000", "00010006")["MASSN"] = "Z9"                                # HCM002 not in T529A
    _one(t, "PA0000", "00010002", "20140602")["ENDDA"] = "20210227"              # TC-PA0000 gap on 28 Feb
    # organisational assignment
    _one(t, "PA0001", "00010001", "20080201")["BUKRS"] = ""                      # HCM003
    _one(t, "PA0001", "00010003", "20110110")["WERKS"] = ""                      # HCM004
    _one(t, "PA0001", "00010005")["BTRTL"] = ""                                  # HCM005
    _one(t, "PA0001", "00010006")["PERSG"] = ""                                  # HCM006
    _one(t, "PA0001", "00010008")["PERSK"] = ""                                  # HCM007
    _one(t, "PA0001", "00010004", "20190801")["KOSTL"] = ""                      # HCM008
    _one(t, "PA0001", "00010002", "20210301")["PLANS"] = "99999999"              # HCM009 active, no position
    _one(t, "PA0001", "00010002", "20140602")["WERKS"] = "ZA09"                  # HCM010 not in T500P
    _one(t, "PA0001", "00010001", "20160101")["PERSG"] = "7"                     # HCM011 not in T501
    _one(t, "PA0001", "00010003", "20180701")["PERSK"] = "X9"                    # HCM012 not in T503K
    _one(t, "PA0001", "00010003", "20260701")["ABKRS"] = "Z9"                    # HCM013 not in T549A
    k = _one(t, "PA0001", "00010007")
    k["BTRTL"] = "0009"                                                          # HCM014 not in T001P
    k["ENDDA"] = "20261231"                                                      # TC-PA0001 secondment ends,
    t["PA0001"].append({**_one(t, "PA0001", "00010008"), "BEGDA": "20250701", "PERSK": "S1",  # nothing after
                        "AEDTM": "20250703"})                                    # TC-PA0001 overlap (re-load)
    # personal data
    _one(t, "PA0002", "00010005")["GBDAT"] = ""                                  # HCM015
    _one(t, "PA0002", "00010006")["NACHN"] = ""                                  # HCM016
    _one(t, "PA0002", "00010007")["VORNA"] = ""                                  # HCM017
    _one(t, "PA0002", "00010008")["GBDAT"] = "19970108"                          # HCM018 born after the record
    _one(t, "PA0002", "00010001")["NATIO"] = "RSA"                               # HCM019 not a T005 key
    t["PA0002"].append(_p0002("00010009", "19920214", OPEN, "Lerato", "Mokoena", "2", "19920214",
                              "9202140789086", "20240115", famst="0"))           # HCM020 hired twice
    _one(t, "PA0002", "00010003")["PERID"] = "7405125800083"                     # HCM021 00010001's ID
    _one(t, "PA0002", "00010002", "20190413")["BEGDA"] = "20190420"              # TC-PA0002 gap 13-19 Apr
    _one(t, "PA0002", "00010002", "19850923")["AEDTM"] = "19140602"              # DT-PA0002-AEDTM
    # addresses
    _one(t, "PA0006", "00010005")["LAND1"] = ""                                  # HCM022
    _one(t, "PA0006", "00010006")["ORT01"] = ""                                  # HCM023
    _one(t, "PA0006", "00010007")["PSTLZ"] = "20920"                             # CF-PA0006-PSTLZ 5 digits
    _one(t, "PA0006", "00010008")["PSTLZ"] = ""                                  # CR-PA0006-PSTLZ
    # planned working time
    _one(t, "PA0007", "00010005")["SCHKZ"] = ""                                  # HCM024
    _one(t, "PA0007", "00010006")["EMPCT"] = "500.00"                            # HCM025
    _one(t, "PA0007", "00010007")["WOSTD"] = "450.00"                            # HCM026
    # bank details
    _one(t, "PA0009", "00010007", subty="2")["IBAN"] = "GB83WEST12345698765432"  # HCM027 check digits
    _one(t, "PA0009", "00010005")["BANKN"] = "101234567890"                      # CF-PA0009-BANKN 12 digits
    _one(t, "PA0009", "00010006")["BANKL"] = "25065"                             # CF-PA0009-BANKL + BK-PA0009
    _one(t, "PA0009", "00010008")["BANKL"] = "632099"                            # BK-PA0009 no such branch
    _one(t, "PA0009", "00010004")["BANKN"] = "0000000000"                        # PH-PA0009-BANKN
    # communication, identification
    _one(t, "PA0105", "00010006")["USRID"] = "lmokoena"                          # HCM028 00010004's user
    _one(t, "PA0105", "00010005")["USRID_LONG"] = "johan.botha@meridian-demo,co.za"  # HCM029
    t["PA0105"].append(_p0105("00010008", "20260101", "0010", "a.zulu@meridian-demo.co.za"))  # TC-PA0105
    _one(t, "PA0185", "00010006")["ICNUM"] = "880730 5098 081"                   # HCM030 00010005's ID
    # basic pay, recurring and additional payments
    _one(t, "PA0008", "00010005")["BSGRD"] = "1000.00"                           # HPY001
    _one(t, "PA0008", "00010006")["TRFAR"] = ""                                  # HPY002
    _one(t, "PA0008", "00010007")["WAERS"] = ""                                  # HPY003
    _one(t, "PA0008", "00010004")["TRFAR"] = "09"                                # HPY004 not in T510A
    _one(t, "PA0008", "00010001")["LGA01"] = "1999"                              # HPY005 not in T512Z
    r = _one(t, "PA0014", "00010006")
    r["LGART"] = r["SUBTY"] = ""                                                 # HPY006
    _one(t, "PA0015", "00010005")["LGART"] = ""                                  # HPY007
    _one(t, "PA0014", "00010002")["WAERS"] = ""                                  # HPY008
    _one(t, "PA0015", "00010001")["WAERS"] = ""                                  # HPY009
    r = _one(t, "PA0014", "00010007")
    r["LGART"] = r["SUBTY"] = "2999"                                             # HPY010 not in T512Z
    r = _one(t, "PA0015", "00010008")
    r["LGART"] = r["SUBTY"] = "3999"                                             # HPY011 not in T512Z
    # payroll directory and results
    _one(t, "HRPY_RGDIR", "00010005", seqnr="00001")["FPEND"] = "20260913"       # HPY012
    _one(t, "HRPY_RGDIR", "00010006", seqnr="00002")["PAYDT"] = ""               # HPY013
    t["HRPY_RGDIR"].append({**_one(t, "HRPY_RGDIR", "00010007", seqnr="00002"), "SEQNR": "00003"})  # HPY014
    t["ZMERIDIAN_PAYRT"] += [{**r, "SEQNR": "00003"} for r in t["ZMERIDIAN_PAYRT"]
                             if r["PERNR"] == "00010007" and r["SEQNR"] == "00002"]
    _one(t, "ZMERIDIAN_PAYRT", "00010005", seqnr="00002", lgart="/560")["BETRG"] = "-320.00"   # HPY015
    _one(t, "ZMERIDIAN_PAYRT", "00010005", seqnr="00002", lgart="/559")["BETRG"] = "0.00"
    _one(t, "ZMERIDIAN_PAYRT", "00010006", seqnr="00001", lgart="/101")["BETRG"] = "-14750.00"  # HPY016
    t["ZMERIDIAN_PAYRT"].append({**_one(t, "ZMERIDIAN_PAYRT", "00010002", seqnr="00002", lgart="/560"),
                                 "LGART": "/561", "BETRG": "450.00"})            # HPY017 current claim
    _one(t, "ZMERIDIAN_PAYRT", "00010004", seqnr="00002", lgart="/559")["BETRG"] = "28240.00"  # HPY018
    return t


def test_seeded_defects_are_found_exactly():
    results, found = _run(_defective())
    k = _key
    assert found == {
        "HCM001": {k("00010005", "20160404")},
        "HCM002": {k("00010006", "20220117")},
        "TC-PA0000": {k("00010002", "20210301")},
        "HCM003": {k("00010001", "20080201", "20151231")},
        "HCM004": {k("00010003", "20110110", "20180630")},
        "HCM005": {k("00010005", "20160404")},
        "HCM006": {k("00010006", "20220117")},
        "HCM007": {k("00010008", "20250203")},
        "HCM008": {k("00010004", "20190801")},
        "HCM009": {k("00010002", "20210301")},
        "HCM010": {k("00010002", "20140602", "20210228")},
        "HCM011": {k("00010001", "20160101")},
        "HCM012": {k("00010003", "20180701", "20260630")},
        "HCM013": {k("00010003", "20260701")},
        "HCM014": {k("00010007", "20230901", "20261231")},
        "TC-PA0001": {k("00010007", "20230901", "20261231"), k("00010008", "20250701")},
        "HCM015": {k("00010005", "19880730")},
        "HCM016": {k("00010006", "19901205")},
        "HCM017": {k("00010007", "19830319")},
        "HCM018": {k("00010008", "19961008")},
        "HCM019": {k("00010001", "19740512")},
        "HCM020": {k("00010004", "19920214"), k("00010009", "19920214")},
        "HCM021": {k("00010001", "19740512"), k("00010003", "19791102")},
        "TC-PA0002": {k("00010002", "20190420")},
        "DT-PA0002-AEDTM": {k("00010002", "19850923", "20190412")},
        "HCM022": {k("00010005", "20160404", subty="1")},
        "HCM023": {k("00010006", "20220117", subty="1")},
        "CF-PA0006-PSTLZ": {k("00010007", "20230901", subty="1")},
        "CR-PA0006-PSTLZ": {k("00010008", "20250203", subty="1")},
        "HCM024": {k("00010005", "20160404")},
        "HCM025": {k("00010006", "20220117")},
        "HCM026": {k("00010007", "20230901")},
        "HCM027": {k("00010007", "20230901", subty="2")},
        "CF-PA0009-BANKN": {k("00010005", "20160404", subty="0")},
        "CF-PA0009-BANKL": {k("00010006", "20220117", subty="0")},
        "BK-PA0009": {k("00010006", "20220117", subty="0"), k("00010008", "20250203", subty="0")},
        "PH-PA0009-BANKN": {k("00010004", "20190801", subty="0")},
        "HCM028": {k("00010004", "20190801", subty="0001"), k("00010006", "20220117", subty="0001")},
        "HCM029": {k("00010005", "20160404", subty="0010")},
        "TC-PA0105": {k("00010008", "20260101", subty="0010")},
        "HCM030": {k("00010005", "20160404", subty="01"), k("00010006", "20220117", subty="01")},
        "HPY001": {k("00010005", "20250401", subty="0")},
        "HPY002": {k("00010006", "20250401", subty="0")},
        "HPY003": {k("00010007", "20250401", subty="0")},
        "HPY004": {k("00010004", "20250401", subty="0")},
        "HPY005": {k("00010001", "20250401", subty="0")},
        "HPY006": {k("00010006", "20220201")},
        "HPY007": {k("00010005", "20260918", "20260918", subty="3100")},
        "HPY008": {k("00010002", "20250101", subty="4100")},
        "HPY009": {k("00010001", "20260915", "20260915", subty="3000")},
        "HPY010": {k("00010007", "20230901", "20260831", subty="2999")},
        "HPY011": {k("00010008", "20260815", "20260815", subty="3999")},
        "HPY012": {"PERNR=00010005|SEQNR=00001"},
        "HPY013": {"PERNR=00010006|SEQNR=00002"},
        "HPY014": {"PERNR=00010007|SEQNR=00002", "PERNR=00010007|SEQNR=00003"},
        "HPY015": {"PERNR=00010005|SEQNR=00002|LGART=/560"},
        "HPY016": {"PERNR=00010006|SEQNR=00001|LGART=/101"},
        "HPY017": {"PERNR=00010002|SEQNR=00002|LGART=/561"},
        "HPY018": {"PERNR=00010004|SEQNR=00002|LGART=/101"},      # the group's first record carries it
    }, found
    # the superseded August result of 00010008 carries a claim, since corrected: not judged
    # (all four wage types of that result, its /561 among them, are out of the population)
    r = next(r for r in results if r.check_id == "HPY017")
    assert (r.total_count, r.affected_count) == (1, 1)
    assert r.details["population_excluded"] == {"superseded": 4}, r.details
