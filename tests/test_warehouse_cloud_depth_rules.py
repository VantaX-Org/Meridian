"""Warehouse, Ariba and Concur depth rules: integrity, pass/fail fixtures and conditional-branch proofs."""
import glob
import json
import re
from datetime import date, timedelta

import pandas as pd
import pytest
import yaml

from checks.frames import TableFrames
from checks.runner import run_checks
from sap.ddic import get_dictionary

D = get_dictionary("s4hana")
MANDATORY = ["id", "field", "check_class", "severity", "dimension", "message", "why_it_matters", "rule_authority",
             "sap_impact", "fix_map", "record_fix_template"]
AUTHORITIES = {"sap_hard_constraint", "best_practice", "customer_configured", "iso_standard", "regulatory",
               "s4hana_migration"}

# pack path -> (id prefix, first new number, number of new rules)
PACKS = {
    "warehouse/ewms_stock": ("EWMS", 113, 18),
    "warehouse/ewms_transfer_orders": ("EWTO", 109, 10),
    "warehouse/wm_interface": ("WMI", 24, 13),
    "warehouse/batch_management": ("BATCH", 25, 16),
    "warehouse/transport_management": ("TM", 38, 13),
    "warehouse/fleet_management": ("FLEET", 36, 14),
    "warehouse/grc_compliance": ("GRC", 27, 15),
    "warehouse/mdg_master_data": ("MDG", 27, 9),
    "warehouse/cross_system_integration": ("XSYS", 28, 5),
    "ariba/ariba_procurement": ("ARP", 17, 11),
    "ariba/ariba_contracts": ("ARC", 10, 7),
    "ariba/ariba_supplier": ("ARS", 8, 7),
    "concur/concur_expense": ("CNE", 21, 20),
    "concur/concur_users": ("CNU", 10, 5),
}
S4R_WM = ["S4R-WM-QUANT-NEG", "S4R-WM-TO-OPEN", "S4R-WM-INV-QUANT", "S4R-WM-INV-BIN", "S4R-WM-QUANT-EXPIRED",
          "S4R-WM-LEIN-EMPTY", "S4R-WM-MLGT-BIN", "S4R-WM-QUANT-BLOCKED"]


def _load(pack):
    return yaml.safe_load(open(f"checks/rules/{pack}.yaml"))["rules"]


def _new(pack):
    prefix, start, _ = PACKS[pack]
    return [r for r in _load(pack) if re.fullmatch(prefix + r"\d+", r["id"]) and int(r["id"][len(prefix):]) >= start]


NEW = {p: _new(p) for p in PACKS}
S4_PACK = yaml.safe_load(open("checks/rules/ecc/s4_readiness.yaml"))
S4_NEW = [r for r in S4_PACK["rules"] if r["id"] in S4R_WM]
ALL_NEW = [(p, r) for p, rs in NEW.items() for r in rs] + [("ecc/s4_readiness", r) for r in S4_NEW]


def _day(n):
    return (date.today() - timedelta(days=n)).strftime("%Y%m%d")


def _fields(table):
    p = f"sap/dictionaries/ecc6/tables/{table}.json"
    try:
        return {x["name"] for x in json.load(open(p))["fields"]}
    except FileNotFoundError:
        for c in glob.glob("sap/dictionaries/canonical/*.yaml"):
            t = yaml.safe_load(open(c)).get("tables", {})
            if table in t:
                return set(t[table]["fields"])
    raise AssertionError(f"no dictionary for {table}")


def _refs(r):
    s = {r["field"], *r.get("fields", []), *r.get("applies_when", {})}
    s |= set(re.findall(r"`([A-Z0-9_/]+\.[A-Z0-9_]+)`", r.get("fail_when", "")))
    s |= set(re.findall(r"\{([A-Z0-9_/]+\.[A-Z0-9_]+)\}", r["record_fix_template"]))
    return s


# ---------------------------------------------------------------- integrity

@pytest.mark.parametrize("pack", list(PACKS))
def test_ids_unique_and_contiguous(pack):
    prefix, start, count = PACKS[pack]
    ids = [r["id"] for r in _load(pack)]
    assert len(ids) == len(set(ids))
    assert sorted(int(r["id"][len(prefix):]) for r in NEW[pack]) == list(range(start, start + count))


