"""rbac scopes: roles, role_permissions, user_role_scopes, access_requests

Revision ID: 077
Revises: 076
Create Date: 2026-10-11

Additive only. Built-in roles stay in code (api/services/rbac.py); `roles` holds
custom roles and per-tenant overrides. Every user gets one unscoped grant for the
role they already hold. users.role is NOT rewritten: legacy keys stay valid and
some code paths special-case them. RLS by tenant_id on all tenant tables;
role_permissions inherits via its role.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision: str = "077"
down_revision: Union[str, None] = "076"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_NOW = sa.text("now()")
_UUID = sa.text("gen_random_uuid()")


def _rls(table: str) -> None:
    op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
    op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
    op.execute(f"DROP POLICY IF EXISTS {table}_rls ON {table}")
    op.execute(f"CREATE POLICY {table}_rls ON {table} "
               "USING (tenant_id = current_setting('app.tenant_id')::uuid)")


def upgrade() -> None:
    op.create_table(
        "roles",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=_UUID),
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("key", sa.Text(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("built_in", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("cloned_from", sa.Text(), nullable=True),
        sa.Column("created_by", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=_NOW),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=_NOW),
        sa.UniqueConstraint("tenant_id", "key", name="uq_roles_tenant_key"),
    )
    op.create_table(
        "role_permissions",
        sa.Column("role_id", UUID(as_uuid=True), sa.ForeignKey("roles.id", ondelete="CASCADE"), nullable=False),
        sa.Column("resource", sa.Text(), nullable=False),
        sa.Column("action", sa.Text(), nullable=False),
        sa.PrimaryKeyConstraint("role_id", "resource", "action"),
    )
    op.create_table(
        "user_role_scopes",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=_UUID),
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("role_key", sa.Text(), nullable=False),
        sa.Column("system_id", UUID(as_uuid=True), sa.ForeignKey("sap_systems.id", ondelete="CASCADE"),
                  nullable=True),
        sa.Column("module", sa.Text(), nullable=True),
        sa.Column("granted_by", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=_NOW),
        sa.UniqueConstraint("user_id", "role_key", "system_id", "module", name="uq_user_role_scopes_grant"),
    )
    op.create_index("ix_user_role_scopes_user", "user_role_scopes", ["tenant_id", "user_id"])
    # The UNIQUE above ignores NULLs; this one makes null-scope grants unique too.
    op.execute("CREATE UNIQUE INDEX uq_user_role_scopes_nullsafe ON user_role_scopes "
               "(user_id, role_key, COALESCE(system_id, '00000000-0000-0000-0000-000000000000'::uuid), "
               "COALESCE(module, ''))")
    op.create_table(
        "access_requests",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=_UUID),
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("resource", sa.Text(), nullable=False),
        sa.Column("action", sa.Text(), nullable=False),
        sa.Column("system_id", UUID(as_uuid=True), nullable=True),
        sa.Column("module", sa.Text(), nullable=True),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("status", sa.Text(), nullable=False, server_default="open"),
        sa.Column("decided_by", UUID(as_uuid=True), nullable=True),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=_NOW),
        sa.CheckConstraint("status IN ('open', 'granted', 'declined')", name="ck_access_requests_status"),
    )
    for t in ("roles", "user_role_scopes", "access_requests"):
        _rls(t)
    op.execute("ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE role_permissions FORCE ROW LEVEL SECURITY")
    op.execute("DROP POLICY IF EXISTS role_permissions_rls ON role_permissions")
    op.execute("CREATE POLICY role_permissions_rls ON role_permissions USING (EXISTS ("
               "SELECT 1 FROM roles r WHERE r.id = role_permissions.role_id "
               "AND r.tenant_id = current_setting('app.tenant_id')::uuid))")

    # Idempotent backfill: one unscoped grant per user for the role they hold today.
    # users is FORCE-RLS, so set the tenant per iteration.
    op.execute("""
        DO $$
        DECLARE t uuid;
        BEGIN
            FOR t IN SELECT id FROM tenants LOOP
                PERFORM set_config('app.tenant_id', t::text, true);
                INSERT INTO user_role_scopes (tenant_id, user_id, role_key)
                SELECT u.tenant_id, u.id, u.role FROM users u
                WHERE u.tenant_id = t AND NOT EXISTS (
                    SELECT 1 FROM user_role_scopes s
                    WHERE s.user_id = u.id AND s.role_key = u.role
                      AND s.system_id IS NULL AND s.module IS NULL);
            END LOOP;
        END $$
    """)


def downgrade() -> None:
    for t in ("access_requests", "user_role_scopes", "role_permissions", "roles"):
        op.execute(f"DROP POLICY IF EXISTS {t}_rls ON {t}")
    op.drop_table("access_requests")
    op.drop_table("user_role_scopes")
    op.drop_table("role_permissions")
    op.drop_table("roles")
