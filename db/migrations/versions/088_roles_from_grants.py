"""roles from grants: every user gets an unscoped persona grant; users.role follows it

Revision ID: 088
Revises: 087
Create Date: 2026-10-26

RBAC grants (user_role_scopes) become the only source of a user's role: Admin › Users no longer sets
users.role, which is re-derived from the unscoped grants after every grant change
(api/services/rbac.py recompute_users_role). For every user this migration:

  1. inserts an unscoped grant (system_id NULL, module NULL) of the persona that replaces their
     current users.role: admin -> platform_admin, manager -> programme_lead, steward -> data_steward,
     approver -> data_owner. Persona keys, analyst, auditor, viewer, ai_reviewer and custom keys keep
     their own key. ON CONFLICT DO NOTHING against uq_user_role_scopes_nullsafe (077), so re-running
     adds nothing;
  2. sets users.role to that same persona key, so the derived value is consistent.

No permission is gained or lost: each persona carries its legacy role's action set, except that
programme_lead and data_steward also run process discovery (owner decision 2026-10-26). The legacy
grants the 077 backfill made are left in place; they still work and are shown as "(legacy)".

Data-only, no new tables (so no new RLS policy). users and user_role_scopes are FORCE-RLS, so the tenant
is set per iteration. Downgrade is a no-op: which persona grants pre-existed cannot be told apart, and
the persona keys stay valid users.role values for 087.
"""
from collections.abc import Sequence

from alembic import op

revision: str = "088"
down_revision: str | None = "087"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Legacy users.role -> the persona that replaces it (api/services/rbac.py PERSONA_ALIAS, inverted).
PERSONA_FOR: dict[str, str] = {
    "admin": "platform_admin",
    "manager": "programme_lead",
    "steward": "data_steward",
    "approver": "data_owner",
}


def persona_for(role: str) -> str:
    """The persona key for a users.role value; any key without a persona keeps its own."""
    return PERSONA_FOR.get(role, role)


_CASE = "CASE u.role " + " ".join(f"WHEN '{k}' THEN '{v}'" for k, v in PERSONA_FOR.items()) + " ELSE u.role END"

# Idempotent: re-running inserts nothing (null-safe unique index) and rewrites no role.
BACKFILL_SQL = f"""
    DO $$
    DECLARE t uuid;
    BEGIN
        FOR t IN SELECT id FROM tenants LOOP
            PERFORM set_config('app.tenant_id', t::text, true);
            INSERT INTO user_role_scopes (tenant_id, user_id, role_key)
            SELECT u.tenant_id, u.id, {_CASE} FROM users u
            WHERE u.tenant_id = t AND u.role IS NOT NULL
            ON CONFLICT DO NOTHING;
            UPDATE users u SET role = {_CASE}
            WHERE u.tenant_id = t AND u.role IN ({", ".join(f"'{k}'" for k in PERSONA_FOR)});
        END LOOP;
    END $$
"""


def upgrade() -> None:
    op.execute(BACKFILL_SQL)


def downgrade() -> None:
    pass
