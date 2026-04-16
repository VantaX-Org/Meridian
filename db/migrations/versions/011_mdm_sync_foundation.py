"""MDM sync engine and AI foundation tables

Revision ID: 011
Revises: 010
Create Date: 2026-03-18

New tables:
  - sap_systems: Named SAP system registry per tenant
  - system_credentials: Encrypted RFC credential store
  - sync_profiles: Extraction schedule definitions
  - sync_runs: Audit log of every sync execution
  - ai_feedback_log: Append-only steward correction log
  - ai_proposed_rules: Quarantine table for AI-generated match rules
  - llm_audit_log: Audit log of every LLM call

All tables have RLS policies on tenant_id.
ai_feedback_log and llm_audit_log have append-only triggers (block UPDATE/DELETE).
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, JSONB

revision: str = "011"
down_revision: Union[str, None] = "010"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── sap_systems ──────────────────────────────────────────────────────────
    op.create_table(
        "sap_systems",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("host", sa.Text(), nullable=False),
        sa.Column("client", sa.Text(), nullable=False),
        sa.Column("sysnr", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("environment", sa.Text(), nullable=False, server_default="DEV"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("ix_sap_systems_tenant", "sap_systems", ["tenant_id"])
    op.execute("""
        ALTER TABLE sap_systems ENABLE ROW LEVEL SECURITY;
        CREATE POLICY tenant_isolation_sap_systems ON sap_systems
            USING (tenant_id = current_setting('app.tenant_id')::uuid);
    """)

    # ── system_credentials ───────────────────────────────────────────────────
    op.create_table(
        "system_credentials",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("system_id", UUID(as_uuid=True), sa.ForeignKey("sap_systems.id", ondelete="CASCADE"), nullable=False),
        sa.Column("encrypted_password", sa.Text(), nullable=False),
        sa.Column("key_version", sa.Integer(), nullable=False, server_default="1"),
    )
    op.create_index("ix_system_credentials_system", "system_credentials", ["system_id"], unique=True)
    # RLS via join to sap_systems — use a policy with subquery
    op.execute("""
        ALTER TABLE system_credentials ENABLE ROW LEVEL SECURITY;
        CREATE POLICY tenant_isolation_system_credentials ON system_credentials
            USING (system_id IN (
                SELECT id FROM sap_systems WHERE tenant_id = current_setting('app.tenant_id')::uuid
            ));
    """)

    # ── sync_profiles ────────────────────────────────────────────────────────
    op.create_table(
        "sync_profiles",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("system_id", UUID(as_uuid=True), sa.ForeignKey("sap_systems.id", ondelete="CASCADE"), nullable=False),
        sa.Column("domain", sa.Text(), nullable=False),
        sa.Column("tables", sa.ARRAY(sa.Text()), nullable=False, server_default="{}"),
        sa.Column("schedule_cron", sa.Text(), nullable=True),
        sa.Column("active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("last_run_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("next_run_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ai_anomaly_baseline", JSONB(), nullable=True),
    )
    op.create_index("ix_sync_profiles_tenant", "sync_profiles", ["tenant_id"])
    op.create_index("ix_sync_profiles_system", "sync_profiles", ["system_id"])
    op.execute("""
        ALTER TABLE sync_profiles ENABLE ROW LEVEL SECURITY;
        CREATE POLICY tenant_isolation_sync_profiles ON sync_profiles
            USING (tenant_id = current_setting('app.tenant_id')::uuid);
    """)

    # ── sync_runs ────────────────────────────────────────────────────────────
    op.create_table(
        "sync_runs",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("profile_id", UUID(as_uuid=True), sa.ForeignKey("sync_profiles.id", ondelete="CASCADE"), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("rows_extracted", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("findings_delta", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("golden_records_updated", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("status", sa.Text(), nullable=False, server_default="running"),
        sa.Column("error_detail", sa.Text(), nullable=True),
        sa.Column("ai_quality_score", sa.Float(), nullable=True),
        sa.Column("anomaly_flags", JSONB(), nullable=True),
    )
    op.create_index("ix_sync_runs_tenant", "sync_runs", ["tenant_id"])
    op.create_index("ix_sync_runs_profile", "sync_runs", ["profile_id"])
    op.create_index("ix_sync_runs_tenant_status", "sync_runs", ["tenant_id", "status"])
    op.execute("""
        ALTER TABLE sync_runs ENABLE ROW LEVEL SECURITY;
        CREATE POLICY tenant_isolation_sync_runs ON sync_runs
            USING (tenant_id = current_setting('app.tenant_id')::uuid);
    """)

    # ── ai_feedback_log ──────────────────────────────────────────────────────
    op.create_table(
        "ai_feedback_log",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("queue_item_id", UUID(as_uuid=True), nullable=False),
        sa.Column("steward_id", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("ai_recommendation", sa.Text(), nullable=False),
        sa.Column("steward_decision", sa.Text(), nullable=False),
        sa.Column("correction_reason", sa.Text(), nullable=True),
        sa.Column("domain", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("ix_ai_feedback_log_tenant", "ai_feedback_log", ["tenant_id"])
    op.execute("""
        ALTER TABLE ai_feedback_log ENABLE ROW LEVEL SECURITY;
        CREATE POLICY tenant_isolation_ai_feedback_log ON ai_feedback_log
            USING (tenant_id = current_setting('app.tenant_id')::uuid);
    """)
    # Append-only trigger — block UPDATE and DELETE
    op.execute("""
        CREATE OR REPLACE FUNCTION prevent_ai_feedback_log_mutation()
        RETURNS TRIGGER AS $$
        BEGIN
            RAISE EXCEPTION 'ai_feedback_log is append-only — UPDATE and DELETE are not permitted';
        END;
        $$ LANGUAGE plpgsql;

        CREATE TRIGGER ai_feedback_log_immutable
            BEFORE UPDATE OR DELETE ON ai_feedback_log
            FOR EACH ROW EXECUTE FUNCTION prevent_ai_feedback_log_mutation();
    """)

    # ── ai_proposed_rules ────────────────────────────────────────────────────
    op.create_table(
        "ai_proposed_rules",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("domain", sa.Text(), nullable=False),
        sa.Column("proposed_rule", JSONB(), nullable=False),
        sa.Column("rationale", sa.Text(), nullable=False),
        sa.Column("supporting_correction_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("status", sa.Text(), nullable=False, server_default="pending"),
        sa.Column("reviewed_by", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("ix_ai_proposed_rules_tenant", "ai_proposed_rules", ["tenant_id"])
    op.create_index("ix_ai_proposed_rules_tenant_status", "ai_proposed_rules", ["tenant_id", "status"])
    op.execute("""
        ALTER TABLE ai_proposed_rules ENABLE ROW LEVEL SECURITY;
        CREATE POLICY tenant_isolation_ai_proposed_rules ON ai_proposed_rules
            USING (tenant_id = current_setting('app.tenant_id')::uuid);
    """)

    # ── llm_audit_log ────────────────────────────────────────────────────────
    op.create_table(
        "llm_audit_log",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("service_name", sa.Text(), nullable=False),
        sa.Column("called_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("model_version", sa.Text(), nullable=False),
        sa.Column("prompt_hash", sa.Text(), nullable=False),
        sa.Column("token_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("latency_ms", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("success", sa.Boolean(), nullable=False, server_default="true"),
    )
    op.create_index("ix_llm_audit_log_tenant", "llm_audit_log", ["tenant_id"])
    op.create_index("ix_llm_audit_log_tenant_service", "llm_audit_log", ["tenant_id", "service_name"])
    op.execute("""
        ALTER TABLE llm_audit_log ENABLE ROW LEVEL SECURITY;
        CREATE POLICY tenant_isolation_llm_audit_log ON llm_audit_log
            USING (tenant_id = current_setting('app.tenant_id')::uuid);
    """)
    # Append-only trigger — block UPDATE and DELETE
    op.execute("""
        CREATE OR REPLACE FUNCTION prevent_llm_audit_log_mutation()
        RETURNS TRIGGER AS $$
        BEGIN
            RAISE EXCEPTION 'llm_audit_log is append-only — UPDATE and DELETE are not permitted';
        END;
        $$ LANGUAGE plpgsql;

        CREATE TRIGGER llm_audit_log_immutable
            BEFORE UPDATE OR DELETE ON llm_audit_log
            FOR EACH ROW EXECUTE FUNCTION prevent_llm_audit_log_mutation();
    """)


def downgrade() -> None:
    # Drop triggers first
    op.execute("DROP TRIGGER IF EXISTS llm_audit_log_immutable ON llm_audit_log;")
    op.execute("DROP FUNCTION IF EXISTS prevent_llm_audit_log_mutation();")
    op.execute("DROP TRIGGER IF EXISTS ai_feedback_log_immutable ON ai_feedback_log;")
    op.execute("DROP FUNCTION IF EXISTS prevent_ai_feedback_log_mutation();")

    # Drop policies
    op.execute("DROP POLICY IF EXISTS tenant_isolation_llm_audit_log ON llm_audit_log;")
    op.execute("DROP POLICY IF EXISTS tenant_isolation_ai_proposed_rules ON ai_proposed_rules;")
    op.execute("DROP POLICY IF EXISTS tenant_isolation_ai_feedback_log ON ai_feedback_log;")
    op.execute("DROP POLICY IF EXISTS tenant_isolation_sync_runs ON sync_runs;")
    op.execute("DROP POLICY IF EXISTS tenant_isolation_sync_profiles ON sync_profiles;")
    op.execute("DROP POLICY IF EXISTS tenant_isolation_system_credentials ON system_credentials;")
    op.execute("DROP POLICY IF EXISTS tenant_isolation_sap_systems ON sap_systems;")

    # Drop tables in reverse dependency order
    op.drop_table("llm_audit_log")
    op.drop_table("ai_proposed_rules")
    op.drop_table("ai_feedback_log")
    op.drop_table("sync_runs")
    op.drop_table("sync_profiles")
    op.drop_table("system_credentials")
    op.drop_table("sap_systems")
