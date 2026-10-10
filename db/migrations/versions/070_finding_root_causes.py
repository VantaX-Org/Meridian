"""finding root causes

Revision ID: 070
Revises: 068
Create Date: 2026-10-10

Who set each check's failing values, grouped by origin (interface or batch user,
dialog transaction, migration load), from SAP change documents
(workers/tasks/root_cause.py). sap_systems.go_live dates the migration cut-over:
records created before it and never changed are migration-era.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "070"
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
    op.add_column("sap_systems", sa.Column("go_live", sa.Date(), nullable=True))
    op.create_table(
        "finding_root_causes",
        sa.Column("id", postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), primary_key=True),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("version_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("analysis_versions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("check_id", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False),
        sa.Column("field", sa.Text(), nullable=True),
        sa.Column("analysed", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("total", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("origins", postgresql.JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("summary", sa.Text(), nullable=False, server_default=""),
        sa.Column("detail", sa.Text(), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_index("ix_finding_root_causes_tenant_version_check", "finding_root_causes",
                    ["tenant_id", "version_id", "check_id"])
    _rls("finding_root_causes")


def downgrade() -> None:
    op.execute("DROP POLICY IF EXISTS finding_root_causes_rls ON finding_root_causes")
    op.drop_index("ix_finding_root_causes_tenant_version_check", table_name="finding_root_causes")
    op.drop_table("finding_root_causes")
    op.drop_column("sap_systems", "go_live")
