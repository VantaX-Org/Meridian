"""analysis run steps

Revision ID: 066
Revises: 065
Create Date: 2026-10-08

Durable per-run step log (step number, name, status, duration, decisive error)
for both analysis runs (run_checks) and sync runs (run_sync). Complements the
Redis-only task_progress mechanism (api/services/task_progress.py), which
remains the live-progress source; this table is the historical record the
/api/v1/runs/{id}/steps endpoint reads.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "066"
down_revision: Union[str, None] = "065"
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
        "analysis_run_steps",
        sa.Column("id", postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()"), primary_key=True),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("version_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("analysis_versions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("step_number", sa.Integer(), nullable=False),
        sa.Column("step_name", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False, server_default="running"),
        sa.Column("started_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("duration_ms", sa.Integer(), nullable=True),
        sa.Column("error_detail", sa.Text(), nullable=True),
    )
    op.create_index(
        "ix_analysis_run_steps_tenant_version_step",
        "analysis_run_steps",
        ["tenant_id", "version_id", "step_number"],
    )
    _rls("analysis_run_steps")


def downgrade() -> None:
    op.execute("DROP POLICY IF EXISTS analysis_run_steps_rls ON analysis_run_steps")
    op.drop_index("ix_analysis_run_steps_tenant_version_step", table_name="analysis_run_steps")
    op.drop_table("analysis_run_steps")
