"""A refused SuccessFactors sign-in must stop all further requests, so SF does not lock the account."""

import httpx
import pytest

from sap.base import SAPConnectorError
from sap.successfactors import SuccessFactorsConnector
from tests.test_successfactors_paging import _connector


def _refusing(calls: list[int], body: str = "") -> SuccessFactorsConnector:
    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(1)
        return httpx.Response(401, text=body)
    return _connector(handler)


def test_one_refused_sign_in_then_nothing_is_sent():
    calls: list[int] = []
    c = _refusing(calls)
    for _ in range(5):
        with pytest.raises(SAPConnectorError, match="refused the sign-in"):
            c.read_entity_set("User")
    assert len(calls) == 1


def test_lockout_code_in_a_non_401_reply_also_stops():
    calls: list[int] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(1)
        return httpx.Response(403, text="<error>LGN0014 account locked</error>")

    c = _connector(handler)
    with pytest.raises(SAPConnectorError, match="LGN0014"):
        c.read_entity_set("User")
    with pytest.raises(SAPConnectorError):
        c.read_entity_set("EmpJob")
    assert len(calls) == 1


def test_ping_raises_on_refused_credentials_and_sends_one_request():
    calls: list[int] = []
    c = _refusing(calls, "LGN0015")
    with pytest.raises(SAPConnectorError, match="LGN0015"):
        c.ping()
    with pytest.raises(SAPConnectorError):
        c.ping()
    assert len(calls) == 1


def test_ping_true_on_200():
    c = _connector(lambda r: httpx.Response(200, text="<edmx/>"))
    assert c.ping() is True
