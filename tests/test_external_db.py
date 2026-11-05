"""External SQL database source: trust boundary, secrecy, and the permission on every route."""

import ast
import socket
import uuid
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.deps import Tenant, get_db, get_tenant
from api.routes import external_db as routes
from api.services import external_db as svc

ROOT = Path(__file__).resolve().parent.parent
TENANT = uuid.uuid4()


@pytest.fixture(autouse=True)
def _no_own_addresses(monkeypatch):
    monkeypatch.setattr(svc, "_own_addresses", lambda: set())


def _resolves_to(monkeypatch, *ips):
    monkeypatch.setattr(svc.socket, "getaddrinfo",
                        lambda *a, **k: [(socket.AF_INET6 if ":" in i else socket.AF_INET, 0, 0, "", (i, 0)) for i in ips])


@pytest.mark.parametrize("ip", ["169.254.169.254", "127.0.0.1", "::1", "0.0.0.0", "fd00:ec2::254",
                                "100.100.100.200", "::ffff:169.254.169.254", "169.254.0.5", "224.0.0.1"])
def test_blocked_addresses(monkeypatch, ip):
    _resolves_to(monkeypatch, ip)
    with pytest.raises(svc.ExternalDbError) as e:
        svc.resolve_safe("db.example.test", 5432)
    assert e.value.code == "host_blocked"


def test_one_bad_address_blocks_the_host(monkeypatch):
    _resolves_to(monkeypatch, "10.1.2.3", "169.254.169.254")
    with pytest.raises(svc.ExternalDbError):
        svc.resolve_safe("db.example.test", 5432)


def test_private_range_allowed_and_checked_address_returned(monkeypatch):
    _resolves_to(monkeypatch, "10.1.2.3")
    assert svc.resolve_safe("db.example.test", 5432) == "10.1.2.3"


@pytest.mark.parametrize("q", [
    "SELECT 1; DELETE FROM t", "select 1; commit; drop table t", "DELETE FROM t", "UPDATE t SET a = 1",
    "INSERT INTO t VALUES (1)", "SELECT 'a", "SELECT 1 /* x", "", "  ", "COPY t TO PROGRAM 'id'",
    "WITH x AS (SELECT 1) SELECT 1; SELECT 2", "SELECT $$a;b$$ AS s",
])
def test_rejected_queries(q):
    with pytest.raises(svc.ExternalDbError):
        svc.check_single_select(q)


@pytest.mark.parametrize("q", [
    "SELECT 1", "select a, b from t where c = 'x;y' ;", "WITH x AS (SELECT 1) SELECT * FROM x",
    "SELECT 1 -- ; trailing", 'SELECT "a;b" FROM t', "SELECT 1 /* ; */",
])
def test_accepted_queries(q):
    assert svc.check_single_select(q)


def test_trailing_semicolon_dropped():
    assert svc.check_single_select("SELECT 1 ;") == "SELECT 1"


def test_connect_failure_message_is_fixed(monkeypatch):
    _resolves_to(monkeypatch, "10.1.2.3")

    def boom(**kw):
        raise svc.psycopg2.OperationalError('connection to server at "10.1.2.3" failed: password=hunter2')
    monkeypatch.setattr(svc.psycopg2, "connect", boom)
    with pytest.raises(svc.ExternalDbError) as e:
        svc.ping({"host": "h", "port": 5432, "database": "d", "username": "u", "ssl_mode": "require"}, "hunter2")
    assert "hunter2" not in e.value.detail and "10.1.2.3" not in e.value.detail


class _Result:
    def __init__(self, rows):
        self._rows = rows

    def mappings(self):
        return self

    def first(self):
        return self._rows[0] if self._rows else None

    def one(self):
        return self._rows[0]

    def all(self):
        return self._rows

    def scalar(self):
        return None


class _DB:
    def __init__(self, rows):
        self.rows = rows
        self.params = []

    async def execute(self, stmt, params=None):
        self.params.append(params)
        return _Result(self.rows)

    async def commit(self):
        pass


def _client(monkeypatch, db):
    monkeypatch.setenv("MERIDIAN_DEV_ROLE_HEADER", "1")
    monkeypatch.setenv("CREDENTIAL_MASTER_KEY", "test-master-key")
    _resolves_to(monkeypatch, "10.1.2.3")
    app = FastAPI()
    app.include_router(routes.router)

    async def _db():
        yield db
    app.dependency_overrides[get_db] = _db
    app.dependency_overrides[get_tenant] = lambda: Tenant(TENANT, "t", [])
    return TestClient(app)


def test_create_encrypts_and_never_returns_password(monkeypatch):
    import datetime
    row = {"id": uuid.uuid4(), "name": "crm", "engine": "postgres", "host": "db.example.test", "port": 5432,
           "database": "d", "username": "u", "ssl_mode": "require", "created_by": "a", "created_at": datetime.datetime.now(),
           "last_tested_at": None, "last_test_ok": None, "last_loaded_at": None}
    db = _DB([row])
    c = _client(monkeypatch, db)
    r = c.post("/api/v1/external-db/connections", headers={"X-User-Role": "admin"},
               json={"name": "crm", "host": "db.example.test", "database": "d", "username": "u", "password": "s3cret-pw"})
    assert r.status_code == 201, r.text
    assert "s3cret-pw" not in r.text and "password" not in r.text
    stored = [p for p in db.params if p and "pw" in p][0]["pw"]
    assert stored != "s3cret-pw" and routes.decrypt_password(str(TENANT), stored) == "s3cret-pw"


