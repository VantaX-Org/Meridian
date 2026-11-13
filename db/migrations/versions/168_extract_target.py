"""analysis_versions.extract_target: the target system and templates a run was started with, and each auto-fill's outcome

Revision ID: 168
Revises: 166
Create Date: 2026-11-13

167 is taken by open PRs (#694, #699); this revision follows 166 on main. If one of those merges first, point
down_revision at it (alembic heads will say).
"""
from typing import Sequence, Union

from alembic import op

revision: str = "168"
down_revision: Union[str, None] = "166"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE analysis_versions ADD COLUMN IF NOT EXISTS extract_target jsonb")


def downgrade() -> None:
    op.execute("ALTER TABLE analysis_versions DROP COLUMN IF EXISTS extract_target")
