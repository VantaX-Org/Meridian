"""User reads carry every status (SF returns only active users otherwise). Mocked HTTP only."""

import httpx

from sap.successfactors import USER_STATUS_FILTER, entity_filter
from tests.test_successfactors_paging import _connector


def test_user_gets_status_filter_and_keeps_caller_filter():
    assert entity_filter("User", None) == USER_STATUS_FILTER
    assert entity_filter("User", "country eq 'ZA'") == f"(country eq 'ZA') and {USER_STATUS_FILTER}"
    # a caller that filters on status itself decides
    assert entity_filter("User", "status eq 't'") == "status eq 't'"
    # other entities untouched
    assert entity_filter("EmpJob", None) is None
    assert entity_filter("PerPerson", "a eq 'b'") == "a eq 'b'"


def test_user_read_sends_status_filter():
    seen: list[httpx.URL] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request.url)
        return httpx.Response(200, json={"d": {"results": [{"userId": "1", "status": "f"}]}})

    _connector(handler).read_entity_set("User", select=["userId"])
    assert seen[0].params["$filter"] == "status in 't','f','T','F','e','d'"
    _connector(handler).read_entity_set("EmpJob")
    assert "$filter" not in seen[1].params
