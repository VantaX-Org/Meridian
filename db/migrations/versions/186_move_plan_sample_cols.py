"""move_plans pilot columns for databases that already ran 185

Revision ID: 186
Revises: 185
Create Date: 2026-11-18

185 gained sample and exclude_countries after it first shipped. A database that applied the earlier 185 never
gets them, because alembic does not re-run an applied revision. This adds both columns if they are missing.
"""
from typing import Sequence, Union

from alembic import op

revision: str = "186"
down_revision: Union[str, None] = "185"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    for col in ("sample", "exclude_countries"):
        op.execute(f"ALTER TABLE move_plans ADD COLUMN IF NOT EXISTS {col} jsonb")


def downgrade() -> None:
    pass  # the columns belong to 185; dropping them here would break plans created on a fresh 185
