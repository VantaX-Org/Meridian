"""Every GET endpoint answers without a server error, on an empty tenant and on one with a run.

A 5xx is what a screen shows as "Something went wrong". This sweeps every registered GET route
(path parameters filled with plausible values) so a broken screen fails here instead of in front of a user.
"""
import asyncio
import os
import uuid

import pytest
from fastapi.routing import APIRoute
from httpx import ASGITransport, AsyncClient
from sqlalchemy import create_engine, text

from api import deps as api_deps
from api.deps import Tenant, get_tenant
from api.main import app

pytestmark = pytest.mark.skipif(not os.getenv("MERIDIAN_TEST_DB_URL"), reason="requires MERIDIAN_TEST_DB_URL")

HEADERS = {"X-User-Role": "admin", "Authorization": "Bearer test-token"}
# Long-lived streams never answer; they are covered by their own tests.
SKIP = ("/events", "/stream", "/sse")
PARAMS = {"object": "material_master", "object_type": "material_master", "module": "material_master",
          "module_id": "material_master", "key": "MATNR=1", "record_key": "MATNR=1", "check_id": "MM001",
          "rule_id": "MM001", "format": "xlsx", "l1": "ptp", "lang": "en"}


def _paths() -> list[str]:
    out = []
    # FastAPI >=0.140 wraps each included router (tests/test_route_shadowing.py).
    routes = [x for r in app.routes for x in (r.original_router.routes if hasattr(r, "original_router") else [r])]
    for r in routes:
        if not isinstance(r, APIRoute) or "GET" not in r.methods or any(s in r.path for s in SKIP):
            continue
        path = r.path
        for name in r.param_convertors:
            path = path.replace("{" + name + "}", PARAMS.get(name, str(uuid.uuid4())))
            path = path.replace("{" + name + ":path}", PARAMS.get(name, str(uuid.uuid4())))
        out.append(path)
    return sorted(set(out))


def _seed(engine, tid: str) -> None:
    vid = str(uuid.uuid4())
    with engine.begin() as c:
        c.execute(text("""INSERT INTO analysis_versions (id, tenant_id, status, run_at, dqs_summary, metadata)
                          VALUES (:v, :t, 'complete', now(), CAST('{"material_master": {"dqs": 80}}' AS jsonb),
                                  CAST('{"modules": ["material_master"]}' AS jsonb))"""), {"v": vid, "t": tid})
        c.execute(text("""INSERT INTO findings (id, version_id, tenant_id, module, check_id, severity, dimension,
                                                affected_count, total_count, pass_rate, details)
                          VALUES (gen_random_uuid(), :v, :t, 'material_master', 'MM001', 'critical', 'completeness',
                                  1, 10, 0.9, CAST('{"message": "Base unit is empty", "field_checked": "MARA.MEINS"}' AS jsonb))"""),
                  {"v": vid, "t": tid})
        c.execute(text("""INSERT INTO record_issues (id, tenant_id, scope, module, check_id, record_key, severity, status,
                                                     first_seen_version, last_seen_version)
                          VALUES (gen_random_uuid(), :t, 'upload', 'material_master', 'MM001', 'MATNR=1', 'critical',
                                  'open', :v, :v)"""), {"t": tid, "v": vid})


# This sweep looks for server errors, not speed. Coverage instrumentation (COVERAGE_FILE is set in CI's coverage
# runs) makes the slowest routes take two to three times longer, so they get more time there.
_ROUTE_TIMEOUT_S = 90 if os.environ.get("COVERAGE_FILE") else 30


async def _sweep(tid: str, monkeypatch) -> list[str]:
    monkeypatch.setattr("api.middleware.local_auth._load_jwt_secret", lambda: "test-secret")
    monkeypatch.setattr("api.middleware.local_auth.decode_access_token",
                        lambda token, secret: {"sub": "00000000-0000-0000-0000-000000000002", "email": "dev@example.com", "role": "admin"})
    monkeypatch.setenv("MERIDIAN_DEV_ROLE_HEADER", "1")
    monkeypatch.setitem(app.dependency_overrides, get_tenant, lambda: Tenant(uuid.UUID(tid), "T", []))
    await api_deps.engine.dispose()
    bad = []
    async with AsyncClient(transport=ASGITransport(app=app, raise_app_exceptions=False), base_url="http://test") as client:
        for path in _paths():
            try:
                r = await asyncio.wait_for(client.get(path, headers=HEADERS), _ROUTE_TIMEOUT_S)
            except asyncio.TimeoutError:
                bad.append(f"{path} timeout")
                continue
            if r.status_code >= 500:
                bad.append(f"{path} {r.status_code} {r.text[:160]}")
    return bad


@pytest.mark.anyio
@pytest.mark.parametrize("seeded", [False, True], ids=["empty", "with_run"])
async def test_no_get_route_answers_a_server_error(seeded, monkeypatch):
    engine = create_engine(os.environ["MERIDIAN_TEST_DB_URL"])
    tid = str(uuid.uuid4())
    with engine.begin() as c:
        c.execute(text("INSERT INTO tenants (id, name) VALUES (:id, :id)"), {"id": tid})
    if seeded:
        _seed(engine, tid)
    bad = await _sweep(tid, monkeypatch)
    assert not bad, "\n".join(bad)
