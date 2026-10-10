"""S/4HANA Cloud, Concur and Ariba rules: dirty synthetic data fires the rules,
clean data passes, and the live extractors deliver the frames the rules read."""
import glob

import pandas as pd
import pytest
import yaml

from api.services.connectivity_manager import ConnectivityManager
from checks.frames import TableFrames
from checks.runner import run_checks
from sap.ddic import get_dictionary, dictionary_for_system
from sap.extraction_plan import MODULES_BY_SYSTEM

D = get_dictionary("s4hana")
MODULES = {"s4hc_master_data": 41, "concur_expense": 40, "concur_users": 41,
           "ariba_supplier": 40, "ariba_contracts": 42, "ariba_procurement": 40}
ENRICHMENT = ("fix_map", "rule_authority", "why_it_matters", "sap_impact", "record_fix_template")


def _rules(module):
    (path,) = glob.glob(f"checks/rules/*/{module}.yaml")
    return yaml.safe_load(open(path))["rules"]


@pytest.mark.parametrize("module,count", MODULES.items())
def test_rule_count_and_enrichment(module, count):
    rules = _rules(module)
    assert len(rules) == count
    for r in rules:
        assert all(r.get(k) for k in ENRICHMENT), (r["id"], [k for k in ENRICHMENT if not r.get(k)])


def test_modules_registered_per_system():
    assert "s4hc_master_data" in MODULES_BY_SYSTEM["s4hana_cloud"]
    assert MODULES_BY_SYSTEM["concur"] == ["concur_expense", "concur_users"]
    assert MODULES_BY_SYSTEM["ariba"] == ["ariba_supplier", "ariba_contracts", "ariba_procurement"]


def _frames(tables):
    return TableFrames({t: pd.DataFrame([{f"{t}.{k}": v for k, v in row.items()} for row in rows])
                        for t, rows in tables.items()}, D)


def _failed(module, tables):
    results = run_checks(module, _frames(tables), "t")
    assert not [r for r in results if r.error and "not applicable" not in r.error.lower()
                and not r.error.lower().startswith("skipped")], [(r.check_id, r.error) for r in results if r.error]
    return {r.check_id for r in results if not r.passed and not r.error}


# ── S/4HANA BP / CVI / product ────────────────────────────────────────────

S4_CLEAN = {
    "BUT000": [{"PARTNER": "BP1", "PARTNER_GUID": "G1", "BU_GROUP": "0001"},
               {"PARTNER": "BP2", "PARTNER_GUID": "G2", "BU_GROUP": "0001"}],
    "BUT100": [{"PARTNER": "BP1", "RLTYP": "FLVN01"}, {"PARTNER": "BP1", "RLTYP": "FLVN00"},
               {"PARTNER": "BP2", "RLTYP": "FLCU01"}, {"PARTNER": "BP2", "RLTYP": "FLCU00"}],
    "CVI_VEND_LINK": [{"PARTNER_GUID": "G1", "VENDOR": "V1"}],
    "CVI_CUST_LINK": [{"PARTNER_GUID": "G2", "CUSTOMER": "K1"}],
    "LFA1": [{"LIFNR": "V1"}],
    "KNA1": [{"KUNNR": "K1"}],
    "MARA": [{"MATNR": "M1", "MTART": "FERT"}],
    "MARC": [{"MATNR": "M1", "WERKS": "1000"}],
    "MBEW": [{"MATNR": "M1", "BWKEY": "1000", "VPRSV": "S"}],
}
S4_DIRTY = {
    "BUT000": [{"PARTNER": "BP1", "PARTNER_GUID": "G1", "BU_GROUP": ""},
               {"PARTNER": "BP2", "PARTNER_GUID": "G2", "BU_GROUP": "0001"},
               {"PARTNER": "BP3", "PARTNER_GUID": "G3", "BU_GROUP": "0001"}],
    "BUT100": [{"PARTNER": "BP2", "RLTYP": "FLVN01"}, {"PARTNER": "BP3", "RLTYP": "FLCU01"}],
    "CVI_VEND_LINK": [{"PARTNER_GUID": "G9", "VENDOR": "V9"}],
    "CVI_CUST_LINK": [{"PARTNER_GUID": "G8", "CUSTOMER": "K9"}],
    "LFA1": [{"LIFNR": "V1"}],
    "KNA1": [{"KUNNR": "K1"}],
    "MARA": [{"MATNR": "M1", "MTART": "FERT"}, {"MATNR": "M2", "MTART": "HALB"}],
    "MARC": [{"MATNR": "M1", "WERKS": "1000"}, {"MATNR": "M2", "WERKS": "1000"}],
    "MBEW": [{"MATNR": "M2", "BWKEY": "1000", "VPRSV": "V"}],
}


