"""Create config_impact_results table for storing feature-level impact
assessments from data quality findings.

Revision ID: 031
Revises: 030
Create Date: 2026-04-10
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID, JSONB

revision: str = "031"
down_revision: Union[str, None] = "030"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "config_impact_results",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("version_id", UUID(as_uuid=True), sa.ForeignKey("analysis_versions.id"), nullable=False),
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("feature", sa.Text(), nullable=False),
        sa.Column("system", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False),  # blocked, degraded, ok
        sa.Column("blocking_findings", JSONB, server_default="[]"),
        sa.Column("total_affected_records", sa.Integer(), server_default="0"),
        sa.Column("blocked_transactions", JSONB, server_default="[]"),
        sa.Column("opportunity_cost_summary", sa.Text(), nullable=True),
        sa.Column("cross_system_dependencies", JSONB, server_default="{}"),
        sa.Column("spro_context", JSONB, server_default="{}"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.UniqueConstraint("version_id", "tenant_id", "feature", name="uq_config_impact_version_feature"),
    )
    op.create_index("ix_config_impact_results_tenant", "config_impact_results", ["tenant_id"])
    op.create_index("ix_config_impact_results_version", "config_impact_results", ["version_id", "tenant_id"])

    # RLS
    op.execute("ALTER TABLE config_impact_results ENABLE ROW LEVEL SECURITY")
    op.execute(
        "CREATE POLICY config_impact_results_rls ON config_impact_results "
        "USING (tenant_id = current_setting('app.tenant_id')::uuid)"
    )


def downgrade() -> None:
    op.execute("DROP POLICY IF EXISTS config_impact_results_rls ON config_impact_results")
    op.drop_table("config_impact_results")
