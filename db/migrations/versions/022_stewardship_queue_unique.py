"""Add unique index on stewardship_queue (source_id, item_type) for ON CONFLICT."""

from alembic import op

revision: str = '022_stewardship_queue_unique'
down_revision: str = '021_analysis_ai_score'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS uq_stewardship_source
        ON stewardship_queue (source_id, item_type)
        WHERE status != 'resolved'
    """)


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS uq_stewardship_source")
