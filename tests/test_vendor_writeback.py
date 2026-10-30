"""Vendor write-back (sap/bapi_writeback.py): through the vendor's business partner where the connected system has
CVI, otherwise export only with the reason. A fake RFC connector answers RFC_FUNCTION_SEARCH, the interface reads and
the table reads (CVI_VEND_LINK, BUT000, LFA1, BUT020, BUT0BK); no live SAP.
"""
from __future__ import annotations

import logging

import pandas as pd

from api.routes.writeback import field_support, record_errors, record_failed
from api.services.export_engine import BAPI_NAMES, ExportEngine
from sap import bapi_writeback as bw
from sap.base import SAPConnectorError
from tests.sap.fake_rfc import _filter
from tests.test_bapi_writeback import FakeRFC

BPC, BPA, BPB = "BAPI_BUPA_CENTRAL_CHANGE", "BAPI_BUPA_ADDRESS_CHANGE", "BAPI_BUPA_BANKDETAIL_CHANGE"
LIFNR = "0000100001"
KEY = f"LIFNR={LIFNR}"
BANK_KEY = f"LIFNR={LIFNR}|BANKS=DE|BANKL=10020030|BANKN=123456"

CVI_TABLES = {
    "CVI_VEND_LINK": pd.DataFrame([{"PARTNER_GUID": "00505688AB121EDB", "VENDOR": LIFNR}]),
    "BUT000": pd.DataFrame([{"PARTNER": "0000900001", "PARTNER_GUID": "00505688AB121EDB", "TYPE": "2"}]),
    "LFA1": pd.DataFrame([{"LIFNR": LIFNR, "ADRNR": "0000022222"}]),
    "BUT020": pd.DataFrame([{"PARTNER": "0000900001", "ADDRNUMBER": "0000022222"}]),
    "BUT0BK": pd.DataFrame([{"PARTNER": "0000900001", "BKVID": "0001", "BANKS": "DE", "BANKL": "10020030",
                             "BANKN": "123456"}]),
}


class VendorRFC(FakeRFC):
    """FakeRFC plus RFC_FUNCTION_SEARCH (``functions`` present), table reads, and a release without ``no_param``."""

    def __init__(self, functions=(BPC, BPA, BPB), tables=None, no_param=(), **kw):
        super().__init__(**kw)
        self.functions = set(functions)
        self.tables = CVI_TABLES if tables is None else tables
        self.no_param = no_param
        self.searched: list[str] = []
        self.reads: list[tuple[str, str]] = []

    def execute_bapi(self, call):
        if call.bapi_name == "RFC_FUNCTION_SEARCH":
            name = call.params["FUNCNAME"]
            self.searched.append(name)
            if name not in self.functions:
                raise SAPConnectorError("NOTHING_FOUND")
            return {"FUNCTIONS": [{"FUNCNAME": name, "GROUPNAME": "X"}]}
        r = super().execute_bapi(call)
        if call.bapi_name == "RFC_GET_FUNCTION_INTERFACE":
            r = {"PARAMS": [p for p in r["PARAMS"] if p["PARAMETER"] not in self.no_param]}
        return r

    def read_table(self, table, fields, where=None, max_rows=0):
        self.reads.append((table, where or ""))
        df = self.tables.get(table)
        if df is None:
            raise SAPConnectorError("TABLE_NOT_AVAILABLE")
        return _filter(df, where or "")[fields]

    def params(self, bapi: str) -> list[dict]:
        return [p for n, p in self.calls if n == bapi]


# ── planning: no SAP contact ─────────────────────────────────────────────────


def test_plan_says_per_vendor_field_bapi_or_export_with_the_reason():
    name = bw.plan_field("accounts_payable", "LFA1.NAME1", KEY)
    assert name.supported and name.bapi == BPC and "business partner" in name.reason
    assert bw.plan_field("accounts_payable", "LFA1.ORT01", KEY).bapi == BPA
    assert bw.plan_field("accounts_payable", "LFBK.KOINH", BANK_KEY).bapi == BPB
    no_bank_key = bw.plan_field("accounts_payable", "LFBK.KOINH", KEY)
    assert not no_bank_key.supported and "BANKS, BANKL, BANKN" in no_bank_key.reason
    for f in ("LFB1.ZTERM", "LFM1.EKGRP", "LFB1.AKONT"):
        p = bw.plan_field("accounts_payable", f, KEY + "|BUKRS=1000")
        assert not p.supported and p.reason == bw.VENDOR_ORG_REASON
    assert bw.plan_field("accounts_payable", "LFA1.STCD1", KEY).reason.startswith("No BAPI mapping for LFA1.STCD1")
    assert not bw.plan_field("accounts_payable", "LFA1.NAME1", "BUKRS=1000").supported  # no vendor number
    assert not bw.plan_field("mm_purchasing", "LFA1.NAME1", KEY).supported
    row = field_support("accounts_payable", {"field": "LFM1.ZTERM", "record_key": KEY, "proposed_value": "0001"})
    assert row["delivery"] == "export" and "VMD_EI_API" in row["reason"]


