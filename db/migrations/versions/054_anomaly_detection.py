"""Statistical anomaly detection across extractions (checks/anomaly.py).

  table_profiles         one row per (extraction version, table): row count and per
                         column blank rate, distinct count and — non-sensitive code
                         fields only — value counts; the baseline of the next runs
  findings.finding_type  'rule' (deterministic checks) | 'anomaly' (deviation from the
                         table's own history); GET /api/v1/findings?type=anomaly

Built by workers/tasks/run_extraction.py after each extraction is stored.

Revision ID: 054
Revises: 053
Create Date: 2026-10-04
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision: str = "054"
down_revision: Union[str, None] = "053"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("findings", sa.Column("finding_type", sa.Text(), nullable=False, server_default="rule"))

    op.create_table(
        "table_profiles",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("version_id", UUID(as_uuid=True), sa.ForeignKey("analysis_versions.id", ondelete="CASCADE"),
                  nullable=False),
        sa.Column("system_id", sa.Text(), nullable=True),
        sa.Column("table_name", sa.Text(), nullable=False),
        sa.Column("row_count", sa.BigInteger(), nullable=False),
        sa.Column("profile", JSONB(), nullable=False, server_default="{}"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.UniqueConstraint("version_id", "table_name", name="uq_table_profiles"),
    )
    op.create_index("ix_table_profiles_baseline", "table_profiles",
                    ["tenant_id", "system_id", "table_name", "created_at"])

    op.execute("ALTER TABLE table_profiles ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE table_profiles FORCE ROW LEVEL SECURITY")
    op.execute("DROP POLICY IF EXISTS table_profiles_rls ON table_profiles")
    op.execute("CREATE POLICY table_profiles_rls ON table_profiles "
               "USING (tenant_id = current_setting('app.tenant_id')::uuid)")


def downgrade() -> None:
    op.drop_table("table_profiles")
    op.drop_column("findings", "finding_type")
