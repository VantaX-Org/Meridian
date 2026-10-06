"""Purchasing depth rules (PUR306 onward): pack integrity and pass/fail fixtures."""
import json
import re

import pandas as pd
import yaml

from checks.frames import TableFrames
from checks.runner import run_rule
from sap.ddic import get_dictionary

PACK = yaml.safe_load(open("checks/rules/ecc/mm_purchasing.yaml"))["rules"]
RULES = {r["id"]: r for r in PACK}
NEW = [r for r in PACK if r["id"].startswith("PUR") and 306 <= int(r["id"][3:]) < 369]
MANDATORY = ["id", "field", "check_class", "severity", "dimension", "message", "why_it_matters", "rule_authority",
             "sap_impact", "fix_map", "record_fix_template"]
DDIC = get_dictionary("ecc6")


def frame(table, **cols):
    return pd.DataFrame({f"{table}.{k}": v for k, v in cols.items()})


def ago(days):
    return (pd.Timestamp.today().normalize() - pd.Timedelta(days=days)).strftime("%Y%m%d")


def fire(rid, tables, refs=None):
    frames = TableFrames(tables, DDIC, module="mm_purchasing")
    _, res = run_rule(dict(RULES[rid]), frames, refs or {})
    assert res is not None and not res.error, (rid, res and res.error)
    return res.affected_count, res.total_count


def _names(table):
    return {x["name"] for x in json.load(open(f"sap/dictionaries/ecc6/tables/{table}.json"))["fields"]}


# ---- integrity ---------------------------------------------------------------------------------------------------

def test_pack_loads_with_unique_contiguous_ids():
    ids = [r["id"] for r in PACK]
    assert len(ids) == len(set(ids))
    new = sorted(int(r["id"][3:]) for r in NEW)
    assert new == list(range(306, 306 + len(new)))
    assert len(new) == 63


def test_every_new_rule_has_full_metadata():
    for r in NEW:
        for k in MANDATORY:
            assert r.get(k), (r["id"], k)
        assert r["field"].count(".") == 1


def test_every_field_exists_in_ddic():
    for r in NEW:
        refs = {r["field"], *r.get("fields", []), *r.get("applies_when", {}), *r.get("group_by", []),
                *r.get("group_keys", {}), *r.get("group_keys", {}).values(), *r.get("child_when", {})}
        refs |= {r[k] for k in ("amount", "start", "end", "sign_field") if r.get(k)}
        refs |= set(re.findall(r"`([A-Z0-9_]+\.[A-Z0-9_]+)`", r.get("fail_when", "")))
        refs |= set(re.findall(r"\{([A-Z0-9_]+\.[A-Z0-9_]+)\}", r["record_fix_template"]))
        for f in refs:
            table, name = f.split(".")
            assert name in _names(table), (r["id"], f)
        if r["check_class"] == "exists_check":
            target = _names(r["target_table"])
            assert set(r["target_fields"]) | set(r.get("target_when") or {}) <= target, r["id"]


def test_new_rules_run_without_error_on_minimal_frames():
    tables = {"EKKO": frame("EKKO", EBELN=["1"]), "EKPO": frame("EKPO", EBELN=["1"], EBELP=["10"])}
    frames = TableFrames(tables, DDIC, module="mm_purchasing")
    for r in NEW:
        _, res = run_rule(dict(r), frames, {})
        assert res is None or not res.error, (r["id"], res.error)


# ---- info records ------------------------------------------------------------------------------------------------

def test_info_record_vendor_blocked_in_purchasing_org():
    eina = frame("EINA", INFNR=["I1", "I2"], LIFNR=["V1", "V2"], MATNR=["M1", "M1"], LOEKZ=["", ""])
    eine = frame("EINE", INFNR=["I1", "I2"], EKORG=["1000", "1000"], ESOKZ=["0", "0"], WERKS=["", ""],
                 LOEKZ=["", ""])
    lfm1 = frame("LFM1", LIFNR=["V1", "V2"], EKORG=["1000", "1000"], SPERM=["", "X"], LOEVM=["", ""])
    assert fire("PUR307", {"EINA": eina, "EINE": eine, "LFM1": lfm1}) == (1, 2)


def test_info_record_price_expired():
    eine = frame("EINE", INFNR=["I1", "I2"], EKORG=["1000", "1000"], ESOKZ=["0", "0"], WERKS=["", ""],
                 LOEKZ=["", ""], PRDAT=[ago(-30), ago(30)])
    assert fire("PUR317", {"EINE": eine}) == (1, 2)


def test_info_record_lead_time_over_a_year():
    eine = frame("EINE", INFNR=["I1", "I2"], EKORG=["1000", "1000"], ESOKZ=["0", "0"], WERKS=["", ""],
                 LOEKZ=["", ""], APLFZ=["21", "2100"])
    assert fire("PUR309", {"EINE": eine}) == (1, 2)


# ---- source list and quota arrangement ---------------------------------------------------------------------------

