"""Add ai_quality_score and anomaly_flags to analysis_versions."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision: str = '021_analysis_ai_score'
down_revision: str = '020_cleaning_golden_link'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        ALTER TABLE analysis_versions
        ADD COLUMN IF NOT EXISTS ai_quality_score FLOAT,
        ADD COLUMN IF NOT EXISTS anomaly_flags JSONB
    """)


def downgrade() -> None:
    op.execute("""
        ALTER TABLE analysis_versions
        DROP COLUMN IF EXISTS ai_quality_score,
        DROP COLUMN IF EXISTS anomaly_flags
    """)
