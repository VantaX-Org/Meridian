"""migration_reconciliations.auto_started: the reconciliation was started by a finished target analysis, not a person."""

from typing import Sequence, Union

from alembic import op

revision: str = "144"
down_revision: Union[str, None] = "143"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE migration_reconciliations ADD COLUMN IF NOT EXISTS auto_started boolean NOT NULL DEFAULT false")


def downgrade() -> None:
    op.execute("ALTER TABLE migration_reconciliations DROP COLUMN IF EXISTS auto_started")
