"""report history and scheduled reports: report_files, report_schedules, report_schedule_runs

Revision ID: 089
Revises: 088
Create Date: 2026-10-26

  report_files          one row per report file Meridian generated: every download from
                        /api/v1/reports/* and every scheduled run. The bytes live in the reports
                        bucket of the object store (``storage_key``); ``content`` holds them only
                        when the store was unreachable and the file is under the size cap
                        (api/services/report_history.py DB_FALLBACK_MAX_BYTES).
  report_schedules      a report (kind, format, params) generated on a cadence (daily, weekly on a
                        weekday, monthly on a day) at a time of day in the schedule's time zone,
                        sent to users and/or alert channels.
  report_schedule_runs  one row per (schedule, due time). The beat task claims a slot with
                        INSERT ... ON CONFLICT (schedule_id, due_at) DO NOTHING, so a slot is
                        generated and delivered at most once however often the task fires.

All three are tenant-scoped: ENABLE + FORCE row-level security with the tenant policy.
A purged run leaves its history rows (version_id is set to NULL).
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID

revision: str = "089"
down_revision: Union[str, None] = "088"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TABLES = ("report_schedules", "report_files", "report_schedule_runs")


def _rls(table: str) -> None:
    op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
    op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
    op.execute(f"DROP POLICY IF EXISTS {table}_rls ON {table}")
    op.execute(f"CREATE POLICY {table}_rls ON {table} "
               "USING (tenant_id = current_setting('app.tenant_id')::uuid)")


def _id() -> sa.Column:
    return sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()"))


def _tenant() -> sa.Column:
    return sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id"), nullable=False)


def _user(name: str) -> sa.Column:
    return sa.Column(name, UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True)


def _now(name: str) -> sa.Column:
    return sa.Column(name, sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()"))


def upgrade() -> None:
    op.create_table(
        "report_schedules",
        _id(), _tenant(),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("kind", sa.Text(), nullable=False),
        sa.Column("format", sa.Text(), nullable=False),
        sa.Column("params", JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("cadence", sa.Text(), nullable=False),
        sa.Column("time_of_day", sa.Time(), nullable=False, server_default="07:00"),
        sa.Column("weekday", sa.SmallInteger(), nullable=True),
        sa.Column("day_of_month", sa.SmallInteger(), nullable=True),
        sa.Column("timezone", sa.Text(), nullable=False, server_default="UTC"),
        sa.Column("recipient_user_ids", ARRAY(UUID(as_uuid=True)), nullable=False, server_default="{}"),
        sa.Column("recipient_channel_ids", ARRAY(UUID(as_uuid=True)), nullable=False, server_default="{}"),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("last_run_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_status", sa.Text(), nullable=True),
        sa.Column("next_run_at", sa.DateTime(timezone=True), nullable=True),
        _user("created_by"),
        _now("created_at"), _now("updated_at"),
        sa.CheckConstraint("cadence IN ('daily', 'weekly', 'monthly')", name="ck_report_schedules_cadence"),
        sa.CheckConstraint("format IN ('pdf', 'xlsx', 'json')", name="ck_report_schedules_format"),
        sa.CheckConstraint("weekday IS NULL OR weekday BETWEEN 0 AND 6", name="ck_report_schedules_weekday"),
        sa.CheckConstraint("day_of_month IS NULL OR day_of_month BETWEEN 1 AND 31",
                           name="ck_report_schedules_day_of_month"),
    )
    # The beat task's scan: enabled schedules whose next slot has come.
    op.create_index("ix_report_schedules_due", "report_schedules", ["tenant_id", "next_run_at"],
                    postgresql_where=sa.text("enabled"))

    op.create_table(
        "report_files",
        _id(), _tenant(),
        sa.Column("kind", sa.Text(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("version_id", UUID(as_uuid=True),
                  sa.ForeignKey("analysis_versions.id", ondelete="SET NULL"), nullable=True),
        sa.Column("format", sa.Text(), nullable=False),
        sa.Column("file_name", sa.Text(), nullable=False),
        sa.Column("content_type", sa.Text(), nullable=False),
        sa.Column("size_bytes", sa.BigInteger(), nullable=False),
        sa.Column("sha256", sa.Text(), nullable=False),
        sa.Column("storage_key", sa.Text(), nullable=True),
        sa.Column("content", sa.LargeBinary(), nullable=True),
        sa.Column("params", JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("source", sa.Text(), nullable=False, server_default="download"),
        sa.Column("schedule_id", UUID(as_uuid=True),
                  sa.ForeignKey("report_schedules.id", ondelete="SET NULL"), nullable=True),
        _user("created_by"),
        sa.Column("created_by_email", sa.Text(), nullable=True),
        _now("created_at"),
        sa.CheckConstraint("format IN ('pdf', 'xlsx', 'json')", name="ck_report_files_format"),
        sa.CheckConstraint("source IN ('download', 'schedule', 'run_now')", name="ck_report_files_source"),
        sa.CheckConstraint("storage_key IS NOT NULL OR content IS NOT NULL", name="ck_report_files_stored"),
    )
    op.create_index("ix_report_files_tenant_created", "report_files", ["tenant_id", "created_at"])
    op.create_index("ix_report_files_kind_created", "report_files", ["tenant_id", "kind", "created_at"])

    op.create_table(
        "report_schedule_runs",
        _id(), _tenant(),
        sa.Column("schedule_id", UUID(as_uuid=True),
                  sa.ForeignKey("report_schedules.id", ondelete="CASCADE"), nullable=False),
        sa.Column("due_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("manual", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("status", sa.Text(), nullable=False, server_default="running"),
        sa.Column("report_file_id", UUID(as_uuid=True),
                  sa.ForeignKey("report_files.id", ondelete="SET NULL"), nullable=True),
        sa.Column("delivered", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("failed", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("detail", sa.Text(), nullable=True),
        _now("started_at"),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("schedule_id", "due_at", name="uq_report_schedule_runs_slot"),
        sa.CheckConstraint("status IN ('running', 'sent', 'partial', 'failed', 'skipped')",
                           name="ck_report_schedule_runs_status"),
    )
    op.create_index("ix_report_schedule_runs_schedule", "report_schedule_runs", ["tenant_id", "schedule_id", "due_at"])

    for t in _TABLES:
        _rls(t)


def downgrade() -> None:
    for t in reversed(_TABLES):
        op.drop_table(t)
