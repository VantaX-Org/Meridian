"""scheduled digests and executive mailouts

Revision ID: 114
Revises: 113
Create Date: 2026-10-29

* digest_schedules: one digest per role or per migration wave: a five-field cron (in its time zone), the channel
  (email to recipients, a webhook event, or one Slack/Teams/webhook/email alert channel), the recipients, whether the
  PDF is attached, when it last went out and when it is next due. workers/tasks/digests.py sends due digests.
* digest_deliveries: one row per (schedule, due slot) claimed before anything is sent (ON CONFLICT DO NOTHING), so a
  slot goes out at most once however often beat fires: sending, sent, failed or skipped (with the reason, e.g.
  ``sandbox``).

Both tenant-scoped with ENABLE + FORCE row-level security and the tenant policy.
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import ARRAY, UUID

revision: str = "114"
down_revision: str | None = "113"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLES = ("digest_schedules", "digest_deliveries")


def _tenant_fk() -> sa.Column:
    return sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)


def _rls(table: str) -> None:
    op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
    op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
    op.execute(f"DROP POLICY IF EXISTS {table}_rls ON {table}")
    op.execute(f"CREATE POLICY {table}_rls ON {table} USING (tenant_id = current_setting('app.tenant_id')::uuid)")


def upgrade() -> None:
    op.create_table(
        "digest_schedules",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        _tenant_fk(),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("audience", sa.Text(), nullable=False),
        sa.Column("role", sa.Text(), nullable=True),
        sa.Column("wave_id", UUID(as_uuid=True), sa.ForeignKey("migration_waves.id", ondelete="CASCADE"), nullable=True),
        sa.Column("cron", sa.Text(), nullable=False),
        sa.Column("timezone", sa.Text(), nullable=False, server_default="UTC"),
        sa.Column("channel", sa.Text(), nullable=False),
        sa.Column("recipients", ARRAY(sa.Text()), nullable=False, server_default="{}"),
        sa.Column("recipient_user_ids", ARRAY(UUID(as_uuid=True)), nullable=False, server_default="{}"),
        sa.Column("alert_channel_id", UUID(as_uuid=True), sa.ForeignKey("alert_channels.id", ondelete="SET NULL"),
                  nullable=True),
        sa.Column("attach_pdf", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("last_sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("next_run_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_by", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.CheckConstraint("audience IN ('role', 'wave')", name="ck_digest_schedules_audience"),
        sa.CheckConstraint("channel IN ('email', 'webhook', 'alert_channel')", name="ck_digest_schedules_channel"),
        sa.CheckConstraint("(audience = 'role' AND role IS NOT NULL) OR (audience = 'wave' AND wave_id IS NOT NULL)",
                           name="ck_digest_schedules_target"),
    )
    op.create_index("ix_digest_schedules_due", "digest_schedules", ["tenant_id", "next_run_at"],
                    postgresql_where=sa.text("enabled"))
    op.create_table(
        "digest_deliveries",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        _tenant_fk(),
        sa.Column("schedule_id", UUID(as_uuid=True), sa.ForeignKey("digest_schedules.id", ondelete="CASCADE"),
                  nullable=False),
        sa.Column("due_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("manual", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("status", sa.Text(), nullable=False, server_default="sending"),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("delivered", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("failed", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("status IN ('sending', 'sent', 'failed', 'skipped')", name="ck_digest_deliveries_status"),
        sa.UniqueConstraint("schedule_id", "due_at", name="uq_digest_deliveries_slot"),
    )
    op.create_index("ix_digest_deliveries_schedule", "digest_deliveries", ["tenant_id", "schedule_id", "created_at"])
    for table in _TABLES:
        _rls(table)


def downgrade() -> None:
    op.drop_table("digest_deliveries")
    op.drop_table("digest_schedules")
