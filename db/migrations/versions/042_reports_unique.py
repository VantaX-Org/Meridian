"""Add UNIQUE(version_id, tenant_id) on reports.

Two callsites already do INSERT ... ON CONFLICT (version_id, tenant_id)
DO UPDATE to upsert reports idempotently — but the table only had an
INDEX on that pair, not a UNIQUE constraint. Postgres rejects ON
CONFLICT against a plain index, so every deterministic report INSERT
silently 23-erred and no row was written.

Symptom: /api/v1/reports/{version_id}/export.json returned 404 for
every version after the check engine completed, even though logs
showed the payload was assembled correctly. Discovered during the
end-to-end validation sweep.

De-duplicates any existing rows before adding the constraint so the
migration doesn't fail on an already-populated DB.

Revision ID: 042
Revises: 041
Create Date: 2026-04-24
"""

from typing import Sequence, Union

from alembic import op


revision: str = "042"
down_revision: Union[str, None] = "041"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Drop duplicate (version_id, tenant_id) rows — keep the newest.
    op.execute(
        """
        DELETE FROM reports
        WHERE id IN (
            SELECT id FROM (
                SELECT id,
                       ROW_NUMBER() OVER (
                         PARTITION BY version_id, tenant_id
                         ORDER BY generated_at DESC, id
                       ) AS rn
                FROM reports
            ) t WHERE t.rn > 1
        )
        """
    )
    op.create_unique_constraint(
        "uq_reports_version_tenant",
        "reports",
        ["version_id", "tenant_id"],
    )


def downgrade() -> None:
    op.drop_constraint("uq_reports_version_tenant", "reports", type_="unique")
