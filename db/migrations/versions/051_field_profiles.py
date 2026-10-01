"""Field profiles + candidate hidden rules per analysed version and object.

  field_profiles       one row per (version, module, TABLE.FIELD): rows, blanks,
                       distinct, lengths, numeric / date ranges, top shapes and —
                       for non-sensitive code fields only — top values
                       (checks/profiling.py)
  field_dependencies   A → B within one table holding for ≥ 99 % (< 100 %) of
                       records: support, violating record count, sample keys

Built by workers/tasks/run_checks.py after each module's checks; deterministic.

Revision ID: 051
Revises: 050
Create Date: 2026-10-01
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision: str = "051"
down_revision: Union[str, None] = "050"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TABLES = ("field_profiles", "field_dependencies")


def upgrade() -> None:
    op.create_table(
        "field_profiles",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("version_id", UUID(as_uuid=True), sa.ForeignKey("analysis_versions.id", ondelete="CASCADE"),
                  nullable=False),
        sa.Column("module", sa.Text(), nullable=False),
        sa.Column("table_name", sa.Text(), nullable=False),
        sa.Column("field", sa.Text(), nullable=False),
        sa.Column("stats", JSONB(), nullable=False, server_default="{}"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.UniqueConstraint("version_id", "module", "table_name", "field", name="uq_field_profiles"),
    )
    op.create_index("ix_field_profiles_tenant_version_module", "field_profiles",
                    ["tenant_id", "version_id", "module"])

    op.create_table(
        "field_dependencies",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("version_id", UUID(as_uuid=True), sa.ForeignKey("analysis_versions.id", ondelete="CASCADE"),
                  nullable=False),
        sa.Column("module", sa.Text(), nullable=False),
        sa.Column("table_name", sa.Text(), nullable=False),
        sa.Column("determinant", sa.Text(), nullable=False),   # TABLE.FIELD
        sa.Column("dependent", sa.Text(), nullable=False),     # TABLE.FIELD
        sa.Column("support", sa.Float(), nullable=False),      # 0.99 ≤ support < 1
        sa.Column("populated_rows", sa.Integer(), nullable=False),  # records with the determinant populated
        sa.Column("violations", sa.Integer(), nullable=False),
        sa.Column("sample_keys", JSONB(), nullable=False, server_default="[]"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.UniqueConstraint("version_id", "module", "determinant", "dependent", name="uq_field_dependencies"),
    )
    op.create_index("ix_field_dependencies_tenant_version_module", "field_dependencies",
                    ["tenant_id", "version_id", "module"])

    for t in _TABLES:
        op.execute(f"ALTER TABLE {t} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {t} FORCE ROW LEVEL SECURITY")
        op.execute(f"DROP POLICY IF EXISTS {t}_rls ON {t}")
        op.execute(f"CREATE POLICY {t}_rls ON {t} USING (tenant_id = current_setting('app.tenant_id')::uuid)")


def downgrade() -> None:
    for t in reversed(_TABLES):
        op.drop_table(t)
