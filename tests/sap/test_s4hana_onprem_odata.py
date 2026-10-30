"""S/4HANA on premise through SAP Gateway OData V2 (sap/s4hana_onprem.py), on a fake HTTP transport."""
from __future__ import annotations

import base64

import httpx
import pytest

from api.services.connectivity_manager import connect_onprem_odata
from sap.base import CloudConnectionParams, SAPConnectorError
from sap.ddic import get_dictionary
from sap.s4hana_onprem import BP_SERVICE, PRODUCT_SERVICE, S4OnPremODataConnector

BASE = "https://s4gw.example.test:44300"
SECRET = "pw-not-in-logs"


class Gateway:
    """Answers V2 JSON (d.results, __next) per path; records every request."""

    def __init__(self) -> None:
        self.seen: list[httpx.Request] = []
        self.pages: dict[str, list[dict]] = {}
        self.page = 2

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.seen.append(request)
        rows = self.pages.get(request.url.path)
        if rows is None:
            return httpx.Response(404, json={"error": {"message": {"value": "Resource not found"}}}, request=request)
        skip = int(request.url.params.get("skiptoken") or 0)
        chunk = rows[skip:skip + self.page]
        body: dict = {"d": {"results": chunk}}
        if skip + self.page < len(rows):
            body["d"]["__next"] = f"{BASE}{request.url.path}?skiptoken={skip + self.page}"
        return httpx.Response(200, json=body, request=request)


def _connect(gw: Gateway, **over) -> S4OnPremODataConnector:
    c = S4OnPremODataConnector(sap_client="100", transport=httpx.MockTransport(gw.handler))
    kw = dict(base_url=BASE, company_id="", auth_type="basic", username="MERIDIAN_RO", password=SECRET)
    kw.update(over)
    c.connect(CloudConnectionParams(**kw))
    return c


PRODUCTS = [{"Product": f"M{i}", "ProductType": "FERT", "ProductGroup": "G1", "BaseUnit": "EA",
             "GrossWeight": "1.000", "WeightUnit": "KG", "CreationDate": "/Date(1704153600000)/",
             "IsMarkedForDeletion": i == 2, "__metadata": {"uri": "x"}} for i in range(3)]


def test_basic_sign_in_sap_client_v2_paths_and_paging():
    gw = Gateway()
    gw.pages[f"{PRODUCT_SERVICE}/A_Product"] = PRODUCTS
    c = _connect(gw)
    df = c.read_entity_set("A_Product", select=["Product", "ProductType"])
    assert df["Product"].tolist() == ["M0", "M1", "M2"]
    first, second = gw.seen[0], gw.seen[1]
    assert first.url.path == f"{PRODUCT_SERVICE}/A_Product" and first.method == "GET"
    assert first.url.params["sap-client"] == "100" and second.url.params["sap-client"] == "100"
    assert first.url.params["$select"] == "Product,ProductType"
    expected = "Basic " + base64.b64encode(f"MERIDIAN_RO:{SECRET}".encode()).decode()
    assert first.headers["Authorization"] == expected
    assert all(r.method == "GET" for r in gw.seen)


def test_oauth_client_credentials(monkeypatch):
    posted = []

    def fake_post(url, data=None, timeout=None):
        posted.append((url, data))
        return httpx.Response(200, json={"access_token": "tok"}, request=httpx.Request("POST", url))

    monkeypatch.setattr("sap.s4hana_cloud.httpx.post", fake_post)
    gw = Gateway()
    gw.pages[f"{BP_SERVICE}/A_Customer"] = [{"Customer": "C1"}]
    c = _connect(gw, auth_type="oauth2_client_credentials", client_id="cid", client_secret="cs",
                 token_url="https://idp.example.test/token", username="", password="")
    assert c.read_entity_set("A_Customer")["Customer"].tolist() == ["C1"]
    assert posted[0][1]["grant_type"] == "client_credentials"
    assert gw.seen[0].headers["Authorization"] == "Bearer tok"


def test_refuses_an_unknown_sign_in_and_a_missing_base_url():
    with pytest.raises(SAPConnectorError, match="basic or oauth2_client_credentials"):
        _connect(Gateway(), auth_type="saml")
    with pytest.raises(SAPConnectorError, match="base URL"):
        _connect(Gateway(), base_url="")
    with pytest.raises(SAPConnectorError, match="base URL"):
        connect_onprem_odata({"base_url": "", "client": "100", "user": "u", "password": "p"})


def test_a_service_that_is_not_active_is_a_clear_error_without_the_password():
    gw = Gateway()
    c = _connect(gw)
    with pytest.raises(SAPConnectorError) as e:
        c.read_entity_set("A_Supplier")
    assert "404" in str(e.value) and SECRET not in str(e.value)


def test_extract_reads_s4_tables_through_odata_with_ecc_shapes(monkeypatch):
    from api.services import connectivity_manager as cm

    gw = Gateway()
    gw.pages[f"{PRODUCT_SERVICE}/A_Product"] = PRODUCTS
    gw.pages[f"{PRODUCT_SERVICE}/A_ProductPlant"] = [{"Product": "M0", "Plant": "1000", "MRPType": "PD"}]
    built = {}

    class Mgr(cm.ConnectivityManager):
        def __init__(self):
            self.tenant_id, self.session = "t", None

        def _load_system(self, sid):
            return type("R", (), {"system_type": "s4hana_onprem", "id": sid})()

        def _build_connection_params(self, row):
            return {"system_type": "s4hana_onprem", "extraction_path": "odata", "base_url": BASE, "client": "100",
                    "user": "MERIDIAN_RO", "password": SECRET, "odata_auth": "basic"}

        def _get_connector(self, system_type, params):
            raise AssertionError("the odata path must not open an RFC connection")

        def _get_onprem_odata_connector(self, params):
            built.update(params)
            return _connect(gw)

    monkeypatch.setattr("api.services.source_design.dictionary_for", lambda s, sid, st=None: get_dictionary("ecc6"))
    frames, coverage = Mgr().extract("sys", ["material_master"])
    cov = {c["table"]: c for c in coverage}
    assert cov["MARA"]["status"] == "live" and cov["MARA"]["path"] == "odata" and cov["MARA"]["rows"] == 3
    mara = frames["MARA"].set_index("MARA.MATNR")
    assert mara.loc["M0", "MARA.ERSDA"] == "20240102" and mara.loc["M2", "MARA.LVORM"] == "X"
    assert mara.loc["M0", "MARA.LVORM"] == ""
    assert cov["MARC"]["path"] == "odata" and cov["MARC"]["rows"] == 1
    assert cov["MBEW"]["status"] == "failed" and cov["MBEW"]["path"] == "odata"  # service answered 404
    assert all(c.get("path") == "odata" for c in coverage if c["status"] in ("live", "failed", "upload_required"))
    assert built["password"] == SECRET  # handed to the connector, then dropped from params
