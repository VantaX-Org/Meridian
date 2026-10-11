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


def test_unlimited_read_sends_no_top():
    """SF treats $top as a client limit and returns no __next: an unlimited read must omit it."""
    seen: list[httpx.URL] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request.url)
        return httpx.Response(200, json={"d": {"results": [{"userId": "1"}]}})

    _connector(handler).read_entity_set("User")
    assert "$top" not in seen[0].params


def test_expand_flattens_navigation_values_into_slash_columns():
    seen: list[httpx.URL] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request.url)
        return httpx.Response(200, json={"d": {"results": [
            {"jobReqId": 1, "jobReqLocale": {"results": [{"jobTitle": "Engineer", "__metadata": {}}]}},
            {"jobReqId": 2, "jobReqLocale": {"results": []}},
            {"jobReqId": 3, "jobReqLocale": {"jobTitle": "Clerk"}},
        ]}})

    df = _connector(handler).read_entity_set(
        "JobRequisition", select=["jobReqId", "jobReqLocale/jobTitle"], expand=["jobReqLocale"])
    assert seen[0].params["$expand"] == "jobReqLocale"
    assert seen[0].params["$select"] == "jobReqId,jobReqLocale/jobTitle"
    col = df["jobReqLocale/jobTitle"]
    assert col[0] == "Engineer" and col.isna()[1] and col[2] == "Clerk"
    assert "jobReqLocale" not in df.columns


def test_to_many_expand_prefers_the_default_language_then_the_first_non_blank_value():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"d": {"results": [
            {"jobReqId": 1, "defaultLanguage": "en_US", "jobReqLocale": {"results": [
                {"locale": "de_DE", "jobTitle": "Ingenieur"}, {"locale": "en_US", "jobTitle": "Engineer"}]}},
            {"jobReqId": 2, "defaultLanguage": "en_US", "jobReqLocale": {"results": [
                {"locale": "en_US", "jobTitle": " "}, {"locale": "fr_FR", "jobTitle": "Commis"}]}},
            {"jobReqId": 3, "jobReqLocale": {"results": [
                {"locale": "de_DE", "jobTitle": None}, {"locale": "fr_FR", "jobTitle": "Chef"}]}},
        ]}})

    df = _connector(handler).read_entity_set(
        "JobRequisition", select=["jobReqId", "defaultLanguage", "jobReqLocale/locale", "jobReqLocale/jobTitle"],
        expand=["jobReqLocale"])
    assert df["jobReqLocale/jobTitle"].tolist() == ["Engineer", "Commis", "Chef"]


def test_metadata_is_requested_as_xml_not_json():
    def handler(request: httpx.Request) -> httpx.Response:
        ok = request.headers["accept"] == "application/xml"
        return httpx.Response(200 if ok else 406, text="<edmx/>")

    c = _connector(handler)
    c._client.headers["Accept"] = "application/json"
    assert c.metadata("EmpJob") == "<edmx/>"


def test_failed_request_carries_the_sf_error_body_first_and_truncated():
    import pytest
    from sap.base import SAPConnectorError

    body = {"error": {"code": "COE0003", "message": {"lang": "en-US", "value":
            "[COE0003]Bad property expression: EmpJob/operation; " + "x" * 500}}}
    with pytest.raises(SAPConnectorError) as ei:
        _connector(lambda r: httpx.Response(400, json=body)).read_entity_set("EmpJob")
    msg = str(ei.value)
    assert msg.startswith("SuccessFactors request failed: [COE0003]Bad property expression: EmpJob/operation")
    assert "400 Bad Request" in msg and msg.index("::") < 400
