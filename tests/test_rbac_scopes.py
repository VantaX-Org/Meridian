"""Scoped grants, resource x action model, /me/permissions shape, migration shape."""

import asyncio
import uuid
from types import SimpleNamespace
from typing import Optional

import pytest
from fastapi import HTTPException

from api.deps import Tenant
from api.services import rbac
from api.services.rbac import (
    ACTIONS, LEGACY_ACTION_MAP, RESOURCES, Scope, has_permission_scoped, legacy_actions_for_pairs,
    resource_matrix,
)

SYS_A, SYS_B = uuid.uuid4(), uuid.uuid4()


def test_scope_matching_is_null_safe() -> None:
    assert has_permission_scoped([("data_steward", Scope())], "approve", Scope(SYS_A, "material_master"))
    assert has_permission_scoped([("data_steward", Scope(SYS_A))], "approve", Scope(SYS_A, "x"))
    assert not has_permission_scoped([("data_steward", Scope(SYS_A))], "approve", Scope(SYS_B))
    assert not has_permission_scoped([("data_steward", Scope(SYS_A, "material_master"))], "approve",
                                     Scope(SYS_A, "employee_central"))
    assert not has_permission_scoped([("viewer", Scope())], "approve", Scope(SYS_A))


def test_union_over_grants() -> None:
    grants = [("viewer", Scope()), ("data_owner", Scope(SYS_A))]
    assert has_permission_scoped(grants, "approve", Scope(SYS_A))
    assert not has_permission_scoped(grants, "approve", Scope(SYS_B))
    assert has_permission_scoped(grants, "view", Scope(SYS_B))


def test_legacy_action_map_covers_every_action_and_uses_known_names() -> None:
    all_actions = {a for acts in rbac.PERMISSIONS.values() for a in acts} | set(rbac.PERSONA_ROLES["sap_basis"])
    assert all_actions <= set(LEGACY_ACTION_MAP)
    for pairs in LEGACY_ACTION_MAP.values():
        for res, act in pairs:
            assert res in (*RESOURCES, "*") and act in ACTIONS


def test_resource_matrix_viewer_vs_steward() -> None:
    viewer = resource_matrix(set(rbac.permissions_for("viewer")))
    assert viewer["mdm"]["view"] and not viewer["mdm"]["edit"]
    assert not viewer["audit"]["view"] and not viewer["users"]["admin"]
    steward = resource_matrix(set(rbac.permissions_for("data_steward")))
    assert steward["fixes"]["approve"] and steward["rules"]["create"]
    assert not steward["users"]["admin"]


def test_custom_role_pairs_round_trip_to_legacy_actions() -> None:
    pairs = {(r, a) for r, acts in resource_matrix(set(rbac.permissions_for("approver"))).items()
             for a, ok in acts.items() if ok}
    assert legacy_actions_for_pairs(pairs) >= set(rbac.permissions_for("approver"))
    assert "manage_users" not in legacy_actions_for_pairs(pairs)


# ── require_permission dependency (fake DB) ──────────────────────────────────


class _Res:
    def __init__(self, rows: list[tuple]) -> None:
        self.rows = rows

    def fetchall(self) -> list[tuple]:
        return self.rows

    def fetchone(self) -> Optional[tuple]:
        return self.rows[0] if self.rows else None


class FakeDB:
    def __init__(self, grants: list[tuple]) -> None:
        self.grants = grants

    async def execute(self, stmt, params=None) -> _Res:  # noqa: ANN001
        return _Res(self.grants if "user_role_scopes" in str(stmt) else [])


def _run(action: str, user_role: str, grants: list[tuple], scope: Optional[Scope] = None,
         resource: Optional[str] = None):
    async def fake_role(*_a, **_k) -> str:
        return user_role

    dep = rbac.require_permission(action, resource=resource, scope=(lambda _r: scope) if scope else None)
    req = SimpleNamespace(state=SimpleNamespace(local_user_id="u1"), headers={})
    orig = rbac._get_user_role
    rbac._get_user_role = fake_role  # type: ignore[assignment]
    try:
        return asyncio.run(dep(req, Tenant(id=uuid.uuid4(), name="t", licensed_modules=[]), FakeDB(grants)))  # type: ignore[arg-type]
    finally:
        rbac._get_user_role = orig  # type: ignore[assignment]


def test_legacy_call_unchanged_for_denied_and_allowed() -> None:
    assert _run("view", "viewer", []) == "viewer"
    with pytest.raises(HTTPException) as e:
        _run("approve", "viewer", [])
    assert e.value.status_code == 403
    assert e.value.detail == "Role 'viewer' does not have 'approve' permission"


def test_scoped_grant_does_not_widen_tenant_wide_check() -> None:
    with pytest.raises(HTTPException):
        _run("approve", "viewer", [("data_owner", SYS_A, None)])


def test_unscoped_grant_allows_tenant_wide_check() -> None:
    assert _run("approve", "viewer", [("data_owner", None, None)]) == "viewer"


def test_scoped_check_denies_cross_system_with_request_access() -> None:
    grants = [("data_steward", SYS_A, None)]
    assert _run("approve", "viewer", grants, Scope(SYS_A), "fixes") == "viewer"
    with pytest.raises(HTTPException) as e:
        _run("approve", "viewer", grants, Scope(SYS_B), "fixes")
    assert e.value.status_code == 403
    assert e.value.detail == {"detail": "forbidden", "resource": "fixes", "action": "approve",
                              "request_access": True}


def test_scoped_check_falls_back_to_users_role_when_no_grants() -> None:
    assert _run("approve", "steward", [], Scope(SYS_B)) == "steward"
    with pytest.raises(HTTPException):
        _run("approve", "viewer", [], Scope(SYS_B))


# ── /me/permissions shape ────────────────────────────────────────────────────


def test_effective_permissions_shape_and_narrowing() -> None:
    db = FakeDB([("data_owner", SYS_A, "material_master")])
    tid = uuid.uuid4()
    wide = asyncio.run(rbac.effective_permissions(db, tid, "u1", "viewer"))  # type: ignore[arg-type]
    assert set(wide) == {"role", "roles", "actions", "resources", "scopes", "home"}
    assert wide["home"] == "/home/lead" and "approve" in wide["actions"]
    assert wide["scopes"] == [{"system_id": str(SYS_A), "module": "material_master"}]
    assert wide["resources"]["fixes"]["approve"] is True
    assert set(wide["resources"]) == set(RESOURCES)
    other = asyncio.run(rbac.effective_permissions(db, tid, "u1", "viewer", SYS_B, None,  # type: ignore[arg-type]
                                                   narrowed=True))
    assert "approve" not in other["actions"] and other["resources"]["fixes"]["approve"] is False
    inside = asyncio.run(rbac.effective_permissions(db, tid, "u1", "viewer", SYS_A, "material_master",  # type: ignore[arg-type]
                                                    narrowed=True))
    assert "approve" in inside["actions"]


def test_home_for_persona_and_legacy_keys() -> None:
    assert rbac.home_for("sap_basis") == "/home/basis"
    assert rbac.home_for("steward") == "/home/steward" and rbac.home_for("manager") == "/home/lead"
    assert rbac.home_for("data_owner") == "/home/steward"


def test_migration_077_chains_from_076() -> None:
    import importlib.util
    from pathlib import Path
    path = Path(__file__).resolve().parent.parent / "db/migrations/versions/077_rbac_scopes.py"
    spec = importlib.util.spec_from_file_location("m077", path)
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    assert (mod.revision, mod.down_revision) == ("077", "076")
