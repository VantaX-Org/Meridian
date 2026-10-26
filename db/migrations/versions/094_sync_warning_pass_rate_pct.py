"""sync warning pass rate: rescale SYNC_QUALITY_WARNING findings.pass_rate from a 0..1 share to 0..100

Revision ID: 094
Revises: 093
Create Date: 2026-10-26

findings.pass_rate is a percentage (checks/base.py pass_rate_of), but workers/tasks/run_sync.py wrote
its batch-level SYNC_QUALITY_WARNING finding with the raw 0..1 AI quality score. It now writes 0..100;
this rescales the rows it wrote before. The writer only fires below 0.6, so every legacy row is <= 1
and a row already on the 0..100 scale is never touched twice. Downgrade is a no-op: the 0..1 value
was the defect.
"""
from collections.abc import Sequence

from alembic import op

revision: str = "094"
down_revision: str | None = "093"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None

BACKFILL_SQL = """
    UPDATE findings SET pass_rate = ROUND(pass_rate * 100, 2)
     WHERE check_id = 'SYNC_QUALITY_WARNING' AND pass_rate IS NOT NULL AND pass_rate <= 1
"""


def upgrade() -> None:
    op.execute(BACKFILL_SQL)


def downgrade() -> None:
    pass
