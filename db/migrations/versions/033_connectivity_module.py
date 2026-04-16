"""Add module-aware sync fields to sync_profiles. Create system_module_map
and record_hashes tables for connectivity management and delta analysis.

Revision ID: 033
Revises: 032
Create Date: 2026-04-10
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID, ARRAY, JSONB

revision: str = "033"
down_revision: Union[str, None] = "032"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Extend sync_profiles with module-aware fields
    op.add_column("sync_profiles", sa.Column("modules", ARRAY(sa.Text()), server_default="{}", nullable=True))
    op.add_column("sync_profiles", sa.Column("sync_type", sa.Text(), server_default="data", nullable=True))
    op.add_column("sync_profiles", sa.Column("extraction_mode", sa.Text(), server_default="full", nullable=True))
    op.add_column("sync_profiles", sa.Column("max_rows", sa.Integer(), server_default="0", nullable=True))

    # system_module_map: tracks which modules are active/available per system
    op.create_table(
        "system_module_map",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("system_id", UUID(as_uuid=True), sa.ForeignKey("sap_systems.id", ondelete="CASCADE"), nullable=False),
        sa.Column("module", sa.Text(), nullable=False),
        sa.Column("enabled", sa.Boolean(), server_default="true"),
        sa.Column("last_synced_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_sync_status", sa.Text(), nullable=True),
        sa.Column("row_count", sa.Integer(), server_default="0"),
        sa.Column("config_synced", sa.Boolean(), server_default="false"),
        sa.UniqueConstraint("tenant_id", "system_id", "module", name="uq_system_module_map_key"),
    )
    op.create_index("ix_system_module_map_tenant", "system_module_map", ["tenant_id"])
    op.create_index("ix_system_module_map_system", "system_module_map", ["tenant_id", "system_id"])

    op.execute("ALTER TABLE system_module_map ENABLE ROW LEVEL SECURITY")
    op.execute(
        "CREATE POLICY system_module_map_rls ON system_module_map "
        "USING (tenant_id = current_setting('app.tenant_id')::uuid)"
    )

    # record_hashes: for delta/incremental analysis
    op.create_table(
        "record_hashes",
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("module", sa.Text(), nullable=False),
        sa.Column("record_key", sa.Text(), nullable=False),
        sa.Column("row_hash", sa.Text(), nullable=False),
        sa.Column("version_id", UUID(as_uuid=True), nullable=False),
        sa.PrimaryKeyConstraint("tenant_id", "module", "record_key"),
    )
    op.create_index("ix_record_hashes_version", "record_hashes", ["tenant_id", "version_id"])

    op.execute("ALTER TABLE record_hashes ENABLE ROW LEVEL SECURITY")
    op.execute(
        "CREATE POLICY record_hashes_rls ON record_hashes "
        "USING (tenant_id = current_setting('app.tenant_id')::uuid)"
    )


def downgrade() -> None:
    op.execute("DROP POLICY IF EXISTS record_hashes_rls ON record_hashes")
    op.drop_table("record_hashes")
    op.execute("DROP POLICY IF EXISTS system_module_map_rls ON system_module_map")
    op.drop_table("system_module_map")
    op.drop_column("sync_profiles", "max_rows")
    op.drop_column("sync_profiles", "extraction_mode")
    op.drop_column("sync_profiles", "sync_type")
    op.drop_column("sync_profiles", "modules")
