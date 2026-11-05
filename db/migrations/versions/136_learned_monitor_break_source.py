"""learned_monitor_breaks.source: a break found between full analysis runs

Revision ID: 136
Revises: 135
Create Date: 2026-11-05

``run`` is a break from a finished analysis run (the existing rows). ``interim`` is a break found by the beat task in
workers/tasks/learned_monitor_interim.py while a sync's extraction has landed but its analysis has not finished. The
row is tied to that pending version; when the analysis finishes, the run's own detection replaces the open ones.
No new table, so row level security (migration 132) already covers it.

"""
from typing import Sequence, Union

from alembic import op

revision: str = "136"
down_revision: Union[str, None] = "135"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE learned_monitor_breaks ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'run'")
    op.execute("ALTER TABLE learned_monitor_breaks DROP CONSTRAINT IF EXISTS ck_learned_monitor_breaks_source")
    op.execute("ALTER TABLE learned_monitor_breaks ADD CONSTRAINT ck_learned_monitor_breaks_source "
               "CHECK (source IN ('run', 'interim'))")


def downgrade() -> None:
    op.execute("ALTER TABLE learned_monitor_breaks DROP CONSTRAINT IF EXISTS ck_learned_monitor_breaks_source")
    op.execute("ALTER TABLE learned_monitor_breaks DROP COLUMN IF EXISTS source")
