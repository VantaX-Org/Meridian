"""delta extraction: the per-table change log of each extraction

Revision ID: 111
Revises: 110
Create Date: 2026-10-29

Independent of 104 and 105. Tenant-scoped with ENABLE + FORCE row-level security and the tenant policy.

* extraction_changes: one row per data table of an extraction (workers/tasks/run_extraction.py with
  api/services/delta_extraction.py): how the table was read (full, change documents, change date), the rows read
  from SAP, and against the previous extraction's row hashes (record_hashes) the rows inserted, updated, deleted
  and unchanged, and the read time. GET /versions/{id}/changes lists them.
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision: str = "111"
down_revision: str | None = "110"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLES = ("extraction_changes",)


def _rls(table: str) -> None:
    op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
    op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
    op.execute(f"DROP POLICY IF EXISTS {table}_rls ON {table}")
    op.execute(f"CREATE POLICY {table}_rls ON {table} USING (tenant_id = current_setting('app.tenant_id')::uuid)")


def upgrade() -> None:
    op.create_table(
        "extraction_changes",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("version_id", UUID(as_uuid=True), sa.ForeignKey("analysis_versions.id", ondelete="CASCADE"),
                  nullable=False),
        sa.Column("table_name", sa.Text(), nullable=False),
        sa.Column("mode", sa.Text(), nullable=False),
        sa.Column("rows_read", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("rows_total", sa.BigInteger(), nullable=True),
        sa.Column("inserted", sa.BigInteger(), nullable=True),
        sa.Column("updated", sa.BigInteger(), nullable=True),
        sa.Column("deleted", sa.BigInteger(), nullable=True),
        sa.Column("unchanged", sa.BigInteger(), nullable=True),
        sa.Column("duration_s", sa.Float(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.CheckConstraint("mode IN ('full', 'change_documents', 'change_date')", name="ck_extraction_changes_mode"),
        sa.UniqueConstraint("version_id", "table_name", name="uq_extraction_changes_table"),
    )
    op.create_index("ix_extraction_changes_version", "extraction_changes", ["tenant_id", "version_id"])
    for table in _TABLES:
        _rls(table)


def downgrade() -> None:
    op.drop_table("extraction_changes")
