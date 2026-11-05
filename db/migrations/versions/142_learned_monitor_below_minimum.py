"""learned_monitor_breaks: status below_minimum, kind cardinality_shift, metric distinct_pct

Revision ID: 142
Revises: 140
Create Date: 2026-11-05

``below_minimum`` is a break outside the usual range whose effect is under a steward-raised learned minimum: stored so it
can be confirmed, never alerted. ``cardinality_shift`` / ``distinct_pct`` is the share of distinct values among the filled
rows of a field. Only the three CHECK constraints of migration 132 change. Number 141 belongs to another open branch;
down_revision is fixed on merge.
"""
from typing import Sequence, Union

from alembic import op

revision: str = "142"
down_revision: Union[str, None] = "140"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_OLD = {
    "status": "'open', 'acknowledged', 'expected', 'snoozed'",
    "kind": "'volume_drop', 'volume_spike', 'fail_rate_jump', 'score_drop', 'field_emptied'",
    "metric": "'records', 'score', 'fail_rate', 'blank_pct'",
}
_NEW = {
    "status": _OLD["status"] + ", 'below_minimum'",
    "kind": _OLD["kind"] + ", 'cardinality_shift'",
    "metric": _OLD["metric"] + ", 'distinct_pct'",
}


def _set(values: dict) -> None:
    for col, vals in values.items():
        op.execute(f"ALTER TABLE learned_monitor_breaks DROP CONSTRAINT IF EXISTS learned_monitor_breaks_{col}_check")
        op.execute(f"ALTER TABLE learned_monitor_breaks ADD CONSTRAINT learned_monitor_breaks_{col}_check "
                   f"CHECK ({col} IN ({vals}))")


def upgrade() -> None:
    _set(_NEW)


def downgrade() -> None:
    op.execute("DELETE FROM learned_monitor_breaks WHERE status = 'below_minimum' OR kind = 'cardinality_shift'")
    _set(_OLD)
