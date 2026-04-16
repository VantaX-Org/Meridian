"""Add cleaning engine tables: cleaning_rules, cleaning_queue, cleaning_audit,
dedup_candidates, cleaning_metrics, steward_metrics

Revision ID: 005
Revises: 004
Create Date: 2026-03-17

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "005"
down_revision: Union[str, None] = "004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # --- cleaning_rules ---
    op.create_table(
        "cleaning_rules",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("object_type", sa.Text(), nullable=False),
        sa.Column("category", sa.Text(), nullable=False),  # dedup|standardisation|enrichment|validation|lifecycle
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("detection_logic", sa.Text(), nullable=True),
        sa.Column("correction_logic", sa.Text(), nullable=True),
        sa.Column("risk_level", sa.Text(), nullable=False, server_default="medium"),  # low|medium|high
        sa.Column("automation_level", sa.Text(), nullable=False, server_default="single_approval"),  # auto|single_approval|dual_approval|triple_approval
        sa.Column("approval_required", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    # --- cleaning_queue ---
    op.create_table(
        "cleaning_queue",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("rule_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("cleaning_rules.id"), nullable=True),
        sa.Column("object_type", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False, server_default="detected"),  # detected|recommended|in_review|approved|applied|verified|rejected|rolled_back
        sa.Column("confidence", sa.Numeric(), nullable=True),  # 0-100
        sa.Column("record_key", sa.Text(), nullable=False),
        sa.Column("record_data_before", postgresql.JSONB(), nullable=True),
        sa.Column("record_data_after", postgresql.JSONB(), nullable=True),
        sa.Column("survivor_key", sa.Text(), nullable=True),
        sa.Column("merge_preview", postgresql.JSONB(), nullable=True),
        sa.Column("priority", sa.Integer(), nullable=False, server_default="50"),
        sa.Column("assigned_to", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("detected_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("approved_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("applied_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("rollback_deadline", sa.DateTime(timezone=True), nullable=True),
        sa.Column("batch_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("version_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("analysis_versions.id"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_cleaning_queue_tenant_status", "cleaning_queue", ["tenant_id", "status"])
    op.create_index("ix_cleaning_queue_tenant_object", "cleaning_queue", ["tenant_id", "object_type"])

    # --- cleaning_audit (immutable audit log) ---
    op.create_table(
        "cleaning_audit",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("queue_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("cleaning_queue.id"), nullable=False),
        sa.Column("rule_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("action", sa.Text(), nullable=False),  # detected|recommended|approved|rejected|applied|rolled_back|verified
        sa.Column("actor_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("actor_name", sa.Text(), nullable=True),
        sa.Column("record_key", sa.Text(), nullable=False),
        sa.Column("object_type", sa.Text(), nullable=False),
        sa.Column("data_before", postgresql.JSONB(), nullable=True),
        sa.Column("data_after", postgresql.JSONB(), nullable=True),
        sa.Column("metadata_", postgresql.JSONB(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_cleaning_audit_tenant_queue", "cleaning_audit", ["tenant_id", "queue_id"])

    # --- dedup_candidates ---
    op.create_table(
        "dedup_candidates",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("object_type", sa.Text(), nullable=False),
        sa.Column("record_key_a", sa.Text(), nullable=False),
        sa.Column("record_key_b", sa.Text(), nullable=False),
        sa.Column("match_score", sa.Numeric(), nullable=False),  # 0-100
        sa.Column("match_method", sa.Text(), nullable=False),  # exact|fuzzy|phonetic|token_overlap
        sa.Column("match_fields", postgresql.JSONB(), nullable=True),
        sa.Column("status", sa.Text(), nullable=False, server_default="pending"),  # pending|merged|dismissed
        sa.Column("survivor_key", sa.Text(), nullable=True),
        sa.Column("merged_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("merged_by", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_dedup_candidates_tenant_object", "dedup_candidates", ["tenant_id", "object_type"])

    # --- cleaning_metrics ---
    op.create_table(
        "cleaning_metrics",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("period", sa.Text(), nullable=False),  # YYYY-MM-DD
        sa.Column("period_type", sa.Text(), nullable=False),  # daily|weekly|monthly
        sa.Column("object_type", sa.Text(), nullable=False),
        sa.Column("detected", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("recommended", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("approved", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("rejected", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("applied", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("verified", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("rolled_back", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("auto_approved", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("avg_review_hours", sa.Numeric(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("tenant_id", "period", "period_type", "object_type", name="uq_cleaning_metrics_tenant_period"),
    )

    # --- steward_metrics ---
    op.create_table(
        "steward_metrics",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("period", sa.Text(), nullable=False),  # YYYY-MM-DD
        sa.Column("items_processed", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("items_approved", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("items_rejected", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("items_applied", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("total_review_hours", sa.Numeric(), nullable=False, server_default="0"),
        sa.Column("exceptions_resolved", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("dqs_impact", sa.Numeric(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    # --- RLS policies ---
    for table in ["cleaning_queue", "cleaning_audit", "dedup_candidates", "cleaning_metrics", "steward_metrics"]:
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(
            f"CREATE POLICY tenant_isolation ON {table} "
            f"USING (tenant_id = current_setting('app.tenant_id')::uuid)"
        )


def downgrade() -> None:
    for table in ["steward_metrics", "cleaning_metrics", "dedup_candidates", "cleaning_audit", "cleaning_queue", "cleaning_rules"]:
        op.execute(f"DROP POLICY IF EXISTS tenant_isolation ON {table}")
        op.drop_table(table)
