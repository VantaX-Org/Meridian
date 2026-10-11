"""insight feedback

Revision ID: 078
Revises: 077
Create Date: 2026-10-11

Thumbs up/down on the AI summary shown in the insight header. One row per vote.
"""
from typing import Sequence, Union

from alembic import op

revision: str = "078"
down_revision: Union[str, None] = "077"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE IF NOT EXISTS insight_feedback (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
            user_id uuid,
            surface text NOT NULL,
            run_id text,
            vote text NOT NULL,
            created_at timestamptz NOT NULL DEFAULT now(),
            CONSTRAINT ck_insight_feedback_vote CHECK (vote IN ('up', 'down'))
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_insight_feedback_tenant ON insight_feedback (tenant_id, created_at)")
    op.execute("ALTER TABLE insight_feedback ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE insight_feedback FORCE ROW LEVEL SECURITY")
    op.execute("DROP POLICY IF EXISTS insight_feedback_rls ON insight_feedback")
    op.execute("CREATE POLICY insight_feedback_rls ON insight_feedback "
               "USING (tenant_id = current_setting('app.tenant_id')::uuid)")


def downgrade() -> None:
    op.execute("DROP POLICY IF EXISTS insight_feedback_rls ON insight_feedback")
    op.execute("DROP TABLE IF EXISTS insight_feedback")
