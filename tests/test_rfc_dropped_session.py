"""A dropped RFC session must cost one page, not the table.

On the KMZ run EORD and MARD failed with RFC_CLOSED after an hour of paging. The reader now
reopens the connection and reads the same page again, twice at most. ABAP errors such as
OPTION_NOT_VALID are not network drops and must still fail at once.
"""

import pytest

from sap.base import SAPConnectorError
from sap.rfc import READ_TABLE, RFCConnector, _MAX_DROPS


class CommunicationError(Exception):
    """Same class name pyrfc raises for a broken session."""


def _page(rows: list[str]) -> dict:
    return {"FIELDS": [{"FIELDNAME": "MATNR", "OFFSET": "0", "LENGTH": "3"}],
            "DATA": [{"WA": r} for r in rows]}


class FakeConn:
    def __init__(self, script: list):
        self.script, self.reopens, self.skips = list(script), 0, []

    def call(self, _fm: str, **params) -> dict:
        self.skips.append(params["ROWSKIPS"])
        step = self.script.pop(0)
        if isinstance(step, Exception):
            raise step
        return step

    def reopen(self) -> None:
        self.reopens += 1


def _reader() -> RFCConnector:
    r = RFCConnector()
    r._read_function = READ_TABLE
    r._password = "secret"
    return r


def test_one_drop_reopens_and_rereads_the_same_page():
    conn = FakeConn([_page(["AAA", "BBB"]), Exception("RFC_CLOSED: connection closed"),
                     _page(["CCC"])])
    df = _reader()._read_paged("MARD", ["MATNR"], None, 0, 2, conn=conn)
    assert df["MATNR"].tolist() == ["AAA", "BBB", "CCC"]
    assert conn.reopens == 1
    assert conn.skips == [0, 2, 2], "the dropped page is read again from the same row"


def test_communication_error_counts_as_a_drop():
    conn = FakeConn([CommunicationError("partner not reached"), _page(["AAA"])])
    df = _reader()._read_paged("EORD", ["MATNR"], None, 0, 5, conn=conn)
    assert len(df) == 1 and conn.reopens == 1


def test_gives_up_after_the_drop_limit():
    drops = [Exception("RFC_CLOSED") for _ in range(_MAX_DROPS + 1)]
    conn = FakeConn(drops)
    with pytest.raises(SAPConnectorError):
        _reader()._read_paged("MARD", ["MATNR"], None, 0, 2, conn=conn)
    assert conn.reopens == _MAX_DROPS


def test_abap_errors_are_not_retried():
    conn = FakeConn([Exception("OPTION_NOT_VALID DB_Error"), _page(["AAA"])])
    with pytest.raises(SAPConnectorError):
        _reader()._read_paged("ADRC", ["MATNR"], None, 0, 2, conn=conn)
    assert conn.reopens == 0


def test_password_is_masked_when_the_reopen_fails():
    class BadReopen(FakeConn):
        def reopen(self) -> None:
            raise Exception("logon failed for secret")

    conn = BadReopen([Exception("RFC_CLOSED")])
    with pytest.raises(SAPConnectorError) as exc:
        _reader()._read_paged("MARD", ["MATNR"], None, 0, 2, conn=conn)
    assert "secret" not in str(exc.value)
