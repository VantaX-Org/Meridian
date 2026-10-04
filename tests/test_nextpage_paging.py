"""Ariba and Concur _read_endpoint paging: NextPage links keep their query. Mocked HTTP only."""

import httpx
import pytest

from sap.ariba import AribaConnector
from sap.base import CloudConnectionParams
from sap.concur import ConcurConnector

BASE = "https://api.example.test"


@pytest.mark.parametrize("cls", [AribaConnector, ConcurConnector])
def test_next_page_token_is_sent(cls):
    seen: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(str(request.url))
        if len(seen) > 3:
            raise AssertionError(f"paging loop: {seen}")
        if "pageToken=p2" in str(request.url):
            return httpx.Response(200, json={"Items": [{"id": "3"}]})
        return httpx.Response(200, json={"Items": [{"id": "1"}, {"id": "2"}],
                                         "NextPage": f"{BASE}/items?pageToken=p2&limit=100"})

    c = cls()
    c._params = CloudConnectionParams(base_url=BASE, company_id="realm1", auth_type="oauth2")
    c._client = httpx.Client(base_url=BASE, transport=httpx.MockTransport(handler))
    c._ensure_token = lambda: None

    df = c._read_endpoint("/items", filter_expr="x eq 1")
    assert list(df["id"]) == ["1", "2", "3"]
    assert len(seen) == 2 and "pageToken=p2" in seen[1]
    if cls is AribaConnector:
        assert "realm=realm1" in seen[1]