def test_s4hc_clean_passes():
    assert _failed("s4hc_master_data", S4_CLEAN) == set()


def test_s4hc_dirty_fires():
    assert _failed("s4hc_master_data", S4_DIRTY) >= {f"S4C{i:03d}" for i in range(1, 11)}


# ── Concur ────────────────────────────────────────────────────────────────

def _user(login, emp, active="true", cc="1000", email=None, last="Doe"):
    return {"LOGIN_ID": login, "EMPLOYEE_ID": emp, "ACTIVE": active, "COST_CENTER": cc,
            "EMAIL": email or f"{login.lower()}@example.com", "FIRST_NAME": "Jo", "LAST_NAME": last}


def _report(rid, owner, status, approver, total="100", cur="USD", policy="P1"):
    return {"REPORT_ID": rid, "OWNER_LOGIN_ID": owner, "APPROVAL_STATUS_CODE": status,
            "APPROVER_LOGIN_ID": approver, "TOTAL": total, "CURRENCY_CODE": cur, "POLICY_ID": policy}


def _entry(eid, rid, etype="MEALS", amount="50", cur="USD", rate="1", posted=None, image="true",
           receipt="true", required="true", personal="false", billable="false", date="2026-01-01"):
    return {"ENTRY_ID": eid, "REPORT_ID": rid, "EXPENSE_TYPE_CODE": etype, "TRANSACTION_DATE": date,
            "TRANSACTION_AMOUNT": amount, "TRANSACTION_CURRENCY_CODE": cur, "EXCHANGE_RATE": rate,
            "POSTED_AMOUNT": posted or amount, "HAS_IMAGE": image, "RECEIPT_RECEIVED": receipt,
            "IS_IMAGE_REQUIRED": required, "IS_PERSONAL": personal, "IS_BILLABLE": billable}


CONCUR_CLEAN = {
    "CONCUR_USER": [_user("U1", "E1"), _user("U2", "E2")],
    "CONCUR_REPORT": [_report("R1", "U1", "A_PEND", "U2"), _report("R2", "U2", "A_APPR", "U1")],
    "CONCUR_ENTRY": [_entry("N1", "R1"),
                     _entry("N2", "R2", etype="TAXI", amount="120", cur="EUR", rate="1.1", posted="132")],
}
CONCUR_DIRTY = {
    "CONCUR_USER": [_user("U1", "E1", cc="", email="not-an-email"),
                    _user("U2", "E1", active="false", last="")],
    "CONCUR_REPORT": [_report("R1", "U1", "A_PEND", "", total="0", cur="usd", policy=""),
                      _report("R2", "U2", "A_RESU", "U2"),
                      _report("R3", "UX", "A_APPR", "U1")],
    "CONCUR_ENTRY": [_entry("N1", "R1", amount="100", image="false", receipt="false",
                            personal="true", billable="true"),
                     _entry("N2", "R1", amount="100", image="true"),
                     _entry("N3", "R9", etype="UNDEF"),
                     _entry("N4", "R2", etype="", amount="0", cur="EUR", rate="1")],
}


def test_concur_clean_passes():
    assert _failed("concur_expense", CONCUR_CLEAN) == set()
    assert _failed("concur_users", CONCUR_CLEAN) == set()


