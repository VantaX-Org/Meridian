"""screen-load indexes on cleaning_queue and the queue counts

Revision ID: 084
Revises: 083
Create Date: 2026-10-16

The cleaning worklist is the slowest screen on the box. Its first page sorted the whole
table to take 50 rows: measured on a pilot deployment (1.59 M rows, 2.5 GB) it read
298,687 buffers — about 2.3 GB — from disk and took 1.67 s, and it did that on every load
because there was no index on the column it orders by:

    Limit  (actual time=1658..1676 rows=50)
      ->  Gather Merge
            ->  Sort  (Sort Key: created_at DESC)
                  ->  Parallel Seq Scan on cleaning_queue  (Buffers: shared read=298687)

The same missing-index shape made the queue totals slow: a bare ``count(*)`` filtered only
by ``tenant_id`` has no index to scan, so it walks the table. Three indexes fix all of it:

  * ``(tenant_id, created_at DESC)`` — the worklist order, so the first page is an index
    scan that stops after 50 rows instead of sorting everything;
  * ``(tenant_id)`` on ``cleaning_queue`` — makes the count an index-only scan;
  * ``(tenant_id)`` on ``record_issues`` (2.6 M rows) and ``dedup_candidates`` (1.59 M)
    — the same bare-count pattern on their dashboards.

These are additive and read-only: no data changes, so the migration is safe to run on a
live database, and the ``IF NOT EXISTS`` guards make it idempotent if a deployment has
already been indexed by hand.

Building the worklist index exposed the other half of why this table is slow. A single
``INSERT INTO cleaning_queue`` transaction was open for **14 minutes**, holding a
``RowExclusiveLock`` while three other statements queued behind it (two ``DELETE``s and a
``CREATE INDEX``, one of them waiting 11 minutes). Every write to the table pays to
maintain its existing indexes inside one long transaction, so the cleaning task's writes
serialise the table for minutes at a time. The index here does not create that problem —
it is the reason the read side was already pathological — but the write side wants its own
look: batch sizes and commit boundaries in the cleaning write path, not another index.

Note for deploying this: build it while the cleaning task is idle. A plain ``CREATE INDEX``
takes a ``ShareLock`` and will block behind any open write transaction on the table (a
``CONCURRENTLY`` build does not block writers, but it cannot run inside alembic's
transaction and will itself wait minutes for a snapshot when a long writer is open — both
were tried on a pilot deployment).
"""
from typing import Sequence, Union

from alembic import op

revision: str = "084"
down_revision: Union[str, None] = "083"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_INDEXES: tuple[tuple[str, str, str], ...] = (
    # (index name, table, columns/expression)
    ("ix_cleaning_queue_tenant_created", "cleaning_queue", "(tenant_id, created_at DESC)"),
    ("ix_cleaning_queue_tenant", "cleaning_queue", "(tenant_id)"),
    ("ix_record_issues_tenant", "record_issues", "(tenant_id)"),
    ("ix_dedup_candidates_tenant", "dedup_candidates", "(tenant_id)"),
)


def upgrade() -> None:
    for name, table, cols in _INDEXES:
        op.execute(f'CREATE INDEX IF NOT EXISTS {name} ON {table} {cols}')


def downgrade() -> None:
    for name, _table, _cols in _INDEXES:
        op.execute(f"DROP INDEX IF EXISTS {name}")
