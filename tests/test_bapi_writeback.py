"""Field-level BAPI write-back (sap/bapi_writeback.py) against a fake connector that records every call.

No live SAP: the fake answers RFC_GET_FUNCTION_INTERFACE and DDIF_FIELDINFO_GET from the structures the mapping
claims, and answers each BAPI with a configurable RETURN.
"""
from __future__ import annotations

import logging

import pytest

from api.routes.writeback import apply_records, field_support
from api.services import golden_writeback as gw
from sap import bapi_writeback as bw
from sap.base import SAPConnectorError


def _interface_of(bapi: str, testrun: bool, drop: tuple[str, ...] = (), mandatory: tuple[str, ...] = ()) -> dict:
    """PARAMS and structure fields for ``bapi`` as the mapping uses them (drop = fields this release lacks)."""
    params: dict[str, set[str]] = {}
    for spec in bw.OBJECTS.values():
        for t in spec.fields.values():
            if t.bapi != bapi:
                continue
            for p in (t.param, t.xparam):
                if p:
                    params.setdefault(p, set()).update({t.field, *[sf for _, sf in t.keys]})
        for b, (_, kp) in spec.bapi_key.items():
            if b == bapi:
                if "." in kp:
                    s, f = kp.split(".", 1)
                    params.setdefault(s, set()).add(f)
                else:
                    params.setdefault(kp, set())
        if any(t.bapi == bapi for t in spec.fields.values()):
            for p in spec.context.values():
                params.setdefault(p, set())
    if bapi == "BAPI_MATERIAL_SAVEDATA":
        params["HEADDATA"].update({"BASIC_VIEW", "MRP_VIEW", "ACCOUNT_VIEW", "SALES_VIEW"})
    if testrun:
        params["TESTRUN"] = set()
    rows = [{"PARAMCLASS": "I", "PARAMETER": p, "TABNAME": f"T_{p}" if f else "", "OPTIONAL": "" if p in mandatory else "X"}
            for p, f in params.items()]
    fields = {f"T_{p}": {x for x in f if x not in drop} for p, f in params.items()}
    return {"rows": rows, "fields": fields}


class FakeRFC:
    def __init__(self, testrun: bool = False, sim_return=None, real_return=None, drop=(), mandatory=()):
        self.calls: list[tuple[str, dict]] = []
        self.testrun, self.drop, self.mandatory = testrun, drop, mandatory
        self.sim_return = sim_return or {"TYPE": "S", "ID": "M3", "NUMBER": "801", "MESSAGE": "ok"}
        self.real_return = real_return or {"TYPE": "S", "ID": "M3", "NUMBER": "801", "MESSAGE": "saved"}
        self._ifaces: dict[str, dict] = {}
        self._seen_sim: set[str] = set()

    def execute_bapi(self, call):
        self.calls.append((call.bapi_name, call.params))
        name = call.bapi_name
        if name == "RFC_GET_FUNCTION_INTERFACE":
            fm = call.params["FUNCNAME"]
            self._ifaces[fm] = _interface_of(fm, self.testrun, self.drop, self.mandatory)
            return {"PARAMS": self._ifaces[fm]["rows"]}
        if name == "DDIF_FIELDINFO_GET":
            for i in self._ifaces.values():
                if call.params["TABNAME"] in i["fields"]:
                    return {"DFIES_TAB": [{"FIELDNAME": f} for f in sorted(i["fields"][call.params["TABNAME"]])]}
            return {"DFIES_TAB": []}
        if name in (bw.COMMIT, bw.ROLLBACK):
            return {"RETURN": {"TYPE": "", "MESSAGE": ""}}
        # a BAPI: the first call per BAPI is the simulation unless TESTRUN marks it
        is_sim = call.params.get("TESTRUN") == "X" or (not self.testrun and name not in self._seen_sim)
        self._seen_sim.add(name)
        return {"RETURN": self.sim_return if is_sim else self.real_return}

    def names(self) -> list[str]:
        return [n for n, _ in self.calls if n not in ("RFC_GET_FUNCTION_INTERFACE", "DDIF_FIELDINFO_GET")]


MAT_KEY = "MATNR=000000000000000042|WERKS=1000"


# ── planning ────────────────────────────────────────────────────────────────


