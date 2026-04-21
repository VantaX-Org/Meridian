"""Create record_fixes table for dedicated per-record tracking.

Replaces the JSONB record_fixes array on findings rows with a dedicated
indexed table. One row per failing SAP record, with status tracking,
assignment, and fix metadata.

Revision ID: 036
Revises: 035
Create Date: 2026-04-21
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID, JSONB


revision: str = "036"
down_revision: Union[str, None] = "035"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "record_fixes",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("version_id", UUID(as_uuid=True), sa.ForeignKey("analysis_versions.id"), nullable=False),
        sa.Column("check_id", sa.Text(), nullable=False),
        sa.Column("module", sa.Text(), nullable=False),
        sa.Column("record_id", sa.Text(), nullable=False),
        sa.Column("id_field", sa.Text(), nullable=True),
        sa.Column("field", sa.Text(), nullable=True),
        sa.Column("invalid_value", sa.Text(), nullable=True),
        sa.Column("suggested_value", sa.Text(), nullable=True),
        sa.Column("fix_instruction", sa.Text(), nullable=True),
        sa.Column("sql_statement", sa.Text(), nullable=True),
        sa.Column("severity", sa.Text(), server_default="medium"),
        sa.Column("status", sa.Text(), server_default="open"),  # open, in_progress, fixed, rejected
        sa.Column("assigned_to", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("fixed_at", sa.DateTime(timezone=True), nullable=True),
    )

    # Indexes for common access patterns
    op.create_index("ix_record_fixes_version_check", "record_fixes", ["version_id", "check_id"])
    op.create_index("ix_record_fixes_version_status", "record_fixes", ["version_id", "status"])
    op.create_index(
        "ix_record_fixes_open_assigned",
        "record_fixes",
        ["assigned_to", "status"],
        postgresql_where=sa.text("status IN ('open', 'in_progress')"),
    )
    op.create_index("ix_record_fixes_tenant", "record_fixes", ["tenant_id"])

    # RLS policy
    op.execute("ALTER TABLE record_fixes ENABLE ROW LEVEL SECURITY")
    op.execute(
        "CREATE POLICY record_fixes_rls ON record_fixes "
        "USING (tenant_id = current_setting('app.tenant_id')::uuid)"
    )


def downgrade() -> None:
    op.execute("DROP POLICY IF EXISTS record_fixes_rls ON record_fixes")
    op.drop_table("record_fixes")