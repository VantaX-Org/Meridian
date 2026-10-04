"""SuccessFactors read_entity_set paging: unlimited reads and __next links. Mocked HTTP only."""

import httpx

from sap.base import CloudConnectionParams
from sap.successfactors import SuccessFactorsConnector

BASE = "https://sf.example.test"


def _connector(handler) -> SuccessFactorsConnector:
    c = SuccessFactorsConnector()
    c._params = CloudConnectionParams(base_url=BASE, company_id="co", auth_type="basic")
    c._client = httpx.Client(base_url=BASE, transport=httpx.MockTransport(handler))
    return c


def test_unlimited_read_follows_next_link_with_its_query():
    seen: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(str(request.url))
        if "$skiptoken=p2" in str(request.url):
            return httpx.Response(200, json={"d": {"results": [{"userId": "3"}]}})
        return httpx.Response(200, json={"d": {
            "results": [{"userId": "1"}, {"userId": "2"}],
            "__next": f"{BASE}/odata/v2/User?$skiptoken=p2",
        }})

    df = _connector(handler).read_entity_set("User")  # top=0: read everything
    assert list(df["userId"]) == ["1", "2", "3"]
    assert len(seen) == 2 and "$skiptoken=p2" in seen[1]


def test_top_still_caps_rows():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"d": {
            "results": [{"userId": str(i)} for i in range(5)],
            "__next": f"{BASE}/odata/v2/User?$skiptoken=p2",
        }})

    assert len(_connector(handler).read_entity_set("User", top=3)) == 3
