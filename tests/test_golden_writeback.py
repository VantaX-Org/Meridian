"""Golden-record write-back: what each system/object supports, simulate/apply with fake connectors,
and the OData PATCH the S/4HANA Cloud / BTP connector sends. No real SAP."""

from __future__ import annotations

import json

import httpx
import pandas as pd
import pytest

from api.routes import writeback
from api.services import golden_writeback as gw
from sap.base import CloudConnectionParams, SAPConnectorError

BP = {"BUT000.PARTNER": "1000", "BUT000.NAME_ORG1": "Acme Ltd", "BUT000.BU_SORT1": "ACME",
      "BUT000.BU_GROUP": "BP01", "LFA1.NAME1": "Acme"}


def _by_field(plan: dict) -> dict:
    return {x["field"]: x for x in plan["fields"]}


# ── plan_target: support per system type and object ──────────────────────────────────────

@pytest.mark.parametrize("stype", ["s4hana_cloud", "btp"])
def test_odata_business_partner_fields_are_supported(stype: str) -> None:
    plan = gw.plan_target(stype, "business_partner", "1000", BP)
    f = _by_field(plan)
    assert plan["supported"] and plan["method"] == "odata_patch"
    assert "BUT000.PARTNER" not in f  # the key is never written
    assert f["BUT000.NAME_ORG1"]["target"] == "OrganizationBPName1" and f["BUT000.NAME_ORG1"]["supported"]
    assert f["BUT000.BU_SORT1"]["target"] == "SearchTerm1"
    assert not f["BUT000.BU_GROUP"]["supported"] and "no writable property" in f["BUT000.BU_GROUP"]["reason"]
    assert not f["LFA1.NAME1"]["supported"]


def test_odata_other_objects_are_unsupported() -> None:
    plan = gw.plan_target("s4hana_cloud", "material_master", "M1", {"MATKL": "FERT"})
    assert not plan["supported"] and "business partners only" in plan["reason"]
    assert all(not x["supported"] for x in plan["fields"])


@pytest.mark.parametrize("domain,bapi", [("business_partner", "BAPI_BUPA_CENTRAL_DATA_SET"),
                                         ("material_master", "BAPI_MATERIAL_SAVEDATA"),
                                         ("accounts_payable", "BAPI_VENDOR_CHANGEFROMDATA"),
                                         ("accounts_receivable", "BAPI_CUSTOMER_CHANGEFROMDATA1")])
def test_rfc_is_unsupported_until_a_bapi_mapping_is_verified(domain: str, bapi: str) -> None:
    """The fix write-back's BAPI_FIELDS is empty, so no field has verified BAPI parameters."""
    assert writeback.BAPI_FIELDS == {}
    plan = gw.plan_target("ecc", domain, "1", {"NAME1": "x"})
    assert not plan["supported"] and plan["bapi"] == bapi
    assert plan["fields"][0]["reason"].startswith(f"No verified {bapi} parameter mapping")


def test_rfc_uses_the_fix_writeback_mapping_once_verified(monkeypatch) -> None:
    monkeypatch.setitem(writeback.BAPI_FIELDS, "BAPI_BUPA_CENTRAL_DATA_SET",
                        {"BUT000.NAME_ORG1": ({"PARTNER": "BUSINESSPARTNER"}, "CENTRALDATAORGANIZATION", "NAME1")})
    plan = gw.plan_target("s4hana_onprem", "business_partner", "1000", BP)
    f = _by_field(plan)
    assert plan["supported"] and plan["method"] == "rfc_bapi"
    assert f["BUT000.NAME_ORG1"]["supported"] and not f["BUT000.BU_SORT1"]["supported"]


def test_rfc_object_without_bapi_and_cloud_without_writes() -> None:
    assert "No write-back BAPI" in gw.plan_target("ecc", "quality_management", "1", {"X": 1})["reason"]
    for stype, label in (("successfactors", "SuccessFactors"), ("concur", "Concur"), ("ariba", "Ariba")):
        plan = gw.plan_target(stype, "business_partner", "1", {"NAME_ORG1": "x"})
        assert not plan["supported"] and plan["reason"] == f"The {label} connector has no write method"


