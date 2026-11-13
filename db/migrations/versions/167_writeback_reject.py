"""write_back_log.rejected_by / rejected_at / reject_reason: a second approver can decline a pending write-back

Revision ID: 167
Revises: 166
Create Date: 2026-11-13

POST /writeback/reject/{id} records who declined the request, when, and why. A rejected row is no longer pending.
"""
from typing import Sequence, Union

from alembic import op

revision: str = "167"
down_revision: Union[str, None] = "166"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE write_back_log ADD COLUMN IF NOT EXISTS rejected_by text")
    op.execute("ALTER TABLE write_back_log ADD COLUMN IF NOT EXISTS rejected_at timestamptz")
    op.execute("ALTER TABLE write_back_log ADD COLUMN IF NOT EXISTS reject_reason text")


def downgrade() -> None:
    op.execute("ALTER TABLE write_back_log DROP COLUMN IF EXISTS reject_reason")
    op.execute("ALTER TABLE write_back_log DROP COLUMN IF EXISTS rejected_at")
    op.execute("ALTER TABLE write_back_log DROP COLUMN IF EXISTS rejected_by")
