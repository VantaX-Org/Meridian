"""outbound webhooks: subscriptions and the delivery log

Revision ID: 107
Revises: 106
Create Date: 2026-10-29

Independent of 104 and 105. Both tables are tenant-scoped with ENABLE + FORCE row-level security and the tenant
policy, like migration 103.

* webhooks: an HTTPS endpoint, the HMAC secret it is signed with (encrypted at rest when CREDENTIAL_MASTER_KEY is
  set; never returned by the API), the events it receives (``*`` for all) and whether it is active.
* webhook_deliveries: one event for one webhook: the payload (ids, names and numbers only), its status (pending,
  retrying, delivered, failed), attempts, the next attempt time (exponential backoff, 5 attempts), the last response
  code and error. workers/tasks/webhooks.py delivers them.
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID

revision: str = "107"
down_revision: str | None = "106"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLES = ("webhooks", "webhook_deliveries")


def _tenant_fk() -> sa.Column:
    return sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False)


def _rls(table: str) -> None:
    op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
    op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
    op.execute(f"DROP POLICY IF EXISTS {table}_rls ON {table}")
    op.execute(f"CREATE POLICY {table}_rls ON {table} USING (tenant_id = current_setting('app.tenant_id')::uuid)")


def upgrade() -> None:
    op.create_table(
        "webhooks",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        _tenant_fk(),
        sa.Column("url", sa.Text(), nullable=False),
        sa.Column("secret", sa.Text(), nullable=False),
        sa.Column("events", ARRAY(sa.Text()), nullable=False, server_default="{}"),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("created_by", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("ix_webhooks_tenant", "webhooks", ["tenant_id"])
    op.create_table(
        "webhook_deliveries",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        _tenant_fk(),
        sa.Column("webhook_id", UUID(as_uuid=True), sa.ForeignKey("webhooks.id", ondelete="CASCADE"), nullable=False),
        sa.Column("event", sa.Text(), nullable=False),
        sa.Column("event_id", UUID(as_uuid=True), nullable=False),
        sa.Column("payload", JSONB(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False, server_default="pending"),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("next_attempt_at", sa.DateTime(timezone=True), nullable=True, server_default=sa.text("now()")),
        sa.Column("last_attempt_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("response_code", sa.Integer(), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("delivered_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("status IN ('pending', 'retrying', 'delivered', 'failed')", name="ck_webhook_deliveries_status"),
        sa.UniqueConstraint("webhook_id", "event_id", name="uq_webhook_deliveries_event"),
    )
    op.create_index("ix_webhook_deliveries_webhook", "webhook_deliveries", ["tenant_id", "webhook_id", "created_at"])
    op.create_index("ix_webhook_deliveries_due", "webhook_deliveries", ["next_attempt_at"],
                    postgresql_where=sa.text("status IN ('pending', 'retrying')"))
    for table in _TABLES:
        _rls(table)


def downgrade() -> None:
    for table in reversed(_TABLES):
        op.drop_table(table)
