"""user preferences

Revision ID: 081
Revises: 080
Create Date: 2026-10-13

Per-user preferences (theme, density, locale, timezone, saved table views, completed
tours, last seen version, notification settings) live in one JSONB document so they
follow the user across browsers. Validated by api/routes/preferences.py.
"""
from typing import Sequence, Union

from alembic import op

revision: str = "081"
down_revision: Union[str, None] = "080"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS preferences JSONB NOT NULL DEFAULT '{}'::jsonb")


def downgrade() -> None:
    op.execute("ALTER TABLE users DROP COLUMN IF EXISTS preferences")