def test_plan_reports_every_field_and_why_not():
    assert bw.plan_field("material_master", "MARC.PLIFZ", MAT_KEY).supported
    assert bw.plan_field("material_master", "MARA.MATKL", "MATNR=1").bapi == "BAPI_MATERIAL_SAVEDATA"
    no_plant = bw.plan_field("material_master", "MARC.PLIFZ", "MATNR=1")
    assert not no_plant.supported and "WERKS" in no_plant.reason
    unmapped = bw.plan_field("material_master", "MARC.NFMAT", MAT_KEY)
    assert not unmapped.supported and unmapped.reason.startswith("No BAPI mapping for MARC.NFMAT")
    vendor = bw.plan_field("accounts_payable", "LFA1.NAME1", "LIFNR=1")
    assert not vendor.supported and "VMD_EI_API" in vendor.reason and "export" in vendor.reason
    assert not bw.plan_field("quality_management", "QALS.ART", "PRUEFLOS=1").supported


def test_route_field_support_is_per_field_with_delivery():
    rows = [field_support("material_master", {"field": f, "record_key": MAT_KEY, "proposed_value": "x"})
            for f in ("MARC.PLIFZ", "MARC.NFMAT")]
    assert [(r["field"], r["supported"], r["delivery"]) for r in rows] == [
        ("MARC.PLIFZ", True, "bapi"), ("MARC.NFMAT", False, "export")]
    assert rows[1]["reason"]


def test_the_shipped_material_fix_fields_are_mapped():
    """The fields the shipped material rules fix most (checks/rules/ecc/material_master*.yaml auto_fix)."""
    for f in ("MBEW.VPRSV", "MARM.EAN11", "MAKT.MAKTX", "MARA.GEWEI", "MBEW.PEINH", "MARA.KZKFG", "MVKE.MTPOS",
              "MVKE.PRODH", "MARM.GEWEI", "MARM.VOLEH", "MARM.MEABM", "MARM.NUMTP", "MARC.XCHPF", "MARC.SAUFT"):
        assert f in bw.MATERIAL.fields, f


def test_material_call_carries_the_x_structures_and_view():
    calls = bw.build_calls("material_master", MAT_KEY, {"MARC.PLIFZ": 12, "MARA.MATKL": "001"})
    p = calls["BAPI_MATERIAL_SAVEDATA"]
    assert p["HEADDATA"] == {"MATERIAL": "000000000000000042", "MRP_VIEW": "X", "BASIC_VIEW": "X"}
    assert p["PLANTDATA"] == {"PLANT": "1000", "PLND_DELRY": "12"} and p["PLANTDATAX"] == {"PLANT": "1000", "PLND_DELRY": "X"}
    assert p["CLIENTDATA"] == {"MATL_GROUP": "001"} and p["CLIENTDATAX"] == {"MATL_GROUP": "X"}


def test_material_units_and_descriptions_are_table_rows():
    p = bw.build_calls("material_master", "MATNR=7|MEINH=KAR|SPRAS=E",
                       {"MARM.EAN11": "4006381333931", "MARM.NUMTP": "HE", "MAKT.MAKTX": "Bolt"})["BAPI_MATERIAL_SAVEDATA"]
    assert p["UNITSOFMEASURE"] == [{"ALT_UNIT": "KAR", "EAN_UPC": "4006381333931", "EAN_CAT": "HE"}]
    assert p["UNITSOFMEASUREX"] == [{"ALT_UNIT": "KAR", "EAN_UPC": "X", "EAN_CAT": "X"}]
    assert p["MATERIALDESCRIPTION"] == [{"LANGU": "E", "MATL_DESC": "Bolt"}] and "MATERIALDESCRIPTIONX" not in p


# ── simulate, then commit only on a clean RETURN ─────────────────────────────


def test_testrun_first_then_real_call_then_commit():
    conn = FakeRFC(testrun=True)
    r = bw.write_record(conn, "material_master", MAT_KEY, {"MARC.PLIFZ": 12}, apply=True)
    assert conn.names() == ["BAPI_MATERIAL_SAVEDATA", "BAPI_MATERIAL_SAVEDATA", bw.COMMIT]
    sim, real, commit = [p for n, p in conn.calls if n in ("BAPI_MATERIAL_SAVEDATA", bw.COMMIT)]
    assert sim["TESTRUN"] == "X" and "TESTRUN" not in real and commit == {"WAIT": "X"}
    assert r.simulated and r.applied and r.committed and r.error is None
    assert r.simulate_messages[0]["message"] == "ok" and r.messages[0]["message"] == "saved"


def test_without_testrun_the_simulation_is_rolled_back():
    conn = FakeRFC(testrun=False)
    r = bw.write_record(conn, "material_master", MAT_KEY, {"MARC.PLIFZ": 12}, apply=True)
    assert conn.names() == ["BAPI_MATERIAL_SAVEDATA", bw.ROLLBACK, "BAPI_MATERIAL_SAVEDATA", bw.COMMIT]
    assert r.committed