def test_overlapping_fixed_sources():
    eord = frame("EORD", MATNR=["M1", "M1", "M2"], WERKS=["P1", "P1", "P1"], ZEORD=["1", "2", "1"],
                 VDATU=["20200101", "20200601", "20200101"], BDATU=["20201231", "20210630", "99991231"],
                 FLIFN=["X", "X", "X"], NOTKZ=["", "", ""])
    affected, total = fire("PUR321", {"EORD": eord})
    assert total == 3 and affected >= 1


def test_quota_arrangement_without_positive_quota():
    equk = frame("EQUK", QUNUM=["Q1", "Q2"], MATNR=["M1", "M2"], WERKS=["P1", "P1"])
    equp = frame("EQUP", QUNUM=["Q1", "Q2"], QUPOS=["1", "1"], QUOTE=["60", "0"])
    assert fire("PUR329", {"EQUK": equk, "EQUP": equp}) == (1, 2)


def test_stock_transfer_quota_item_needs_supplying_plant():
    equp = frame("EQUP", QUNUM=["Q1", "Q1", "Q1"], QUPOS=["1", "2", "3"], SOBES=["7", "7", "0"],
                 BEWRK=["P2", "", ""])
    assert fire("PUR332", {"EQUP": equp}) == (1, 2)


# ---- outline agreements ------------------------------------------------------------------------------------------

def test_release_order_outside_contract_validity():
    ekko = frame("EKKO", EBELN=["C1"], BSTYP=["K"], KDATB=["20240101"], KDATE=["20241231"])
    ekab = frame("EKAB", KONNR=["C1", "C1"], KTPNR=["10", "10"], EBELN=["P1", "P2"], EBELP=["10", "10"],
                 BEDAT=["20240615", "20250210"], LOEKZ=["", ""])
    assert fire("PUR335", {"EKKO": ekko, "EKAB": ekab}) == (1, 2)


def test_contract_item_target_quantity_overrun():
    ekko = frame("EKKO", EBELN=["C1"], BSTYP=["K"])
    ekpo = frame("EKPO", EBELN=["C1", "C1"], EBELP=["10", "20"], KTMNG=["100", "100"], LOEKZ=["", ""])
    ekab = frame("EKAB", KONNR=["C1", "C1", "C1"], KTPNR=["10", "20", "20"], EBELN=["P1", "P2", "P3"],
                 EBELP=["10", "10", "10"], MENGE=["80", "70", "60"])
    assert fire("PUR336", {"EKKO": ekko, "EKPO": ekpo, "EKAB": ekab}) == (1, 2)


def test_contract_target_value_overrun():
    ekko = frame("EKKO", EBELN=["C1", "C2"], BSTYP=["K", "K"], LOEKZ=["", ""], KTWRT=["1000", "1000"],
                 WAERS=["ZAR", "ZAR"])
    ekab = frame("EKAB", KONNR=["C1", "C2", "C2"], KTPNR=["10", "10", "10"], EBELN=["P1", "P2", "P3"],
                 EBELP=["10", "10", "10"], NETWR=["900", "600", "600"], WAERS=["ZAR", "ZAR", "ZAR"])
    assert fire("PUR337", {"EKKO": ekko, "EKAB": ekab}) == (1, 2)


# ---- purchase orders ---------------------------------------------------------------------------------------------

def test_account_assigned_item_without_ekkn():
    ekpo = frame("EKPO", EBELN=["1", "1", "1"], EBELP=["10", "20", "30"], KNTTP=["K", "K", ""],
                 LOEKZ=["", "", ""])
    ekkn = frame("EKKN", EBELN=["1"], EBELP=["10"], ZEKKN=["01"], KOSTL=["CC1"])
    assert fire("PUR345", {"EKPO": ekpo, "EKKN": ekkn}) == (1, 2)


def test_cost_centre_assignment_without_cost_centre():
    ekko = frame("EKKO", EBELN=["1"])
    ekpo = frame("EKPO", EBELN=["1", "1"], EBELP=["10", "20"], KNTTP=["K", "K"])
    ekkn = frame("EKKN", EBELN=["1", "1"], EBELP=["10", "20"], ZEKKN=["01", "01"], KOSTL=["CC1", ""],
                 LOEKZ=["", ""])
    assert fire("PUR346", {"EKKO": ekko, "EKPO": ekpo, "EKKN": ekkn}) == (1, 2)


def test_quantity_distribution_must_add_up():
    ekpo = frame("EKPO", EBELN=["1", "1"], EBELP=["10", "20"], VRTKZ=["1", "1"], LOEKZ=["", ""],
                 MENGE=["10", "10"])
    ekkn = frame("EKKN", EBELN=["1", "1", "1", "1"], EBELP=["10", "10", "20", "20"], ZEKKN=["01", "02", "01", "02"],
                 MENGE=["4", "6", "4", "4"])
    assert fire("PUR350", {"EKPO": ekpo, "EKKN": ekkn}) == (1, 2)


