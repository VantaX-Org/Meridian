"""Role x route matrix for the sensitive routes: admin, platform (manage_system, the nearest thing to a
superadmin; no role of that name exists), export, import, purge, versions delete, users and licence.

Three layers:
- static: every route in api.main is read for the actions its require_permission / require_any_permission
  dependencies ask for, so a missing or weakened guard fails here without a database;
- HTTP: each sensitive route is called once per built-in role through the real dependency (dev role header,
  fake database), and a role without the action must get 403 before the handler runs;
- tenant isolation: the purge token and the version lookup are keyed by the caller's tenant, so a second
  tenant gets 404.

The Postgres-backed grant and RLS paths are covered by tests/test_rbac_escalation_pg.py."""

from __future__ import annotations

import inspect
import re
import uuid
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient

from api.deps import Tenant, get_db, get_tenant
from api.services.rbac import VALID_ROLES, has_permission

MUTATING = {"POST", "PUT", "PATCH", "DELETE"}

# (method, path, action the route must require). The roles allowed are exactly those holding the action.
SENSITIVE: list[tuple[str, str, str]] = [
    # users and access
    ("POST", "/api/v1/users/invite", "manage_users"),
    ("POST", "/api/v1/users/bulk", "manage_users"),
    ("POST", "/api/v1/users/import/preview", "manage_users"),
    ("POST", "/api/v1/users/import", "manage_users"),
    ("PUT", "/api/v1/users/{user_id}", "manage_users"),
    ("DELETE", "/api/v1/users/{user_id}", "manage_users"),
    ("POST", "/api/v1/users/{user_id}/grants", "manage_users"),
    ("DELETE", "/api/v1/users/{user_id}/grants/{grant_id}", "manage_users"),
    ("POST", "/api/v1/admin/api-keys", "manage_users"),
    ("DELETE", "/api/v1/admin/api-keys/{key_id}", "manage_users"),
    ("PUT", "/api/v1/admin/sso", "manage_users"),
    # platform (superadmin): licence, sandbox, SCIM token
    ("POST", "/api/v1/licence/validate", "manage_system"),
    ("POST", "/api/v1/admin/sandbox/enter", "manage_system"),
    ("POST", "/api/v1/admin/sandbox/exit", "manage_system"),
    ("POST", "/api/v1/admin/scim/token", "manage_system"),
    # purge and delete
    ("POST", "/api/v1/admin/purge-tenant", "manage_settings"),
    ("DELETE", "/api/v1/versions/{version_id}", "manage_settings"),
    # admin imports and exports
    ("POST", "/api/v1/admin/config-bundle/import", "manage_settings"),
    ("POST", "/api/v1/admin/subject-requests/export", "manage_settings"),
    ("POST", "/api/v1/rules/bulk/import", "manage_rules"),
    # data imports and exports
    ("POST", "/api/v1/upload", "upload"),
    ("POST", "/api/v1/work/import", "apply"),
    ("POST", "/api/v1/export/grid", "export"),
    ("POST", "/api/v1/reports/exports", "export"),
    # queue state (a viewer passed this before; see the stewardship fix)
    ("PUT", "/api/v1/stewardship/{item_id}/escalate", "approve"),
]

# Mutating routes a viewer may call, each with its reason: self-scoped (own preferences, notifications, views,
# comments, delegations), read-only POSTs (previews, dry runs, lookups), sign-in, SCIM (bearer token), or an
# in-handler check (jobs retry, rule transition, certificates, assignment-template apply, data-request submit).
VIEWER_MUTATION_OK = {
    "findings.save_view", "findings.delete_saved_view", "cleaning.dedup_preview", "record_issues.bulk_update",
    "work.decide", "learned_monitors.explain", "notifications.mark_notification_read",
    "notifications.mark_all_read", "me.create_access_request", "preferences.patch_preferences",
    "me_notifications.send_test_notification", "merge_explain.match_tuning_dry_run",
    "insight_feedback.submit_insight_feedback", "client_errors.report_client_error", "glossary.batch_lookup",
    "rules.transition_version", "insights.mark_acted", "assistant.ask", "jobs.retry_job", "simulate.simulate_fix",
    "wave_certificates.issue_certificate", "wave_certificates.sign_certificate",
    "survivorship_rules.preview_survivorship_rules", "actions.undo_action", "views.put_view", "views.delete_view",
    "scim.create_user", "scim.replace_user", "scim.patch_user", "scim.delete_user", "scim.create_group",
    "scim.replace_group", "scim.patch_group", "scim.delete_group", "admin_tools.stop_view_as",
    "collab.add_comment", "collab.delete_comment", "collab.put_watch", "collab.delete_watch",
    "collab.put_subscriptions", "delegations.create", "delegations.revoke", "workflows.validate_definition",
    "change_requests.add_comment", "change_requests.export_request", "share_links.revoke_link",
    "stewardship_template.apply_template", "data_collection.submit_values",
    "auth.login", "auth.refresh", "auth.change_password", "auth.logout", "auth.accept_invite",
    "auth.invite_preview", "auth.forgot_password", "auth.reset_password",
}


