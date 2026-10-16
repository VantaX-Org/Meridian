"""retention policy and purge log

Revision ID: 082
Revises: 081
Create Date: 2026-10-15

tenants.retention holds the tenant's data retention policy as one JSONB document
(api/services/retention.py:RetentionPolicy), the same way dqs_weights,
alert_thresholds and cost_model are stored. purge_log records every purge,
dry run or real, with the rows removed per table and the storage bytes freed,
so the tenant can prove what was deleted and when (docs/legal/DPA.md section 11).
``source`` says who wrote the row: the nightly task, a preview, a manual delete or
the whole-tenant purge; only nightly dry runs count towards the dry-run gate.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "082"
down_revision: Union[str, None] = "081"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _rls(table: str) -> None:
    op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
    op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
    op.execute(f"DROP POLICY IF EXISTS {table}_rls ON {table}")
    op.execute(f"CREATE POLICY {table}_rls ON {table} "
               "USING (tenant_id = current_setting('app.tenant_id')::uuid)")


def upgrade() -> None:
    op.execute("ALTER TABLE tenants ADD COLUMN IF NOT EXISTS retention JSONB NOT NULL DEFAULT '{}'::jsonb")
    op.create_table(
        "purge_log",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenants.id"), nullable=False),
        # version | reports | audit | tenant
        sa.Column("kind", sa.Text(), nullable=False),
        sa.Column("target_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("dry_run", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        # nightly | preview | manual | tenant
        sa.Column("source", sa.Text(), nullable=False, server_default="manual"),
        sa.Column("rows_by_table", postgresql.JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("bytes_freed", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("blocked_reason", sa.Text(), nullable=True),
        sa.Column("actor_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("actor_email", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.CheckConstraint("kind IN ('version', 'reports', 'audit', 'tenant')", name="ck_purge_log_kind"),
        sa.CheckConstraint("source IN ('nightly', 'preview', 'manual', 'tenant')", name="ck_purge_log_source"),
    )
    op.create_index("ix_purge_log_tenant_created", "purge_log", ["tenant_id", "created_at"])
    _rls("purge_log")


def downgrade() -> None:
    op.execute("DROP POLICY IF EXISTS purge_log_rls ON purge_log")
    op.drop_index("ix_purge_log_tenant_created", table_name="purge_log")
    op.drop_table("purge_log")
    op.execute("ALTER TABLE tenants DROP COLUMN IF EXISTS retention")
