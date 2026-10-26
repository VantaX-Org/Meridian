"""RBAC matrix invariants and route-guard coverage."""

import ast
from pathlib import Path

from api.services.rbac import PERMISSIONS, has_permission, permissions_for

ROOT = Path(__file__).resolve().parent.parent

# Public or self-service endpoints that intentionally carry no role guard.
_UNGUARDED_OK = {
    ("auth.py", "/login"), ("auth.py", "/change-password"), ("auth.py", "/accept-invite"),
    ("auth.py", "/forgot-password"), ("auth.py", "/reset-password"), ("auth.py", "/invite/preview"),
    ("notifications.py", "/notifications/{notification_id}/read"),
    ("notifications.py", "/notifications/read-all"),
    ("preferences.py", "/me/preferences"),
    ("me_notifications.py", "/me/notifications/test"),
    # router-wide "view", then in the handler require_scope with the permission of the job kind's start endpoint
    # (the kind is only known once the job is read); pinned by tests/test_jobs_retry.py
    ("jobs.py", "/{job_id}/retry"),
}


def test_viewer_is_read_only():
    writes = {"upload", "analyse", "approve", "apply", "assign", "manage_users", "manage_systems",
              "manage_settings", "manage_rules", "trigger_sync", "mdm.write"}
    for role in ("viewer", "auditor"):
        assert not writes & PERMISSIONS[role], role


def test_admin_is_superset():
    for role, perms in PERMISSIONS.items():
        assert perms <= PERMISSIONS["admin"], role


def test_only_admin_manages_users_llm_platform_settings():
    for action in ("manage_users", "manage_llm", "manage_system", "manage_settings"):
        assert [r for r in PERMISSIONS if has_permission(r, action)] == ["admin"], action


def test_permissions_for_unknown_role_is_empty():
    assert permissions_for("nobody") == []


def test_every_mutating_route_is_guarded():
    unguarded = []
    for path in sorted((ROOT / "api" / "routes").glob("*.py")):
        src = path.read_text()
        tree = ast.parse(src)
        # A router declared with a permission dependency guards every route on it.
        router_guarded = any(
            isinstance(n, ast.Call) and getattr(n.func, "id", "") == "APIRouter"
            and any(k.arg == "dependencies" and "require_" in ast.get_source_segment(src, k.value) for k in n.keywords)
            for n in ast.walk(tree)
        )
        for node in ast.walk(tree):
            if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            for d in node.decorator_list:
                if not (isinstance(d, ast.Call) and isinstance(d.func, ast.Attribute)
                        and d.func.attr in ("post", "put", "patch", "delete")):
                    continue
                route = d.args[0].value if d.args and isinstance(d.args[0], ast.Constant) else ""
                sig = ast.get_source_segment(src, node).split(":\n", 1)[0]
                guard = (sig, ast.get_source_segment(src, d))
                if router_guarded or any(
                    g in part for g in ("require_permission", "require_any_permission", "require_action_or_sap_source")
                    for part in guard
                ):
                    continue
                if (path.name, route) not in _UNGUARDED_OK:
                    unguarded.append(f"{path.name} {d.func.attr.upper()} {route}")
    assert unguarded == []


def test_audit_reads_accept_view_audit_or_manage_users():
    src = (ROOT / "api" / "routes" / "audit.py").read_text()
    assert src.count('require_any_permission("view_audit", "manage_users")') == 4
    assert 'require_permission("manage_users")' not in src
    assert has_permission("auditor", "view_audit") and not has_permission("auditor", "manage_users")


class _EmptyResult:
    def scalar(self):
        return 0

    def fetchall(self):
        return []


class _EmptyDB:
    async def execute(self, *_a, **_k):
        return _EmptyResult()


def _audit_client(monkeypatch):
    import uuid

    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from api.deps import Tenant, get_db, get_tenant
    from api.routes.audit import router

    monkeypatch.setenv("MERIDIAN_DEV_ROLE_HEADER", "1")
    app = FastAPI()
    app.include_router(router)

    async def _db():
        yield _EmptyDB()

    app.dependency_overrides[get_db] = _db
    app.dependency_overrides[get_tenant] = lambda: Tenant(uuid.uuid4(), "T", [])
    return TestClient(app)


def test_audit_endpoints_gate_by_role_over_http(monkeypatch):
    client = _audit_client(monkeypatch)
    for path in ("/api/v1/audit", "/api/v1/audit/llm"):
        for role, status in (("auditor", 200), ("admin", 200), ("viewer", 403)):
            r = client.get(path, headers={"X-User-Role": role})
            assert r.status_code == status, (path, role, r.text)


def test_require_any_permission_raises_only_when_every_action_fails():
    import asyncio
    import uuid

    from fastapi import HTTPException, Request

    from api.deps import Tenant
    from api.services.rbac import require_any_permission

    req = Request({"type": "http", "headers": [(b"x-user-role", b"viewer")], "query_string": b""})
    t = Tenant(uuid.uuid4(), "T", [])

    async def call(*actions):
        return await require_any_permission(*actions)(req, t, _EmptyDB())

    import os
    os.environ["MERIDIAN_DEV_ROLE_HEADER"] = "1"
    try:
        assert asyncio.run(call("manage_users", "view_audit_x", "view")) == "viewer"
        try:
            asyncio.run(call("manage_users", "view_audit"))
        except HTTPException as exc:
            assert exc.status_code == 403
        else:
            raise AssertionError("expected 403")
    finally:
        os.environ.pop("MERIDIAN_DEV_ROLE_HEADER", None)


def _reports_client(monkeypatch):
    import uuid

    from fastapi import FastAPI
    from fastapi.responses import Response
    from fastapi.testclient import TestClient

    from api.deps import Tenant, get_db, get_tenant
    from api.routes import reports

    async def _pdf(*_a, **_k):
        return Response(b"%PDF-1.4", media_type="application/pdf")

    monkeypatch.setenv("MERIDIAN_DEV_ROLE_HEADER", "1")
    monkeypatch.setattr(reports, "_pdf", _pdf)
    app = FastAPI()
    app.include_router(reports.router)

    async def _db():
        yield _EmptyDB()

    app.dependency_overrides[get_db] = _db
    app.dependency_overrides[get_tenant] = lambda: Tenant(uuid.uuid4(), "T", [])
    return app, TestClient(app)


def test_report_downloads_need_export(monkeypatch):
    import uuid

    from api.routes import reports

    _, client = _reports_client(monkeypatch)
    vid = uuid.uuid4()
    for role, status in (("analyst", 200), ("auditor", 200), ("admin", 200), ("viewer", 403)):
        r = client.get("/api/v1/reports/cleaning.pdf", headers={"X-User-Role": role})
        assert r.status_code == status, (role, r.text)
    # Every route on the reports router refuses a viewer, whatever the handler does.
    paths = [r.path.replace("{version_id}", str(vid)).replace("{module}", "MARA").replace("{matnr}", "M1")
             for r in reports.router.routes if r.path.startswith("/api/v1/reports")]
    assert len(paths) >= 9
    for p in paths:
        assert client.get(p, params={"v2": "x"}, headers={"X-User-Role": "viewer"}).status_code == 403, p
