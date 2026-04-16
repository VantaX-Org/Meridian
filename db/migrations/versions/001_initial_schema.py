"""Initial schema — tenants, analysis_versions, findings with RLS

Revision ID: 001
Revises: None
Create Date: 2026-03-16

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # --- tenants ---
    op.create_table(
        "tenants",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("licensed_modules", postgresql.ARRAY(sa.Text()), nullable=False, server_default="{}"),
        sa.Column("dqs_weights", postgresql.JSONB(), nullable=True),
        sa.Column("alert_thresholds", postgresql.JSONB(), nullable=True),
        sa.Column("stripe_customer_id", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )

    # --- analysis_versions ---
    op.create_table(
        "analysis_versions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("run_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("label", sa.Text(), nullable=True),
        sa.Column("dqs_summary", postgresql.JSONB(), nullable=True),
        sa.Column("metadata", postgresql.JSONB(), nullable=True),
        sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
    )

    # --- findings ---
    op.create_table(
        "findings",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("version_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("analysis_versions.id"), nullable=False),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("module", sa.Text(), nullable=False),
        sa.Column("check_id", sa.Text(), nullable=False),
        sa.Column("severity", sa.Text(), nullable=False),
        sa.Column("dimension", sa.Text(), nullable=False),
        sa.Column("affected_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("total_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("pass_rate", sa.Numeric(), nullable=True),
        sa.Column("details", postgresql.JSONB(), nullable=True),
        sa.Column("remediation_text", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )

    # --- indexes ---
    op.create_index("ix_findings_tenant_version", "findings", ["tenant_id", "version_id"])
    op.create_index("ix_findings_tenant_module_severity", "findings", ["tenant_id", "module", "severity"])

    # --- Row Level Security ---
    op.execute("ALTER TABLE analysis_versions ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE findings ENABLE ROW LEVEL SECURITY")

    # RLS policies — filter by app.tenant_id session variable
    op.execute("""
        CREATE POLICY tenant_isolation ON analysis_versions
        USING (tenant_id = current_setting('app.tenant_id')::uuid)
    """)
    op.execute("""
        CREATE POLICY tenant_isolation ON findings
        USING (tenant_id = current_setting('app.tenant_id')::uuid)
    """)

    # The table owner (vantax) bypasses RLS by default in Postgres.
    # Force RLS even for table owner so it applies to our app queries.
    op.execute("ALTER TABLE analysis_versions FORCE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE findings FORCE ROW LEVEL SECURITY")


def downgrade() -> None:
    op.execute("DROP POLICY IF EXISTS tenant_isolation ON findings")
    op.execute("DROP POLICY IF EXISTS tenant_isolation ON analysis_versions")
    op.drop_index("ix_findings_tenant_module_severity")
    op.drop_index("ix_findings_tenant_version")
    op.drop_table("findings")
    op.drop_table("analysis_versions")
    op.drop_table("tenants")
