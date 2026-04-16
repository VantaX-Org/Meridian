"""Stewardship workbench — unified queue with AI triage columns

Revision ID: 015
Revises: 014
Create Date: 2026-03-18

New tables:
  - stewardship_queue: Aggregated work items from all source tables,
    with ai_recommendation and ai_confidence for AI triage.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision: str = "015"
down_revision: Union[str, None] = "014"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "stewardship_queue",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("item_type", sa.Text(), nullable=False),
        sa.Column("source_id", UUID(as_uuid=True), nullable=False),
        sa.Column("domain", sa.Text(), nullable=False),
        sa.Column("priority", sa.Integer(), nullable=False, server_default="3"),
        sa.Column("due_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("assigned_to", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("status", sa.Text(), nullable=False, server_default="open"),
        sa.Column("sla_hours", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.TIMESTAMP(timezone=True), server_default=sa.text("now()")),
        sa.Column("updated_at", sa.TIMESTAMP(timezone=True), server_default=sa.text("now()")),
        sa.Column("ai_recommendation", sa.Text(), nullable=True),
        sa.Column("ai_confidence", sa.Float(), nullable=True),
    )

    # RLS
    op.execute("ALTER TABLE stewardship_queue ENABLE ROW LEVEL SECURITY")
    op.execute("""
        CREATE POLICY stewardship_queue_tenant ON stewardship_queue
            USING (tenant_id = current_setting('app.tenant_id')::uuid)
    """)

    # Composite index for workbench queries
    op.create_index(
        "ix_stewardship_queue_priority",
        "stewardship_queue",
        ["tenant_id", "status", "priority", "due_at"],
    )


def downgrade() -> None:
    op.execute("DROP POLICY IF EXISTS stewardship_queue_tenant ON stewardship_queue")
    op.drop_table("stewardship_queue")
