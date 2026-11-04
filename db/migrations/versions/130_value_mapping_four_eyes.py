"""maker-checker columns on transfer_value_mappings

Revision ID: 130
Revises: 129
Create Date: 2026-11-04

Reference data management: a steward proposes a source to target code mapping and a second user approves it.
proposed_by is the maker, decided_by and decided_at the checker. Existing rows keep NULL (they pre-date the
four-eyes flow); the table's status column (075) already carries proposed, confirmed and rejected.
"""
from typing import Sequence, Union

from alembic import op

revision: str = "130"
down_revision: Union[str, None] = "129"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE transfer_value_mappings ADD COLUMN IF NOT EXISTS proposed_by uuid")
    op.execute("ALTER TABLE transfer_value_mappings ADD COLUMN IF NOT EXISTS decided_by uuid")
    op.execute("ALTER TABLE transfer_value_mappings ADD COLUMN IF NOT EXISTS decided_at timestamptz")


def downgrade() -> None:
    op.execute("ALTER TABLE transfer_value_mappings DROP COLUMN IF EXISTS decided_at")
    op.execute("ALTER TABLE transfer_value_mappings DROP COLUMN IF EXISTS decided_by")
    op.execute("ALTER TABLE transfer_value_mappings DROP COLUMN IF EXISTS proposed_by")