def test_concur_dirty_fires():
    expense = _failed("concur_expense", CONCUR_DIRTY)
    assert {"CNE003", "CNE004", "CNE005", "CNE006", "CNE007", "CNE008", "CNE009", "CNE010", "CNE011",
            "CNE012", "CNE013", "CNE014", "CNE015", "CNE016", "CNE017", "CNE019", "CNE020"} <= expense
    assert {"CNU004", "CNU006", "CNU007", "CNU008"} <= _failed("concur_users", CONCUR_DIRTY)


# ── Ariba ─────────────────────────────────────────────────────────────────

def _po(oid, sup, cur="USD", total="100", date="2026-02-01", cc="1000"):
    return {"ORDER_ID": oid, "SUPPLIER": sup, "CURRENCY_CODE": cur, "TOTAL_AMOUNT": total,
            "ORDER_DATE": date, "COMPANY_CODE": cc}


def _inv(iid, po, sup, cur="USD", total="100", date="2026-02-10", num=None, terms="N30"):
    return {"INVOICE_ID": iid, "PURCHASE_ORDER_ID": po, "SUPPLIER": sup, "CURRENCY_CODE": cur,
            "TOTAL_AMOUNT": total, "INVOICE_DATE": date, "INVOICE_NUMBER": num if num is not None else iid,
            "PAYMENT_TERMS": terms}


ARIBA_CLEAN = {
    "ARIBA_SUPPLIER": [{"VENDOR_ID": "S1", "NAME": "Acme Ltd", "COUNTRY": "US", "CITY": "Austin"},
                       {"VENDOR_ID": "S2", "NAME": "Globex", "COUNTRY": "US", "CITY": "Dallas"}],
    "ARIBA_CONTRACT": [{"CONTRACT_ID": "C1", "SUPPLIER": "S1", "EFFECTIVE_DATE": "2026-01-01",
                        "EXPIRATION_DATE": "2026-12-31", "CONTRACT_AMOUNT": "5000", "CURRENCY_CODE": "USD",
                        "OWNER": "buyer1"}],
    "ARIBA_PO": [_po("P1", "S1"), _po("P2", "S2")],
    "ARIBA_INVOICE": [_inv("I1", "P1", "S1", total="80"), _inv("I2", "P2", "S2")],
}
ARIBA_DIRTY = {
    "ARIBA_SUPPLIER": [{"VENDOR_ID": "S1", "NAME": "Acme Ltd", "COUNTRY": "US", "CITY": "Austin"},
                       {"VENDOR_ID": "S2", "NAME": "ACME LTD.", "COUNTRY": "US", "CITY": "Austin"},
                       {"VENDOR_ID": "S3", "NAME": "", "COUNTRY": "USA", "CITY": ""}],
    "ARIBA_CONTRACT": [{"CONTRACT_ID": "C1", "SUPPLIER": "S1", "EFFECTIVE_DATE": "2026-05-01",
                        "EXPIRATION_DATE": "2026-01-01", "CONTRACT_AMOUNT": "0", "CURRENCY_CODE": "usd",
                        "OWNER": "buyer1"},
                       {"CONTRACT_ID": "C2", "SUPPLIER": "S9", "EFFECTIVE_DATE": "2026-01-01",
                        "EXPIRATION_DATE": "", "CONTRACT_AMOUNT": "10", "CURRENCY_CODE": "USD", "OWNER": ""}],
    "ARIBA_PO": [_po("P1", "S1"), _po("P2", "S9", cur="us", cc=""), _po("P3", "")],
    "ARIBA_INVOICE": [_inv("I1", "P1", "S2", total="150", date="2026-01-15", num="INV-1", terms=""),
                      _inv("I2", "P1", "S2", total="10", num="INV1"),
                      _inv("I3", "P9", "S9", cur="eur", num=""),
                      _inv("I4", "P1", "S1", cur="EUR")],
}


def test_ariba_clean_passes():
    for m in ("ariba_supplier", "ariba_contracts", "ariba_procurement"):
        assert _failed(m, ARIBA_CLEAN) == set(), m