# ── static: the actions each route's dependencies require ────────────────────

def _actions(call: Any) -> list[str]:
    try:
        nl = inspect.getclosurevars(call).nonlocals
    except (TypeError, ValueError):
        return []
    if "action" in nl:
        return [nl["action"]]
    if "checks" in nl:  # require_any_permission
        return [a for c in nl["checks"] for a in _actions(c)]
    return []


def _guards(dependant: Any, acc: list[frozenset[str]]) -> list[frozenset[str]]:
    """Each entry is one any-of guard; a role passes the route when it passes every entry."""
    for sub in dependant.dependencies:
        if sub.call is not None and inspect.isfunction(sub.call):
            acts = _actions(sub.call)
            if acts:
                acc.append(frozenset(acts))
        _guards(sub, acc)
    return acc


@pytest.fixture(scope="module")
def route_guards() -> dict[tuple[str, str], tuple[str, list[frozenset[str]]]]:
    from api.main import app

    out: dict[tuple[str, str], tuple[str, list[frozenset[str]]]] = {}
    for r in app.routes:
        if isinstance(r, APIRoute):
            fn = r.endpoint.__module__.replace("api.routes.", "") + "." + r.endpoint.__name__
            for m in r.methods - {"HEAD"}:
                out[(m, r.path)] = (fn, _guards(r.dependant, []))
    return out


def _passes(role: str, guards: list[frozenset[str]]) -> bool:
    return all(any(has_permission(role, a) for a in g) for g in guards)


@pytest.mark.parametrize("method,path,action", SENSITIVE)
def test_sensitive_route_allows_exactly_the_roles_holding_its_action(route_guards, method, path, action):
    assert (method, path) in route_guards, f"{method} {path} is not registered"
    _, guards = route_guards[(method, path)]
    allowed = {r for r in VALID_ROLES if _passes(r, guards)}
    assert allowed == {r for r in VALID_ROLES if has_permission(r, action)}, (method, path, sorted(allowed))
    assert "viewer" not in allowed


def test_platform_routes_are_out_of_reach_of_every_tenant_role(route_guards):
    """manage_system is the superadmin line: only admin and platform_admin cross it."""
    platform = [k for k, (_, g) in route_guards.items() if any(g_ == {"manage_system"} for g_ in g)]
    assert len(platform) >= 4
    for key in platform:
        _, guards = route_guards[key]
        assert {r for r in VALID_ROLES if _passes(r, guards)} == {"admin", "platform_admin"}, key


def test_viewer_mutates_nothing_outside_the_reviewed_list(route_guards):
    leaks = sorted(f"{m} {p} {fn}" for (m, p), (fn, g) in route_guards.items()
                   if m in MUTATING and _passes("viewer", g) and fn not in VIEWER_MUTATION_OK)
    assert leaks == []


def test_admin_and_users_writes_need_a_manage_action(route_guards):
    """Every write under /admin and /users asks for a manage_* action (view-as stop and the assignment template
    apply are viewer-safe and checked in the handler)."""
    loose = []
    for (m, p), (fn, guards) in route_guards.items():
        if m not in MUTATING or not re.match(r"/api/v1/(admin|users)(/|$)", p) or fn in VIEWER_MUTATION_OK:
            continue
        if not any(all(a.startswith("manage_") or a == "run_process_discovery" for a in g) for g in guards):
            loose.append(f"{m} {p} {fn} {[sorted(g) for g in guards]}")
    assert loose == []


