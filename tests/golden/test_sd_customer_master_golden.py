"""Golden dataset: the whole SD customer-master pipeline (shipped + generated rules,
active population, joins, live configuration) on customers and sales areas whose
correct findings are known. Clean records must produce no finding at all — any
failure on them is a false positive; each seeded defect must be found exactly
where it was put."""

import pandas as pd
import yaml

from checks.frames import TableFrames
from checks.runner import _find_module_yaml, _with_reference, run_checks
from checks.value_placement import generate
from sap.ddic import get_dictionary

D = get_dictionary("ecc6")

# Customers (KNA1.KUNNR, ALPHA internal format)
#   clean:  C1 ZA sold-to in two distribution channels, C2 German export customer, C3 ZA distributor,
#           C4 private customer (natural person, no VAT registration), OT one-time account (CPD)
#   seeded: one defect each (see the expected findings in the test)
#   DEL:    flagged for deletion centrally; C3's old wholesale sales area is flagged for deletion
C1, C2, C3, C4, OT = "0000200001", "0000200002", "0000200003", "0000200004", "0000900002"
D_POBOX, D_MAIL, D_KALKS, D_INCO2, D_INCO1, D_LPRIO, D_WAERS, D_ERDAT = (
    "0000200011", "0000200012", "0000200013", "0000200014", "0000200015", "0000200016", "0000200017", "0000200018")
DEL = "0000200020"
CUSTOMERS = [C1, C2, C3, C4, OT, D_POBOX, D_MAIL, D_KALKS, D_INCO2, D_INCO1, D_LPRIO, D_WAERS, D_ERDAT, DEL]


def _col(values: dict[str, str], default: str = "") -> list[str]:
    return [values.get(k, default) for k in CUSTOMERS]


