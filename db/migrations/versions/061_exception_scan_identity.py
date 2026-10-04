"""One exception per (tenant, type, source_reference) for scan-raised exceptions.

The exception scan raised SAP-monitor exceptions with a random id, so every re-scan
inserted a fresh duplicate. Scan exceptions (types sap_transaction and custom_business)
now upsert on this identity.

Existing duplicates are collapsed first: the oldest row per identity is kept with its
steward state (status, assignee, resolution); comments on the newer duplicates are moved
to it and their stewardship_queue rows are dropped before the duplicates are deleted.

Revision ID: 061
Revises: 060
Create Date: 2026-10-04
"""

from typing import Sequence, Union

from alembic import op

revision: str = "061"
down_revision: Union[str, None] = "060"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

SCAN_TYPES = "type IN ('sap_transaction', 'custom_business') AND source_reference IS NOT NULL"


def upgrade() -> None:
    op.execute(f"""
        CREATE TEMP TABLE exc_dupes ON COMMIT DROP AS
        SELECT id AS dup_id, keep_id FROM (
            SELECT id, first_value(id) OVER w AS keep_id, row_number() OVER w AS rn
              FROM exceptions
             WHERE {SCAN_TYPES}
            WINDOW w AS (PARTITION BY tenant_id, type, source_reference ORDER BY created_at, id)
        ) ranked
        WHERE rn > 1
    """)
    op.execute("UPDATE exception_comments c SET exception_id = d.keep_id FROM exc_dupes d WHERE c.exception_id = d.dup_id")
    op.execute("DELETE FROM stewardship_queue q USING exc_dupes d WHERE q.item_type = 'exception' AND q.source_id = d.dup_id")
    op.execute("DELETE FROM exceptions e USING exc_dupes d WHERE e.id = d.dup_id")
    op.execute(f"""
        CREATE UNIQUE INDEX IF NOT EXISTS uq_exceptions_scan_identity
            ON exceptions (tenant_id, type, source_reference)
         WHERE {SCAN_TYPES}
    """)


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS uq_exceptions_scan_identity")
