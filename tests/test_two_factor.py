"""Two-factor sign-in without a database: RFC 6238 codes, drift and replay, recovery codes, the pending
sign-in token, the set-up-only session in LocalAuthMiddleware and the per-identity rate limit.

The database flows (login in two steps, recovery codes spent once, the tenant requirement, an admin reset,
migration 094) are in tests/test_two_factor_pg.py.
"""

from __future__ import annotations

import base64
from typing import Iterator
from urllib.parse import parse_qs, urlparse

import pytest
from fastapi import HTTPException

from api.services import totp

# RFC 6238 appendix B: the SHA-1 seed is the ASCII string "12345678901234567890".
RFC_SECRET = base64.b32encode(b"12345678901234567890").decode()


@pytest.mark.parametrize(("unix_time", "eight_digits"), [
    (59, "94287082"), (1111111109, "07081804"), (1111111111, "14050471"),
    (1234567890, "89005924"), (2000000000, "69279037"),
])
def test_rfc6238_vectors(unix_time: int, eight_digits: str) -> None:
    # Six digits are the low six of the RFC's eight (the same truncated value, mod 10^6).
    assert totp.code_at(RFC_SECRET, totp.current_step(unix_time)) == eight_digits[-6:]


def test_accepts_one_step_of_drift_either_way() -> None:
    now = 1_700_000_000.0
    step = totp.current_step(now)
    for offset in (-1, 0, 1):
        assert totp.matching_step(RFC_SECRET, totp.code_at(RFC_SECRET, step + offset), now=now) == step + offset
    for offset in (-2, 2):
        assert totp.matching_step(RFC_SECRET, totp.code_at(RFC_SECRET, step + offset), now=now) is None


def test_replay_of_the_same_step_is_refused() -> None:
    now = 1_700_000_000.0
    step = totp.current_step(now)
    code = totp.code_at(RFC_SECRET, step)
    assert totp.matching_step(RFC_SECRET, code, now=now, last_step=None) == step
    # Once step was accepted, neither it nor an earlier step is accepted again; the next one is.
    assert totp.matching_step(RFC_SECRET, code, now=now, last_step=step) is None
    assert totp.matching_step(RFC_SECRET, totp.code_at(RFC_SECRET, step - 1), now=now, last_step=step) is None
    assert totp.matching_step(RFC_SECRET, totp.code_at(RFC_SECRET, step + 1), now=now, last_step=step) == step + 1


def test_code_input_is_forgiving_about_spaces_but_not_length() -> None:
    now = 1_700_000_000.0
    code = totp.code_at(RFC_SECRET, totp.current_step(now))
    assert totp.matching_step(RFC_SECRET, f"{code[:3]} {code[3:]}", now=now) is not None
    assert totp.matching_step(RFC_SECRET, code[:5], now=now) is None
    assert totp.matching_step(RFC_SECRET, "abcdef", now=now) is None


def test_generated_secret_and_provisioning_uri() -> None:
    secret = totp.generate_secret()
    assert len(base64.b32decode(secret + "=" * (-len(secret) % 8))) == 20
    uri = urlparse(totp.provisioning_uri(secret, "ana@example.test"))
    assert uri.scheme == "otpauth" and uri.netloc == "totp"
    assert uri.path == "/Meridian%3Aana%40example.test"
    q = parse_qs(uri.query)
    assert q["secret"] == [secret] and q["issuer"] == ["Meridian"] and q["digits"] == ["6"] and q["period"] == ["30"]


def test_recovery_codes_are_distinct_formatted_and_hash_normalised() -> None:
    codes = totp.generate_recovery_codes()
    assert len(codes) == 10 and len(set(codes)) == 10
    for c in codes:
        assert len(c) == 19 and c.count("-") == 3 and totp.looks_like_recovery_code(c)
    c = codes[0]
    assert totp.hash_recovery_code(c) == totp.hash_recovery_code(c.lower().replace("-", " "))
    assert not totp.looks_like_recovery_code("123456")


