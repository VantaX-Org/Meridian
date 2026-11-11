"""Permission gates on balance, collab, delegations, exceptions, jobs retry, report schedules and SCIM.

Each write a viewer must not make answers 403 before any database work; SCIM answers 401 without its bearer token
because it authenticates the identity provider, not a signed-in user."""

import uuid

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.deps import Tenant, get_tenant
from api.routes import balance, collab, delegations, exceptions, jobs, report_library, scim

VIEWER = {"X-User-Role": "viewer"}


def _client(*routers) -> TestClient:
    api = FastAPI()
    for r in routers:
        api.include_router(r.router)
    api.dependency_overrides[get_tenant] = lambda: Tenant(uuid.uuid4(), "D", [])
    return TestClient(api, raise_server_exceptions=False)


@pytest.fixture(autouse=True)
def _dev_roles(monkeypatch):
    monkeypatch.setenv("MERIDIAN_DEV_ROLE_HEADER", "1")


def test_every_route_in_these_files_has_a_gate():
    """No route in these modules runs without a permission dependency (SCIM: its bearer token instead)."""
    for mod in (balance, collab, delegations, exceptions, jobs, report_library):
        router_gate = bool(mod.router.dependencies)
        for route in mod.router.routes:
            gated = router_gate or any("require" in getattr(d.call, "__qualname__", "") for d in route.dependant.dependencies)
            assert gated, f"{mod.__name__} {route.path} has no permission dependency"
    for route in scim.router.routes:
        names = {d.call.__name__ for d in route.dependant.dependencies}
        assert "scim_context" in names or "_session" in names, route.path


@pytest.mark.parametrize("method,path,body", [
    ("post", "/api/v1/people/balance/plan", {}),
    ("post", "/api/v1/people/balance/apply", {"moves": []}),
    ("post", "/api/v1/exceptions", {}),
    ("put", f"/api/v1/exceptions/{uuid.uuid4()}/escalate", {}),
    ("post", f"/api/v1/exceptions/{uuid.uuid4()}/comment", {}),
    ("post", "/api/v1/exceptions/rules", {}),
    ("put", f"/api/v1/exceptions/rules/{uuid.uuid4()}", {}),
    ("get", "/api/v1/exceptions/billing", None),
    ("get", "/api/v1/reports/schedules", None),
    ("post", "/api/v1/reports/schedules", {}),
    ("delete", f"/api/v1/reports/schedules/{uuid.uuid4()}", None),
    ("post", f"/api/v1/reports/schedules/{uuid.uuid4()}/run", None),
    ("post", f"/api/v1/jobs/{uuid.uuid4()}/cancel", None),
])
def test_viewer_gets_403(method, path, body):
    c = _client(balance, exceptions, report_library, jobs)
    r = getattr(c, method)(path, headers=VIEWER, **({"json": body} if body is not None else {}))
    assert r.status_code == 403, (path, r.status_code, r.text[:200])


def test_viewer_cannot_retry_a_failed_extraction(monkeypatch):
    """Retry checks the permission of the endpoint that started the job (trigger_sync for a download)."""
    sid = str(uuid.uuid4())
    monkeypatch.setattr(jobs.jobs, "get_job", lambda t, j: {"kind": "extraction", "status": "failed",
                                                            "system_id": sid, "retry": {"x": 1}})
    called = []
    monkeypatch.setitem(jobs.RETRY, "extraction", ("trigger_sync", lambda *a: called.append(a)))
    r = _client(jobs).post(f"/api/v1/jobs/{uuid.uuid4()}/retry", headers=VIEWER)
    assert r.status_code == 403 and not called


def test_scim_needs_its_bearer_token():
    from fastapi.responses import JSONResponse

    from api.services.scim import ScimError

    c = _client(scim)
    c.app.add_exception_handler(ScimError, lambda req, exc: JSONResponse({}, status_code=exc.status))
    c.app.dependency_overrides[scim._scim_limit] = lambda: None
    r = c.get("/scim/v2/Users", headers=VIEWER)
    assert r.status_code == 401
