"""insight feedback

Revision ID: 078
Revises: 077
Create Date: 2026-10-11

Thumbs up/down on the AI summary shown in the insight header. One row per vote.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision: str = "078"
down_revision: Union[str, None] = "077"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "insight_feedback",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", UUID(as_uuid=True), nullable=True),
        sa.Column("surface", sa.Text(), nullable=False),
        sa.Column("run_id", sa.Text(), nullable=True),
        sa.Column("vote", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.CheckConstraint("vote IN ('up', 'down')", name="ck_insight_feedback_vote"),
    )
    op.create_index("ix_insight_feedback_tenant", "insight_feedback", ["tenant_id", "created_at"])
    op.execute("ALTER TABLE insight_feedback ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE insight_feedback FORCE ROW LEVEL SECURITY")
    op.execute("DROP POLICY IF EXISTS insight_feedback_rls ON insight_feedback")
    op.execute("CREATE POLICY insight_feedback_rls ON insight_feedback "
               "USING (tenant_id = current_setting('app.tenant_id')::uuid)")


def downgrade() -> None:
    op.execute("DROP POLICY IF EXISTS insight_feedback_rls ON insight_feedback")
    op.drop_table("insight_feedback")
