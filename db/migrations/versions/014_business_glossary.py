"""Business glossary tables

Revision ID: 014
Revises: 013
Create Date: 2026-03-18

New tables:
  - glossary_terms: One row per SAP field with business definitions
  - glossary_term_rules: Join table linking glossary terms to check rules
  - glossary_change_log: Immutable audit log (append-only via trigger)
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, JSONB

revision: str = "014"
down_revision: Union[str, None] = "013"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── glossary_terms ─────────────────────────────────────────────────────────
    op.create_table(
        "glossary_terms",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("domain", sa.Text(), nullable=False),
        sa.Column("sap_table", sa.Text(), nullable=False),
        sa.Column("sap_field", sa.Text(), nullable=False),
        sa.Column("technical_name", sa.Text(), nullable=False),
        sa.Column("business_name", sa.Text(), nullable=False),
        sa.Column("business_definition", sa.Text(), nullable=True),
        sa.Column("why_it_matters", sa.Text(), nullable=True),
        sa.Column("sap_impact", sa.Text(), nullable=True),
        sa.Column("approved_values", JSONB(), nullable=True),
        sa.Column("mandatory_for_s4hana", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("rule_authority", sa.Text(), nullable=True),
        sa.Column("data_steward_id", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("review_cycle_days", sa.Integer(), nullable=False, server_default="90"),
        sa.Column("last_reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("status", sa.Text(), nullable=False, server_default="active"),
        sa.Column("ai_drafted", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_unique_constraint("uq_glossary_terms_tenant_table_field", "glossary_terms", ["tenant_id", "sap_table", "sap_field"])
    op.create_index("ix_glossary_terms_tenant_domain", "glossary_terms", ["tenant_id", "domain"])
    op.execute("""
        ALTER TABLE glossary_terms ENABLE ROW LEVEL SECURITY;
        CREATE POLICY tenant_isolation_glossary_terms ON glossary_terms
            USING (tenant_id = current_setting('app.tenant_id')::uuid);
    """)

    # ── glossary_term_rules ────────────────────────────────────────────────────
    op.create_table(
        "glossary_term_rules",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("term_id", UUID(as_uuid=True), sa.ForeignKey("glossary_terms.id", ondelete="CASCADE"), nullable=False),
        sa.Column("rule_id", sa.Text(), nullable=False),
        sa.Column("domain", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_unique_constraint("uq_glossary_term_rules_tenant_term_rule", "glossary_term_rules", ["tenant_id", "term_id", "rule_id"])
    op.create_index("ix_glossary_term_rules_tenant_term", "glossary_term_rules", ["tenant_id", "term_id"])
    op.execute("""
        ALTER TABLE glossary_term_rules ENABLE ROW LEVEL SECURITY;
        CREATE POLICY tenant_isolation_glossary_term_rules ON glossary_term_rules
            USING (tenant_id = current_setting('app.tenant_id')::uuid);
    """)

    # ── glossary_change_log ────────────────────────────────────────────────────
    op.create_table(
        "glossary_change_log",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("term_id", UUID(as_uuid=True), sa.ForeignKey("glossary_terms.id", ondelete="CASCADE"), nullable=False),
        sa.Column("changed_by", sa.Text(), nullable=False),
        sa.Column("changed_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("field_changed", sa.Text(), nullable=False),
        sa.Column("old_value", sa.Text(), nullable=True),
        sa.Column("new_value", sa.Text(), nullable=True),
        sa.Column("change_reason", sa.Text(), nullable=True),
    )
    op.create_index("ix_glossary_change_log_tenant", "glossary_change_log", ["tenant_id"])
    op.create_index("ix_glossary_change_log_term", "glossary_change_log", ["term_id"])
    op.execute("""
        ALTER TABLE glossary_change_log ENABLE ROW LEVEL SECURITY;
        CREATE POLICY tenant_isolation_glossary_change_log ON glossary_change_log
            USING (tenant_id = current_setting('app.tenant_id')::uuid);
    """)
    # Append-only trigger — block UPDATE and DELETE
    op.execute("""
        CREATE OR REPLACE FUNCTION prevent_glossary_change_log_mutation()
        RETURNS TRIGGER AS $$
        BEGIN
            RAISE EXCEPTION 'glossary_change_log is append-only — UPDATE and DELETE are not permitted';
        END;
        $$ LANGUAGE plpgsql;

        CREATE TRIGGER glossary_change_log_immutable
            BEFORE UPDATE OR DELETE ON glossary_change_log
            FOR EACH ROW EXECUTE FUNCTION prevent_glossary_change_log_mutation();
    """)


def downgrade() -> None:
    # Drop triggers first
    op.execute("DROP TRIGGER IF EXISTS glossary_change_log_immutable ON glossary_change_log;")
    op.execute("DROP FUNCTION IF EXISTS prevent_glossary_change_log_mutation();")

    # Drop policies
    op.execute("DROP POLICY IF EXISTS tenant_isolation_glossary_change_log ON glossary_change_log;")
    op.execute("DROP POLICY IF EXISTS tenant_isolation_glossary_term_rules ON glossary_term_rules;")
    op.execute("DROP POLICY IF EXISTS tenant_isolation_glossary_terms ON glossary_terms;")

    # Drop tables in reverse dependency order
    op.drop_table("glossary_change_log")
    op.drop_table("glossary_term_rules")
    op.drop_table("glossary_terms")