def test_total_new_rules():
    assert sum(len(v) for v in NEW.values()) == 163
    assert len(S4_NEW) == len(S4R_WM)


@pytest.mark.parametrize("pack,rule", ALL_NEW, ids=[r["id"] for _, r in ALL_NEW])
def test_metadata_and_fields(pack, rule):
    for k in MANDATORY:
        assert rule.get(k), (rule["id"], k)
    assert rule["rule_authority"] in AUTHORITIES
    for ref in _refs(rule):
        table, name = ref.split(".", 1)
        assert name in _fields(table), (rule["id"], ref)
    if rule["check_class"] == "exists_check":
        assert set(rule["target_fields"]) | set(rule.get("target_when", {})) <= _fields(rule["target_table"]), rule["id"]


def test_no_personal_values_echoed():
    bad = re.compile(r"NAME|EMAIL|SMTP|STRAS|CITY|TEL|BIRTH|FIRST|LAST_NAME|OWNER")
    for _, r in ALL_NEW:
        for f in re.findall(r"\{[A-Z0-9_/]+\.([A-Z0-9_]+)\}", r["record_fix_template"]):
            assert not bad.search(f), (r["id"], f)


def test_s4_wm_rules_are_tagged():
    for r in S4_NEW:
        assert r["s4_area"] == "warehouse_ewm" and r["baseline"] == "s4_target"
        assert r["rule_authority"] == "s4hana_migration" and r["s4_impact"] in ("blocking", "warning")
        assert r["simplification_item"] and r["message"].startswith("S/4HANA readiness:")


def test_readiness_areas_reference_existing_rules():
    known = {r["id"] for f in glob.glob("checks/rules/*/*.yaml") for r in (yaml.safe_load(open(f)) or {}).get("rules", [])
             if isinstance(yaml.safe_load(open(f)), dict)}
    for area in ("warehouse_ewm", "ariba_integration", "concur_integration"):
        rel = S4_PACK["areas"][area]["related"]
        ids = rel.get("blocking", []) + rel.get("warning", [])
        assert ids and not set(ids) - known, (area, set(ids) - known)
        assert not set(rel.get("blocking", [])) & set(rel.get("warning", []))
    assert {r["id"] for r in S4_NEW} <= {r["id"] for r in S4_PACK["rules"]}


# ---------------------------------------------------------------- run helpers

BY_ID = {r["id"]: r for _, r in ALL_NEW}


def _tables(spec, rule=None):
    """Build frames; columns the rule reads but the fixture omits are present and blank."""
    out = {}
    for t, rows in spec.items():
        df = pd.DataFrame([{f"{t}.{k}": v for k, v in row.items()} for row in rows])
        for ref in _refs(rule) if rule else ():
            if ref.startswith(t + ".") and ref not in df.columns:
                df[ref] = None
        out[t] = df
    return out


def run(module, rule_id, spec, absent_ok=False):
    res = next((r for r in run_checks(module, TableFrames(_tables(spec, BY_ID[rule_id]), D, module=module), "t") if r.check_id == rule_id), None)
    if res is None and absent_ok:  # no row passed applies_when: the engine emits no result
        return 0, 0
    assert res is not None, f"{rule_id} did not run"
    assert res.error is None, (rule_id, res.error)
    return res.total_count, res.affected_count


def test_every_new_rule_runs_on_minimal_frames():
    for pack, rule in ALL_NEW:
        module = pack.split("/")[1]
        spec = {}
        for ref in _refs(rule):
            t, n = ref.split(".", 1)
            spec.setdefault(t, [{}])[0][n] = "X"
        if rule["check_class"] == "exists_check":
            spec.setdefault(rule["target_table"], [{}])
            for f in rule["target_fields"]:
                spec[rule["target_table"]][0][f] = "X"
        results = run_checks(module, TableFrames(_tables(spec), D, module=module), "t")
        for res in results:
            if res.check_id == rule["id"]:
                assert not res.error or "not applicable" in res.error.lower() or "skipped" in res.error.lower(), (rule["id"], res.error)


