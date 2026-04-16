"""Match and merge engine tables

Revision ID: 013
Revises: 012
Create Date: 2026-03-18

New tables:
  - match_rules: Configurable per-domain match rules with weighted scoring
  - match_scores: Weighted confidence per candidate pair with field-level breakdown
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, JSONB

revision: str = "013"
down_revision: Union[str, None] = "012"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── match_rules ─────────────────────────────────────────────────────────
    op.create_table(
        "match_rules",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("domain", sa.Text(), nullable=False),
        sa.Column("field", sa.Text(), nullable=False),
        sa.Column("match_type", sa.Text(), nullable=False),
        sa.Column("weight", sa.Integer(), nullable=False, server_default="50"),
        sa.Column("threshold", sa.Float(), nullable=False, server_default="0.8"),
        sa.Column("active", sa.Boolean(), nullable=False, server_default="true"),
    )
    op.create_index("ix_match_rules_tenant_domain", "match_rules", ["tenant_id", "domain"])
    op.execute("""
        ALTER TABLE match_rules ENABLE ROW LEVEL SECURITY;
        CREATE POLICY tenant_isolation_match_rules ON match_rules
            USING (tenant_id = current_setting('app.tenant_id')::uuid);
    """)

    # ── match_scores ────────────────────────────────────────────────────────
    op.create_table(
        "match_scores",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("candidate_a_key", sa.Text(), nullable=False),
        sa.Column("candidate_b_key", sa.Text(), nullable=False),
        sa.Column("domain", sa.Text(), nullable=False),
        sa.Column("total_score", sa.Float(), nullable=False),
        sa.Column("field_scores", JSONB(), nullable=False, server_default="{}"),
        sa.Column("ai_semantic_score", sa.Float(), nullable=True),
        sa.Column("auto_action", sa.Text(), nullable=False),
        sa.Column("reviewed_by", UUID(as_uuid=True), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("ix_match_scores_tenant_domain", "match_scores", ["tenant_id", "domain"])
    op.create_index("ix_match_scores_tenant_action", "match_scores", ["tenant_id", "auto_action"])
    op.execute("""
        ALTER TABLE match_scores ENABLE ROW LEVEL SECURITY;
        CREATE POLICY tenant_isolation_match_scores ON match_scores
            USING (tenant_id = current_setting('app.tenant_id')::uuid);
    """)


def downgrade() -> None:
    # Drop policies
    op.execute("DROP POLICY IF EXISTS tenant_isolation_match_scores ON match_scores;")
    op.execute("DROP POLICY IF EXISTS tenant_isolation_match_rules ON match_rules;")

    # Drop tables in reverse order
    op.drop_table("match_scores")
    op.drop_table("match_rules")
