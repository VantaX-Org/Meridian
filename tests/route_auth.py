"""Shared auth bypass for route tests that hit the live api.main.app over real Postgres.

Overrides get_tenant on the live app and turns on the dev role-header escape hatch
(api/services/rbac.py:dev_role_override), the same two-part mechanism
tests/test_material_360_routes.py uses for api.routes.materials.

The real app also runs LocalAuthMiddleware (api/middleware/local_auth.py) ahead of
FastAPI dependency injection, since AUTH_MODE defaults to "local" — it 401s before the
get_tenant override ever runs. tests/test_pyrfc_connector.py establishes the pattern
for bypassing it: stub the two module-level functions it calls on every request and
send a Bearer token so it takes the decode path. monkeypatch reverts everything at
test teardown, so nothing leaks between tests.
"""
import uuid

HEADERS = {"X-User-Role": "steward", "Authorization": "Bearer test-token"}


def patch_tenant(monkeypatch, tenant_id: str) -> None:
    from api.deps import Tenant, get_tenant
    from api.main import app

    monkeypatch.setattr("api.middleware.local_auth._load_jwt_secret", lambda: "test-secret")
    monkeypatch.setattr(
        "api.middleware.local_auth.decode_access_token",
        lambda token, secret: {
            "sub": "00000000-0000-0000-0000-000000000002",
            "email": "dev@example.com",
            "role": "admin",
        },
    )
    monkeypatch.setenv("MERIDIAN_DEV_ROLE_HEADER", "1")
    monkeypatch.setitem(
        app.dependency_overrides, get_tenant,
        lambda: Tenant(uuid.UUID(tenant_id), "T", []),
    )