# ---------------------------------------------------------------- pass/fail fixtures
# Each case: rows are [clean, dirty, ...skipped rows]; the expected (total, affected) default is (2, 1).

LQ = dict(LGNUM="100", LGTYP="001", LGPLA="B1", MATNR="M1", WERKS="1000")


def lq(**kw):
    return {**LQ, **kw}


CASES = {
    "EWMS113": ("ewms_stock", {"LQUA": [lq(LQNUM="1", LENUM="E1"), lq(LQNUM="2", LENUM="E9")],
                               "LEIN": [{"LGNUM": "100", "LENUM": "E1"}]}),
    "EWMS117": ("ewms_stock", {"LQUA": [lq(LQNUM="1", EINME="5"), lq(LQNUM="2", EINME="-1")]}),
    "EWMS119": ("ewms_stock", {"LQUA": [lq(LQNUM="1", AUSME="1", GESME="5"), lq(LQNUM="2", AUSME="6", GESME="5")]}),
    "EWMS120": ("ewms_stock", {"LQUA": [lq(LQNUM="1", SKZSA="X", SPGRU="1"), lq(LQNUM="2", SKZSA="X")]}),
    "EWMS124": ("ewms_stock", {"LQUA": [lq(LQNUM="1", GESME="5", VFDAT=_day(30), BESTQ="S"), lq(LQNUM="2", GESME="5", VFDAT=_day(30)),
                                        lq(LQNUM="3", GESME="0", VFDAT=_day(30))]}),
    "EWMS125": ("ewms_stock", {"LQUA": [lq(LQNUM="1", VFDAT="20300101", WDATU="20260101"),
                                        lq(LQNUM="2", VFDAT="20250101", WDATU="20260101")]}),
    "EWTO109": ("ewms_transfer_orders", {"LTAK": [{"LGNUM": "100", "TANUM": "1", "BDATU": _day(2), "KQUIT": ""},
                                                  {"LGNUM": "100", "TANUM": "2", "BDATU": _day(120), "KQUIT": ""},
                                                  {"LGNUM": "100", "TANUM": "3", "BDATU": _day(120), "KQUIT": "X"}]}),
    "EWTO110": ("ewms_transfer_orders", {"LTAP": [{"LGNUM": "100", "TANUM": "1", "TAPOS": "1", "VLTYP": "001", "VLPLA": "B1"},
                                                  {"LGNUM": "100", "TANUM": "2", "TAPOS": "1", "VLTYP": "001", "VLPLA": "B9"},
                                                  {"LGNUM": "100", "TANUM": "3", "TAPOS": "1", "VLTYP": "901", "VLPLA": "B9"}],
                                         "LAGP": [{"LGNUM": "100", "LGTYP": "001", "LGPLA": "B1"}]}),
    "EWTO116": ("ewms_transfer_orders", {"LTAP": [{"LGNUM": "100", "TANUM": "1", "TAPOS": "1", "SOBKZ": "E", "SONUM": "S1"},
                                                  {"LGNUM": "100", "TANUM": "2", "TAPOS": "1", "SOBKZ": "E"}]}),
    "WMI026": ("wm_interface", {"MLGT": [{"MATNR": "M1", "LGNUM": "100", "LGTYP": "001", "LGPLA": "B1", "LPMAX": "10"},
                                         {"MATNR": "M2", "LGNUM": "100", "LGTYP": "001", "LGPLA": "B2"}]}),
    "WMI027": ("wm_interface", {"MLGT": [{"MATNR": "M1", "LGNUM": "100", "LGTYP": "001", "LGPLA": "B1", "NSMNG": "5"},
                                         {"MATNR": "M2", "LGNUM": "100", "LGTYP": "001", "NSMNG": "5"}]}),
    "WMI035": ("wm_interface", {"T333": [{"LGNUM": "100", "BWLVS": "999"}, {"LGNUM": "900", "BWLVS": "998"}],
                                "T300": [{"LGNUM": "100"}]}),
    "BATCH027": ("batch_management", {"MCH1": [{"MATNR": "M1", "CHARG": "A", "VFDAT": "20991231"},
                                               {"MATNR": "M1", "CHARG": "B", "VFDAT": "20200101"}],
                                      "MCHA": [{"MATNR": "M1", "WERKS": "1000", "CHARG": "A"},
                                               {"MATNR": "M1", "WERKS": "1000", "CHARG": "B"}],
                                      "MCHB": [{"MATNR": "M1", "WERKS": "1000", "LGORT": "0001", "CHARG": "A", "CLABS": "10"},
                                               {"MATNR": "M1", "WERKS": "1000", "LGORT": "0001", "CHARG": "B", "CLABS": "10"}]}),
    "BATCH031": ("batch_management", {"MCHB": [{"MATNR": "M1", "WERKS": "1000", "LGORT": "0001", "CHARG": "A", "SPERC": "X", "CLABS": "0"},
                                               {"MATNR": "M1", "WERKS": "1000", "LGORT": "0001", "CHARG": "B", "SPERC": "X", "CLABS": "4"}]}),
    "BATCH037": ("batch_management", {"MCH1": [{"MATNR": "M1", "CHARG": "A", "VLCHA": "Z", "VLMAT": "M0"},
                                               {"MATNR": "M1", "CHARG": "B", "VLCHA": "Z"}]}),
    "TM038": ("transport_management", {"VTTK": [{"TKNUM": "1", "ROUTE": "R1"}, {"TKNUM": "2", "ROUTE": "R9"},
                                                {"TKNUM": "3"}], "TVRO": [{"ROUTE": "R1"}]}),
    "TM041": ("transport_management", {"VTTK": [{"TKNUM": "1", "STTRG": "4", "DPTEN": _day(-5)},
                                                {"TKNUM": "2", "STTRG": "4", "DPTEN": _day(5)},
                                                {"TKNUM": "3", "STTRG": "7", "DPTEN": _day(5)},
                                                {"TKNUM": "4", "STTRG": "4", "DPTEN": _day(5), "STTEN": _day(1)}]}),
    "TM049": ("transport_management", {"VTTP": [{"TKNUM": "1", "TPNUM": "1", "VBELN": "80000001"},
                                                {"TKNUM": "1", "TPNUM": "2", "VBELN": "80000002"},
                                                {"TKNUM": "1", "TPNUM": "3", "VBELN": "80000002"}]}, (3, 2)),
    "FLEET036": ("fleet_management", {"FLEET_MASTER": [{"EQUNR": "1", "CURRENT_KM": "100"}, {"EQUNR": "2", "CURRENT_KM": "-1"}]}),
    "FLEET043": ("fleet_management", {"EQUI": [{"EQUNR": "1", "S_FLEET": "X", "INBDT": _day(5)},
                                               {"EQUNR": "2", "S_FLEET": "X", "INBDT": _day(-5)},
                                               {"EQUNR": "3", "S_FLEET": "", "INBDT": _day(-5)}]}),
    "GRC032": ("grc_compliance", {"GRACROLE": [{"ROLEID": "1", "CERTIFY_PERIOD": "30", "CERTIFY_DUE": "20260101"},
                                               {"ROLEID": "2", "CERTIFY_PERIOD": "30"}]}),
    "GRC034": ("grc_compliance", {"GRACROLE": [{"ROLEID": "1", "CRITLVL": "1"}, {"ROLEID": "2"}]}),
    "GRC040": ("grc_compliance", {"GRACSODRISK": [{"RISKID": "1", "ACTIVE": "X", "ACTGEN": "A"},
                                                  {"RISKID": "2", "ACTIVE": "X"}]}),
    "MDG029": ("mdg_master_data", {"USMD120C": [{"USMD_CREQUEST": "1", "USMD_CREQ_STATUS": "05", "USMD_RELEASED_AT": "20260101120000"},
                                                {"USMD_CREQUEST": "2", "USMD_CREQ_STATUS": "05", "USMD_RELEASED_AT": "0"}]}),
    "MDG030": ("mdg_master_data", {"USMD120C": [{"USMD_CREQUEST": "1", "USMD_CREQ_STATUS": "01", "USMD_PRIORITY": "2"},
                                                {"USMD_CREQUEST": "2", "USMD_CREQ_STATUS": "01"},
                                                {"USMD_CREQUEST": "3", "USMD_CREQ_STATUS": "05"}]}),
    "MDG035": ("mdg_master_data", {"USMD120C": [{"USMD_CREQUEST": "1", "USMD_CREQ_STATUS": "06", "USMD_DATA_ACTIVE": ""},
                                                {"USMD_CREQUEST": "2", "USMD_CREQ_STATUS": "06", "USMD_DATA_ACTIVE": "X"}]}),
    "XSYS028": ("cross_system_integration", {"XSYS": [{"OBJECT_TYPE": "MATERIAL", "OBJECT_KEY": "1", "MATNR": "M1"},
                                                      {"OBJECT_TYPE": "MATERIAL", "OBJECT_KEY": "2"},
                                                      {"OBJECT_TYPE": "VENDOR", "OBJECT_KEY": "3"}]}, (3, 1)),
    "ARP017": ("ariba_procurement", {"ARIBA_PO": [{"ORDER_ID": "1", "TOTAL_AMOUNT": "10"}, {"ORDER_ID": "2", "TOTAL_AMOUNT": "-5"},
                                                  {"ORDER_ID": "3"}]}),
    "ARP018": ("ariba_procurement", {"ARIBA_PO": [{"ORDER_ID": "1", "COMPANY_CODE": "1000", "STATUS": "Ordered"},
                                                  {"ORDER_ID": "2", "STATUS": "Ordered"},
                                                  {"ORDER_ID": "3", "STATUS": "Canceled"}]}),
    "ARP021": ("ariba_procurement", {"ARIBA_PO": [{"ORDER_ID": "1", "TOTAL_AMOUNT": "10", "CURRENCY_CODE": "USD"},
                                                  {"ORDER_ID": "2", "TOTAL_AMOUNT": "10"}]}),
    "ARC010": ("ariba_contracts", {"ARIBA_CONTRACT": [{"CONTRACT_ID": "1", "STATUS": "Published", "EXPIRATION_DATE": _day(-30)},
                                                      {"CONTRACT_ID": "2", "STATUS": "Published", "EXPIRATION_DATE": _day(30)},
                                                      {"CONTRACT_ID": "3", "STATUS": "Expired", "EXPIRATION_DATE": _day(30)}]}),
    "ARC013": ("ariba_contracts", {"ARIBA_CONTRACT": [{"CONTRACT_ID": "1", "CONTRACT_AMOUNT": "5", "CURRENCY_CODE": "USD"},
                                                      {"CONTRACT_ID": "2", "CONTRACT_AMOUNT": "5"}]}),
    "ARS009": ("ariba_supplier", {"ARIBA_SUPPLIER": [{"VENDOR_ID": "1", "ERP_VENDOR_ID": "V1"}, {"VENDOR_ID": None, "ERP_VENDOR_ID": "V2"}]}),
    "CNE024": ("concur_expense", {"CONCUR_REPORT": [{"REPORT_ID": "1", "APPROVAL_STATUS_CODE": "A_APPR", "APPROVED_DATE": "20260101"},
                                                    {"REPORT_ID": "2", "APPROVAL_STATUS_CODE": "A_APPR"},
                                                    {"REPORT_ID": "3", "APPROVAL_STATUS_CODE": "A_PEND"}]}),
    "CNE025": ("concur_expense", {"CONCUR_REPORT": [{"REPORT_ID": "1", "APPROVAL_STATUS_CODE": "A_PEND", "APPROVER_LOGIN_ID": "a"},
                                                    {"REPORT_ID": "2", "APPROVAL_STATUS_CODE": "A_PEND"},
                                                    {"REPORT_ID": "3", "APPROVAL_STATUS_CODE": "A_APPR"}]}),
    "CNE026": ("concur_expense", {"CONCUR_REPORT": [{"REPORT_ID": "1", "APPROVAL_STATUS_CODE": "A_PEND", "SUBMIT_DATE": _day(5)},
                                                    {"REPORT_ID": "2", "APPROVAL_STATUS_CODE": "A_PEND", "SUBMIT_DATE": _day(60)},
                                                    {"REPORT_ID": "3", "APPROVAL_STATUS_CODE": "A_APPR", "SUBMIT_DATE": _day(60)}]}),
    "CNE031": ("concur_expense", {"CONCUR_REPORT": [{"REPORT_ID": "1", "APPROVAL_STATUS_CODE": "A_APPR", "HAS_EXCEPTION": "false"},
                                                    {"REPORT_ID": "2", "APPROVAL_STATUS_CODE": "A_APPR", "HAS_EXCEPTION": "true"},
                                                    {"REPORT_ID": "3", "APPROVAL_STATUS_CODE": "A_PEND", "HAS_EXCEPTION": "true"}]}),
    "CNE036": ("concur_expense", {"CONCUR_ENTRY": [{"ENTRY_ID": "1", "EXCHANGE_RATE": "1.2"}, {"ENTRY_ID": "2", "EXCHANGE_RATE": "0"},
                                                   {"ENTRY_ID": "3"}]}),
    "CNE039": ("concur_expense", {"CONCUR_ENTRY": [
        {"ENTRY_ID": "1", "REPORT_ID": "R1", "EXPENSE_TYPE_CODE": "MEALS", "TRANSACTION_DATE": "20260101", "TRANSACTION_AMOUNT": "10"},
        {"ENTRY_ID": "2", "REPORT_ID": "R1", "EXPENSE_TYPE_CODE": "MEALS", "TRANSACTION_DATE": "20260102", "TRANSACTION_AMOUNT": "10"},
        {"ENTRY_ID": "3", "REPORT_ID": "R1", "EXPENSE_TYPE_CODE": "MEALS", "TRANSACTION_DATE": "20260102", "TRANSACTION_AMOUNT": "10"}]}, (3, 2)),
    "CNU010": ("concur_users", {"CONCUR_USER": [{"LOGIN_ID": "1", "ACTIVE": "true", "COST_CENTER": "C1"},
                                                {"LOGIN_ID": "2", "ACTIVE": "true"}, {"LOGIN_ID": "3", "ACTIVE": "false"}]}),
    "CNU013": ("concur_users", {"CONCUR_USER": [{"LOGIN_ID": "1", "ACTIVE": "false", "EMPLOYEE_ID": "E1"},
                                                {"LOGIN_ID": "2", "ACTIVE": "false"}, {"LOGIN_ID": "3", "ACTIVE": "true"}]}),
    "CNU014": ("concur_users", {"CONCUR_USER": [{"LOGIN_ID": "1", "ACTIVE": "true"}, {"LOGIN_ID": "2", "ACTIVE": "maybe"}]}),
    # S/4HANA readiness, warehouse
    "S4R-WM-QUANT-NEG": ("s4_readiness", {"LQUA": [lq(LQNUM="1", GESME="5"), lq(LQNUM="2", GESME="-5")]}),
    "S4R-WM-TO-OPEN": ("s4_readiness", {"LTAP": [{"LGNUM": "100", "TANUM": "1", "TAPOS": "1", "KZQUI": "X", "PQUIT": "X"},
                                                 {"LGNUM": "100", "TANUM": "2", "TAPOS": "1", "KZQUI": "X"},
                                                 {"LGNUM": "100", "TANUM": "3", "TAPOS": "1"}]}),
    "S4R-WM-INV-QUANT": ("s4_readiness", {"LQUA": [lq(LQNUM="1"), lq(LQNUM="2", IVNUM="I1")]}),
    "S4R-WM-INV-BIN": ("s4_readiness", {"LAGP": [{"LGNUM": "100", "LGTYP": "001", "LGPLA": "B1"},
                                                 {"LGNUM": "100", "LGTYP": "001", "LGPLA": "B2", "KZINV": "X"}]}),
    "S4R-WM-QUANT-EXPIRED": ("s4_readiness", {"LQUA": [lq(LQNUM="1", VFDAT=_day(-30)), lq(LQNUM="2", VFDAT=_day(30))]}),
    "S4R-WM-LEIN-EMPTY": ("s4_readiness", {"LEIN": [{"LGNUM": "100", "LENUM": "E1"}, {"LGNUM": "100", "LENUM": "E2"}],
                                           "LQUA": [lq(LQNUM="1", LENUM="E1")]}),
    "S4R-WM-MLGT-BIN": ("s4_readiness", {"MLGT": [{"MATNR": "M1", "LGNUM": "100", "LGTYP": "001", "LGPLA": "B1"},
                                                  {"MATNR": "M2", "LGNUM": "100", "LGTYP": "001", "LGPLA": "B9"},
                                                  {"MATNR": "M3", "LGNUM": "100", "LGTYP": "001"}],
                                         "LAGP": [{"LGNUM": "100", "LGTYP": "001", "LGPLA": "B1"}]}),
    "S4R-WM-QUANT-BLOCKED": ("s4_readiness", {"LQUA": [lq(LQNUM="1", SKZSA="X", GESME="0"), lq(LQNUM="2", SKZSA="X", GESME="5")]}),
}

