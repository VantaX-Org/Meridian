"""The connection test names why RFC_PING failed, and an RFC logon whose RFC_PING is refused
still counts as connected: the logon proved the host, client, user and password."""

import api.routes.systems as systems


class _Conn:
    def __init__(self, ok: bool, error: str = "") -> None:
        self.ok, self.error = ok, error

    def ping(self) -> bool:
        if not self.ok and self.error:
            self.ping_error = self.error
        return self.ok

    def close(self) -> None:
        pass


def _run(monkeypatch, conn: _Conn, system_type: str = "ecc", secrets: list[str] | None = None):
    monkeypatch.setattr(systems, "connect_sap_system", lambda t, p: conn)
    return systems._connection_test_once(system_type, {}, secrets or [])


def test_refused_rfc_ping_after_logon_is_connected_with_reason(monkeypatch):
    r = _run(monkeypatch, _Conn(False, "No RFC authorization for function module RFC_PING s3cret"), secrets=["s3cret"])
    assert r.connected is True
    assert "No RFC authorization" in r.message and "s3cret" not in r.message


def test_cloud_ping_failure_stays_not_connected_and_names_the_reason(monkeypatch):
    r = _run(monkeypatch, _Conn(False, "HTTP 403"), system_type="successfactors")
    assert r.connected is False and r.message == "Ping failed: HTTP 403"


def test_ping_without_reason_keeps_the_old_message(monkeypatch):
    r = _run(monkeypatch, _Conn(False))
    assert r.connected is False and r.message == "Ping failed"


def test_rfc_ping_keeps_the_masked_error(monkeypatch):
    from sap.rfc import RFCConnector

    class _Raw:
        def call(self, name, **kw):
            raise RuntimeError("RFC_PING refused for pw hunter2")

    c = RFCConnector.__new__(RFCConnector)
    c._conn, c._password = _Raw(), "hunter2"
    assert c.ping() is False and "refused" in c.ping_error and "hunter2" not in c.ping_error