# ── CVI active: vendor fields go to the business partner ────────────────────


def test_cvi_vendor_fields_are_mapped_to_business_partner_calls():
    conn = VendorRFC()
    r = bw.write_record(conn, "accounts_payable", BANK_KEY,
                        {"LFA1.NAME1": "Acme GmbH", "LFA1.ORT01": "Berlin", "LFBK.KOINH": "Acme GmbH"}, apply=True)
    assert r.error is None and r.export == [] and r.committed
    assert r.bapi_calls == sorted([BPA, BPB, BPC]) and r.fields == ["LFA1.NAME1", "LFA1.ORT01", "LFBK.KOINH"]
    central = conn.params(BPC)[-1]
    assert central == {"BUSINESSPARTNER": "0000900001", "CENTRALDATAORGANIZATION": {"NAME1": "Acme GmbH"},
                       "CENTRALDATAORGANIZATION_X": {"NAME1": "X"}}  # no address number on the central call
    assert conn.params(BPA)[-1] == {"BUSINESSPARTNER": "0000900001", "ADDRNUMBER": "0000022222",
                                    "ADDRESSDATA": {"CITY": "Berlin"}, "ADDRESSDATA_X": {"CITY": "X"}}
    assert conn.params(BPB)[-1] == {"BUSINESSPARTNER": "0000900001", "BANKDETAILID": "0001",
                                    "BANKDETAILDATA": {"ACCOUNTHOLDER": "Acme GmbH"},
                                    "BANKDETAILDATA_X": {"ACCOUNTHOLDER": "X"}}
    # each BAPI simulated (no TESTRUN on these: called, then rolled back), then the real calls and one commit
    assert conn.names() == [BPC, bw.ROLLBACK, BPA, bw.ROLLBACK, BPB, bw.ROLLBACK, BPC, BPA, BPB, bw.COMMIT]
    assert sorted(conn.searched) == sorted([BPC, BPA, BPB])
    assert [t for t, _ in conn.reads] == ["CVI_VEND_LINK", "BUT000", "LFA1", "BUT020", "BUT0BK"]


def test_the_address_number_in_the_record_key_is_used_and_checked_against_the_partner():
    conn = VendorRFC()
    r = bw.write_record(conn, "accounts_payable", KEY + "|ADRNR=0000022222", {"LFA1.LAND1": "DE"}, apply=False)
    assert r.simulated and not r.applied and "LFA1" not in [t for t, _ in conn.reads]
    other = VendorRFC()
    r = bw.write_record(other, "accounts_payable", KEY + "|ADRNR=0000099999", {"LFA1.LAND1": "DE"}, apply=True)
    assert r.fields == [] and "BUT020" in r.export[0]["reason"] and other.names() == []


def test_a_person_partner_keeps_its_name_fields_for_the_export():
    tables = {**CVI_TABLES, "BUT000": CVI_TABLES["BUT000"].assign(TYPE="1")}
    conn = VendorRFC(tables=tables)
    r = bw.write_record(conn, "accounts_payable", KEY, {"LFA1.NAME1": "A", "LFA1.ORT01": "Berlin"}, apply=True)
    assert r.committed and r.fields == ["LFA1.ORT01"]
    assert r.export[0]["field"] == "LFA1.NAME1" and "not an organisation" in r.export[0]["reason"]


# ── classic ECC: export only, with the reason ────────────────────────────────