# Rules whose third (or later) row sits outside the applies_when condition: the row is skipped (not counted)
# so the expected population is 2 although three rows exist.
EXPECT = {"EWMS124": (2, 1), "EWTO109": (2, 1), "EWTO110": (2, 1), "TM038": (2, 1), "TM041": (2, 1), "FLEET043": (2, 1),
          "MDG030": (2, 1), "ARP017": (2, 1), "ARP018": (2, 1), "ARC010": (2, 1), "CNE024": (2, 1), "CNE025": (2, 1),
          "CNE026": (2, 1), "CNE031": (2, 1), "CNE036": (2, 1), "CNU010": (2, 1), "CNU013": (2, 1),
          "S4R-WM-TO-OPEN": (2, 1), "S4R-WM-MLGT-BIN": (2, 1)}


@pytest.mark.parametrize("rule_id", list(CASES))
def test_rule_flags_dirty_and_passes_clean(rule_id):
    case = CASES[rule_id]
    module, spec = case[0], case[1]
    expected = case[2] if len(case) > 2 else EXPECT.get(rule_id, (2, 1))
    assert run(module, rule_id, spec) == expected


# ---------------------------------------------------------------- conditional branches
# (rule, module, row skipped when the condition is false, row flagged when true): the same dirty value.

def _cond(rule_id, module, table, false_row, true_row, extra=None):
    extra = extra or {}
    skipped = run(module, rule_id, {table: [false_row], **extra}, absent_ok=True)
    flagged = run(module, rule_id, {table: [true_row], **extra})
    assert skipped[1] == 0 and flagged == (1, 1), (rule_id, skipped, flagged)


