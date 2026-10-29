"""An authenticated test client for the Meridian 2 endpoint tests: a tenant, a user id and a role per call."""
from __future__ import annotations

import uuid

from httpx import ASGITransport, AsyncClient

USER = "00000000-0000-0000-0000-0000000000b7"


def headers(role: str = "admin") -> dict:
    return {"X-User-Role": role, "Authorization": "Bearer test-token"}


def make_client(monkeypatch, tid: str, sub: str = USER):
    """(api.deps, client) for tenant ``tid`` signed in as user ``sub``. Call again with another ``sub`` to switch user:
    the patches replace each other, and the clients share one app."""
    from api import deps as api_deps
    from api.deps import Tenant, get_tenant
    from api.main import app

    monkeypatch.setattr("api.middleware.local_auth._load_jwt_secret", lambda: "test-secret")
    monkeypatch.setattr("api.middleware.local_auth.decode_access_token",
                        lambda token, secret: {"sub": sub, "email": f"{sub[:8]}@example.com", "role": "admin"})
    monkeypatch.setenv("MERIDIAN_DEV_ROLE_HEADER", "1")
    monkeypatch.setitem(app.dependency_overrides, get_tenant, lambda: Tenant(uuid.UUID(tid), "T", []))
    return api_deps, AsyncClient(transport=ASGITransport(app=app), base_url="http://test")