def test_classic_release_without_the_functions_is_export_only_with_the_reason():
    conn = VendorRFC(functions=())
    r = bw.write_record(conn, "accounts_payable", KEY, {"LFA1.NAME1": "Acme", "LFB1.ZTERM": "0001"}, apply=True)
    assert conn.names() == [] and conn.reads == [] and not r.committed and r.error is None and r.fields == []
    reasons = {x["field"]: x["reason"] for x in r.export}
    assert reasons["LFA1.NAME1"].startswith(bw.CLASSIC_VENDOR_REASON)
    assert reasons["LFA1.NAME1"].startswith("Vendor master on this release changes through the vendor maintenance "
                                            "transaction; Meridian exports a load file")
    assert reasons["LFB1.ZTERM"] == bw.VENDOR_ORG_REASON
    assert not record_failed(r.as_dict())


def test_classic_ecc_without_cvi_link_is_export_only():
    conn = VendorRFC(tables={**CVI_TABLES, "CVI_VEND_LINK": CVI_TABLES["CVI_VEND_LINK"].iloc[0:0]})
    r = bw.write_record(conn, "accounts_payable", KEY, {"LFA1.NAME1": "Acme"}, apply=True)
    assert conn.names() == [] and r.export[0]["reason"].startswith(bw.CLASSIC_VENDOR_REASON)
    assert "CVI_VEND_LINK" in r.export[0]["reason"]


def test_an_unreadable_link_table_says_so():
    tables = {k: v for k, v in CVI_TABLES.items() if k != "CVI_VEND_LINK"}
    r = bw.write_record(VendorRFC(tables=tables), "accounts_payable", KEY, {"LFA1.NAME1": "Acme"}, apply=True)
    assert "could not read CVI_VEND_LINK" in r.export[0]["reason"]


# ── the release decides what is sent ─────────────────────────────────────────


def test_a_parameter_this_release_lacks_is_never_sent():
    conn = VendorRFC(no_param=("BANKDETAILID",))
    r = bw.write_record(conn, "accounts_payable", BANK_KEY, {"LFBK.KOINH": "Acme"}, apply=True)
    assert conn.names() == [] and "has no parameter BANKDETAILID on this release" in r.error and not r.committed
    conn = VendorRFC(drop=("REGION",))
    r = bw.write_record(conn, "accounts_payable", KEY, {"LFA1.REGIO": "BY"}, apply=True)
    assert conn.names() == [] and "ADDRESSDATA has no field REGION" in r.error


def test_an_error_in_the_simulation_stops_the_commit():
    conn = VendorRFC(sim_return={"TYPE": "E", "ID": "R11", "NUMBER": "005", "MESSAGE": "Partner locked"})
    r = bw.write_record(conn, "accounts_payable", KEY, {"LFA1.NAME1": "Acme"}, apply=True)
    assert conn.names() == [BPC, bw.ROLLBACK] and not r.applied and not r.committed
    assert r.simulate_messages == [{"type": "E", "id": "R11", "number": "005", "message": "Partner locked"}]
    assert record_failed(r.as_dict())


def test_the_vendor_log_carries_keys_and_types_never_values(caplog):
    caplog.set_level(logging.INFO, logger="meridian.sap.writeback")
    bw.write_record(VendorRFC(), "accounts_payable", KEY, {"LFA1.NAME1": "SECRET-NAME-7"}, apply=True)
    assert LIFNR in caplog.text and "SECRET-NAME-7" not in caplog.text


# ── route helpers and the export file ────────────────────────────────────────


def test_record_errors_moves_fields_the_system_sent_to_the_export():
    support = [field_support("accounts_payable", {"field": "LFA1.NAME1", "record_key": KEY, "proposed_value": "A"})]
    assert support[0]["delivery"] == "bapi"
    errs = record_errors([{"record_key": KEY, "fields": [], "committed": False, "error": None,
                           "export": [{"field": "LFA1.NAME1", "reason": bw.CLASSIC_VENDOR_REASON}]}], support)
    assert support[0]["delivery"] == "export" and support[0]["reason"] == bw.CLASSIC_VENDOR_REASON
    assert errs and "could not go by BAPI" in errs[0]


def test_the_export_names_the_bapis_actually_used():
    import json

    for t in ("vendor", "accounts_payable", "business_partner"):
        assert BAPI_NAMES[t] == BPC
    out = json.loads(ExportEngine().export_bapi([{"vendor_id": LIFNR, "name": "Acme"}], "accounts_payable"))
    assert out["bapi_calls"][0]["bapi"] == BPC and "CVI_VEND_LINK" in out["note"] and BPB in out["note"]
    none = json.loads(ExportEngine().export_bapi([{"x": 1}], "financial"))
    assert none["bapi_calls"][0]["bapi"] is None and "LSMW" in none["note"]