def test_expired_quant_flagged_only_when_stock_remains():
    _cond("EWMS124", "ewms_stock", "LQUA", lq(LQNUM="1", GESME="0", VFDAT=_day(30)), lq(LQNUM="1", GESME="5", VFDAT=_day(30)))


def test_open_transfer_order_flagged_only_when_confirmation_required():
    _cond("S4R-WM-TO-OPEN", "s4_readiness", "LTAP", {"LGNUM": "100", "TANUM": "1", "TAPOS": "1"},
          {"LGNUM": "100", "TANUM": "1", "TAPOS": "1", "KZQUI": "X"})


def test_old_transfer_order_flagged_only_while_unconfirmed():
    _cond("EWTO109", "ewms_transfer_orders", "LTAK", {"LGNUM": "100", "TANUM": "1", "BDATU": _day(120), "KQUIT": "X"},
          {"LGNUM": "100", "TANUM": "1", "BDATU": _day(120), "KQUIT": ""})


def test_interim_storage_type_bin_not_checked():
    bins = {"LAGP": [{"LGNUM": "100", "LGTYP": "001", "LGPLA": "B1"}]}
    _cond("EWTO110", "ewms_transfer_orders", "LTAP",
          {"LGNUM": "100", "TANUM": "1", "TAPOS": "1", "VLTYP": "901", "VLPLA": "B9"},
          {"LGNUM": "100", "TANUM": "1", "TAPOS": "1", "VLTYP": "001", "VLPLA": "B9"}, bins)


