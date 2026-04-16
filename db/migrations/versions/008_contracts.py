"""Add contracts and contract_compliance_history tables

Revision ID: 008
Revises: 007
Create Date: 2026-03-17

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "008"
down_revision: Union[str, None] = "007"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # --- contracts ---
    op.create_table(
        "contracts",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("producer", sa.Text(), nullable=False),
        sa.Column("consumer", sa.Text(), nullable=False),
        sa.Column("schema_contract", postgresql.JSONB(), nullable=True),
        sa.Column("quality_contract", postgresql.JSONB(), nullable=True),
        sa.Column("freshness_contract", postgresql.JSONB(), nullable=True),
        sa.Column("volume_contract", postgresql.JSONB(), nullable=True),
        sa.Column("status", sa.Text(), nullable=False, server_default="draft"),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("approved_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("activated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_contracts_tenant_status", "contracts", ["tenant_id", "status"])

    # --- contract_compliance_history ---
    op.create_table(
        "contract_compliance_history",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("contract_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("contracts.id"), nullable=False),
        sa.Column("version_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("analysis_versions.id"), nullable=True),
        sa.Column("completeness_actual", sa.Numeric(), nullable=True),
        sa.Column("accuracy_actual", sa.Numeric(), nullable=True),
        sa.Column("consistency_actual", sa.Numeric(), nullable=True),
        sa.Column("timeliness_actual", sa.Numeric(), nullable=True),
        sa.Column("uniqueness_actual", sa.Numeric(), nullable=True),
        sa.Column("validity_actual", sa.Numeric(), nullable=True),
        sa.Column("overall_compliant", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("violations", postgresql.JSONB(), nullable=True),
        sa.Column("recorded_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index(
        "ix_contract_compliance_tenant_contract_recorded",
        "contract_compliance_history",
        ["tenant_id", "contract_id", "recorded_at"],
    )

    # --- RLS policies ---
    for table in ["contracts", "contract_compliance_history"]:
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(
            f"CREATE POLICY tenant_isolation ON {table} "
            f"USING (tenant_id = current_setting('app.tenant_id')::uuid)"
        )


def downgrade() -> None:
    for table in ["contract_compliance_history", "contracts"]:
        op.execute(f"DROP POLICY IF EXISTS tenant_isolation ON {table}")
        op.drop_table(table)
