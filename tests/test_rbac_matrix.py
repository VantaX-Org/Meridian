"""RBAC matrix invariants and route-guard coverage."""

import ast
from pathlib import Path

from api.services.rbac import PERMISSIONS, has_permission, permissions_for

ROOT = Path(__file__).resolve().parent.parent

# Public or self-service endpoints that intentionally carry no role guard.
_UNGUARDED_OK = {
    ("auth.py", "/login"), ("auth.py", "/change-password"), ("auth.py", "/accept-invite"),
    ("auth.py", "/forgot-password"), ("auth.py", "/reset-password"),
    ("notifications.py", "/notifications/{notification_id}/read"),
    ("notifications.py", "/notifications/read-all"),
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
        for node in ast.walk(ast.parse(src)):
            if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            for d in node.decorator_list:
                if not (isinstance(d, ast.Call) and isinstance(d.func, ast.Attribute)
                        and d.func.attr in ("post", "put", "patch", "delete")):
                    continue
                route = d.args[0].value if d.args and isinstance(d.args[0], ast.Constant) else ""
                sig = ast.get_source_segment(src, node).split(":\n", 1)[0]
                if "require_permission" in sig or "require_permission" in ast.get_source_segment(src, d):
                    continue
                if (path.name, route) not in _UNGUARDED_OK:
                    unguarded.append(f"{path.name} {d.func.attr.upper()} {route}")
    assert unguarded == []
