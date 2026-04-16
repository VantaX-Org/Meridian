"""MDM governance metrics — daily health snapshots with AI narrative

Revision ID: 017
Revises: 016_relationships
Create Date: 2026-03-18

New tables:
  - mdm_metrics: Daily MDM health snapshot per tenant (RLS on tenant_id)
    Includes AI columns: ai_narrative, ai_projected_score, ai_risk_flags
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision: str = "017"
down_revision: Union[str, None] = "016"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "mdm_metrics",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("snapshot_date", sa.Date(), nullable=False),
        sa.Column("domain", sa.Text(), nullable=True),
        sa.Column("golden_record_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("golden_record_coverage_pct", sa.Float(), nullable=False, server_default="0.0"),
        sa.Column("avg_match_confidence", sa.Float(), nullable=False, server_default="0.0"),
        sa.Column("steward_sla_compliance_pct", sa.Float(), nullable=False, server_default="0.0"),
        sa.Column("source_consistency_pct", sa.Float(), nullable=False, server_default="0.0"),
        sa.Column("mdm_health_score", sa.Float(), nullable=False, server_default="0.0"),
        sa.Column("backlog_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("sync_coverage_pct", sa.Float(), nullable=False, server_default="0.0"),
        sa.Column("ai_narrative", sa.Text(), nullable=True),
        sa.Column("ai_projected_score", sa.Float(), nullable=True),
        sa.Column("ai_risk_flags", JSONB, nullable=True),
    )

    # Index on (tenant_id, snapshot_date) for efficient time-series queries
    op.create_index(
        "ix_mdm_metrics_tenant_date",
        "mdm_metrics",
        ["tenant_id", "snapshot_date"],
    )

    # RLS policy
    op.execute("""
        ALTER TABLE mdm_metrics ENABLE ROW LEVEL SECURITY;
        CREATE POLICY tenant_isolation_mdm_metrics
            ON mdm_metrics
            USING (tenant_id = current_setting('app.tenant_id')::uuid);
    """)


def downgrade() -> None:
    op.execute("DROP POLICY IF EXISTS tenant_isolation_mdm_metrics ON mdm_metrics")
    op.drop_table("mdm_metrics")
