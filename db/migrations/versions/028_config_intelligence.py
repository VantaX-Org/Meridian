"""Add 6 config intelligence tables: config_inventory, config_processes,
config_process_steps, config_alignment_findings, config_health_scores,
config_drift_log.

Revision ID: 028
Revises: 027
Create Date: 2026-04-03
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID, JSONB

# revision identifiers, used by Alembic.
revision: str = "028"
down_revision: Union[str, None] = "027"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. config_inventory
    op.create_table(
        "config_inventory",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("run_id", UUID(as_uuid=True), nullable=False),
        sa.Column("module", sa.VARCHAR(20), nullable=False),
        sa.Column("element_type", sa.VARCHAR(80), nullable=False),
        sa.Column("element_value", sa.VARCHAR(500), nullable=False),
        sa.Column("transaction_count", sa.Integer, server_default="0"),
        sa.Column("first_seen", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_seen", sa.DateTime(timezone=True), nullable=True),
        sa.Column("status", sa.VARCHAR(20), server_default="active"),
        sa.Column("sap_reference_table", sa.VARCHAR(80), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_index("ix_config_inventory_tenant_id", "config_inventory", ["tenant_id"])
    op.create_index("ix_config_inventory_run_id", "config_inventory", ["run_id"])
    op.create_index("ix_config_inventory_module", "config_inventory", ["module"])
    op.create_index("ix_config_inventory_element_type", "config_inventory", ["element_type"])

    # 2. config_processes
    op.create_table(
        "config_processes",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("run_id", UUID(as_uuid=True), nullable=False),
        sa.Column("process_id", sa.VARCHAR(20), nullable=False),
        sa.Column("process_name", sa.VARCHAR(100), nullable=False),
        sa.Column("status", sa.VARCHAR(20), server_default="inactive"),
        sa.Column("completeness_score", sa.Float, server_default="0"),
        sa.Column("exception_rate", sa.Float, server_default="0"),
        sa.Column("bottleneck_step", sa.VARCHAR(100), nullable=True),
        sa.Column("total_volume", sa.Integer, server_default="0"),
        sa.Column("avg_cycle_days", sa.Float, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_index("ix_config_processes_tenant_id", "config_processes", ["tenant_id"])
    op.create_index("ix_config_processes_run_id", "config_processes", ["run_id"])

    # 3. config_process_steps
    op.create_table(
        "config_process_steps",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("process_id", UUID(as_uuid=True), sa.ForeignKey("config_processes.id", ondelete="CASCADE"), nullable=False),
        sa.Column("step_number", sa.Integer, nullable=False),
        sa.Column("step_name", sa.VARCHAR(100), nullable=False),
        sa.Column("sap_table", sa.VARCHAR(20), nullable=True),
        sa.Column("detected", sa.Boolean, server_default="false"),
        sa.Column("volume", sa.Integer, server_default="0"),
        sa.Column("exception_count", sa.Integer, server_default="0"),
        sa.Column("avg_days_to_next_step", sa.Float, nullable=True),
    )
    op.create_index("ix_config_process_steps_process_id", "config_process_steps", ["process_id"])

    # 4. config_alignment_findings
    op.create_table(
        "config_alignment_findings",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("run_id", UUID(as_uuid=True), nullable=False),
        sa.Column("check_id", sa.VARCHAR(80), nullable=False),
        sa.Column("module", sa.VARCHAR(20), nullable=False),
        sa.Column("category", sa.VARCHAR(30), nullable=False),
        sa.Column("severity", sa.VARCHAR(20), nullable=False),
        sa.Column("title", sa.VARCHAR(500), nullable=False),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("affected_elements", JSONB, server_default=sa.text("'[]'")),
        sa.Column("remediation", sa.Text, nullable=True),
        sa.Column("estimated_impact_zar", sa.Float, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_index("ix_config_alignment_findings_tenant_id", "config_alignment_findings", ["tenant_id"])
    op.create_index("ix_config_alignment_findings_run_id", "config_alignment_findings", ["run_id"])
    op.create_index("ix_config_alignment_findings_category", "config_alignment_findings", ["category"])
    op.create_index("ix_config_alignment_findings_severity", "config_alignment_findings", ["severity"])

    # 5. config_health_scores
    op.create_table(
        "config_health_scores",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("run_id", UUID(as_uuid=True), nullable=False),
        sa.Column("module", sa.VARCHAR(20), nullable=False),
        sa.Column("chs_score", sa.Float, server_default="100"),
        sa.Column("critical_count", sa.Integer, server_default="0"),
        sa.Column("high_count", sa.Integer, server_default="0"),
        sa.Column("medium_count", sa.Integer, server_default="0"),
        sa.Column("low_count", sa.Integer, server_default="0"),
        sa.Column("recorded_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_index("ix_config_health_scores_tenant_id", "config_health_scores", ["tenant_id"])
    op.create_index("ix_config_health_scores_module", "config_health_scores", ["module"])

    # 6. config_drift_log
    op.create_table(
        "config_drift_log",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("run_id", UUID(as_uuid=True), nullable=False),
        sa.Column("module", sa.VARCHAR(20), nullable=False),
        sa.Column("element_type", sa.VARCHAR(80), nullable=False),
        sa.Column("element_value", sa.VARCHAR(500), nullable=False),
        sa.Column("change_type", sa.VARCHAR(20), nullable=False),
        sa.Column("previous_value", sa.Text, nullable=True),
        sa.Column("current_value", sa.Text, nullable=True),
        sa.Column("detected_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_index("ix_config_drift_log_tenant_id", "config_drift_log", ["tenant_id"])
    op.create_index("ix_config_drift_log_run_id", "config_drift_log", ["run_id"])


def downgrade() -> None:
    op.drop_table("config_drift_log")
    op.drop_table("config_health_scores")
    op.drop_table("config_alignment_findings")
    op.drop_table("config_process_steps")
    op.drop_table("config_processes")
    op.drop_table("config_inventory")
