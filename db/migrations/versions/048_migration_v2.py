"""Migration readiness v2: source versions, S/4 standard targets, value maps.

  migration_runs          + source_version_id, target_release, target_connected,
                            records_total / records_blocked;
                            source_system_id nullable (a run can analyse an upload)
  migration_gap_findings  + source_table, source_field, source_value,
                            target_value, grounded, provenance
  transfer_field_mappings one source field may feed several targets (identity +
                            CVI) → unique on the full source→target pair;
                            + value_map, origin
  transfer_value_mappings new — steward-maintained source→target value mapping
                            (e.g. vendor account group → BP grouping)

Existing rows keep working: old single-target mappings stay valid, new
columns are nullable or defaulted.

Revision ID: 048
Revises: 047
Create Date: 2026-09-30
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision: str = "048"
down_revision: Union[str, None] = "047"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("migration_runs", sa.Column("source_version_id", UUID(as_uuid=True),
                                              sa.ForeignKey("analysis_versions.id"), nullable=True))
    op.add_column("migration_runs", sa.Column("target_release", sa.Text(), nullable=True))
    op.add_column("migration_runs", sa.Column("target_connected", sa.Boolean(), server_default="false"))
    op.add_column("migration_runs", sa.Column("records_total", sa.Integer(), server_default="0"))
    op.add_column("migration_runs", sa.Column("records_blocked", sa.Integer(), server_default="0"))
    op.alter_column("migration_runs", "source_system_id", nullable=True)

    for col, typ in (("source_table", sa.Text()), ("source_field", sa.Text()), ("source_value", sa.Text()),
                     ("target_value", sa.Text()), ("provenance", sa.Text())):
        op.add_column("migration_gap_findings", sa.Column(col, typ, nullable=True))
    op.add_column("migration_gap_findings", sa.Column("grounded", sa.Boolean(), server_default="true"))
    op.create_index("ix_migration_gap_findings_run_type", "migration_gap_findings", ["run_id", "gap_type", "severity"])

    op.drop_constraint("uq_transfer_field_mappings", "transfer_field_mappings", type_="unique")
    op.add_column("transfer_field_mappings", sa.Column("value_map", sa.Boolean(), server_default="false"))
    op.add_column("transfer_field_mappings", sa.Column("origin", sa.Text(), server_default="steward"))
    op.execute(
        "CREATE UNIQUE INDEX uq_transfer_field_mappings_pair ON transfer_field_mappings "
        "(tenant_id, module, source_field, dest_system_type, dest_table, dest_field) NULLS NOT DISTINCT"
    )

    op.create_table(
        "transfer_value_mappings",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("module", sa.Text(), nullable=False),
        sa.Column("target_field", sa.Text(), nullable=False),  # TABLE.FIELD in the target
        sa.Column("source_value", sa.Text(), nullable=False),
        sa.Column("target_value", sa.Text(), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("updated_by", UUID(as_uuid=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.UniqueConstraint("tenant_id", "module", "target_field", "source_value", name="uq_transfer_value_mappings"),
    )
    op.execute("ALTER TABLE transfer_value_mappings ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE transfer_value_mappings FORCE ROW LEVEL SECURITY")
    op.execute("DROP POLICY IF EXISTS transfer_value_mappings_rls ON transfer_value_mappings")
    op.execute(
        "CREATE POLICY transfer_value_mappings_rls ON transfer_value_mappings "
        "USING (tenant_id = current_setting('app.tenant_id')::uuid)"
    )


def downgrade() -> None:
    op.drop_table("transfer_value_mappings")
    op.execute("DROP INDEX IF EXISTS uq_transfer_field_mappings_pair")
    op.drop_column("transfer_field_mappings", "origin")
    op.drop_column("transfer_field_mappings", "value_map")
    op.create_unique_constraint("uq_transfer_field_mappings", "transfer_field_mappings",
                                ["tenant_id", "module", "source_field", "dest_system_type"])
    op.drop_index("ix_migration_gap_findings_run_type", "migration_gap_findings")
    for col in ("grounded", "provenance", "target_value", "source_value", "source_field", "source_table"):
        op.drop_column("migration_gap_findings", col)
    for col in ("records_blocked", "records_total", "target_connected", "target_release", "source_version_id"):
        op.drop_column("migration_runs", col)