def test_bare_field() -> None:
    assert gw.bare_field("BUT000.NAME_ORG1", "BUT000") == "NAME_ORG1"
    assert gw.bare_field("BUT000_NAME_ORG1", "BUT000") == "NAME_ORG1"
    assert gw.bare_field("NAME_ORG1", "BUT000") == "NAME_ORG1"
    assert gw.bare_field("LFA1.NAME1", "BUT000") is None


# ── simulate / apply with fake connectors ────────────────────────────────────────────────

class FakeOData:
    def __init__(self, row: dict, fail_on: str | None = None) -> None:
        self.row, self.fail_on, self.patches, self.closed = dict(row), fail_on, [], False

    def read_entity(self, entity_set, key, select):
        assert entity_set == "A_BusinessPartner" and key == "1000"
        return {k: self.row.get(k) for k in select}, {"If-Match": "*"}

    def update_entity(self, entity_set, key, changes):
        if self.fail_on and self.fail_on in changes:
            raise SAPConnectorError("400 property is read-only")
        self.patches.append(changes)
        self.row.update(changes)

    def close(self):
        self.closed = True


def _target(stype="s4hana_cloud", golden=None):
    return {"system_id": "s1", "system_name": "S4C", "system_type": stype,
            **gw.plan_target(stype, "business_partner", "1000", golden or BP)}


def test_simulate_diffs_without_writing_then_apply_writes_only_the_approved_changes() -> None:
    sap = FakeOData({"OrganizationBPName1": "ACME LTD.", "SearchTerm1": "ACME"})
    sim = gw.execute_targets([_target()], "business_partner", "1000", False, lambda sid: sap)
    f = _by_field(sim[0])
    assert f["BUT000.NAME_ORG1"]["result"] == "would_change" and f["BUT000.NAME_ORG1"]["current_value"] == "ACME LTD."
    assert f["BUT000.BU_SORT1"]["result"] == "unchanged"
    assert f["BUT000.BU_GROUP"]["result"] == "unsupported"
    assert sap.patches == [] and sap.closed

    done = gw.execute_targets(sim, "business_partner", "1000", True, lambda sid: sap)
    f = _by_field(done[0])
    assert sap.patches == [{"OrganizationBPName1": "Acme Ltd"}]
    assert f["BUT000.NAME_ORG1"]["result"] == "written" and f["BUT000.BU_SORT1"]["result"] == "unchanged"
    assert gw.summarise(done) == {"written": 1, "unchanged": 1, "unsupported": 2}

    # Idempotent: applying the same approval again re-reads SAP and writes nothing.
    again = gw.execute_targets(sim, "business_partner", "1000", True, lambda sid: sap)
    assert sap.patches == [{"OrganizationBPName1": "Acme Ltd"}]
    assert _by_field(again[0])["BUT000.NAME_ORG1"]["result"] == "unchanged"


def test_a_refused_field_is_an_error_and_the_rest_still_write() -> None:
    golden = {"NAME_ORG1": "Acme Ltd", "BU_SORT1": "ACME2"}
    sap = FakeOData({"OrganizationBPName1": "x", "SearchTerm1": "y"}, fail_on="SearchTerm1")
    sim = gw.execute_targets([_target(golden=golden)], "business_partner", "1000", False, lambda sid: sap)
    done = _by_field(gw.execute_targets(sim, "business_partner", "1000", True, lambda sid: sap)[0])
    assert done["NAME_ORG1"]["result"] == "written"
    assert done["BU_SORT1"]["result"] == "error" and "read-only" in done["BU_SORT1"]["message"]


def test_connection_failure_marks_the_supported_fields_and_skips_unsupported_systems() -> None:
    calls = []

    def connect(sid):
        calls.append(sid)
        raise SAPConnectorError("auth_failed")

    ecc = {"system_id": "e1", "system_name": "ECC", "system_type": "ecc",
           **gw.plan_target("ecc", "business_partner", "1000", BP)}
    out = gw.execute_targets([_target(), ecc], "business_partner", "1000", False, connect)
    assert calls == ["s1"]  # never connects to a system that cannot take any field
    assert _by_field(out[0])["BUT000.NAME_ORG1"]["result"] == "error"
    assert "auth_failed" in _by_field(out[0])["BUT000.NAME_ORG1"]["message"]
    assert {x["result"] for x in out[1]["fields"]} == {"unsupported"}


