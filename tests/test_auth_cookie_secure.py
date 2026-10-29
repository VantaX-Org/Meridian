"""The sign-in cookie is Secure only on HTTPS: a Secure cookie on a plain http:// install is never stored, so the
help centre's videos (a <video> cannot send a bearer header) were refused and the player hid itself."""
import pytest
from starlette.requests import Request

from api.routes.auth import cookie_secure


def _req(scheme: str = "http", proto: str | None = None) -> Request:
    headers = [(b"x-forwarded-proto", proto.encode())] if proto else []
    return Request({"type": "http", "scheme": scheme, "headers": headers, "path": "/", "server": ("h", 80)})


@pytest.mark.parametrize(("scheme", "proto", "secure"), [
    ("http", None, False),        # plain http straight to the API
    ("http", "http", False),      # nginx on port 80
    ("http", "https", True),      # nginx terminating TLS
    ("https", None, True),
])
def test_follows_the_address_the_browser_used(monkeypatch, scheme, proto, secure):
    monkeypatch.delenv("AUTH_COOKIE_SECURE", raising=False)
    assert cookie_secure(_req(scheme, proto)) is secure


@pytest.mark.parametrize(("forced", "secure"), [("true", True), ("false", False)])
def test_env_still_forces_it(monkeypatch, forced, secure):
    monkeypatch.setenv("AUTH_COOKIE_SECURE", forced)
    assert cookie_secure(_req("http", "https" if not secure else None)) is secure
