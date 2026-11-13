"""Every route in the app carries a permission dependency (require_permission / require_any_permission).

A route without one ignores scoped grants: a custom role limited to one system or module could read every record.
New routes must add a guard, or join the allowlist below with a comment saying why they are public or self-only."""

import uuid

import pytest
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient

from api.main import app

# (method, path) pairs that are deliberately reachable without a permission dependency.
ALLOWLIST = {
    # Liveness and readiness probes for the orchestrator; no tenant data.
    ("GET", "/health"),
    ("GET", "/health/live"),
    ("GET", "/health/llm"),
    # Prometheus scrape endpoint, process metrics only (restrict at the proxy).
    ("GET", "/metrics"),
    # Sign-in and account recovery: the caller has no session yet, or acts on their own account only.
    ("POST", "/api/v1/auth/login"),
    ("GET", "/api/v1/auth/me"),
    ("POST", "/api/v1/auth/change-password"),
    ("POST", "/api/v1/auth/logout"),
    ("POST", "/api/v1/auth/accept-invite"),
    ("POST", "/api/v1/auth/invite/preview"),
    ("POST", "/api/v1/auth/forgot-password"),
    ("POST", "/api/v1/auth/reset-password"),
    # SSO: config, start and the identity provider's callback run before a session exists.
    ("GET", "/api/v1/auth/oidc/config"),
    ("GET", "/api/v1/auth/oidc/start"),
    ("GET", "/api/v1/auth/oidc/callback"),
    # Public assets shown on the sign-in page and the status page (public in LocalAuthMiddleware too).
    ("GET", "/api/v1/theme"),
    ("GET", "/api/v1/theme/logo"),
    ("GET", "/api/v1/status/page"),
    ("GET", "/api/v1/licence"),
    # The caller's own effective permissions; the frontend needs it to decide what to show.
    ("GET", "/api/v1/me/permissions"),
}
# SCIM authenticates the identity provider with its own bearer token (scim_context), not a user session.
SCIM_PREFIX = "/scim/v2/"


def _dependency_names(dependant, out):
    for d in dependant.dependencies:
        out.append(getattr(d.call, "__qualname__", repr(d.call)))
        _dependency_names(d, out)
    return out


def _guarded(names):
    return any("require_permission" in n or "require_any_permission" in n for n in names)


def test_every_route_has_a_permission_dependency():
    missing = []
    for route in app.routes:
        if not isinstance(route, APIRoute):
            continue
        names = _dependency_names(route.dependant, [])
        if route.path.startswith(SCIM_PREFIX):
            assert any("scim_context" in n for n in names), f"{route.path} lacks the SCIM bearer check"
            continue
        if _guarded(names):
            continue
        if all((m, route.path) in ALLOWLIST for m in route.methods):
            continue
        missing.append(f"{sorted(route.methods)} {route.path} ({route.endpoint.__module__})")
    assert not missing, "Routes without a permission dependency:\n" + "\n".join(missing)


def test_allowlist_has_no_stale_entries():
    live = {(m, r.path) for r in app.routes if isinstance(r, APIRoute) for m in r.methods}
    assert ALLOWLIST <= live, f"Allowlist names routes that no longer exist: {sorted(ALLOWLIST - live)}"


@pytest.fixture
def _dev_roles(monkeypatch):
    monkeypatch.setenv("MERIDIAN_DEV_ROLE_HEADER", "1")


def test_viewer_cannot_read_another_stewards_metrics(_dev_roles):
    from fastapi import FastAPI

    from api.deps import Tenant, get_tenant
    from api.routes import analytics

    api = FastAPI()
    api.include_router(analytics.router)
    api.dependency_overrides[get_tenant] = lambda: Tenant(uuid.uuid4(), "D", [])
    client = TestClient(api, raise_server_exceptions=False)
    paths = [r.path for r in analytics.router.routes if r.path.endswith("/team/{user_id}")]
    assert paths
    r = client.get(paths[0].replace("{user_id}", str(uuid.uuid4())), headers={"X-User-Role": "viewer"})
    assert r.status_code == 403