def test_ariba_dirty_fires():
    assert {"ARS003", "ARS004", "ARS006", "ARS007"} <= _failed("ariba_supplier", ARIBA_DIRTY)
    assert {"ARC003", "ARC004", "ARC006", "ARC007", "ARC008", "ARC009"} <= _failed("ariba_contracts", ARIBA_DIRTY)
    assert {f"ARP{i:03d}" for i in range(3, 17)} <= _failed("ariba_procurement", ARIBA_DIRTY)


# ── Live extractors (fake connectors, no network) ─────────────────────────

class _Fake:
    def __init__(self, data):
        self.data, self.calls = data, []

    def read_entity_set(self, entity, select=None, **kw):
        self.calls.append((entity, select))
        self.kwargs = getattr(self, "kwargs", []) + [(entity, kw)]
        return pd.DataFrame(self.data.get(entity, []))


def test_s4hc_extractor_maps_odata_to_ecc_tables():
    conn = _Fake({
        "A_BusinessPartner": [
            {"BusinessPartner": "BP1", "BusinessPartnerUUID": "G1", "BusinessPartnerGrouping": "0001",
             "Supplier": "V1", "Customer": "", "IsNaturalPerson": False, "CreationDate": "2026-03-04"},
            {"BusinessPartner": "BP2", "BusinessPartnerUUID": "G2", "BusinessPartnerGrouping": "0001",
             "Supplier": "", "Customer": "K1", "IsNaturalPerson": True, "CreationDate": None}],
        "A_BusinessPartnerRole": [{"BusinessPartner": "BP1", "BusinessPartnerRole": "FLVN01"}],
    })
    frames, coverage = ConnectivityManager._extract_s4hc(
        object.__new__(ConnectivityManager), conn, ["s4hc_master_data"], dictionary_for_system("s4hana_cloud"))
    assert frames["CVI_VEND_LINK"].to_dict("records") == [
        {"CVI_VEND_LINK.PARTNER_GUID": "G1", "CVI_VEND_LINK.VENDOR": "V1"}]
    assert frames["CVI_CUST_LINK"]["CVI_CUST_LINK.CUSTOMER"].tolist() == ["K1"]
    but000 = frames["BUT000"]
    if "BUT000.NATPERS" in but000:
        assert but000["BUT000.NATPERS"].tolist() == ["", "X"]
    if "BUT000.CRDAT" in but000:
        assert but000["BUT000.CRDAT"].tolist() == ["20260304", ""]
    # A_BusinessPartner is read once for BUT000 and both CVI link tables
    assert [e for e, _ in conn.calls].count("A_BusinessPartner") == 1
    status = {c["table"]: c["status"] for c in coverage}
    assert status["BUT100"] == "live" and status["BUT000"] == "live"


def test_sf_job_history_reads_all_effective_dated_records(monkeypatch):
    import api.services.source_design as sd
    monkeypatch.setattr(sd, "latest_snapshot_id", lambda *_: None)
    conn = _Fake({"EmpJob": [{"userId": "U1", "startDate": "2020-01-01", "seqNumber": 1},
                             {"userId": "U1", "startDate": "2024-01-01", "seqNumber": 1}]})
    cm = object.__new__(ConnectivityManager)
    cm.session = None
    frames, _ = ConnectivityManager._extract_successfactors(
        cm, conn, ["employee_central"], dictionary_for_system("successfactors"), None)
    assert len(frames["EMPJOBHIST"]) == 2
    assert ("EmpJob", {"from_date": "1900-01-01"}) in conn.kwargs  # EMPJOBHIST: full history
    assert ("EmpJob", {}) in conn.kwargs  # EMPEMPLOYMENT: current record
    assert ("PerEmergencyContacts", {}) in conn.kwargs  # non-history entities read as of today


