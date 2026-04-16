"""Add exception management tables: exceptions, exception_comments,
exception_rules, exception_billing

Revision ID: 006
Revises: 005
Create Date: 2026-03-17

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "006"
down_revision: Union[str, None] = "005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # --- exceptions ---
    op.create_table(
        "exceptions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("type", sa.Text(), nullable=False),  # sap_transaction|dq_rule|custom_business|anomaly|contract_violation
        sa.Column("category", sa.Text(), nullable=False),
        sa.Column("severity", sa.Text(), nullable=False),  # critical|high|medium|low
        sa.Column("status", sa.Text(), nullable=False, server_default="open"),  # open|investigating|pending_approval|resolved|verified|closed
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("source_system", sa.Text(), nullable=True),
        sa.Column("source_reference", sa.Text(), nullable=True),
        sa.Column("affected_records", postgresql.JSONB(), nullable=True),
        sa.Column("estimated_impact_zar", sa.Numeric(), nullable=True),
        sa.Column("assigned_to", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("escalation_tier", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("sla_deadline", sa.DateTime(timezone=True), nullable=True),
        sa.Column("root_cause_category", sa.Text(), nullable=True),
        sa.Column("resolution_type", sa.Text(), nullable=True),
        sa.Column("resolution_notes", sa.Text(), nullable=True),
        sa.Column("linked_finding_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("findings.id"), nullable=True),
        sa.Column("linked_cleaning_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("cleaning_queue.id"), nullable=True),
        sa.Column("billing_tier", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_exceptions_tenant_status", "exceptions", ["tenant_id", "status"])
    op.create_index("ix_exceptions_tenant_type", "exceptions", ["tenant_id", "type"])
    op.create_index("ix_exceptions_tenant_severity", "exceptions", ["tenant_id", "severity"])
    op.create_index("ix_exceptions_sla_deadline", "exceptions", ["sla_deadline"])

    # --- exception_comments ---
    op.create_table(
        "exception_comments",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("exception_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("exceptions.id"), nullable=False),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("user_name", sa.Text(), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_exception_comments_exception", "exception_comments", ["exception_id"])

    # --- exception_rules ---
    op.create_table(
        "exception_rules",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("rule_type", sa.Text(), nullable=False),  # field_condition|cross_record|temporal|threshold|relationship|aggregate
        sa.Column("object_type", sa.Text(), nullable=False),
        sa.Column("condition", sa.Text(), nullable=False),
        sa.Column("severity", sa.Text(), nullable=False),
        sa.Column("auto_assign_to", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("created_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_exception_rules_tenant", "exception_rules", ["tenant_id"])

    # --- exception_billing ---
    op.create_table(
        "exception_billing",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("period", sa.Text(), nullable=False),  # YYYY-MM
        sa.Column("tier1_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("tier2_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("tier3_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("tier4_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("tier1_amount", sa.Numeric(), nullable=False, server_default="0"),
        sa.Column("tier2_amount", sa.Numeric(), nullable=False, server_default="0"),
        sa.Column("tier3_amount", sa.Numeric(), nullable=False, server_default="0"),
        sa.Column("tier4_amount", sa.Numeric(), nullable=False, server_default="0"),
        sa.Column("base_fee", sa.Numeric(), nullable=False, server_default="8000"),
        sa.Column("total_amount", sa.Numeric(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("tenant_id", "period", name="uq_exception_billing_tenant_period"),
    )

    # --- RLS policies ---
    for table in ["exceptions", "exception_comments"]:
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(
            f"CREATE POLICY tenant_isolation ON {table} "
            f"USING (tenant_id = current_setting('app.tenant_id')::uuid)"
        )


def downgrade() -> None:
    for table in ["exception_billing", "exception_rules", "exception_comments", "exceptions"]:
        op.execute(f"DROP POLICY IF EXISTS tenant_isolation ON {table}")
        op.drop_table(table)
