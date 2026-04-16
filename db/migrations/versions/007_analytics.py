"""Add analytics tables: dqs_history, impact_records, cost_avoidance

Revision ID: 007
Revises: 006
Create Date: 2026-03-17

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "007"
down_revision: Union[str, None] = "006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # --- dqs_history ---
    op.create_table(
        "dqs_history",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("module_id", sa.Text(), nullable=False),
        sa.Column("dqs_score", sa.Numeric(), nullable=False),
        sa.Column("completeness", sa.Numeric(), nullable=True),
        sa.Column("accuracy", sa.Numeric(), nullable=True),
        sa.Column("consistency", sa.Numeric(), nullable=True),
        sa.Column("timeliness", sa.Numeric(), nullable=True),
        sa.Column("uniqueness", sa.Numeric(), nullable=True),
        sa.Column("validity", sa.Numeric(), nullable=True),
        sa.Column("finding_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("recorded_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_dqs_history_tenant_module_recorded", "dqs_history", ["tenant_id", "module_id", "recorded_at"])

    # --- impact_records ---
    op.create_table(
        "impact_records",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("version_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("analysis_versions.id"), nullable=False),
        sa.Column("category", sa.Text(), nullable=False),  # duplicate_payment|warranty_miss|inventory_write_off|compliance_penalty|blocked_invoice|failed_posting|labour_displacement|contract_violation
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("annual_risk_zar", sa.Numeric(), nullable=False, server_default="0"),
        sa.Column("mitigated_zar", sa.Numeric(), nullable=False, server_default="0"),
        sa.Column("finding_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("calculation_method", sa.Text(), nullable=True),
        sa.Column("recorded_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_impact_records_tenant_version", "impact_records", ["tenant_id", "version_id"])

    # --- cost_avoidance ---
    op.create_table(
        "cost_avoidance",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("period", sa.Text(), nullable=False),  # YYYY-MM
        sa.Column("subscription_cost_zar", sa.Numeric(), nullable=False, server_default="0"),
        sa.Column("risk_mitigated_zar", sa.Numeric(), nullable=False, server_default="0"),
        sa.Column("exceptions_value_zar", sa.Numeric(), nullable=False, server_default="0"),
        sa.Column("cleaning_value_zar", sa.Numeric(), nullable=False, server_default="0"),
        sa.Column("cumulative_roi_multiple", sa.Numeric(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("tenant_id", "period", name="uq_cost_avoidance_tenant_period"),
    )

    # --- RLS policies ---
    for table in ["dqs_history", "impact_records", "cost_avoidance"]:
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(
            f"CREATE POLICY tenant_isolation ON {table} "
            f"USING (tenant_id = current_setting('app.tenant_id')::uuid)"
        )


def downgrade() -> None:
    for table in ["cost_avoidance", "impact_records", "dqs_history"]:
        op.execute(f"DROP POLICY IF EXISTS tenant_isolation ON {table}")
        op.drop_table(table)