def test_simulate_only_never_commits():
    conn = FakeRFC(testrun=True)
    r = bw.write_record(conn, "material_master", MAT_KEY, {"MARC.PLIFZ": 12}, apply=False)
    assert conn.names() == ["BAPI_MATERIAL_SAVEDATA"] and r.simulated and not r.applied


def test_an_error_in_the_simulation_stops_before_the_real_call():
    conn = FakeRFC(testrun=True, sim_return={"TYPE": "E", "ID": "M3", "NUMBER": "305", "MESSAGE": "Plant not maintained"})
    r = bw.write_record(conn, "material_master", MAT_KEY, {"MARC.PLIFZ": 12}, apply=True)
    assert conn.names() == ["BAPI_MATERIAL_SAVEDATA"]
    assert not r.applied and not r.committed and r.simulate_messages[0]["type"] == "E"


def test_an_abort_in_the_real_call_is_rolled_back_not_committed():
    conn = FakeRFC(testrun=True, real_return=[{"TYPE": "A", "ID": "MG", "NUMBER": "1", "MESSAGE": "locked"}])
    r = bw.write_record(conn, "material_master", MAT_KEY, {"MARC.PLIFZ": 12}, apply=True)
    assert conn.names() == ["BAPI_MATERIAL_SAVEDATA", "BAPI_MATERIAL_SAVEDATA", bw.ROLLBACK]
    assert r.applied and not r.committed and r.messages == [{"type": "A", "id": "MG", "number": "1", "message": "locked"}]


def test_a_field_this_release_lacks_is_never_sent():
    conn = FakeRFC(testrun=True, drop=("PLND_DELRY",))
    r = bw.write_record(conn, "material_master", MAT_KEY, {"MARC.PLIFZ": 12}, apply=True)
    assert conn.names() == [] and "has no field PLND_DELRY" in r.error


def test_the_log_carries_keys_and_types_never_values(caplog):
    caplog.set_level(logging.INFO, logger="meridian.sap.writeback")
    bw.write_record(FakeRFC(testrun=True), "material_master", MAT_KEY, {"MARA.MATKL": "SECRET-GROUP-9"}, apply=True)
    assert caplog.records and "SECRET-GROUP-9" not in caplog.text and MAT_KEY in caplog.text


def test_a_connector_error_is_recorded():
    class Down(FakeRFC):
        def execute_bapi(self, call):
            raise SAPConnectorError("RFC_COMMUNICATION_FAILURE")

    r = bw.write_record(Down(), "material_master", MAT_KEY, {"MARA.MATKL": "1"}, apply=True)
    assert r.error == "RFC_COMMUNICATION_FAILURE" and not r.committed


# ── business partner and customer ────────────────────────────────────────────


def test_business_partner_central_and_address_changes():
    p = bw.build_calls("business_partner", "PARTNER=1000", {"BUT000.NAME_ORG1": "Acme Ltd", "BUT000.BU_SORT1": "ACME",
                                                            "BUT000.BIRTHDT": "1980-02-03"})["BAPI_BUPA_CENTRAL_CHANGE"]
    assert p["BUSINESSPARTNER"] == "1000"
    assert p["CENTRALDATAORGANIZATION"] == {"NAME1": "Acme Ltd"} and p["CENTRALDATAORGANIZATION_X"] == {"NAME1": "X"}
    assert p["CENTRALDATA"] == {"SEARCHTERM1": "ACME"} and p["CENTRALDATAPERSON"] == {"BIRTHDATE": "19800203"}
    a = bw.build_calls("business_partner", "PARTNER=1000|ADDRNUMBER=9", {"ADRC.REGION": "GP"})["BAPI_BUPA_ADDRESS_CHANGE"]
    assert a == {"BUSINESSPARTNER": "1000", "ADDRNUMBER": "9", "ADDRESSDATA": {"REGION": "GP"},
                 "ADDRESSDATA_X": {"REGION": "X"}}
    assert not bw.plan_field("business_partner", "ADRC.REGION", "PARTNER=1000").supported  # no address named
    assert not bw.plan_field("business_partner", "BUT000.BU_GROUP", "PARTNER=1000").supported

    conn = FakeRFC(testrun=False)
    assert bw.write_record(conn, "business_partner", "PARTNER=1000", {"BUT000.NAME_ORG1": "Acme Ltd"}, apply=True).committed
    assert conn.names() == ["BAPI_BUPA_CENTRAL_CHANGE", bw.ROLLBACK, "BAPI_BUPA_CENTRAL_CHANGE", bw.COMMIT]


