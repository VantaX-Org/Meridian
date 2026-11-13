"""AUTH_MODE can never boot the API without its auth middleware: local and oidc both run LocalAuthMiddleware,
anything else refuses to start. No database: the middleware answers 401 before any route or DB access."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from api.config import Settings


@pytest.mark.parametrize("mode", ["local", "oidc", " LOCAL ", "Oidc"])
def test_supported_modes_normalise_to_local(mode: str) -> None:
    assert Settings(auth_mode=mode).auth_mode == "local"


@pytest.mark.parametrize("mode", ["clerk", "none", "off", "", "disabled"])
def test_unknown_mode_refuses_to_start(mode: str) -> None:
    with pytest.raises(ValidationError, match="AUTH_MODE"):
        Settings(auth_mode=mode)


def test_auth_middleware_is_always_mounted() -> None:
    import api.main
    from api.middleware.local_auth import LocalAuthMiddleware

    assert any(m.cls is LocalAuthMiddleware for m in api.main.app.user_middleware)


@pytest.mark.parametrize("mode", ["local", "oidc"])
@pytest.mark.parametrize("path", ["/api/v1/users", "/api/v1/roles", "/api/v1/auth/me"])
def test_unauthenticated_protected_route_is_401(mode: str, path: str, monkeypatch: pytest.MonkeyPatch) -> None:
    import api.main
    from api.config import settings

    monkeypatch.setattr(settings, "auth_mode", Settings(auth_mode=mode).auth_mode)
    client = TestClient(api.main.app)  # no lifespan: no DB, no startup seeding
    r = client.get(path)
    assert r.status_code == 401, (path, r.status_code, r.text)


def test_identity_flags_email_verified_only_when_asserted() -> None:
    from api.services.oidc import identity_from_claims

    base = {"sub": "s-1", "email": "sam@corp.test"}
    assert identity_from_claims({**base, "email_verified": True})["email_verified"] is True
    assert identity_from_claims({**base, "email_verified": "true"})["email_verified"] is True
    assert identity_from_claims(base)["email_verified"] is False
    assert identity_from_claims({**base, "email_verified": "yes"})["email_verified"] is False