def test_rfc_simulate_and_apply_through_the_verified_bapi(monkeypatch) -> None:
    monkeypatch.setitem(writeback.BAPI_FIELDS, "BAPI_BUPA_CENTRAL_DATA_SET",
                        {"BUT000.NAME_ORG1": ({"PARTNER": "BUSINESSPARTNER"}, "CENTRALDATAORGANIZATION", "NAME1")})

    class FakeRFC:
        def __init__(self):
            self.calls = []

        def read_table(self, table, fields, where=None, max_rows=0):
            assert table == "BUT000" and where == "PARTNER = '1000'" and max_rows == 1
            return pd.DataFrame([{"PARTNER": "1000", "NAME_ORG1": "Old"}])

        def execute_bapi(self, call):
            self.calls.append(call)
            return {}

        def close(self):
            pass

    conn = FakeRFC()
    t = {"system_id": "e1", "system_name": "ECC", "system_type": "ecc",
         **gw.plan_target("ecc", "business_partner", "1000", {"NAME_ORG1": "New"})}
    sim = gw.execute_targets([t], "business_partner", "1000", False, lambda sid: conn)
    assert sim[0]["fields"][0]["result"] == "would_change" and conn.calls == []
    gw.execute_targets(sim, "business_partner", "1000", True, lambda sid: conn)
    assert conn.calls[0].bapi_name == "BAPI_BUPA_CENTRAL_DATA_SET"
    assert conn.calls[0].params == {"BUSINESSPARTNER": "1000", "CENTRALDATAORGANIZATION": {"NAME1": "New"},
                                    "CENTRALDATAORGANIZATIONX": {"NAME1": "X"}}


# ── connector: read_entity / update_entity ──────────────────────────────────────────────

@pytest.mark.parametrize("v2", [False, True])
def test_update_entity_fetches_csrf_and_etag_then_patches(monkeypatch, v2: bool) -> None:
    from sap.btp import BP_SERVICE, BTPConnector
    from sap.s4hana_cloud import S4HanaCloudConnector

    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        if request.method == "GET":
            row = {"BusinessPartner": "10'0", "OrganizationBPName1": "Old"}
            body = {"d": {**row, "__metadata": {"etag": "W/\"e1\""}}} if v2 else {**row, "@odata.etag": "W/\"e1\""}
            return httpx.Response(200, json=body, headers={"x-csrf-token": "tok123"})
        return httpx.Response(204)

    real = httpx.Client
    monkeypatch.setattr("sap.s4hana_cloud.httpx.post", lambda url, data=None, timeout=None: httpx.Response(
        200, json={"access_token": "t", "expires_in": 3600}, request=httpx.Request("POST", url)))
    monkeypatch.setattr("sap.s4hana_cloud.httpx.Client",
                        lambda **kw: real(transport=httpx.MockTransport(handler), **kw))
    conn = BTPConnector() if v2 else S4HanaCloudConnector()
    conn.connect(CloudConnectionParams(base_url="https://x.test", company_id="", auth_type="oauth2_client_credentials",
                                       client_id="c", client_secret="s", token_url="https://x.test/token"))
    current, _ = conn.read_entity("A_BusinessPartner", "10'0", ["OrganizationBPName1"])
    assert current == {"BusinessPartner": "10'0", "OrganizationBPName1": "Old"}
    conn.update_entity("A_BusinessPartner", "10'0", {"OrganizationBPName1": "New"})
    get, patch = seen[-2], seen[-1]
    assert get.headers["x-csrf-token"] == "Fetch" and get.url.params["$select"] == "OrganizationBPName1"
    assert patch.method == "PATCH"
    assert patch.headers["x-csrf-token"] == "tok123" and patch.headers["if-match"] == 'W/"e1"'
    assert json.loads(patch.content) == {"OrganizationBPName1": "New"}
    service = BP_SERVICE if v2 else "/sap/opu/odata4/sap/api_business_partner/srvd_a2x/sap/a_businesspartner/0001"
    assert patch.url.path == f"{service}/A_BusinessPartner('10''0')"
