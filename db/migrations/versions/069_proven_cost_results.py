"""proven cost results

Revision ID: 069
Revises: 068
Create Date: 2026-10-10

Per-version, per-metric money already lost/held in transactions (late POs, GR/IR UoM
variance, blocked sales, duplicate vendor payments), attributed to finding check_ids.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "069"
down_revision: Union[str, None] = "068"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _rls(table: str) -> None:
    op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
    op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
    op.execute(f"DROP POLICY IF EXISTS {table}_rls ON {table}")
    op.execute(f"CREATE POLICY {table}_rls ON {table} "
               "USING (tenant_id = current_setting('app.tenant_id')::uuid)")


def upgrade() -> None:
    op.create_table(
        "proven_cost_results",
        sa.Column("id", postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), primary_key=True),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("version_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("analysis_versions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("metric", sa.Text(), nullable=False),
        sa.Column("amount", sa.Numeric(), nullable=False),
        sa.Column("currency", sa.Text(), nullable=True),
        sa.Column("by_currency", postgresql.JSONB(), nullable=False, server_default="{}"),
        sa.Column("documents", sa.Integer(), nullable=False),
        sa.Column("check_ids", postgresql.ARRAY(sa.Text()), nullable=False, server_default="{}"),
        sa.Column("items", postgresql.JSONB(), nullable=False, server_default="[]"),
        sa.Column("computed_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.UniqueConstraint("version_id", "metric", name="uq_proven_cost_version_metric"),
    )
    op.create_index("ix_proven_cost_tenant_version", "proven_cost_results", ["tenant_id", "version_id"])
    _rls("proven_cost_results")


def downgrade() -> None:
    op.drop_table("proven_cost_results")
