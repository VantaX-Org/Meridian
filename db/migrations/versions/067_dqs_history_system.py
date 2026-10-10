"""dqs_history per system

Revision ID: 067
Revises: 066
Create Date: 2026-10-10

dqs_history held one row per tenant, module and UTC day, so the second system
analysed on a day lost its score (ON CONFLICT DO NOTHING). Adds system_id
(NULL = file upload; no FK, history outlives a deleted system) and widens the
daily unique key to include it. The ::text cast is required: COALESCE(uuid,
'upload') does not type-check.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "067"
down_revision: Union[str, None] = "066"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("dqs_history", sa.Column("system_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.execute("DROP INDEX IF EXISTS uq_dqs_history_tenant_module_day")
    op.execute(
        "CREATE UNIQUE INDEX uq_dqs_history_tenant_system_module_day ON dqs_history "
        "(tenant_id, (COALESCE(system_id::text, 'upload')), module_id, ((recorded_at AT TIME ZONE 'UTC')::date))"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS uq_dqs_history_tenant_system_module_day")
    # the narrower key allows one row per tenant, module and day: keep the newest
    op.execute("""
        DELETE FROM dqs_history d USING dqs_history n
         WHERE d.tenant_id = n.tenant_id AND d.module_id = n.module_id
           AND (d.recorded_at AT TIME ZONE 'UTC')::date = (n.recorded_at AT TIME ZONE 'UTC')::date
           AND (d.recorded_at, d.id) < (n.recorded_at, n.id)
    """)
    op.execute(
        "CREATE UNIQUE INDEX uq_dqs_history_tenant_module_day "
        "ON dqs_history (tenant_id, module_id, ((recorded_at AT TIME ZONE 'UTC')::date))"
    )
    op.drop_column("dqs_history", "system_id")
