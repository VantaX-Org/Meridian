"""export packages

Revision ID: 072
Revises: 071
Create Date: 2026-10-10

One row per downloaded correction package (format, file name, sha256, size, who
exported it, who approved the batch) — the audit trail proving which exact file
left Meridian. Batches may now come from approved cleaning items and simulations.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "072"
down_revision: Union[str, None] = "071"
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
        "export_packages",
        sa.Column("id", postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), primary_key=True),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("batch_id", postgresql.UUID(as_uuid=True),
                  sa.ForeignKey("remediation_batches.id", ondelete="CASCADE"), nullable=False),
        sa.Column("format", sa.Text(), nullable=False),
        sa.Column("filename", sa.Text(), nullable=False),
        sa.Column("sha256", sa.Text(), nullable=False),
        sa.Column("size_bytes", sa.BigInteger(), nullable=False),
        sa.Column("item_count", sa.Integer(), nullable=False),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_by_label", sa.Text(), nullable=True),
        sa.Column("approved_by_label", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("ix_export_packages_batch", "export_packages", ["tenant_id", "batch_id"])
    _rls("export_packages")
    op.drop_constraint("ck_remediation_items_source", "remediation_items", type_="check")
    op.create_check_constraint("ck_remediation_items_source", "remediation_items",
                               "proposal_source IN ('rule', 'steward', 'manual', 'cleaning', 'simulation')")


def downgrade() -> None:
    op.drop_constraint("ck_remediation_items_source", "remediation_items", type_="check")
    # Remap rows the pre-072 constraint can't represent before re-adding it, or the ALTER
    # TABLE below fails outright whenever a 'cleaning' or 'simulation' item already exists.
    op.execute("UPDATE remediation_items SET proposal_source = 'manual' "
               "WHERE proposal_source IN ('cleaning', 'simulation')")
    op.create_check_constraint("ck_remediation_items_source", "remediation_items",
                               "proposal_source IN ('rule', 'steward', 'manual')")
    op.drop_table("export_packages")
