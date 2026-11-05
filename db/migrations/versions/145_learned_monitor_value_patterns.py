"""learned_monitor_breaks: kinds pattern_shift, format_break, range_shift and their metrics

Revision ID: 145
Revises: 144
Create Date: 2026-11-05

Value patterns and ranges of a field profile are watched: ``pattern_shift`` / ``pattern_pct`` (share of filled rows outside
the field's usual shapes), ``format_break`` / ``unparse_pct`` (share of values that do not parse as a number or date) and
``range_shift`` / ``num_mean``, ``num_max``, ``num_min``, ``date_max``, ``date_min`` (a number or date range leaving its
learned band). Only the kind and metric CHECK constraints of migration 142 change. Needs 144 (PR 626) merged first.
"""
from typing import Sequence, Union

from alembic import op

revision: str = "145"
down_revision: Union[str, None] = "144"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_OLD = {
    "kind": "'volume_drop', 'volume_spike', 'fail_rate_jump', 'score_drop', 'field_emptied', 'cardinality_shift'",
    "metric": "'records', 'score', 'fail_rate', 'blank_pct', 'distinct_pct'",
}
_KINDS = ("pattern_shift", "format_break", "range_shift")
_METRICS = ("pattern_pct", "unparse_pct", "num_mean", "num_max", "num_min", "date_max", "date_min")
_NEW = {
    "kind": _OLD["kind"] + "".join(f", '{k}'" for k in _KINDS),
    "metric": _OLD["metric"] + "".join(f", '{m}'" for m in _METRICS),
}


def _set(values: dict) -> None:
    for col, vals in values.items():
        op.execute(f"ALTER TABLE learned_monitor_breaks DROP CONSTRAINT IF EXISTS learned_monitor_breaks_{col}_check")
        op.execute(f"ALTER TABLE learned_monitor_breaks ADD CONSTRAINT learned_monitor_breaks_{col}_check "
                   f"CHECK ({col} IN ({vals}))")


def upgrade() -> None:
    _set(_NEW)


def downgrade() -> None:
    kinds = ", ".join(f"'{k}'" for k in _KINDS)
    metrics = ", ".join(f"'{m}'" for m in _METRICS)
    op.execute(f"DELETE FROM learned_monitor_breaks WHERE kind IN ({kinds}) OR metric IN ({metrics})")
    _set(_OLD)
