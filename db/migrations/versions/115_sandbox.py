"""sandbox tenant mode: the tenant flag and the log of what was held back

Revision ID: 115
Revises: 114
Create Date: 2026-10-29

* tenants.sandbox (default false), sandbox_since, sandbox_by: while true nothing leaves the deployment for the tenant
  (alert and user emails, Slack and Teams posts, webhooks, digests, report mailouts, SAP write-backs); each sender
  records what it held back in skipped_deliveries with the reason ``sandbox`` (api/services/sandbox.py). Entering
  copies the latest run into a sandbox run (analysis_versions.metadata.sandbox = true) whose work rows carry the scope
  ``sandbox:<source scope>``, so decisions land on sandbox rows only; exiting discards them.
* skipped_deliveries: one row per delivery a sender held back (channel, kind, a reference id, the reason). Tenant-scoped
  with ENABLE + FORCE row-level security and the tenant policy.
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision: str = "115"
down_revision: str | None = "114"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLES = ("skipped_deliveries",)


def _rls(table: str) -> None:
    op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
    op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
    op.execute(f"DROP POLICY IF EXISTS {table}_rls ON {table}")
    op.execute(f"CREATE POLICY {table}_rls ON {table} USING (tenant_id = current_setting('app.tenant_id')::uuid)")


def upgrade() -> None:
    op.add_column("tenants", sa.Column("sandbox", sa.Boolean(), nullable=False, server_default=sa.text("false")))
    op.add_column("tenants", sa.Column("sandbox_since", sa.DateTime(timezone=True), nullable=True))
    op.add_column("tenants", sa.Column("sandbox_by", sa.Text(), nullable=True))
    op.create_table(
        "skipped_deliveries",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("channel", sa.Text(), nullable=False),
        sa.Column("kind", sa.Text(), nullable=False),
        sa.Column("ref", sa.Text(), nullable=True),
        sa.Column("reason", sa.Text(), nullable=False, server_default="sandbox"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("ix_skipped_deliveries_tenant", "skipped_deliveries", ["tenant_id", "created_at"])
    for table in _TABLES:
        _rls(table)


def downgrade() -> None:
    op.drop_table("skipped_deliveries")
    op.drop_column("tenants", "sandbox_by")
    op.drop_column("tenants", "sandbox_since")
    op.drop_column("tenants", "sandbox")