# ── HTTP: the real dependency refuses before the handler runs ────────────────

class _NoDB:
    async def execute(self, *_a: Any, **_k: Any) -> Any:
        raise RuntimeError("no database in this test")

    async def commit(self) -> None:
        pass

    async def rollback(self) -> None:
        pass


TENANT_A = uuid.uuid4()
TENANT_B = uuid.uuid4()


def _app(monkeypatch: pytest.MonkeyPatch, tenant: list[uuid.UUID]) -> TestClient:
    from api.routes import (admin_tools, api_keys, auth_oidc, grid_export, licence, report_library, retention,
                            roles, sandbox, scim_admin, stewardship, subject_requests, upload, users, work)

    monkeypatch.setenv("MERIDIAN_DEV_ROLE_HEADER", "1")

    async def _hq_down() -> tuple[None, str]:  # never call Meridian HQ from a test
        return None, "unreachable"

    monkeypatch.setattr(licence.licence_mw, "revalidate", _hq_down)
    app = FastAPI()
    for router in (users.router, roles.router, api_keys.router, auth_oidc.admin_router, licence.router,
                   sandbox.router, scim_admin.router, retention.router, admin_tools.router, upload.router,
                   work.router, grid_export.router, report_library.router, stewardship.router, subject_requests.router):
        app.include_router(router)

    async def _db():
        yield _NoDB()

    app.dependency_overrides[get_db] = _db
    app.dependency_overrides[get_tenant] = lambda: Tenant(tenant[0], "T", [])
    return TestClient(app, raise_server_exceptions=False)


def _url(path: str) -> str:
    return re.sub(r"\{[a-z_]+\}", str(uuid.uuid4()), path)


@pytest.mark.parametrize("method,path,action", SENSITIVE)
def test_sensitive_route_role_matrix_over_http(monkeypatch, method, path, action):
    client = _app(monkeypatch, [TENANT_A])
    url = _url(path)
    for role in sorted(VALID_ROLES):
        r = client.request(method, url, json={}, headers={"X-User-Role": role})
        if has_permission(role, action):
            assert r.status_code != 403, (role, method, path, r.text)
        else:
            assert r.status_code == 403, (role, method, path, r.status_code, r.text)


# ── tenant isolation ─────────────────────────────────────────────────────────

class _Redis:
    def __init__(self) -> None:
        self.kv: dict[str, str] = {}

    def setex(self, k: str, _ttl: int, v: str) -> None:
        self.kv[k] = v

    def get(self, k: str) -> str | None:
        return self.kv.get(k)

    def delete(self, k: str) -> None:
        self.kv.pop(k, None)

    def incr(self, k: str) -> int:
        self.kv[k] = str(int(self.kv.get(k, "0")) + 1)
        return int(self.kv[k])

    def expire(self, *_a: Any) -> None:
        pass

    def ttl(self, *_a: Any) -> int:
        return 60


def test_purge_token_from_one_tenant_is_unknown_to_another(monkeypatch):
    from api.routes import retention

    redis = _Redis()
    monkeypatch.setattr(retention, "get_redis", lambda: redis)
    tenant = [TENANT_A]
    client = _app(monkeypatch, tenant)
    admin = {"X-User-Role": "admin"}
    r = client.post("/api/v1/admin/purge-tenant", json={}, headers=admin)
    assert r.status_code == 200, r.text
    token = r.json()["token"]
    tenant[0] = TENANT_B
    r = client.post("/api/v1/admin/purge-tenant", json={"token": token}, headers=admin)
    assert r.status_code == 404, r.text


def test_version_delete_looks_up_only_the_callers_tenant(monkeypatch):
    from api.routes import retention

    vid = uuid.uuid4()
    seen: list[str] = []

    def _label(tid: str, v: str) -> tuple[str, bool] | None:
        seen.append(tid)
        return ("Run 1", True) if (tid, v) == (str(TENANT_A), str(vid)) else None

    monkeypatch.setattr(retention, "_version_label", _label)
    tenant = [TENANT_B]
    client = _app(monkeypatch, tenant)
    r = client.request("DELETE", f"/api/v1/versions/{vid}", json={"confirm": "Run 1"},
                       headers={"X-User-Role": "admin"})
    assert r.status_code == 404, r.text
    assert seen == [str(TENANT_B)]
