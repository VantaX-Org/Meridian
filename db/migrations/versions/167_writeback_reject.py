"""write_back_log.rejected_by / rejected_at / reject_reason: a second user can decline a write-back request

Revision ID: 167
Revises: 169
Create Date: 2026-11-13

A pending live write-back used to wait forever unless approved. The reject route records who declined it, when and
why; a rejected request leaves the pending list and can no longer be approved.
"""
from typing import Sequence, Union

from alembic import op

revision: str = "167"
down_revision: Union[str, None] = "169"
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
