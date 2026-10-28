"""GET /roles/matrix, GET /users/{id}/effective?with_grant= and the pure rbac.grant_diff.

grant_diff tests need no database. The route tests run against a real Postgres with MERIDIAN_TEST_DB_URL
(a throwaway database; see tests/test_rls_integration.py) and are skipped otherwise.
"""

from __future__ import annotations

import copy
import uuid
from typing import TYPE_CHECKING

import pytest

from api.services.rbac import (
    ACTIONS, PERMISSIONS, PERSONA_ROLES, RESOURCES, VALID_ROLES, EffectivePermissions, RoleRef, ScopeRef,
    grant_diff, permissions_for, resource_matrix,
)
from tests.test_rbac_escalation_pg import _grant, _seed_custom, _serve, _tenant, owner, pytestmark as _pg  # noqa: F401

if TYPE_CHECKING:
    from httpx import AsyncClient
    from sqlalchemy import Engine

SYS = str(uuid.uuid4())


def _ep(actions: set[str], roles: list[tuple[str, str | None, str | None]]) -> EffectivePermissions:
    return EffectivePermissions(
        role="viewer", roles=[RoleRef(key=k, name=k, system_id=s, module=m) for k, s, m in roles],
        actions=sorted(actions), resources=resource_matrix(actions),
        scopes=[ScopeRef(system_id=s, module=m) for _, s, m in roles if s or m], home="/home/lead")


VIEWER = _ep(set(permissions_for("viewer")), [("viewer", None, None)])


def test_grant_diff_unscoped_grant_adds_actions_pairs_and_tenant_wide_scope() -> None:
    after = _ep(set(permissions_for("viewer")) | set(permissions_for("data_steward")),
                [("viewer", None, None), ("data_steward", None, None)])
    d = grant_diff(VIEWER, after)
    assert {"approve", "apply", "assign", "manage_rules"} <= set(d["added_actions"])
    assert d["added_actions"] == sorted(d["added_actions"])
    assert ["fixes", "approve"] in d["added_pairs"] and ["fixes", "run"] in d["added_pairs"]
    assert d["added_pairs"] == sorted(d["added_pairs"])
    assert ["fixes", "view"] not in d["added_pairs"]  # already held
    assert d["widened_scopes"] == [{"system_id": None, "module": None}]


def test_grant_diff_scoped_grant_reports_the_new_scope() -> None:
    before = _ep(set(permissions_for("viewer")), [("viewer", None, None)])
    after = _ep(set(permissions_for("viewer")) | set(permissions_for("data_steward")),
                [("viewer", None, None), ("data_steward", SYS, "fi_gl")])
    assert grant_diff(before, after)["widened_scopes"] == [{"system_id": SYS, "module": "fi_gl"}]


def test_grant_diff_same_or_narrower_adds_nothing() -> None:
    assert grant_diff(VIEWER, VIEWER) == {"added_actions": [], "added_pairs": [], "widened_scopes": []}
    after = _ep(set(permissions_for("viewer")), [("viewer", None, None), ("viewer", SYS, None)])
    d = grant_diff(VIEWER, after)  # a scope is new even when it adds no action
    assert d["added_actions"] == [] and d["added_pairs"] == [] and d["widened_scopes"] == [{"system_id": SYS, "module": None}]
    # a smaller `after` is not a negative diff: removals are never reported
    big = _ep(set(permissions_for("data_steward")), [("data_steward", None, None)])
    d = grant_diff(big, VIEWER)
    assert d["added_actions"] == [] and d["added_pairs"] == []


def test_grant_diff_is_pure_and_deterministic() -> None:
    after = _ep(set(permissions_for("programme_lead")), [("viewer", None, None), ("programme_lead", SYS, None)])
    b, a = copy.deepcopy(VIEWER), copy.deepcopy(after)
    first = grant_diff(VIEWER, after)
    assert VIEWER == b and after == a  # inputs untouched
    assert grant_diff(VIEWER, after) == first
    first["added_actions"].append("x")  # the result is a fresh object each time
    assert "x" not in grant_diff(VIEWER, after)["added_actions"]


def test_manage_triage_is_in_the_matrix_as_stewardship_admin() -> None:
    assert resource_matrix({"manage_triage"})["stewardship"]["admin"] is True
    assert resource_matrix(set(permissions_for("viewer")))["stewardship"]["admin"] is False


# ── routes ───────────────────────────────────────────────────────────────────


