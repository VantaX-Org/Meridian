"""Platform self-update — RBAC gate, version comparison, manifest passthrough.

Pure-function unit tests, no FastAPI TestClient/DB — matches the style of
test_licence_gating.py. Deliberately does NOT import api.routes.system_update
(it pulls in api.deps, which creates an async DB engine at import time) —
version comparison lives in api.services.version specifically so it stays
importable without a DB driver. The updater sidecar itself and the full
trigger/progress routes are exercised manually against a real stack (see the
implementation plan's verification section), not here.
"""

from api.middleware.licence import _update_manifest_cache
from api.services.rbac import has_permission
from api.services.version import is_newer, version_tuple


# ── RBAC gate ────────────────────────────────────────────────────────────────


def test_only_admin_has_manage_system():
    assert has_permission("admin", "manage_system") is True
    for role in ("manager", "viewer", "steward", "analyst", "approver", "auditor", "ai_reviewer"):
        assert has_permission(role, "manage_system") is False, f"{role} should not have manage_system"


# ── Version comparison ───────────────────────────────────────────────────────


def test_version_tuple_parses_with_and_without_v_prefix():
    assert version_tuple("1.2.3") == (1, 2, 3)
    assert version_tuple("v1.2.3") == (1, 2, 3)


def test_version_tuple_returns_none_on_malformed_input():
    assert version_tuple("not-a-version") is None
    assert version_tuple("") is None
    assert version_tuple(None) is None  # type: ignore[arg-type]


def test_is_newer_true_when_latest_ahead():
    assert is_newer("1.3.0", "1.2.9") is True
    assert is_newer("2.0.0", "1.9.9") is True


def test_is_newer_false_when_equal_or_behind():
    assert is_newer("1.2.3", "1.2.3") is False
    assert is_newer("1.2.0", "1.2.3") is False


def test_is_newer_false_when_latest_missing_or_unparseable():
    assert is_newer(None, "1.2.3") is False
    assert is_newer("garbage", "1.2.3") is False


# ── Manifest passthrough ─────────────────────────────────────────────────────


def test_manifest_cache_forwards_latest_version_and_release_notes():
    result = {
        "valid": True,
        "tenant_id": "t1",
        "latest_version": "9.9.9",
        "release_notes": "Bug fixes",
    }
    _update_manifest_cache(result)
    from api.middleware.licence import get_cached_manifest

    manifest = get_cached_manifest()
    assert manifest["latest_version"] == "9.9.9"
    assert manifest["release_notes"] == "Bug fixes"


def test_manifest_cache_tolerates_missing_version_fields():
    """A licence-worker response predating this feature (or a lookup that
    failed server-side) must not break manifest caching."""
    result = {"valid": True, "tenant_id": "t1"}
    _update_manifest_cache(result)
    from api.middleware.licence import get_cached_manifest

    manifest = get_cached_manifest()
    assert manifest["latest_version"] is None
    assert manifest["release_notes"] is None


# --- the release asked for is the release installed (register D-32) ---------------------------------------------

def test_updater_passes_the_requested_release_to_update_sh(monkeypatch):
    import asyncio

    from fastapi.testclient import TestClient

    import updater.main as sidecar

    started: list[tuple] = []

    class _Proc:
        returncode = 0

        async def wait(self) -> int:
            return 0

    async def fake_exec(*args, **kwargs):
        started.append(args)
        return _Proc()

    monkeypatch.setattr(sidecar, "SHARED_SECRET", "s3cret")
    monkeypatch.setattr(sidecar, "_process", None)
    monkeypatch.setattr(asyncio, "create_subprocess_exec", fake_exec)
    client = TestClient(sidecar.app)
    h = {"X-Updater-Secret": "s3cret"}
    assert client.post("/update", headers=h, json={"version": "2.4.1"}).status_code == 202
    assert started[-1] == ("bash", "scripts/update.sh", "--version", "2.4.1")
    monkeypatch.setattr(sidecar, "_process", None)
    assert client.post("/update", headers=h).status_code == 202  # no body: the script asks Meridian HQ itself
    assert started[-1] == ("bash", "scripts/update.sh")
    monkeypatch.setattr(sidecar, "_process", None)
    for bad in ("latest", "2.4", "2.4.1; rm -rf /", "--rollback"):
        assert client.post("/update", headers=h, json={"version": bad}).status_code == 422
    assert len(started) == 2


def test_api_asks_the_updater_for_hq_latest_version(monkeypatch):
    import asyncio

    from api.services import updater_client

    sent: dict = {}

    class _Resp:
        status_code = 202

        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict:
            return {"status": "started"}

    class _Client:
        def __init__(self, *a, **k) -> None:
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a) -> None:
            return None

        async def post(self, url, headers=None, json=None):
            sent.update(url=url, json=json)
            return _Resp()

    monkeypatch.setattr(updater_client.settings, "updater_shared_secret", "s3cret")
    monkeypatch.setattr(updater_client.httpx, "AsyncClient", _Client)
    assert asyncio.run(updater_client.trigger_update("2.4.1")) == {"status": "started"}
    assert sent["json"] == {"version": "2.4.1"} and sent["url"].endswith("/update")
    asyncio.run(updater_client.trigger_update())
    assert sent["json"] is None