def _frames() -> TableFrames:
    n = len(CUSTOMERS)
    adrnr = [f"{int(k) - 158000:010d}" for k in CUSTOMERS]  # central address numbers (ADRC)
    kna1 = pd.DataFrame({
        "KNA1.KUNNR": CUSTOMERS,
        "KNA1.NAME1": _col({
            C1: "Sasolburg Valve Services (Pty) Ltd", C2: "Weber Antriebstechnik GmbH",
            C3: "Mzansi Industrial Distributors (Pty) Ltd", C4: "Thabo Nkosi", OT: "One-time customers SD",
            D_POBOX: "Drakensberg Timber Products (Pty) Ltd", D_MAIL: "Vaal River Plastics (Pty) Ltd",
            D_KALKS: "Lowveld Citrus Packers (Pty) Ltd", D_INCO2: "Saldanha Steel Fabricators (Pty) Ltd",
            D_INCO1: "Free State Grain Handling (Pty) Ltd", D_LPRIO: "Tshwane Office Interiors (Pty) Ltd",
            D_WAERS: "Matlosana Mining Services (Pty) Ltd", D_ERDAT: "West Coast Seafood Processors (Pty) Ltd",
            DEL: "Mzansi Industrial Distributors"}),
        "KNA1.NAME2": [""] * n,
        "KNA1.NAME3": [""] * n, "KNA1.NAME4": [""] * n,
        "KNA1.PSON1": [""] * n, "KNA1.PSON2": [""] * n, "KNA1.PSON3": [""] * n,
        "KNA1.STRAS": _col({
            C1: "8 Fichardt Street", C2: "Industriestraße 27", C3: "31 Steel Road", C4: "17 Jacaranda Avenue",
            D_POBOX: "PO Box 1187", D_MAIL: "12 Barrage Road", D_KALKS: "4 Koedoe Street",
            D_INCO2: "1 Harbour Road", D_INCO1: "66 Church Street", D_LPRIO: "250 Lynnwood Road",
            D_WAERS: "3 Leask Street", D_ERDAT: "9 Voortrekker Street", DEL: "31 Steel Road"}),
        "KNA1.ORT01": _col({
            C1: "Sasolburg", C2: "Mannheim", C3: "Spartan", C4: "Pretoria", D_POBOX: "Pietermaritzburg",
            D_MAIL: "Vanderbijlpark", D_KALKS: "Nelspruit", D_INCO2: "Saldanha", D_INCO1: "Bethlehem",
            D_LPRIO: "Pretoria", D_WAERS: "Klerksdorp", D_ERDAT: "Vredenburg", DEL: "Spartan"}),
        "KNA1.ORT02": [""] * n,
        "KNA1.PSTLZ": _col({
            C1: "1947", C2: "68219", C3: "1619", C4: "0181", D_POBOX: "3200", D_MAIL: "1911", D_KALKS: "1200",
            D_INCO2: "7395", D_INCO1: "9701", D_LPRIO: "0081", D_WAERS: "2571", D_ERDAT: "7380", DEL: "1619"}),
        "KNA1.PFORT": [""] * n, "KNA1.PSTL2": [""] * n,
        "KNA1.LAND1": _col({C2: "DE"}, "ZA"),
        "KNA1.KTOKD": _col({OT: "CPD"}, "0001"),
        "KNA1.STKZN": _col({C4: "X"}),
        "KNA1.STCD1": _col({
            C1: "4230118876", C3: "4610133429", D_POBOX: "4180127745", D_MAIL: "4920165530", D_KALKS: "4350198812",
            D_INCO2: "4470124409", D_INCO1: "4060177713", D_LPRIO: "4790106654", D_WAERS: "4520149987",
            D_ERDAT: "4840112236", DEL: "4610133429"}),
        "KNA1.STCD2": [""] * n, "KNA1.STCD3": [""] * n, "KNA1.STCD4": [""] * n,
        "KNA1.STCEG": _col({C2: "DE136695976"}),
        "KNA1.TELF1": _col({
            C1: "0169734400", C2: "+49 621 8774 0", C3: "0119752200", C4: "0823456781", D_POBOX: "0333452100",
            D_MAIL: "0169812300", D_KALKS: "0137551800", D_INCO2: "0227141600", D_INCO1: "0583036200",
            D_LPRIO: "0123488800", D_WAERS: "0184627700", D_ERDAT: "0227132900"}),
        "KNA1.TELF2": [""] * n, "KNA1.TELFX": [""] * n,
        "KNA1.KNURL": _col({C2: "www.weber-antriebstechnik.de"}),
        "KNA1.ERDAT": _col({C2: "20140310", C4: "20230805", OT: "20080301", DEL: "20110704",
                            D_ERDAT: "20271103"}, "20180919"),
        "KNA1.ADRNR": adrnr,
        "KNA1.LOEVM": _col({DEL: "X"}),
        "KNA1.SPERR": _col({DEL: "X"}),
        "KNA1.AUFSD": _col({DEL: "01"}),
        "KNA1.CASSD": [""] * n,
        "KNA1.XCPDK": _col({OT: "X"}),
    })
    kna1.loc[kna1["KNA1.KUNNR"] == OT, ["KNA1.STRAS", "KNA1.ORT01", "KNA1.PSTLZ", "KNA1.TELF1"]] = ""

    # sales areas: 1000 / 10 (direct) / 00 (cross-division), C1 also 1000 / 20 (wholesale);
    # C3's old wholesale sales area is flagged for deletion and was never completed
    areas = [(k, "1000", "10", "00") for k in CUSTOMERS] + [(C1, "1000", "20", "00"), (C3, "1000", "20", "00")]
    m = len(areas)
    knvv = pd.DataFrame({
        "KNVV.KUNNR": [a[0] for a in areas], "KNVV.VKORG": [a[1] for a in areas],
        "KNVV.VTWEG": [a[2] for a in areas], "KNVV.SPART": [a[3] for a in areas],
        "KNVV.KDGRP": ["01"] * m, "KNVV.KALKS": ["1"] * m, "KNVV.VERSG": ["1"] * m,
        "KNVV.ZTERM": ["ZB30"] * m, "KNVV.WAERS": ["ZAR"] * m, "KNVV.VSBED": ["01"] * m,
        "KNVV.LPRIO": ["02"] * m, "KNVV.KZAZU": ["X"] * m,
        "KNVV.INCO1": ["FCA"] * m, "KNVV.INCO2": ["Sasolburg"] * m,
        "KNVV.ERDAT": [kna1.set_index("KNA1.KUNNR").at[a[0], "KNA1.ERDAT"] if a[0] != D_ERDAT else "20181002"
                       for a in areas],
        "KNVV.LOEVM": [""] * m, "KNVV.KTGRD": ["01"] * m,
    })
    knvv.loc[knvv["KNVV.KUNNR"] == C2, ["KNVV.WAERS", "KNVV.INCO1", "KNVV.INCO2", "KNVV.KDGRP"]] = \
        ["EUR", "CIP", "Mannheim", "02"]
    knvv.loc[knvv["KNVV.KUNNR"] == C4, ["KNVV.ZTERM", "KNVV.INCO1", "KNVV.INCO2", "KNVV.KDGRP", "KNVV.KZAZU"]] = \
        ["0001", "DAP", "Pretoria", "05", ""]
    knvv.loc[knvv["KNVV.KUNNR"] == OT, ["KNVV.ZTERM", "KNVV.INCO1", "KNVV.INCO2"]] = ["0001", "EXW", "Sasolburg"]
    stale = (knvv["KNVV.KUNNR"] == C3) & (knvv["KNVV.VTWEG"] == "20")
    knvv.loc[stale, ["KNVV.LOEVM", "KNVV.KALKS", "KNVV.ZTERM", "KNVV.VSBED", "KNVV.KTGRD"]] = ["X", "", "", "", ""]
    knvv.loc[knvv["KNVV.KUNNR"] == DEL, ["KNVV.KALKS", "KNVV.WAERS", "KNVV.KTGRD"]] = ["", "", ""]
    knvv.loc[knvv["KNVV.KUNNR"] == D_ERDAT, "KNVV.KTGRD"] = ""   # no account assignment group
    knvv.loc[knvv["KNVV.KUNNR"] == D_MAIL, "KNVV.VSBED"] = "99"  # shipping condition not in TVSB
    knvv.loc[knvv["KNVV.KUNNR"] == D_KALKS, "KNVV.KALKS"] = ""
    knvv.loc[knvv["KNVV.KUNNR"] == D_INCO2, ["KNVV.INCO1", "KNVV.INCO2"]] = ["FOB", ""]
    knvv.loc[knvv["KNVV.KUNNR"] == D_INCO1, "KNVV.INCO1"] = "FOT"
    knvv.loc[knvv["KNVV.KUNNR"] == D_LPRIO, "KNVV.LPRIO"] = "09"
    knvv.loc[knvv["KNVV.KUNNR"] == D_WAERS, "KNVV.WAERS"] = "RAND"

    emails = {C1: "orders@sasolburgvalve.co.za", C2: "einkauf@weber-antriebstechnik.de",
              C3: "purchasing@mzansiindustrial.co.za", C4: "thabo.nkosi@webmail.co.za",
              D_POBOX: "orders@drakensbergtimber.co.za", D_MAIL: "noemail@vaalplastics.co.za",
              D_KALKS: "orders@lowveldcitrus.co.za", D_INCO2: "procurement@saldanhasteel.co.za",
              D_INCO1: "orders@fsgrain.co.za", D_LPRIO: "buying@tshwaneinteriors.co.za",
              D_WAERS: "stores@matlosanamining.co.za", D_ERDAT: "orders@wcseafood.co.za"}
    with_mail = [(a, k) for a, k in zip(adrnr, CUSTOMERS) if k in emails]
    adr6 = pd.DataFrame({
        "ADR6.ADDRNUMBER": [a for a, _ in with_mail], "ADR6.PERSNUMBER": [""] * len(with_mail),
        "ADR6.DATE_FROM": ["00010101"] * len(with_mail), "ADR6.CONSNUMBER": ["001"] * len(with_mail),
        "ADR6.FLGDEFAULT": ["X"] * len(with_mail), "ADR6.SMTP_ADDR": [emails[k] for _, k in with_mail],
    })
    return TableFrames({"KNA1": kna1, "KNVV": knvv, "ADR6": adr6}, D, module="sd_customer_master")


