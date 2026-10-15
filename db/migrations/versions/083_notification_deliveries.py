"""notification deliveries

Revision ID: 083
Revises: 082
Create Date: 2026-10-15

One row per outbound attempt of a per-user notification (email or in-app, for a
critical alert, a digest or a test), so a user can see on Me > Preferences what
reached them and an operator can tell "no email backend" from "the send failed".

Revision 082 (tenant retention and the purge log) is written on another branch;
this file only names it as its parent. Do not run ``alembic upgrade`` until both
are merged.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision: str = "083"
down_revision: Union[str, None] = "082"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TABLE = "notification_deliveries"


def upgrade() -> None:
    op.create_table(
        _TABLE,
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        # NULL for a tenant-level row (the one "no_backend" row a run writes per tenant).
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=True),
        sa.Column("channel", sa.Text(), nullable=False),   # email | in_app
        sa.Column("kind", sa.Text(), nullable=False),      # critical | digest | test
        sa.Column("status", sa.Text(), nullable=False),    # sent | failed | no_backend | skipped
        sa.Column("error", sa.Text(), nullable=True),      # exception type or backend reason, never an address
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.CheckConstraint("channel IN ('email', 'in_app')", name="ck_notification_deliveries_channel"),
        sa.CheckConstraint("kind IN ('critical', 'digest', 'test')", name="ck_notification_deliveries_kind"),
        sa.CheckConstraint("status IN ('sent', 'failed', 'no_backend', 'skipped')",
                           name="ck_notification_deliveries_status"),
    )
    op.create_index("ix_notification_deliveries_tenant_user_created", _TABLE,
                    ["tenant_id", "user_id", "created_at"])

    op.execute("ALTER TABLE notification_deliveries ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE notification_deliveries FORCE ROW LEVEL SECURITY")
    op.execute("DROP POLICY IF EXISTS notification_deliveries_rls ON notification_deliveries")
    op.execute("CREATE POLICY notification_deliveries_rls ON notification_deliveries "
               "USING (tenant_id = current_setting('app.tenant_id')::uuid)")


def downgrade() -> None:
    op.drop_table(_TABLE)
