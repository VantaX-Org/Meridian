"""Create mining result tables + llm_decision_cache.

Adds persistent schema for the previously-orphaned mining pipeline
(`data_duplicates`, `data_anomalies`, `data_relationships`) and a
cross-service persistent LLM decision cache (`llm_decision_cache`)
used to survive Redis flushes and make second-run cost ~zero.

Revision ID: 037
Revises: 036
Create Date: 2026-04-22
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB, UUID


revision: str = "037"
down_revision: Union[str, None] = "036"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _enable_rls(table: str) -> None:
    op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
    op.execute(
        f"CREATE POLICY {table}_rls ON {table} "
        "USING (tenant_id = current_setting('app.tenant_id')::uuid)"
    )


def upgrade() -> None:
    # ── data_duplicates ────────────────────────────────────────────────────
    op.create_table(
        "data_duplicates",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("version_id", UUID(as_uuid=True), sa.ForeignKey("analysis_versions.id"), nullable=False),
        sa.Column("module_id", sa.Text(), nullable=False),
        sa.Column("record_a", sa.Text(), nullable=False),
        sa.Column("record_b", sa.Text(), nullable=False),
        sa.Column("match_score", sa.Numeric(4, 3), nullable=False),
        sa.Column("blocking_key", sa.Text(), nullable=True),
        sa.Column("id_field", sa.Text(), nullable=True),
        sa.Column("matched_fields", JSONB, nullable=True),
        sa.Column("detected_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )
    op.create_index(
        "ix_data_duplicates_tenant_version",
        "data_duplicates", ["tenant_id", "version_id"],
    )
    op.create_index(
        "ix_data_duplicates_module_score",
        "data_duplicates", ["module_id", "match_score"],
    )
    op.create_unique_constraint(
        "uq_data_duplicates_pair",
        "data_duplicates",
        ["tenant_id", "version_id", "module_id", "record_a", "record_b"],
    )
    _enable_rls("data_duplicates")

    # ── data_anomalies ─────────────────────────────────────────────────────
    op.create_table(
        "data_anomalies",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("version_id", UUID(as_uuid=True), sa.ForeignKey("analysis_versions.id"), nullable=False),
        sa.Column("module_id", sa.Text(), nullable=False),
        sa.Column("field_name", sa.Text(), nullable=False),
        sa.Column("field_value", sa.Numeric(), nullable=True),
        sa.Column("record_index", sa.Integer(), nullable=True),
        sa.Column("detection_method", sa.Text(), nullable=False),
        sa.Column("z_score", sa.Numeric(10, 4), nullable=True),
        sa.Column("severity", sa.Text(), nullable=False),
        sa.Column("bounds_json", JSONB, nullable=True),
        sa.Column("detected_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )
    op.create_index(
        "ix_data_anomalies_tenant_version",
        "data_anomalies", ["tenant_id", "version_id"],
    )
    op.create_index(
        "ix_data_anomalies_severity",
        "data_anomalies", ["module_id", "severity"],
    )
    _enable_rls("data_anomalies")

    # ── data_relationships ─────────────────────────────────────────────────
    op.create_table(
        "data_relationships",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("version_id", UUID(as_uuid=True), sa.ForeignKey("analysis_versions.id"), nullable=False),
        sa.Column("module_id", sa.Text(), nullable=False),
        sa.Column("field_a", sa.Text(), nullable=False),
        sa.Column("field_b", sa.Text(), nullable=False),
        sa.Column("relationship_type", sa.Text(), nullable=False),
        sa.Column("cardinality_json", JSONB, nullable=True),
        sa.Column("strength_score", sa.Numeric(4, 3), nullable=False),
        sa.Column("detected_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )
    op.create_index(
        "ix_data_relationships_tenant_version",
        "data_relationships", ["tenant_id", "version_id"],
    )
    op.create_index(
        "ix_data_relationships_strength",
        "data_relationships", ["module_id", "strength_score"],
    )
    op.create_unique_constraint(
        "uq_data_relationships_fields",
        "data_relationships",
        ["tenant_id", "version_id", "module_id", "field_a", "field_b"],
    )
    _enable_rls("data_relationships")

    # ── llm_decision_cache ─────────────────────────────────────────────────
    # Persistent cross-service cache: (service, input_hash) → decision payload.
    # Survives Redis flushes so second-run cost stays near zero.
    op.create_table(
        "llm_decision_cache",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("service_name", sa.Text(), nullable=False),
        sa.Column("input_hash", sa.Text(), nullable=False),   # sha256 of normalised input
        sa.Column("decision", JSONB, nullable=False),
        sa.Column("deterministic_hit", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_unique_constraint(
        "uq_llm_decision_cache_key",
        "llm_decision_cache",
        ["tenant_id", "service_name", "input_hash"],
    )
    op.create_index(
        "ix_llm_decision_cache_expiry",
        "llm_decision_cache",
        ["expires_at"],
        postgresql_where=sa.text("expires_at IS NOT NULL"),
    )
    _enable_rls("llm_decision_cache")

    # ── llm_audit_log: add deterministic_hit + skip_reason columns ─────────
    op.add_column(
        "llm_audit_log",
        sa.Column("deterministic_hit", sa.Boolean(), server_default=sa.text("false"), nullable=False),
    )
    op.add_column(
        "llm_audit_log",
        sa.Column("skip_reason", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("llm_audit_log", "skip_reason")
    op.drop_column("llm_audit_log", "deterministic_hit")

    for table in ("llm_decision_cache", "data_relationships", "data_anomalies", "data_duplicates"):
        op.execute(f"DROP POLICY IF EXISTS {table}_rls ON {table}")
        op.drop_table(table)
