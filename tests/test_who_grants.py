"""frontend/lib/who-grants.ts names who to ask for an action; it must match api/services/rbac.py PERSONA_ROLES.

Every role the frontend names holds the action, and every persona that holds it is named, apart from the ones the
helper leaves out on purpose (the platform admin holds everything; the process analyst is a specialist).
"""

from __future__ import annotations

import re
from pathlib import Path

from api.services.rbac import PERSONA_ROLES, has_permission

SOURCE = Path(__file__).resolve().parents[1] / "frontend" / "lib" / "who-grants.ts"
LEFT_OUT = {"platform_admin", "process_analyst"}


def _granted_by() -> dict[str, list[str]]:
    text = SOURCE.read_text()
    block = re.search(r"export const GRANTED_BY = \{(.*?)\} as const", text, re.S)
    assert block, "GRANTED_BY not found in who-grants.ts"
    return {action: re.findall(r'"([a-z_]+)"', roles)
            for action, roles in re.findall(r"(\w+): \[([^\]]*)\]", block.group(1))}


def test_who_grants_lists_discovery() -> None:
    assert _granted_by()["run_process_discovery"] == ["programme_lead", "data_steward", "sap_basis"]


def test_every_named_role_holds_the_action_and_every_holder_is_named() -> None:
    for action, roles in _granted_by().items():
        for role in roles:
            assert role in PERSONA_ROLES and has_permission(role, action), (action, role)
        holders = {r for r, perms in PERSONA_ROLES.items() if action in perms}
        assert holders - LEFT_OUT == set(roles), (action, holders)
