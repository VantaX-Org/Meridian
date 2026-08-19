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
