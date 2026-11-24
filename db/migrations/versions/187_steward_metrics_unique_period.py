"""steward_metrics unique period

Revision ID: 187
Revises: 186
Create Date: 2026-11-24

weekly_cleaning_batch rolled up steward_metrics with ON CONFLICT DO NOTHING, but the
table had no unique key beyond its random id. Every run therefore added another row
for the same steward and period, and the existing row never refreshed. Duplicates are
removed first, keeping the newest row of each group because it holds the latest counts.
The unique index lets the rollup upsert one row per tenant, steward and period.
"""
from typing import Sequence, Union

from alembic import op

revision: str = "187"
down_revision: Union[str, None] = "186"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        DELETE FROM steward_metrics m
        USING (
            SELECT ctid, row_number() OVER (
                PARTITION BY tenant_id, user_id, period ORDER BY created_at DESC, ctid DESC
            ) AS n
            FROM steward_metrics
        ) d
        WHERE m.ctid = d.ctid AND d.n > 1
    """)
    op.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS uq_steward_metrics_tenant_user_period
        ON steward_metrics (tenant_id, user_id, period) NULLS NOT DISTINCT
    """)


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS uq_steward_metrics_tenant_user_period")
