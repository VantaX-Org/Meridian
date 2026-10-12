"""mdm_metrics unique snapshot

Revision ID: 080
Revises: 079
Create Date: 2026-10-12

snapshot_mdm_metrics inserts with ON CONFLICT (tenant_id, snapshot_date, domain),
which Postgres rejects unless a matching unique index exists. The aggregate row
has domain NULL, so the index treats NULLs as equal (Postgres 15+). Duplicate
snapshots written before the index existed are removed first, keeping the
earliest row of each group, the one ON CONFLICT DO NOTHING would have kept.
"""
from typing import Sequence, Union

from alembic import op

revision: str = "080"
down_revision: Union[str, None] = "079"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("""
        DELETE FROM mdm_metrics m
        USING (
            SELECT ctid, row_number() OVER (
                PARTITION BY tenant_id, snapshot_date, domain ORDER BY ctid
            ) AS n
            FROM mdm_metrics
        ) d
        WHERE m.ctid = d.ctid AND d.n > 1
    """)
    op.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS uq_mdm_metrics_tenant_date_domain
        ON mdm_metrics (tenant_id, snapshot_date, domain) NULLS NOT DISTINCT
    """)


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS uq_mdm_metrics_tenant_date_domain")
