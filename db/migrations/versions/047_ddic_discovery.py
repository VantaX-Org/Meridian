"""Source-system design discovery: live DDIC snapshots per connected system.

  ddic_snapshots   one row per discovery run of a system (release, components,
                   coverage, status)
  ddic_tables      table definitions read live (fields as JSONB, bundle format)
  ddic_domains     domain fixed values read live (DD07L)
  sap_systems      + discovery_status / discovered_at / sap_release /
                   sap_product (ecc6 | s4hana) / last_snapshot_id

Every table is tenant-scoped with FORCE RLS like the rest of the schema.

Revision ID: 047
Revises: 046
Create Date: 2026-09-30
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision: str = "047"
down_revision: Union[str, None] = "046"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TABLES = ("ddic_snapshots", "ddic_tables", "ddic_domains")


def upgrade() -> None:
    op.create_table(
        "ddic_snapshots",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("system_id", UUID(as_uuid=True), sa.ForeignKey("sap_systems.id", ondelete="CASCADE"), nullable=False),
        sa.Column("status", sa.Text(), nullable=False, server_default="running"),  # running|complete|partial|failed
        sa.Column("source", sa.Text(), nullable=False),  # live_rfc | live_odata_metadata
        sa.Column("system_info", JSONB(), nullable=True),  # release, SID, components
        sa.Column("coverage", JSONB(), nullable=True),  # per-table live/failed/not_found
        sa.Column("table_count", sa.Integer(), server_default="0"),
        sa.Column("customer_table_count", sa.Integer(), server_default="0"),
        sa.Column("customer_field_count", sa.Integer(), server_default="0"),
        sa.Column("error_detail", sa.Text(), nullable=True),
        sa.Column("task_id", sa.Text(), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_ddic_snapshots_system", "ddic_snapshots", ["tenant_id", "system_id", "started_at"])

    op.create_table(
        "ddic_tables",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("snapshot_id", UUID(as_uuid=True), sa.ForeignKey("ddic_snapshots.id", ondelete="CASCADE"), nullable=False),
        sa.Column("table_name", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("category", sa.Text(), nullable=True),
        sa.Column("delivery_class", sa.Text(), nullable=True),
        sa.Column("customer_table", sa.Boolean(), server_default="false"),
        sa.Column("field_count", sa.Integer(), server_default="0"),
        sa.Column("definition", JSONB(), nullable=False),  # {fields: [...], foreign_keys: [...]}
        sa.UniqueConstraint("snapshot_id", "table_name", name="uq_ddic_tables_snapshot_table"),
    )
    op.create_index("ix_ddic_tables_snapshot", "ddic_tables", ["snapshot_id"])

    op.create_table(
        "ddic_domains",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("snapshot_id", UUID(as_uuid=True), sa.ForeignKey("ddic_snapshots.id", ondelete="CASCADE"), nullable=False),
        sa.Column("domain", sa.Text(), nullable=False),
        sa.Column("fixed_values", JSONB(), nullable=False),
        sa.UniqueConstraint("snapshot_id", "domain", name="uq_ddic_domains_snapshot_domain"),
    )

    op.add_column("sap_systems", sa.Column("discovery_status", sa.Text(), nullable=True))
    op.add_column("sap_systems", sa.Column("discovered_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("sap_systems", sa.Column("sap_release", sa.Text(), nullable=True))
    op.add_column("sap_systems", sa.Column("sap_product", sa.Text(), nullable=True))
    op.add_column("sap_systems", sa.Column("last_snapshot_id", UUID(as_uuid=True), nullable=True))

    for table in _TABLES:
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
        op.execute(f"DROP POLICY IF EXISTS {table}_rls ON {table}")
        op.execute(
            f"CREATE POLICY {table}_rls ON {table} "
            "USING (tenant_id = current_setting('app.tenant_id')::uuid)"
        )


def downgrade() -> None:
    for col in ("last_snapshot_id", "sap_product", "sap_release", "discovered_at", "discovery_status"):
        op.drop_column("sap_systems", col)
    for table in reversed(_TABLES):
        op.drop_table(table)
