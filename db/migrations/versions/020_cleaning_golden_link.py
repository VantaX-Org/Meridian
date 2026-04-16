"""Add golden_record_id and golden_field_value to cleaning_queue."""
from alembic import op
import sqlalchemy as sa

revision: str = '020_cleaning_golden_link'
down_revision: str = '017'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        ALTER TABLE cleaning_queue
        ADD COLUMN IF NOT EXISTS golden_record_id UUID
            REFERENCES master_records(id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS golden_field_value TEXT
    """)


def downgrade() -> None:
    op.execute("""
        ALTER TABLE cleaning_queue
        DROP COLUMN IF EXISTS golden_record_id,
        DROP COLUMN IF EXISTS golden_field_value
    """)
