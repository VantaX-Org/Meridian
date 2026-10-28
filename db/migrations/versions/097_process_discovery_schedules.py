"""process discovery schedules

Revision ID: 097
Revises: 096
Create Date: 2026-10-28

process_discovery_schedules: one cron schedule per (tenant, system, L1). The beat task
workers/tasks/process_schedules.py starts an incremental discovery run for every active schedule whose
next_run_at has come, moving next_run_at past now first so a slot is enqueued once. ``mode`` is the run mode
(incremental), ``coverage`` is reserved for the last run's coverage and stays NULL until a run reports it.
Tenant-scoped: ENABLE + FORCE row-level security with the tenant policy, like process_discovery_runs.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision: str = "097"
down_revision: Union[str, None] = "096"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TABLE = "process_discovery_schedules"


def upgrade() -> None:
    op.create_table(
        _TABLE,
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("system_id", UUID(as_uuid=True), sa.ForeignKey("sap_systems.id", ondelete="CASCADE"),
                  nullable=False),
        sa.Column("l1", sa.Text(), nullable=False),
        sa.Column("schedule_cron", sa.Text(), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("last_run_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("next_run_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("mode", sa.Text(), nullable=False, server_default="incremental"),
        sa.Column("coverage", JSONB(), nullable=True),
        sa.Column("created_by", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.UniqueConstraint("tenant_id", "system_id", "l1", name="uq_process_discovery_schedules_l1"),
        sa.CheckConstraint("mode IN ('full', 'incremental')", name="ck_process_discovery_schedules_mode"),
    )
    # The beat task's scan: active schedules whose next slot has come.
    op.create_index("ix_process_discovery_schedules_due", _TABLE, ["tenant_id", "next_run_at"],
                    postgresql_where=sa.text("active"))
    op.execute("ALTER TABLE process_discovery_schedules ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE process_discovery_schedules FORCE ROW LEVEL SECURITY")
    op.execute("DROP POLICY IF EXISTS process_discovery_schedules_rls ON process_discovery_schedules")
    op.execute("CREATE POLICY process_discovery_schedules_rls ON process_discovery_schedules "
               "USING (tenant_id = current_setting('app.tenant_id')::uuid)")


def downgrade() -> None:
    op.drop_table(_TABLE)