def test_fixed_bin_checked_only_when_assigned():
    bins = {"LAGP": [{"LGNUM": "100", "LGTYP": "001", "LGPLA": "B1"}]}
    _cond("S4R-WM-MLGT-BIN", "s4_readiness", "MLGT", {"MATNR": "M1", "LGNUM": "100", "LGTYP": "001"},
          {"MATNR": "M1", "LGNUM": "100", "LGTYP": "001", "LGPLA": "B9"}, bins)


def test_special_stock_needs_number_only_for_special_stock_indicators():
    _cond("EWTO116", "ewms_transfer_orders", "LTAP", {"LGNUM": "100", "TANUM": "1", "TAPOS": "1", "SOBKZ": "W"},
          {"LGNUM": "100", "TANUM": "1", "TAPOS": "1", "SOBKZ": "E"})


def test_departure_checked_only_for_open_shipments():
    _cond("TM041", "transport_management", "VTTK", {"TKNUM": "1", "STTRG": "7", "DPTEN": _day(5)},
          {"TKNUM": "1", "STTRG": "4", "DPTEN": _day(5)})


def test_certification_due_date_needed_only_with_period():
    _cond("GRC032", "grc_compliance", "GRACROLE", {"ROLEID": "1", "CERTIFY_PERIOD": "000"},
          {"ROLEID": "1", "CERTIFY_PERIOD": "030"})


