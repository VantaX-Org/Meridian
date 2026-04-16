"""Add 6 Z-Object Intelligence tables: z_object_registry, z_object_profiles,
z_object_baselines, z_object_anomalies, z_object_rules, z_object_findings.

Revision ID: 029
Revises: 028
Create Date: 2026-04-07
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID, JSONB

# revision identifiers, used by Alembic.
revision: str = "029"
down_revision: Union[str, None] = "028"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. z_object_registry — master governance catalogue
    op.create_table(
        "z_object_registry",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("category", sa.VARCHAR(30), nullable=False),
        sa.Column("module", sa.VARCHAR(20), nullable=False),
        sa.Column("object_name", sa.VARCHAR(200), nullable=False),
        sa.Column("standard_equivalent", sa.VARCHAR(200), nullable=True),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("owner", sa.VARCHAR(200), nullable=True),
        sa.Column("created_date", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("last_active_date", sa.DateTime(timezone=True), nullable=True),
        sa.Column("status", sa.VARCHAR(20), server_default="under_review"),
        sa.Column("transaction_count_total", sa.Integer, server_default="0"),
        sa.Column("profile_snapshot", JSONB, nullable=True),
        sa.Column("baseline_snapshot", JSONB, nullable=True),
        sa.Column("rules_applied", JSONB, server_default=sa.text("'[]'")),
        sa.Column("notes", sa.Text, nullable=True),
        sa.UniqueConstraint("tenant_id", "module", "category", "object_name", name="uq_z_registry_tenant_module_cat_name"),
    )
    op.create_index("ix_z_object_registry_tenant_id", "z_object_registry", ["tenant_id"])
    op.create_index("ix_z_object_registry_tenant_status", "z_object_registry", ["tenant_id", "status"])
    op.create_index("ix_z_object_registry_tenant_module", "z_object_registry", ["tenant_id", "module"])

    # 2. z_object_profiles — per-run profile snapshot for trending
    op.create_table(
        "z_object_profiles",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("z_object_id", UUID(as_uuid=True), sa.ForeignKey("z_object_registry.id", ondelete="CASCADE"), nullable=False),
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("run_id", UUID(as_uuid=True), nullable=False),
        sa.Column("data_type", sa.VARCHAR(30), nullable=True),
        sa.Column("cardinality", sa.Integer, server_default="0"),
        sa.Column("null_rate", sa.Float, server_default="0"),
        sa.Column("value_distribution", JSONB, nullable=True),
        sa.Column("length_stats", JSONB, nullable=True),
        sa.Column("format_pattern", sa.VARCHAR(200), nullable=True),
        sa.Column("relationship_score", sa.Float, server_default="0"),
        sa.Column("related_standard_field", sa.VARCHAR(80), nullable=True),
        sa.Column("transaction_count", sa.Integer, server_default="0"),
        sa.Column("user_count", sa.Integer, server_default="0"),
        sa.Column("first_seen", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_seen", sa.DateTime(timezone=True), nullable=True),
        sa.Column("trend_direction", sa.VARCHAR(20), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_index("ix_z_object_profiles_z_object_id", "z_object_profiles", ["z_object_id"])
    op.create_index("ix_z_object_profiles_tenant_id", "z_object_profiles", ["tenant_id"])
    op.create_index("ix_z_object_profiles_run_id", "z_object_profiles", ["run_id"])

    # 3. z_object_baselines — learned baseline for anomaly detection
    op.create_table(
        "z_object_baselines",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("z_object_id", UUID(as_uuid=True), sa.ForeignKey("z_object_registry.id", ondelete="CASCADE"), nullable=False),
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("mean_volume", sa.Float, server_default="0"),
        sa.Column("stddev_volume", sa.Float, server_default="0"),
        sa.Column("expected_null_rate", sa.Float, server_default="0"),
        sa.Column("expected_cardinality", sa.Integer, server_default="0"),
        sa.Column("format_pattern", sa.VARCHAR(200), nullable=True),
        sa.Column("distribution_hash", sa.VARCHAR(64), nullable=True),
        sa.Column("relationship_baseline", JSONB, nullable=True),
        sa.Column("learning_count", sa.Integer, server_default="0"),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.UniqueConstraint("z_object_id", "tenant_id", name="uq_z_baselines_object_tenant"),
    )
    op.create_index("ix_z_object_baselines_z_object_id", "z_object_baselines", ["z_object_id"])
    op.create_index("ix_z_object_baselines_tenant_id", "z_object_baselines", ["tenant_id"])

    # 4. z_object_anomalies — detected anomalies against baselines
    op.create_table(
        "z_object_anomalies",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("z_object_id", UUID(as_uuid=True), sa.ForeignKey("z_object_registry.id", ondelete="CASCADE"), nullable=False),
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("run_id", UUID(as_uuid=True), nullable=False),
        sa.Column("anomaly_type", sa.VARCHAR(40), nullable=False),
        sa.Column("severity", sa.VARCHAR(20), nullable=False),
        sa.Column("description", sa.Text, nullable=False),
        sa.Column("baseline_value", sa.VARCHAR(200), nullable=True),
        sa.Column("current_value", sa.VARCHAR(200), nullable=True),
        sa.Column("deviation_pct", sa.Float, server_default="0"),
        sa.Column("status", sa.VARCHAR(20), server_default="active"),
        sa.Column("feedback_by", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("feedback_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_index("ix_z_object_anomalies_z_object_id", "z_object_anomalies", ["z_object_id"])
    op.create_index("ix_z_object_anomalies_tenant_id", "z_object_anomalies", ["tenant_id"])
    op.create_index("ix_z_object_anomalies_run_id", "z_object_anomalies", ["run_id"])

    # 5. z_object_rules — rules applied to Z objects
    op.create_table(
        "z_object_rules",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("z_object_id", UUID(as_uuid=True), sa.ForeignKey("z_object_registry.id", ondelete="SET NULL"), nullable=True),
        sa.Column("rule_template_id", sa.VARCHAR(20), nullable=True),
        sa.Column("rule_name", sa.VARCHAR(200), nullable=False),
        sa.Column("custom_condition", sa.Text, nullable=True),
        sa.Column("severity", sa.VARCHAR(20), server_default="medium"),
        sa.Column("is_active", sa.Boolean, server_default="true"),
        sa.Column("created_by", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_index("ix_z_object_rules_tenant_id", "z_object_rules", ["tenant_id"])

    # 6. z_object_findings — Z-rule violation findings per run
    op.create_table(
        "z_object_findings",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("z_object_id", UUID(as_uuid=True), sa.ForeignKey("z_object_registry.id", ondelete="CASCADE"), nullable=False),
        sa.Column("rule_id", UUID(as_uuid=True), sa.ForeignKey("z_object_rules.id", ondelete="CASCADE"), nullable=False),
        sa.Column("run_id", UUID(as_uuid=True), nullable=False),
        sa.Column("severity", sa.VARCHAR(20), nullable=False),
        sa.Column("title", sa.VARCHAR(500), nullable=False),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("affected_records", JSONB, server_default=sa.text("'[]'")),
        sa.Column("remediation", sa.Text, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
    )
    op.create_index("ix_z_object_findings_tenant_id", "z_object_findings", ["tenant_id"])
    op.create_index("ix_z_object_findings_z_object_id", "z_object_findings", ["z_object_id"])
    op.create_index("ix_z_object_findings_run_id", "z_object_findings", ["run_id"])


def downgrade() -> None:
    op.drop_table("z_object_findings")
    op.drop_table("z_object_rules")
    op.drop_table("z_object_anomalies")
    op.drop_table("z_object_baselines")
    op.drop_table("z_object_profiles")
    op.drop_table("z_object_registry")
