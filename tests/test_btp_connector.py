"""BTP OData extraction: XSUAA token, V2/V4 paging, ECC-shaped frames. Mocked HTTP only."""

import httpx
import pandas as pd
import pytest

from api.services.connectivity_manager import CLOUD_SYSTEM_TYPES, ConnectivityManager, connect_sap_system
from sap.base import CloudConnectionParams, SAPConnectorError
from sap.btp import BP_SERVICE, BTPConnector, ecc_value
from sap.extraction_registry import get_extraction_targets

TOKEN_URL = "https://sub.authentication.example.test/oauth/token"
SECRET = "s3cr3t-value"


@pytest.fixture
def http(monkeypatch):
    """Fake XSUAA + OData server; records every request."""
    seen: list[httpx.Request] = []
    pages: dict[str, object] = {}

    def fake_post(url, data=None, timeout=None):
        seen.append(httpx.Request("POST", url, data=data))
        return httpx.Response(200, json={"access_token": "tok", "expires_in": 3600},
                              request=httpx.Request("POST", url))

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        body = pages.get(f"{request.url.path}?{request.url.query.decode()}") or pages.get(request.url.path)
        if callable(body):
            return body(request)
        return httpx.Response(200, json=body or {"d": {"results": []}})

    real_client = httpx.Client
    monkeypatch.setattr("sap.s4hana_cloud.httpx.post", fake_post)
    monkeypatch.setattr("sap.s4hana_cloud.httpx.Client",
                        lambda **kw: real_client(transport=httpx.MockTransport(handler), **kw))
    return seen, pages


def _connect(**over) -> BTPConnector:
    c = BTPConnector()
    c.connect(CloudConnectionParams(base_url="https://bp.example.test", company_id="",
                                    auth_type="oauth2_client_credentials", client_id="cid",
                                    client_secret=SECRET, token_url=TOKEN_URL, **over))
    return c


def test_token_from_xsuaa_and_bearer_header(http):
    seen, _ = http
    c = _connect()
    assert seen[0].method == "POST" and str(seen[0].url) == TOKEN_URL
    assert c.ping() is True
    assert seen[1].url.path == f"{BP_SERVICE}/" and seen[1].headers["Authorization"] == "Bearer tok"


def test_token_url_required(http):
    with pytest.raises(SAPConnectorError, match="token_url"):
        BTPConnector().connect(CloudConnectionParams(
            base_url="https://x", company_id="", auth_type="oauth2_client_credentials",
            client_id="cid", client_secret=SECRET))


def test_v2_next_paging_and_get_only(http):
    seen, pages = http
    path = f"{BP_SERVICE}/A_BusinessPartner"
    pages[path] = lambda r: httpx.Response(200, json={"d": {
        "results": [{"BusinessPartner": "1"}],
        "__next": f"https://bp.example.test{path}?$skiptoken=2"}}) if "skiptoken" not in str(r.url) \
        else httpx.Response(200, json={"d": {"results": [{"BusinessPartner": "2"}]}})
    df = _connect().read_entity_set("A_BusinessPartner", select=["BusinessPartner"])
    assert df["BusinessPartner"].tolist() == ["1", "2"]
    assert {r.method for r in seen[1:]} == {"GET"}  # only the token request is a POST


def test_skip_paging_without_next_link(http, monkeypatch):
    monkeypatch.setattr("sap.s4hana_cloud._DEFAULT_PAGE_SIZE", 2)
    _, pages = http
    rows = [{"BusinessPartner": str(i)} for i in range(5)]

    def page(r):
        skip = int(r.url.params.get("$skip", 0))
        return httpx.Response(200, json={"value": rows[skip:skip + 2]})
    pages[f"{BP_SERVICE}/A_BusinessPartner"] = page
    df = _connect().read_entity_set("A_BusinessPartner")
    assert df["BusinessPartner"].tolist() == ["0", "1", "2", "3", "4"]


def test_server_ignoring_skip_does_not_loop(http, monkeypatch):
    monkeypatch.setattr("sap.s4hana_cloud._DEFAULT_PAGE_SIZE", 2)
    _, pages = http
    pages[f"{BP_SERVICE}/A_BusinessPartner"] = {"value": [{"BusinessPartner": "0"}, {"BusinessPartner": "1"}]}
    assert len(_connect().read_entity_set("A_BusinessPartner")) == 2


def test_errors_mask_secret(http):
    _, pages = http
    pages[f"{BP_SERVICE}/A_BusinessPartner"] = lambda r: httpx.Response(403, text=f"denied {SECRET}")
    with pytest.raises(SAPConnectorError) as e:
        _connect().read_entity_set("A_BusinessPartner")
    assert SECRET not in str(e.value)


def test_ecc_value():
    assert ecc_value(True) == "X" and ecc_value(False) == ""
    assert ecc_value("/Date(1704067200000)/") == "20240101"
    assert ecc_value("2024-01-31") == "20240131"
    assert ecc_value("2024-01-31T00:00:00") == "20240131"
    assert ecc_value("1000123") == "1000123" and ecc_value(None) is None


def test_btp_registered():
    assert "btp" in CLOUD_SYSTEM_TYPES
    tables = {next(iter(t.rename_map.values())).split(".")[0]
              for t in get_extraction_targets("btp", "business_partner", include_config=False)}
    assert {"BUT000", "BUT020", "ADRC", "DFKKBPTAXNUM", "BUT0BK"} <= tables


def test_connect_sap_system_selects_btp(http):
    c = connect_sap_system("btp", {"base_url": "https://bp.example.test", "client_id": "cid",
                                   "client_secret": SECRET, "token_url": TOKEN_URL})
    assert type(c) is BTPConnector


def test_extract_mapped_lands_ecc_tables():
    class Fake:
        def read_entity_set(self, entity_set, select=None, **_):
            if entity_set == "A_BusinessPartnerBank":
                raise SAPConnectorError("403")
            return pd.DataFrame([{"BusinessPartner": "1", "BusinessPartnerIsBlocked": True,
                                  "CreationDate": "/Date(1704067200000)/", "__metadata": {}}])

    frames, cov = ConnectivityManager._extract_mapped(Fake(), "btp", ["business_partner"])
    but000 = frames["BUT000"]
    assert but000.loc[0, "BUT000.PARTNER"] == "1"
    assert but000.loc[0, "BUT000.XBLCK"] == "X" and but000.loc[0, "BUT000.CRDAT"] == "20240101"
    by = {c["table"]: c for c in cov}
    assert by["BUT000"]["status"] == "live" and by["BUT000"]["purpose"] == "data"
    assert "FirstName" in by["BUT000"]["unavailable_fields"]  # not returned: reported, not filled
    assert by["ADRC"]["status"] == "not_in_system"  # no mapped property returned at all
    assert by["BUT0BK"]["status"] == "failed" and "BUT0BK" not in frames


def test_extract_mapped_empty_entity_set_is_zero_rows():
    class Empty:
        def read_entity_set(self, *a, **k):
            return pd.DataFrame()

    frames, cov = ConnectivityManager._extract_mapped(Empty(), "btp", ["business_partner"])
    assert len(frames["BUT000"]) == 0 and "BUT000.PARTNER" in frames["BUT000"].columns
    assert all(c["status"] == "live" and c["rows"] == 0 for c in cov)
