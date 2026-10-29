"""enterprise readiness: SCIM provisioning, tenant settings keys, health samples

Revision ID: 103
Revises: 101
Create Date: 2026-10-29

Independent of 102 (it touches none of its tables); when both are on one branch, point ``down_revision`` at the
other one so the chain stays linear. Every table is tenant-scoped with ENABLE + FORCE row-level security and the
tenant policy, like migration 099.

* scim_tokens: the per-tenant SCIM bearer token. ``token_prefix`` is the public part of
  ``mscim_<tenant hex><random>.<secret>`` (unique, finds the row); ``token_hash`` is the SHA-256 of the secret.
  At most one live token per tenant (``revoked_at IS NULL``), enforced by a partial unique index.
* scim_users: the SCIM view of a users row (externalId, userName, name parts) and ``managed_roles``, the role keys
  the group-to-role map granted (only those are ever taken away again when the groups change).
* scim_groups / scim_group_members: SCIM groups and their members.
* scim_group_role_map: group displayName -> role key (one role per group, matched case-insensitively).
* tenant_settings: one JSON value per (tenant, key): theme, maintenance windows.
* health_samples: one row per component every 5 minutes (workers/tasks/health_samples.py); kept 35 days.

Two work_records indexes from the v2 load test (scripts/loadtest_v2.py, 400k work records over 3 systems; plans in
the step 8 notes), built CONCURRENTLY so a large work list stays writable while they build:
* ix_work_records_tenant_rank (tenant_id, sev_rank, module, record_key): the Fix work page in the current scope
  (several runs at once) walks this in order instead of sorting every open record: 342 ms -> 0.5 ms a page.
* ix_work_records_status_cover (tenant_id, version_id, module, status) INCLUDE (sev_rank, issues, proposed,
  due_at): index-only counts for an object's open work (receipt 190 ms -> 23 ms) and the capped page total.
"""
from collections.abc import Sequence
from typing import Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID

revision: str = "103"
down_revision: Union[str, None] = "102"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TABLES = ("scim_tokens", "scim_users", "scim_groups", "scim_group_members", "scim_group_role_map",
           "tenant_settings", "health_samples")


def _tenant_fk() -> sa.Column:
    return sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)


def _rls(table: str) -> None:
    op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
    op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
    op.execute(f"DROP POLICY IF EXISTS {table}_rls ON {table}")
    op.execute(f"CREATE POLICY {table}_rls ON {table} USING (tenant_id = current_setting('app.tenant_id')::uuid)")


def upgrade() -> None:
    op.create_table(
        "scim_tokens",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        _tenant_fk(),
        sa.Column("token_prefix", sa.Text(), nullable=False, unique=True),
        sa.Column("token_hash", sa.Text(), nullable=False),
        sa.Column("created_by", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("uq_scim_tokens_live", "scim_tokens", ["tenant_id"], unique=True,
                    postgresql_where=sa.text("revoked_at IS NULL"))

    op.create_table(
        "scim_users",
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        _tenant_fk(),
        sa.Column("external_id", sa.Text(), nullable=True),
        sa.Column("user_name", sa.Text(), nullable=False),
        sa.Column("given_name", sa.Text(), nullable=True),
        sa.Column("family_name", sa.Text(), nullable=True),
        sa.Column("display_name", sa.Text(), nullable=True),
        sa.Column("managed_roles", ARRAY(sa.Text()), nullable=False, server_default="{}"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("uq_scim_users_user_name", "scim_users", ["tenant_id", sa.text("lower(user_name)")], unique=True)
    op.create_index("uq_scim_users_external_id", "scim_users", ["tenant_id", "external_id"], unique=True,
                    postgresql_where=sa.text("external_id IS NOT NULL"))

    op.create_table(
        "scim_groups",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        _tenant_fk(),
        sa.Column("display_name", sa.Text(), nullable=False),
        sa.Column("external_id", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("uq_scim_groups_name", "scim_groups", ["tenant_id", sa.text("lower(display_name)")], unique=True)

    op.create_table(
        "scim_group_members",
        sa.Column("group_id", UUID(as_uuid=True), sa.ForeignKey("scim_groups.id", ondelete="CASCADE"),
                  primary_key=True),
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        _tenant_fk(),
    )
    op.create_index("ix_scim_group_members_user", "scim_group_members", ["tenant_id", "user_id"])

    op.create_table(
        "scim_group_role_map",
        _tenant_fk(),
        sa.Column("group_key", sa.Text(), nullable=False),  # lower(display_name)
        sa.Column("display_name", sa.Text(), nullable=False),
        sa.Column("role_key", sa.Text(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("tenant_id", "group_key"),
    )

    op.create_table(
        "tenant_settings",
        _tenant_fk(),
        sa.Column("key", sa.Text(), nullable=False),
        sa.Column("value", JSONB(), nullable=False),
        sa.Column("updated_by", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("tenant_id", "key"),
    )

    op.create_table(
        "health_samples",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        _tenant_fk(),
        sa.Column("sampled_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("component", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("latency_ms", sa.Integer(), nullable=True),
        sa.Column("detail", JSONB(), nullable=True),
        sa.CheckConstraint("status IN ('up', 'degraded', 'down', 'not_configured')", name="ck_health_samples_status"),
        sa.UniqueConstraint("tenant_id", "sampled_at", "component", name="uq_health_samples_slot"),
    )
    op.create_index("ix_health_samples_tenant_time", "health_samples", ["tenant_id", "sampled_at"])

    for table in _TABLES:
        _rls(table)

    with op.get_context().autocommit_block():
        op.execute("CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_work_records_tenant_rank "
                   "ON work_records (tenant_id, sev_rank, module, record_key)")
        op.execute("CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_work_records_status_cover "
                   "ON work_records (tenant_id, version_id, module, status) INCLUDE (sev_rank, issues, proposed, due_at)")


def downgrade() -> None:
    with op.get_context().autocommit_block():
        op.execute("DROP INDEX CONCURRENTLY IF EXISTS ix_work_records_status_cover")
        op.execute("DROP INDEX CONCURRENTLY IF EXISTS ix_work_records_tenant_rank")
    for table in reversed(_TABLES):
        op.drop_table(table)
