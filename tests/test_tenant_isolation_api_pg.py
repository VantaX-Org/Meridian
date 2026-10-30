"""Cross-tenant isolation through the real API: the tenant comes from the verified token, never a default.

Two tenants, each with its own signing secret, user and run. Nothing in the auth path is stubbed (no
get_tenant override, no decode stub): a session token signed for tenant A reads A's rows only, cannot reach
B's run, and a token that claims B but is signed with A's secret is refused. RLS is set from the verified
claim (TenantMiddleware -> get_db), and every route query also carries the tenant id.
"""
import json
import os
import uuid

import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import create_engine, text

from api import deps as api_deps
from api.main import app
from api.middleware import local_auth
from api.services.local_auth import create_access_token

pytestmark = pytest.mark.skipif(not os.getenv("MERIDIAN_TEST_DB_URL"), reason="requires MERIDIAN_TEST_DB_URL")

SUMMARY_A = {"material_master": {"composite_score": 88.0, "raw_score": 88.0, "dimension_scores": {}, "total_checks": 3}}
SUMMARY_B = {"business_partner": {"composite_score": 41.0, "raw_score": 41.0, "dimension_scores": {}, "total_checks": 3}}


@pytest.fixture
def tenants():
    engine = create_engine(os.environ["MERIDIAN_TEST_DB_URL"])
    out = {}
    with engine.begin() as conn:
        for name, summary in (("a", SUMMARY_A), ("b", SUMMARY_B)):
            t, u, v = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
            secret = f"tenant-{name}-test-secret-" + uuid.uuid4().hex
            conn.execute(text("INSERT INTO tenants (id, name, jwt_secret) VALUES (:t, :n, :s)"),
                         {"t": t, "n": f"Tenant {name.upper()}", "s": secret})
            conn.execute(text("SELECT set_config('app.tenant_id', :t, true)"), {"t": t})
            conn.execute(text("INSERT INTO users (id, tenant_id, email, name, role) VALUES (:u, :t, :e, :n, 'admin')"),
                         {"u": u, "t": t, "e": f"{u}@example.test", "n": f"User {name}"})
            conn.execute(text("INSERT INTO analysis_versions (id, tenant_id, status, dqs_summary) "
                              "VALUES (:v, :t, 'complete', CAST(:s AS jsonb))"), {"v": v, "t": t, "s": json.dumps(summary)})
            out[name] = {"tenant": t, "user": u, "run": v, "secret": secret}
    local_auth.forget_jwt_secret()
    yield out
    local_auth.forget_jwt_secret()
    with engine.begin() as conn:
        for d in out.values():
            conn.execute(text("SELECT set_config('app.tenant_id', :t, true)"), {"t": d["tenant"]})
            conn.execute(text("DELETE FROM analysis_versions WHERE tenant_id = :t"), {"t": d["tenant"]})
            conn.execute(text("DELETE FROM user_role_scopes WHERE tenant_id = :t"), {"t": d["tenant"]})
            conn.execute(text("DELETE FROM users WHERE tenant_id = :t"), {"t": d["tenant"]})
        conn.execute(text("DELETE FROM tenants WHERE id = ANY(CAST(:ids AS uuid[]))"), {"ids": [d["tenant"] for d in out.values()]})
    engine.dispose()


def _token(d: dict, tenant: str | None = None, secret: str | None = None) -> dict[str, str]:
    tok = create_access_token(d["user"], tenant or d["tenant"], "x@example.test", "admin", secret or d["secret"])
    return {"Authorization": f"Bearer {tok}"}


async def _get(path: str, headers: dict[str, str]):
    await api_deps.engine.dispose()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        return await client.get(path, headers=headers)


@pytest.mark.anyio
async def test_token_for_tenant_a_reads_only_tenant_a(tenants):
    a, b = tenants["a"], tenants["b"]
    own = await _get(f"/api/v1/objects?run={a['run']}", _token(a))
    assert own.status_code == 200, own.text
    assert [o["module"] for o in own.json()["objects"]] == ["material_master"]

    # B's run does not exist for A: RLS and the tenant filter both hide it
    other = await _get(f"/api/v1/objects?run={b['run']}", _token(a))
    assert other.status_code == 404
    assert (await _get(f"/api/v1/objects/business_partner/receipt?run={b['run']}", _token(a))).status_code == 404

    # and B, with its own token, sees its own run
    mine = await _get(f"/api/v1/objects?run={b['run']}", _token(b))
    assert mine.status_code == 200
    assert [o["module"] for o in mine.json()["objects"]] == ["business_partner"]


@pytest.mark.anyio
async def test_token_claiming_another_tenant_is_refused(tenants):
    a, b = tenants["a"], tenants["b"]
    # signed with A's secret but naming B: B's secret does not verify it
    forged = _token(a, tenant=b["tenant"], secret=a["secret"])
    r = await _get(f"/api/v1/objects?run={b['run']}", forged)
    assert r.status_code == 401


@pytest.mark.anyio
async def test_token_without_tenant_claim_is_refused_outside_development(tenants, monkeypatch):
    import jwt

    from api.config import settings

    a = tenants["a"]
    monkeypatch.setattr(settings, "env", "production")
    tok = jwt.encode({"sub": a["user"], "email": "x@example.test", "role": "admin", "tv": 0}, a["secret"], "HS256")
    r = await _get(f"/api/v1/objects?run={a['run']}", {"Authorization": f"Bearer {tok}"})
    assert r.status_code == 401


@pytest.mark.anyio
async def test_get_tenant_refuses_without_a_verified_tenant_outside_development(monkeypatch):
    from fastapi import HTTPException
    from starlette.requests import Request

    from api.config import settings

    monkeypatch.setattr(settings, "env", "production")
    req = Request({"type": "http", "method": "GET", "path": "/api/v1/objects", "headers": [], "query_string": b""})
    with pytest.raises(HTTPException) as e:
        await api_deps.get_tenant(req)
    assert e.value.status_code == 401
    # the public pages before sign-in serve the deployment's own tenant
    pub = Request({"type": "http", "method": "GET", "path": "/api/v1/theme", "headers": [], "query_string": b""})
    assert (await api_deps.get_tenant(pub)).id == api_deps.deployment_tenant_id()