def test_sf_boolean_fields_lowercased_like_rest_extractor(monkeypatch):
    """NEW-5: SF OData V2 JSON booleans arrive as Python bool. _extract_rest lowercases BOOLEAN
    fields to 'true'/'false' for target_when/applies_when string matches (EC446/EC449); this must
    hold for SuccessFactors too, or every such rule false-positives on 100% of live tenants."""
    import api.services.source_design as sd
    monkeypatch.setattr(sd, "latest_snapshot_id", lambda *_: None)
    conn = _Fake({
        "EmpJob": [{"userId": "U1", "startDate": "2024-01-01", "seqNumber": 1}],
        "EmpEmployment": [{"userId": "U1", "personIdExternal": "P1", "isPrimary": True}],
        "PerPhone": [{"personIdExternal": "P1", "isPrimary": False}],
    })
    cm = object.__new__(ConnectivityManager)
    cm.session = None
    frames, _ = ConnectivityManager._extract_successfactors(
        cm, conn, ["employee_central"], dictionary_for_system("successfactors"), None)
    assert frames["EMPEMPLOYMENT"]["EMPEMPLOYMENT.IS_PRIMARY"].tolist() == ["true"]
    assert frames["PERPHONE"]["PERPHONE.IS_PRIMARY"].tolist() == ["false"]


class _Resp:
    def __init__(self, status, body):
        self.status_code, self._body = status, body

    def json(self):
        return self._body

    def raise_for_status(self):
        assert self.status_code == 200


class _ConcurHTTP:
    """Fake httpx client: records each GET; refuses user=ALL when ``grant_all`` is False."""
    def __init__(self, grant_all):
        self.grant_all, self.calls = grant_all, []

    def get(self, url, params=None):
        self.calls.append((url, dict(params or {})))
        if (params or {}).get("user") == "ALL" and not self.grant_all:
            return _Resp(403, {})
        return _Resp(200, {"Items": [{"ID": "R1", "OwnerLoginID": "U1"}], "NextPage": None})


@pytest.mark.parametrize("grant_all", [True, False])
def test_concur_requests_all_users_reports(grant_all):
    from sap.concur import ConcurConnector
    conn = ConcurConnector()
    conn._client, conn._token_expiry = _ConcurHTTP(grant_all), float("inf")
    d = dictionary_for_system("concur")
    frames, coverage = ConnectivityManager._extract_rest(
        object.__new__(ConnectivityManager), conn, ["concur_expense", "concur_users"], d, "concur")
    calls = conn._client.calls
    for path in ("/api/v3.0/expense/reports", "/api/v3.0/expense/entries"):
        assert (path, {"limit": 100, "user": "ALL"}) in calls
    assert all("user" not in p for u, p in calls if u == "/api/v3.0/common/users")
    report = next(c for c in coverage if c["table"] == "CONCUR_REPORT")
    assert report["status"] == "live" and report["rows"] == 1
    if grant_all:
        assert "partial" not in report
    else:  # refused: fell back to own reports, flagged as partial coverage
        assert report["partial"] is True and report["complete"] is False and "user=ALL" in report["detail"]
        assert ("/api/v3.0/expense/reports", {"limit": 100}) in calls


@pytest.mark.parametrize("system,module,table,payload,expect", [
    ("concur", "concur_users", "CONCUR_USER",
     {"LoginID": "U1", "Active": True, "EmployeeID": "E1"},
     {"CONCUR_USER.LOGIN_ID": "U1", "CONCUR_USER.ACTIVE": "true", "CONCUR_USER.EMPLOYEE_ID": "E1"}),
    ("ariba", "ariba_supplier", "ARIBA_SUPPLIER",
     {"VendorId": "S1", "Name": "Acme", "Country": "US"},
     {"ARIBA_SUPPLIER.VENDOR_ID": "S1", "ARIBA_SUPPLIER.NAME": "Acme", "ARIBA_SUPPLIER.COUNTRY": "US"}),
])
def test_rest_extractor_renames_to_canonical(system, module, table, payload, expect):
    d = dictionary_for_system(system)
    path = d.table(table).note
    conn = _Fake({path: [payload]})
    frames, coverage = ConnectivityManager._extract_rest(object.__new__(ConnectivityManager), conn, [module], d, system)
    row = frames[table].iloc[0].to_dict()
    assert {k: row[k] for k in expect} == expect
    assert {"table": table, "status": "live"}.items() <= next(c for c in coverage if c["table"] == table).items()