def test_change_request_priority_checked_only_while_open():
    _cond("MDG030", "mdg_master_data", "USMD120C", {"USMD_CREQUEST": "1", "USMD_CREQ_STATUS": "05"},
          {"USMD_CREQUEST": "1", "USMD_CREQ_STATUS": "01"})


def test_cross_system_key_checked_only_for_matching_object_type():
    _cond("XSYS028", "cross_system_integration", "XSYS", {"OBJECT_TYPE": "VENDOR", "OBJECT_KEY": "1"},
          {"OBJECT_TYPE": "MATERIAL", "OBJECT_KEY": "1"})


def test_ariba_company_code_not_required_on_canceled_order():
    _cond("ARP018", "ariba_procurement", "ARIBA_PO", {"ORDER_ID": "1", "STATUS": "Canceled"}, {"ORDER_ID": "1", "STATUS": "Ordered"})


def test_ariba_contract_expiry_only_for_live_contracts():
    _cond("ARC010", "ariba_contracts", "ARIBA_CONTRACT",
          {"CONTRACT_ID": "1", "STATUS": "Expired", "EXPIRATION_DATE": _day(30)},
          {"CONTRACT_ID": "1", "STATUS": "Published", "EXPIRATION_DATE": _day(30)})


def test_concur_approver_needed_only_while_pending():
    _cond("CNE025", "concur_expense", "CONCUR_REPORT", {"REPORT_ID": "1", "APPROVAL_STATUS_CODE": "A_APPR"},
          {"REPORT_ID": "1", "APPROVAL_STATUS_CODE": "A_PEND"})


def test_concur_exceptions_matter_only_after_approval():
    _cond("CNE031", "concur_expense", "CONCUR_REPORT",
          {"REPORT_ID": "1", "APPROVAL_STATUS_CODE": "A_PEND", "HAS_EXCEPTION": "true"},
          {"REPORT_ID": "1", "APPROVAL_STATUS_CODE": "A_APPR", "HAS_EXCEPTION": "true"})


def test_concur_cost_centre_needed_only_for_active_users():
    _cond("CNU010", "concur_users", "CONCUR_USER", {"LOGIN_ID": "1", "ACTIVE": "false"}, {"LOGIN_ID": "1", "ACTIVE": "true"})


def test_concur_inactive_user_archive_candidate_only_when_inactive():
    _cond("CNU013", "concur_users", "CONCUR_USER", {"LOGIN_ID": "1", "ACTIVE": "true"}, {"LOGIN_ID": "1", "ACTIVE": "false"})
