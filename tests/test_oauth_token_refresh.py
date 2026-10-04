"""S/4HANA Cloud / BTP: an expired bearer token is refreshed once on 401. Mocked HTTP only."""

import httpx
import pytest

from sap.base import CloudConnectionParams, SAPConnectorError
from sap.btp import BTPConnector

BASE = "https://api.example.test"


def _connector(handler) -> BTPConnector:
    c = BTPConnector()
    c._params = CloudConnectionParams(base_url=BASE, company_id="", auth_type="oauth2_client_credentials",
                                      token_url=f"{BASE}/oauth/token", client_id="id", client_secret="s")
    c._client = httpx.Client(base_url=BASE, headers={"Authorization": "Bearer old"},
                             transport=httpx.MockTransport(handler))
    c._get_oauth_token = lambda params: "new"
    return c


def test_401_refreshes_token_and_retries():
    def handler(request: httpx.Request) -> httpx.Response:
        if request.headers["Authorization"] == "Bearer old":
            return httpx.Response(401)
        return httpx.Response(200, json={"ok": True})

    assert _connector(handler)._request_with_retry("GET", "/x").json() == {"ok": True}


def test_persistent_401_still_fails():
    with pytest.raises(SAPConnectorError):
        _connector(lambda request: httpx.Response(401))._request_with_retry("GET", "/x")


def test_successfactors_401_refreshes_token():
    from sap.successfactors import SuccessFactorsConnector

    def handler(request: httpx.Request) -> httpx.Response:
        if request.headers["Authorization"] == "Bearer old":
            return httpx.Response(401)
        return httpx.Response(200, json={"ok": True})

    c = SuccessFactorsConnector()
    c._params = CloudConnectionParams(base_url=BASE, company_id="co", auth_type="oauth2_saml")
    c._client = httpx.Client(base_url=BASE, headers={"Authorization": "Bearer old"},
                             transport=httpx.MockTransport(handler))
    c._get_oauth_token = lambda params: "new"
    assert c._request_with_retry("GET", "/x").json() == {"ok": True}
