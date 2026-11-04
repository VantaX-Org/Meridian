"""steward rejection of AI survivorship picks

Revision ID: 131
Revises: 130
Create Date: 2026-11-04

survivorship_decisions gains the decision 'reject' (the proposed pick is turned down and the golden value stays as the
deterministic chain set it) and a free-text note, required for a rejection. actor and decided_at are the approver and
the time; the four-eyes comparison against whoever triggered the run uses the proposed_by stored with the pick.
"""
from typing import Sequence, Union

from alembic import op

revision: str = "131"
down_revision: Union[str, None] = "130"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE survivorship_decisions ADD COLUMN IF NOT EXISTS note text")
    op.execute("ALTER TABLE survivorship_decisions DROP CONSTRAINT IF EXISTS survivorship_decisions_decision_check")
    op.execute("ALTER TABLE survivorship_decisions ADD CONSTRAINT survivorship_decisions_decision_check "
               "CHECK (decision IN ('accept', 'override', 'reject'))")


def downgrade() -> None:
    op.execute("DELETE FROM survivorship_decisions WHERE decision = 'reject'")
    op.execute("ALTER TABLE survivorship_decisions DROP CONSTRAINT IF EXISTS survivorship_decisions_decision_check")
    op.execute("ALTER TABLE survivorship_decisions ADD CONSTRAINT survivorship_decisions_decision_check "
               "CHECK (decision IN ('accept', 'override'))")
    op.execute("ALTER TABLE survivorship_decisions DROP COLUMN IF EXISTS note")
