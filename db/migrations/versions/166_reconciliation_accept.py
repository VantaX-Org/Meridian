"""migration_reconciliations.accepted_by / accepted_at: four-eyes sign-off of a post-load reconciliation

Revision ID: 166
Revises: 165
Create Date: 2026-11-12

A reconciliation is accepted by a user other than the one who ran it. The accept route enforces that and writes
an audit_log row; these two columns record who accepted it and when.
"""
from typing import Sequence, Union

from alembic import op

revision: str = "166"
down_revision: Union[str, None] = "165"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE migration_reconciliations ADD COLUMN IF NOT EXISTS accepted_by uuid REFERENCES users(id)")
    op.execute("ALTER TABLE migration_reconciliations ADD COLUMN IF NOT EXISTS accepted_at timestamptz")


def downgrade() -> None:
    op.execute("ALTER TABLE migration_reconciliations DROP COLUMN IF EXISTS accepted_at")
    op.execute("ALTER TABLE migration_reconciliations DROP COLUMN IF EXISTS accepted_by")
