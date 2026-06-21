"""Migration mode — source→source / source→destination transfer runs.

Adds the four tenant-scoped tables behind the MODE selector on the transfer
workflow:

  migration_runs          one row per analyse/export run (queued→…→exported)
  migration_gap_findings  per-record source-vs-destination gap findings
  migration_export_files  audit metadata for generated SAP load files
  transfer_field_mappings source-field → destination-SAP-field map (editable)

Every table carries a NOT NULL ``tenant_id`` and ships with RLS
ENABLE+FORCE+policy from the outset (no repeat of the 043 retrofit). App-role
grants are already covered by 040's blanket grant on the schema.

Revision ID: 044
Revises: 043
Create Date: 2026-06-21
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID, JSONB, ARRAY


revision: str = "044"
down_revision: Union[str, None] = "043"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_RLS_TABLES: tuple[str, ...] = (
    "migration_runs",
    "migration_gap_findings",
    "migration_export_files",
    "transfer_field_mappings",
)


def upgrade() -> None:
    op.create_table(
        "migration_runs",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("mode", sa.Text(), nullable=False),  # source_to_source | source_to_destination
        sa.Column("source_system_id", UUID(as_uuid=True), sa.ForeignKey("sap_systems.id"), nullable=False),
        sa.Column("dest_system_id", UUID(as_uuid=True), sa.ForeignKey("sap_systems.id"), nullable=True),
        sa.Column("modules", ARRAY(sa.Text()), server_default="{}"),
        sa.Column("status", sa.Text(), server_default="queued"),  # queued|running|analysed|exported|failed
        sa.Column("readiness_verdict", sa.Text(), nullable=True),  # go|conditional|no-go
        sa.Column("readiness_score", sa.Float(), nullable=True),
        sa.Column("critical_count", sa.Integer(), server_default="0"),
        sa.Column("gap_summary", JSONB(), nullable=True),  # rollup only — no raw SAP values
        sa.Column("task_id", sa.Text(), nullable=True),
        sa.Column("error_detail", sa.Text(), nullable=True),
        sa.Column("requested_by", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )
    op.create_index("ix_migration_runs_tenant_status", "migration_runs", ["tenant_id", "status"])

    op.create_table(
        "migration_gap_findings",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("run_id", UUID(as_uuid=True), sa.ForeignKey("migration_runs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("module", sa.Text(), nullable=False),
        sa.Column("object_type", sa.Text(), nullable=True),
        sa.Column("record_key", sa.Text(), nullable=True),
        sa.Column("dest_table", sa.Text(), nullable=True),
        sa.Column("field", sa.Text(), nullable=True),
        sa.Column("gap_type", sa.Text(), nullable=False),  # field_mapping|target_mandatory|value_domain|type_mismatch
        sa.Column("severity", sa.Text(), server_default="medium"),
        sa.Column("detail", sa.Text(), nullable=True),  # sanitised
        sa.Column("status_source", sa.Text(), nullable=True),  # FieldStatusSource provenance
        sa.Column("domain_provenance", sa.Text(), nullable=True),
        sa.Column("transfer_ready", sa.Boolean(), server_default="false"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )
    op.create_index("ix_migration_gap_findings_run", "migration_gap_findings", ["run_id"])
    op.create_index("ix_migration_gap_findings_run_ready", "migration_gap_findings", ["run_id", "transfer_ready"])
    op.create_index("ix_migration_gap_findings_tenant", "migration_gap_findings", ["tenant_id"])

    op.create_table(
        "migration_export_files",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("run_id", UUID(as_uuid=True), sa.ForeignKey("migration_runs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("export_format", sa.Text(), nullable=False),
        sa.Column("object_type", sa.Text(), nullable=True),
        sa.Column("record_count", sa.Integer(), server_default="0"),
        sa.Column("record_keys", ARRAY(sa.Text()), server_default="{}"),
        sa.Column("filename", sa.Text(), nullable=False),
        sa.Column("exported_by", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )
    op.create_index("ix_migration_export_files_run", "migration_export_files", ["run_id"])
    op.create_index("ix_migration_export_files_tenant", "migration_export_files", ["tenant_id"])

    op.create_table(
        "transfer_field_mappings",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("module", sa.Text(), nullable=False),
        sa.Column("source_field", sa.Text(), nullable=False),
        sa.Column("source_data_type", sa.Text(), nullable=True),
        sa.Column("dest_system_type", sa.Text(), nullable=False),
        sa.Column("dest_table", sa.Text(), nullable=True),
        sa.Column("dest_field", sa.Text(), nullable=True),  # NULL ⇒ explicitly unmapped/skipped
        sa.Column("transform_note", sa.Text(), nullable=True),
        sa.Column("is_confirmed", sa.Boolean(), server_default="false"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("tenant_id", "module", "source_field", "dest_system_type",
                            name="uq_transfer_field_mappings_key"),
    )
    op.create_index("ix_transfer_field_mappings_tenant", "transfer_field_mappings", ["tenant_id"])
    op.create_index("ix_transfer_field_mappings_lookup", "transfer_field_mappings",
                    ["tenant_id", "module", "dest_system_type"])

    for table in _RLS_TABLES:
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
        op.execute(f"DROP POLICY IF EXISTS {table}_rls ON {table}")
        op.execute(
            f"CREATE POLICY {table}_rls ON {table} "
            "USING (tenant_id = current_setting('app.tenant_id')::uuid)"
        )


def downgrade() -> None:
    for table in _RLS_TABLES:
        op.execute(f"DROP POLICY IF EXISTS {table}_rls ON {table}")
        op.execute(f"ALTER TABLE {table} NO FORCE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table} DISABLE ROW LEVEL SECURITY")
    op.drop_table("transfer_field_mappings")
    op.drop_table("migration_export_files")
    op.drop_table("migration_gap_findings")
    op.drop_table("migration_runs")
