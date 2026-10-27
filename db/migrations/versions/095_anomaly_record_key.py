"""anomaly record key: data_anomalies.record_key, the SAP record an outlier sits on

Revision ID: 095
Revises: 094
Create Date: 2026-10-27

The anomaly miner stored only the row's position in the extracted frame (record_index), so the
Insights anomalies list showed eleven identical PA0007.EMPCT rows with nothing to open. The miner
now stores the record key exactly as the check engine builds it (DDIC key fields,
``PERNR=00001001|SUBTY=...``), the key the record page and Fix work read. Rows mined before this
keep NULL and read as their row number. Downgrade drops the column.
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "095"
down_revision: str | None = "094"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("data_anomalies", sa.Column("record_key", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("data_anomalies", "record_key")