def test_customer_is_never_called_to_simulate_and_sales_data_needs_the_area():
    key = "KUNNR=0000001234|VKORG=1000|VTWEG=10|SPART=00"
    conn = FakeRFC()
    sim = bw.write_record(conn, "sd_customer_master", key, {"KNVV.VSBED": "01"}, apply=False)
    assert sim.simulated and conn.names() == []  # interface check only: the BAPI may commit by itself
    r = bw.write_record(conn, "sd_customer_master", key, {"KNVV.VSBED": "01", "KNA1.NAME1": "Acme"}, apply=True)
    assert conn.names() == ["BAPI_CUSTOMER_CHANGEFROMDATA1", bw.COMMIT] and r.committed
    p = [p for n, p in conn.calls if n == "BAPI_CUSTOMER_CHANGEFROMDATA1"][0]
    assert p["CUSTOMERNO"] == "0000001234" and (p["PI_SALESORG"], p["PI_DISTR_CHAN"], p["PI_DIVISION"]) == ("1000", "10", "00")
    assert p["PI_OPT_COMPANYDATA"] == {"SHIP_COND": "01"} and p["PI_OPT_COMPANYDATAX"] == {"SHIP_COND": "X"}
    assert p["PI_COMPANYDATA"] == {"NAME": "Acme"} and p["PI_COMPANYDATAX"] == {"NAME": "X"}
    assert not bw.plan_field("sd_customer_master", "KNVV.VSBED", "KUNNR=1").supported


def test_a_mandatory_parameter_the_record_cannot_fill_stops_the_call():
    conn = FakeRFC(mandatory=("PI_SALESORG",))
    r = bw.write_record(conn, "sd_customer_master", "KUNNR=1", {"KNA1.NAME1": "Acme"}, apply=True)
    assert "needs PI_SALESORG" in r.error and conn.names() == []


def test_apply_records_reads_each_interface_once():
    conn = FakeRFC(testrun=True)
    out = apply_records(conn, "material_master", {MAT_KEY: {"MARC.PLIFZ": 3},
                                                 "MATNR=000000000000000043|WERKS=1000": {"MARC.PLIFZ": 4}})
    assert [r["committed"] for r in out] == [True, True]
    assert sum(1 for n, _ in conn.calls if n == "RFC_GET_FUNCTION_INTERFACE") == 1


# ── golden-record write-back through the same path ──────────────────────────


def test_golden_rfc_simulate_diffs_and_apply_goes_through_write_record():
    import pandas as pd

    class GoldenRFC(FakeRFC):
        def read_table(self, table, fields, where=None, max_rows=0):
            assert table == "BUT000" and where == "PARTNER = '1000'"
            return pd.DataFrame([{"PARTNER": "1000", "NAME_ORG1": "Old", "BU_SORT1": "ACME"}])

        def close(self):
            pass

    golden = {"BUT000.PARTNER": "1000", "BUT000.NAME_ORG1": "New", "BUT000.BU_SORT1": "ACME", "BUT000.BU_GROUP": "X"}
    t = {"system_id": "e1", "system_name": "ECC", "system_type": "ecc",
         **gw.plan_target("ecc", "business_partner", "1000", golden)}
    assert t["supported"] and t["method"] == "rfc_bapi"
    conn = GoldenRFC(testrun=False)
    sim = gw.execute_targets([t], "business_partner", "1000", False, lambda sid: conn)
    by = {x["field"]: x for x in sim[0]["fields"]}
    assert by["BUT000.NAME_ORG1"]["result"] == "would_change" and by["BUT000.BU_SORT1"]["result"] == "unchanged"
    assert by["BUT000.BU_GROUP"]["result"] == "unsupported" and conn.names() == []
    done = gw.execute_targets(sim, "business_partner", "1000", True, lambda sid: conn)
    assert {x["field"]: x["result"] for x in done[0]["fields"]}["BUT000.NAME_ORG1"] == "written"
    assert conn.names() == ["BAPI_BUPA_CENTRAL_CHANGE", bw.ROLLBACK, "BAPI_BUPA_CENTRAL_CHANGE", bw.COMMIT]


@pytest.mark.parametrize("domain", ["accounts_payable"])
def test_golden_vendor_is_unsupported_with_the_reason(domain):
    plan = gw.plan_target("ecc", domain, "1", {"LFA1.NAME1": "x"})
    assert not plan["supported"] and "VMD_EI_API" in plan["reason"]
