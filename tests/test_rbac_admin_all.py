"""The admin sees every feature: platform_admin (and the legacy admin) hold every action any role holds or any route asks for."""

import re
from pathlib import Path

import pytest

from api.services.rbac import (
    ALL_ACTIONS, LEGACY_ACTION_MAP, PERMISSIONS, PERSONA_ROLES, has_permission, permissions_for,
)

ROOT = Path(__file__).resolve().parent.parent
ADMINS = ("platform_admin", "admin")

# Every literal action a route or service checks: require_permission("x"), require_any_permission("x", "y"),
# require_scope(..., "x", ...), has_permission(role, "x").
_CALL = re.compile(r"\b(?:require_permission|require_any_permission|require_scope|has_permission)\(([^)]*)\)")
_LITERAL = re.compile(r"\"([a-z_]+(?:\.[a-z]+)?)\"")


def _checked_actions() -> set[str]:
    found: set[str] = set()
    for path in [*(ROOT / "api").rglob("*.py"), *(ROOT / "workers").rglob("*.py"), *(ROOT / "agents").rglob("*.py")]:
        for args in _CALL.findall(path.read_text(encoding="utf-8")):
            found |= {a for a in _LITERAL.findall(args) if a in ALL_ACTIONS or a in LEGACY_ACTION_MAP}
    return found


@pytest.mark.parametrize("admin", ADMINS)
def test_admin_holds_every_role_action(admin: str) -> None:
    every = set().union(*PERMISSIONS.values(), *PERSONA_ROLES.values())
    assert every - set(permissions_for(admin)) == set()


@pytest.mark.parametrize("admin", ADMINS)
def test_admin_holds_every_mapped_action(admin: str) -> None:
    # LEGACY_ACTION_MAP is the list of actions the resource model knows (run_process_discovery, export_process, ...).
    assert set(LEGACY_ACTION_MAP) - set(permissions_for(admin)) == set()


@pytest.mark.parametrize("admin", ADMINS)
def test_admin_passes_every_route_check(admin: str) -> None:
    checked = _checked_actions()
    # The scan must see the run entry points, or it is reading nothing.
    assert {"upload", "analyse", "trigger_sync", "run_process_discovery", "manage_users"} <= checked
    assert [a for a in sorted(checked) if not has_permission(admin, a)] == []


def test_platform_admin_matches_legacy_admin() -> None:
    assert set(permissions_for("platform_admin")) == set(permissions_for("admin")) == set(ALL_ACTIONS)


def test_reviewer_notifications_reach_persona_admins() -> None:
    # users.role is the persona key (migration 088): role-filtered notifications must match it too.
    src = (ROOT / "workers/tasks/ai_health_narrative.py").read_text(encoding="utf-8")
    assert "'platform_admin'" in src
    src = (ROOT / "workers/tasks/rule_proposal_task.py").read_text(encoding="utf-8")
    assert "persona_for(r) for r in roles" in src