def test_secret_round_trips_through_the_credential_store(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CREDENTIAL_MASTER_KEY", "unit-test-master-key")
    tid = "00000000-0000-0000-0000-000000000001"
    stored = totp.encrypt_secret(tid, RFC_SECRET)
    assert RFC_SECRET not in stored
    assert totp.decrypt_secret(tid, stored) == RFC_SECRET


def test_missing_master_key_is_503_not_500(monkeypatch: pytest.MonkeyPatch) -> None:
    from api.services import two_factor

    monkeypatch.delenv("CREDENTIAL_MASTER_KEY", raising=False)
    with pytest.raises(HTTPException) as e:
        two_factor.encrypt_secret_or_503("00000000-0000-0000-0000-000000000001", RFC_SECRET)
    assert e.value.status_code == 503


def test_pending_token_is_short_lived_and_not_a_session() -> None:
    from api.services.local_auth import create_mfa_pending_token, decode_access_token

    secret = "pending-token-secret-of-32-bytes!!"
    payload = decode_access_token(create_mfa_pending_token("u1", "t1", secret, 3), secret)
    assert payload["purpose"] == "mfa_pending" and payload["tv"] == 3
    assert payload["exp"] - payload["iat"] == 5 * 60


# ── LocalAuthMiddleware: a session that may only set up two-factor sign-in ──────────────────────────

SECRET = "enrol-only-test-secret-of-32-bytes!"
UID = "6d1f0a3e-9d1b-4a8e-8f5e-2b6f3c1d7a90"


@pytest.fixture
def guarded(monkeypatch: pytest.MonkeyPatch) -> Iterator[object]:
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    import api.middleware.local_auth as mw

    monkeypatch.setattr(mw, "_load_jwt_secret", lambda: SECRET)
    monkeypatch.setattr(mw, "_current_token_version", lambda _u, _t: 0)
    app = FastAPI()

    @app.get("/api/v1/ping")
    def ping() -> dict[str, bool]:
        return {"ok": True}

    @app.post("/api/v1/auth/2fa/setup")
    def setup() -> dict[str, bool]:
        return {"ok": True}

    app.add_middleware(mw.LocalAuthMiddleware)
    yield TestClient(app)


def _session(enrol: bool) -> str:
    from api.services.local_auth import create_access_token

    return create_access_token(UID, "00000000-0000-0000-0000-000000000001", "u@example.test", "viewer", SECRET,
                               mfa_enrol=enrol)


def test_enrol_only_session_reaches_only_set_up(guarded) -> None:
    restricted = {"Authorization": f"Bearer {_session(True)}"}
    r = guarded.get("/api/v1/ping", headers=restricted)
    assert r.status_code == 403 and r.json()["error"] == "mfa_enrol_required"
    assert guarded.post("/api/v1/auth/2fa/setup", headers=restricted).status_code == 200
    assert guarded.get("/api/v1/ping", headers={"Authorization": f"Bearer {_session(False)}"}).status_code == 200


def test_pending_token_is_refused_as_a_session(guarded) -> None:
    from api.services.local_auth import create_mfa_pending_token

    token = create_mfa_pending_token(UID, "00000000-0000-0000-0000-000000000001", SECRET, 0)
    assert guarded.get("/api/v1/ping", headers={"Authorization": f"Bearer {token}"}).status_code == 401


def test_second_step_route_is_open_to_the_unauthenticated() -> None:
    import api.middleware.local_auth as mw

    assert "/api/v1/auth/login/2fa" in mw._EXCLUDED_PATHS


# ── per-identity rate limit ─────────────────────────────────────────────────────────────────────────

class _FakeRedis:
    def __init__(self) -> None:
        self.counts: dict[str, int] = {}

    def incr(self, key: str) -> int:
        self.counts[key] = self.counts.get(key, 0) + 1
        return self.counts[key]

    def expire(self, _key: str, _s: int) -> None:
        return None


def test_limit_identity_counts_per_identity(monkeypatch: pytest.MonkeyPatch) -> None:
    import api.services.rate_limiter as rl

    fake = _FakeRedis()
    monkeypatch.setattr(rl, "get_redis", lambda: fake)
    for _ in range(5):
        rl.limit_identity("t", "user-a", limit=5, window_s=300)
    with pytest.raises(HTTPException) as e:
        rl.limit_identity("t", "user-a", limit=5, window_s=300)
    assert e.value.status_code == 429
    rl.limit_identity("t", "user-b", limit=5, window_s=300)  # someone else is not affected