def _live_config(rules) -> dict[str, set[str]]:
    """The system's own check tables, as discovery would read them."""
    values = {"INCO1": {"EXW", "FCA", "FAS", "FOB", "CFR", "CIF", "CPT", "CIP", "DAP", "DPU", "DDP", "DAT", "DDU",
                        "DES", "DEQ", "DAF", "UN"},
              "LPRIO": {"01", "02", "03"}, "VKORG": {"1000"}, "VTWEG": {"10", "20"}, "SPART": {"00"},
              "KALKS": {"1", "2"}, "KDGRP": {"01", "02", "05"}, "KTGRD": {"01", "02"}, "VSBED": {"01", "02"},
              "ZTERM": {"0001", "ZB30"}, "VERSG": {"1"}, "LAND1": {"ZA", "DE"}}
    out = {}
    for r in rules:
        if r.get("check_class") in ("referential_check", "domain_value_check") and r["field"].split(".")[1] in values:
            key = _with_reference(r, D, {}).get("_reference_key")
            if key:
                out[key] = values[r["field"].split(".")[1]]
    return out


def _area(kunnr: str, vtweg: str = "10") -> str:
    return f"KUNNR={kunnr}|VKORG=1000|VTWEG={vtweg}|SPART=00"


def test_sd_customer_master_golden():
    static = yaml.safe_load(_find_module_yaml("sd_customer_master").read_text())["rules"]
    results = run_checks("sd_customer_master", _frames(), "t", reference_values=_live_config(static),
                         extra_rules=generate("sd_customer_master", static, D))
    errors = {r.check_id: r.error for r in results if r.error}
    assert not errors, errors
    found = {r.check_id: set(r.failing_record_keys or []) for r in results if r.affected_count}
    assert found == {
        "VP-KNA1-STRAS": {f"KUNNR={D_POBOX}"},           # PO box in the street (belongs in PFACH / PSTL2)
        "PH-ADR6-SMTP_ADDR": {f"KUNNR={D_MAIL}"},        # noemail@ placeholder address
        "SDCM013": {_area(D_KALKS)},                     # customer pricing procedure missing
        "SDCM022": {_area(D_INCO2)},                     # FOB without the named port
        "SDCM015": {_area(D_INCO1)},                     # FOT is not an Incoterm in TINC
        "SDCM020": {_area(D_LPRIO)},                     # delivery priority 09 not in TPRIO
        "SDCM018": {_area(D_WAERS)},                     # RAND is not an ISO currency code
        "DT-KNA1-ERDAT": {f"KUNNR={D_ERDAT}"},           # created in the future (loaded wrongly)
        "SDCM031": {_area(D_ERDAT)},                     # no account assignment group (revenue accounts)
        "SDCM033": {_area(D_MAIL)},                      # shipping condition 99 not in TVSB
    }, found
    # DEL is flagged for deletion, OT is a one-time account, C3's wholesale area is deleted at sales level
    name = next(r for r in results if r.check_id == "SDCM003")
    assert name.details["population_excluded"] == {"deleted": 1}
    tax = next(r for r in results if r.check_id == "SDCM006")
    assert tax.details["population_excluded"] == {"deleted": 1, "one_time_account": 1}
    mail = next(r for r in results if r.check_id == "SDCM007")
    assert mail.details["population_excluded"] == {"deleted": 1, "one_time_account": 1}
    pricing = next(r for r in results if r.check_id == "SDCM013")   # DEL's area (central flag) + C3's area
    assert pricing.details["population_excluded"] == {"deleted": 2}
    accounts = next(r for r in results if r.check_id == "SDCM031")
    assert accounts.details["population_excluded"] == {"deleted": 2}
