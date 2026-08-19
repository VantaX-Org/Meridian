"""System update log — audit trail for one-click platform self-update.

Records each admin-triggered update attempt (api/routes/system_update.py):
who triggered it, what version it moved from/to, and how it ended (done /
failed / rolled_back — scripts/update.sh auto-rolls-back on migration or
health-check failure). Complements the generic audit_log row the
AuditMiddleware already writes for the POST /trigger call itself — that one
records "who clicked it"; this one records the async multi-phase outcome a
single point-in-time audit row can't hold.

Revision ID: 045
Revises: 044
Create Date: 2026-08-18
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID


revision: str = "045"
down_revision: Union[str, None] = "044"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "system_update_log",
        sa.Column(
            "id",
            UUID(as_uuid=True),
            primary_key=True,
            server_default=sa.text("gen_random_uuid()"),
        ),
        sa.Column(
            "tenant_id",
            UUID(as_uuid=True),
            sa.ForeignKey("tenants.id"),
            nullable=False,
        ),
        sa.Column(
            "triggered_by_user_id",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id"),
            nullable=True,
        ),
        sa.Column("triggered_by_email", sa.Text(), nullable=True),
        sa.Column("from_version", sa.Text(), nullable=False),
        sa.Column("to_version_requested", sa.Text(), nullable=False),
        sa.Column("to_version_actual", sa.Text(), nullable=True),
        sa.Column("status", sa.Text(), nullable=False, server_default="started"),
        sa.Column("error_detail", sa.Text(), nullable=True),
        sa.Column(
            "started_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        "ix_system_update_log_tenant_started",
        "system_update_log",
        ["tenant_id", sa.text("started_at DESC")],
    )

    op.execute("ALTER TABLE system_update_log ENABLE ROW LEVEL SECURITY")
    op.execute(
        "CREATE POLICY system_update_log_rls ON system_update_log "
        "USING (tenant_id = current_setting('app.tenant_id')::uuid)"
    )


def downgrade() -> None:
    op.execute("DROP POLICY IF EXISTS system_update_log_rls ON system_update_log")
    op.drop_index("ix_system_update_log_tenant_started", table_name="system_update_log")
    op.drop_table("system_update_log")
