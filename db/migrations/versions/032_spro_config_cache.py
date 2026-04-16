"""Create config_snapshots table for caching SPRO/Foundation Object
configuration reads per tenant/system/module.

Revision ID: 032
Revises: 031
Create Date: 2026-04-10
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID, JSONB

revision: str = "032"
down_revision: Union[str, None] = "031"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "config_snapshots",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("system_id", UUID(as_uuid=True), sa.ForeignKey("sap_systems.id", ondelete="CASCADE"), nullable=False),
        sa.Column("module", sa.Text(), nullable=False),
        sa.Column("config_table", sa.Text(), nullable=False),
        sa.Column("config_data", JSONB, nullable=False, server_default="[]"),
        sa.Column("record_count", sa.Integer(), server_default="0"),
        sa.Column("source", sa.Text(), nullable=False, server_default="live"),  # live or baseline
        sa.Column("synced_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.UniqueConstraint("tenant_id", "system_id", "module", "config_table", name="uq_config_snapshots_key"),
    )
    op.create_index("ix_config_snapshots_tenant_system", "config_snapshots", ["tenant_id", "system_id"])
    op.create_index("ix_config_snapshots_module", "config_snapshots", ["tenant_id", "module"])

    # RLS
    op.execute("ALTER TABLE config_snapshots ENABLE ROW LEVEL SECURITY")
    op.execute(
        "CREATE POLICY config_snapshots_rls ON config_snapshots "
        "USING (tenant_id = current_setting('app.tenant_id')::uuid)"
    )


def downgrade() -> None:
    op.execute("DROP POLICY IF EXISTS config_snapshots_rls ON config_snapshots")
    op.drop_table("config_snapshots")