def test_roles_matrix_route(owner: Engine, monkeypatch: pytest.MonkeyPatch) -> None:
    tid, u = _tenant(owner, {"padmin": "platform_admin", "viewer": "viewer"})
    _grant(owner, tid, u["padmin"], "platform_admin")
    _seed_custom(owner, tid, "custom:readers", {("findings", "view"), ("stewardship", "admin")})

    async def scenario(c: AsyncClient) -> None:
        assert (await c.get("/api/v1/roles/matrix", headers={"x-test-uid": u["viewer"]})).status_code == 403
        r = await c.get("/api/v1/roles/matrix", headers={"x-test-uid": u["padmin"]})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["resources"] == list(RESOURCES) and body["actions"] == list(ACTIONS)
        roles = {x["key"]: x for x in body["roles"]}
        assert set(VALID_ROLES) | {"custom:readers"} == set(roles)
        for key in (*PERMISSIONS, *PERSONA_ROLES):
            assert roles[key]["built_in"] is True
            assert roles[key]["legacy_actions"] == permissions_for(key)
            assert roles[key]["matrix"] == resource_matrix(set(permissions_for(key)))
            assert set(roles[key]["matrix"]) == set(RESOURCES)
            assert all(set(row) == set(ACTIONS) for row in roles[key]["matrix"].values())
        assert roles["admin"]["legacy"] is True and roles["programme_lead"]["legacy"] is False
        assert roles["programme_lead"]["matrix"]["stewardship"]["admin"] is True
        assert "manage_triage" in roles["programme_lead"]["legacy_actions"]
        assert roles["manager"]["matrix"]["stewardship"]["admin"] is False
        custom = roles["custom:readers"]
        assert custom["built_in"] is False and custom["name"] == "custom:readers"
        assert custom["matrix"]["findings"]["view"] and custom["matrix"]["stewardship"]["admin"]
        assert not custom["matrix"]["findings"]["edit"]
        assert "manage_triage" in custom["legacy_actions"]

    _serve(owner, monkeypatch, tid, scenario)


def test_effective_with_grant_previews_without_writing(owner: Engine, monkeypatch: pytest.MonkeyPatch) -> None:
    from sqlalchemy import text

    tid, u = _tenant(owner, {"padmin": "platform_admin", "target": "viewer"})
    _grant(owner, tid, u["padmin"], "platform_admin")
    _grant(owner, tid, u["target"], "viewer")
    sid = str(uuid.uuid4())
    with owner.begin() as c:
        c.execute(text("INSERT INTO sap_systems (id, tenant_id, name, system_type) VALUES (:s, :t, 'S', 'ECC')"), {"s": sid, "t": tid})

    def grants() -> int:
        with owner.connect() as c:
            return c.execute(text("SELECT count(*) FROM user_role_scopes WHERE tenant_id = :t"), {"t": tid}).scalar_one()

    async def scenario(c: AsyncClient) -> None:
        h = {"x-test-uid": u["padmin"]}
        path = f"/api/v1/users/{u['target']}/effective"
        n = grants()
        r = await c.get(path, params={"with_grant": "data_steward", "system_id": sid, "module": "fi_gl"}, headers=h)
        assert r.status_code == 200, r.text
        body = r.json()
        assert set(body) == {"before", "after", "diff"}
        assert "approve" not in body["before"]["actions"] and "approve" in body["after"]["actions"]
        assert body["before"]["resources"]["fixes"]["approve"] is False and body["after"]["resources"]["fixes"]["approve"] is True
        assert body["diff"]["widened_scopes"] == [{"system_id": sid, "module": "fi_gl"}]
        assert ["fixes", "approve"] in body["diff"]["added_pairs"]
        assert set(body["diff"]["added_actions"]) == set(body["after"]["actions"]) - set(body["before"]["actions"])
        assert grants() == n  # a preview writes nothing

        r = await c.get(path, params={"with_grant": "programme_lead"}, headers=h)  # unscoped
        assert r.json()["diff"]["widened_scopes"] == [{"system_id": None, "module": None}]
        assert "manage_triage" in r.json()["diff"]["added_actions"]

        r = await c.get(path, params={"with_grant": "custom:nope"}, headers=h)
        assert r.status_code == 404
        r = await c.get(path, params={"with_grant": "steward"}, headers=h)  # legacy keys cannot be granted
        assert r.status_code == 422
        r = await c.get(f"/api/v1/users/{uuid.uuid4()}/effective", params={"with_grant": "viewer"}, headers=h)
        assert r.status_code == 404

        # unchanged without with_grant: the /me/permissions shape, and a user may read their own
        r = await c.get(path, headers=h)
        assert r.status_code == 200 and {"role", "roles", "actions", "resources", "scopes", "home"} <= set(r.json())
        own = {"x-test-uid": u["target"]}
        assert (await c.get(path, headers=own)).status_code == 200
        assert (await c.get(path, params={"with_grant": "data_steward"}, headers=own)).status_code == 403  # preview is manage_users

    _serve(owner, monkeypatch, tid, scenario)