def test_create_refuses_metadata_host(monkeypatch):
    c = _client(monkeypatch, _DB([]))
    _resolves_to(monkeypatch, "169.254.169.254")
    r = c.post("/api/v1/external-db/connections", headers={"X-User-Role": "admin"},
               json={"name": "x", "host": "metadata.example.test", "database": "d", "username": "u", "password": "p"})
    assert r.status_code == 422 and r.json()["detail"]["error"] == "host_blocked"


def test_every_route_needs_manage_systems():
    src = (ROOT / "api" / "routes" / "external_db.py").read_text()
    routes_found = 0
    for node in ast.walk(ast.parse(src)):
        if isinstance(node, ast.AsyncFunctionDef):
            for d in node.decorator_list:
                if isinstance(d, ast.Call) and getattr(d.func, "attr", "") in ("get", "post", "delete"):
                    routes_found += 1
                    assert 'require_permission("manage_systems")' in ast.get_source_segment(src, d), node.name
    assert routes_found == 7


@pytest.mark.skipif(not __import__("os").getenv("MERIDIAN_TEST_DB_URL"), reason="requires MERIDIAN_TEST_DB_URL")
def test_live_session_is_read_only_and_capped(monkeypatch):
    from sqlalchemy.engine import make_url
    u = make_url(__import__("os").environ["MERIDIAN_TEST_DB_URL"])
    monkeypatch.setattr(svc, "resolve_safe", lambda host, port: "127.0.0.1")  # the test database is on loopback
    conn = {"host": u.host, "port": u.port or 5432, "database": u.database, "username": u.username, "ssl_mode": "disable"}
    pw = u.password or ""
    df, cut = svc.fetch(conn, pw, table=None, query="SELECT g AS n FROM generate_series(1, 50) g", limit=10)
    assert len(df) == 10 and cut and list(df.columns) == ["n"]
    with pytest.raises(svc.ExternalDbError) as e:
        svc.fetch(conn, pw, table=None, query="WITH d AS (DELETE FROM tenants RETURNING 1) SELECT * FROM d")
    assert e.value.code == "query_failed"


# each of these hides a second statement from a naive mask while Postgres runs it; COMMIT would end the read-only transaction
_SMUGGLED = [
    "SELECT E'\\'' ; COMMIT; DELETE FROM t; --'",           # escape string: \' does not close it
    "SELECT 1 AS a$b$; COMMIT; DELETE FROM t; SELECT 1 AS c$b$",  # a$b$ is an identifier, not a dollar quote
    "SELECT 1 /* /* */ ' */ ; COMMIT; DELETE FROM t; --'",  # block comments nest
    "SELECT 1 -- x\r; COMMIT; DELETE FROM t",               # a carriage return ends a line comment
]


@pytest.mark.parametrize("q", _SMUGGLED)
def test_smuggled_second_statement_refused(q):
    with pytest.raises(svc.ExternalDbError):
        svc.check_single_select(q)


def test_own_service_address_refused(monkeypatch):
    monkeypatch.setattr(svc, "_own_addresses", lambda: {"172.18.0.5"})
    monkeypatch.setattr(svc.socket, "getaddrinfo", lambda *a, **k: [(2, 1, 6, "", ("172.18.0.5", 5432))])
    with pytest.raises(svc.ExternalDbError) as e:
        svc.resolve_safe("db", 5432)
    assert e.value.code == "host_blocked"


@pytest.mark.skipif(not __import__("os").getenv("MERIDIAN_TEST_DB_URL"), reason="requires MERIDIAN_TEST_DB_URL")
def test_live_timeout_and_types(monkeypatch):
    from sqlalchemy.engine import make_url
    u = make_url(__import__("os").environ["MERIDIAN_TEST_DB_URL"])
    monkeypatch.setattr(svc, "resolve_safe", lambda host, port: "127.0.0.1")
    monkeypatch.setattr(svc, "STATEMENT_TIMEOUT_MS", 500)
    conn = {"host": u.host, "port": u.port or 5432, "database": u.database, "username": u.username, "ssl_mode": "disable"}
    with pytest.raises(svc.ExternalDbError) as e:
        svc.fetch(conn, u.password or "", table=None, query="SELECT pg_sleep(5)")
    assert e.value.code == "timeout"
    df, _ = svc.fetch(conn, u.password or "", table=None,
                      query="SELECT 1.5::numeric AS n, '\\x00ff'::bytea AS b, gen_random_uuid() AS g, now() AS t")
    assert df["n"][0] == 1.5 and df["b"][0] == "00ff" and isinstance(df["g"][0], str)