def test_schedule_lines_must_add_up():
    ekko = frame("EKKO", EBELN=["1"], BSTYP=["F"])
    ekpo = frame("EKPO", EBELN=["1", "1"], EBELP=["10", "20"], LOEKZ=["", ""], MENGE=["10", "10"])
    eket = frame("EKET", EBELN=["1", "1"], EBELP=["10", "20"], ETENR=["1", "1"], MENGE=["10", "8"])
    assert fire("PUR351", {"EKKO": ekko, "EKPO": ekpo, "EKET": eket}) == (1, 2)


def test_overdue_schedule_line():
    ekko = frame("EKKO", EBELN=["1"], BSTYP=["F"])
    ekpo = frame("EKPO", EBELN=["1", "1"], EBELP=["10", "20"], WEPOS=["X", "X"], ELIKZ=["", ""], LOEKZ=["", ""])
    eket = frame("EKET", EBELN=["1", "1"], EBELP=["10", "20"], ETENR=["1", "1"], EINDT=[ago(60), ago(60)],
                 MENGE=["10", "10"], WEMNG=["10", "4"])
    assert fire("PUR352", {"EKKO": ekko, "EKPO": ekpo, "EKET": eket}) == (1, 2)


def test_old_open_item():
    ekko = frame("EKKO", EBELN=["1", "2", "3"], BSTYP=["F", "F", "F"], BEDAT=[ago(500), ago(20), ago(500)])
    ekpo = frame("EKPO", EBELN=["1", "2", "3"], EBELP=["10", "10", "10"], ELIKZ=["", "", ""], LOEKZ=["", "", ""],
                 EREKZ=["", "", "X"])  # PO 3: final invoice posted, out of scope
    assert fire("PUR353", {"EKKO": ekko, "EKPO": ekpo}) == (1, 2)


def test_fully_received_without_delivery_completed():
    ekko = frame("EKKO", EBELN=["1"], BSTYP=["F"])
    ekpo = frame("EKPO", EBELN=["1", "1"], EBELP=["10", "20"], ELIKZ=["", ""], LOEKZ=["", ""], MENGE=["10", "10"])
    ekbe = frame("EKBE", EBELN=["1", "1", "1"], EBELP=["10", "20", "20"], ZEKKN=["00", "00", "00"],
                 VGABE=["1", "1", "1"], GJAHR=["2026", "2026", "2026"], BELNR=["A", "B", "C"],
                 BUZEI=["1", "1", "1"], MENGE=["10", "6", "1"], SHKZG=["S", "S", "H"])
    assert fire("PUR354", {"EKKO": ekko, "EKPO": ekpo, "EKBE": ekbe}) == (1, 2)


def test_gr_based_iv_required_by_vendor():
    lfm1 = frame("LFM1", LIFNR=["V1"], EKORG=["1000"], WEBRE=["X"])
    ekko = frame("EKKO", EBELN=["1"], LIFNR=["V1"], EKORG=["1000"])
    ekpo = frame("EKPO", EBELN=["1", "1"], EBELP=["10", "20"], WEBRE=["X", ""], WEPOS=["X", "X"],
                 LOEKZ=["", ""], ELIKZ=["", ""])
    assert fire("PUR355", {"LFM1": lfm1, "EKKO": ekko, "EKPO": ekpo}) == (1, 1)


def test_incoterms_against_vendor():
    lfm1 = frame("LFM1", LIFNR=["V1"], EKORG=["1000"], INCO1=["FCA"])
    ekko = frame("EKKO", EBELN=["1", "2"], LIFNR=["V1", "V1"], EKORG=["1000", "1000"], INCO1=["FCA", "DDP"],
                 LOEKZ=["", ""], BSTYP=["F", "F"])
    assert fire("PUR357", {"LFM1": lfm1, "EKKO": ekko}) == (1, 2)


# ---- release strategy and requisitions ---------------------------------------------------------------------------

def test_po_release_strategy_must_exist():
    t16fs = frame("T16FS", FRGGR=["01"], FRGSX=["S1"], FRGC1=["10"])
    ekko = frame("EKKO", EBELN=["1", "2"], FRGGR=["01", "01"], FRGSX=["S1", "S9"])
    assert fire("PUR358", {"EKKO": ekko, "T16FS": t16fs}) == (1, 2)


def test_strategy_without_release_code():
    t16fs = frame("T16FS", FRGGR=["01", "01"], FRGSX=["S1", "S2"], FRGC1=["10", ""])
    assert fire("PUR368", {"T16FS": t16fs}) == (1, 2)


def test_requisition_open_too_long():
    eban = frame("EBAN", BANFN=["R1", "R2"], BNFPO=["10", "10"], STATU=["N", "N"], LOEKZ=["", ""],
                 EBAKZ=["", ""], BADAT=[ago(200), ago(10)])
    assert fire("PUR360", {"EBAN": eban}) == (1, 2)


def test_account_assigned_requisition_without_ebkn():
    eban = frame("EBAN", BANFN=["R1", "R2"], BNFPO=["10", "10"], KNTTP=["K", "K"], LOEKZ=["", ""])
    ebkn = frame("EBKN", BANFN=["R1"], BNFPO=["10"], ZEBKN=["01"])
    assert fire("PUR364", {"EBAN": eban, "EBKN": ebkn}) == (1, 2)
