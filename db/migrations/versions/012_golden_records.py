"""Golden record store, history, and survivorship rules

Revision ID: 012
Revises: 011
Create Date: 2026-03-18

New tables:
  - master_records: Core golden record table with field-level provenance
  - master_record_history: Immutable audit log (append-only via trigger)
  - survivorship_rules: Configurable field-level survivorship logic per domain
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, JSONB

revision: str = "012"
down_revision: Union[str, None] = "011"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── master_records ────────────────────────────────────────────────────────
    op.create_table(
        "master_records",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("domain", sa.Text(), nullable=False),
        sa.Column("sap_object_key", sa.Text(), nullable=False),
        sa.Column("golden_fields", JSONB(), nullable=False, server_default="{}"),
        sa.Column("source_contributions", JSONB(), nullable=False, server_default="{}"),
        sa.Column("overall_confidence", sa.Float(), nullable=False, server_default="0.0"),
        sa.Column("status", sa.Text(), nullable=False, server_default="candidate"),
        sa.Column("promoted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("promoted_by", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("ix_master_records_tenant_domain_key", "master_records", ["tenant_id", "domain", "sap_object_key"], unique=True)
    op.create_index("ix_master_records_tenant_status", "master_records", ["tenant_id", "status"])
    op.execute("""
        ALTER TABLE master_records ENABLE ROW LEVEL SECURITY;
        CREATE POLICY tenant_isolation_master_records ON master_records
            USING (tenant_id = current_setting('app.tenant_id')::uuid);
    """)

    # ── master_record_history ─────────────────────────────────────────────────
    op.create_table(
        "master_record_history",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("master_record_id", UUID(as_uuid=True), sa.ForeignKey("master_records.id", ondelete="CASCADE"), nullable=False),
        sa.Column("changed_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("changed_by", UUID(as_uuid=True), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("change_type", sa.Text(), nullable=False),
        sa.Column("previous_fields", JSONB(), nullable=True),
        sa.Column("new_fields", JSONB(), nullable=True),
        sa.Column("ai_was_involved", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("ai_recommendation_accepted", sa.Boolean(), nullable=True),
    )
    op.create_index("ix_master_record_history_tenant", "master_record_history", ["tenant_id"])
    op.create_index("ix_master_record_history_record", "master_record_history", ["master_record_id"])
    op.execute("""
        ALTER TABLE master_record_history ENABLE ROW LEVEL SECURITY;
        CREATE POLICY tenant_isolation_master_record_history ON master_record_history
            USING (tenant_id = current_setting('app.tenant_id')::uuid);
    """)
    # Append-only trigger — block UPDATE and DELETE
    op.execute("""
        CREATE OR REPLACE FUNCTION prevent_master_record_history_mutation()
        RETURNS TRIGGER AS $$
        BEGIN
            RAISE EXCEPTION 'master_record_history is append-only — UPDATE and DELETE are not permitted';
        END;
        $$ LANGUAGE plpgsql;

        CREATE TRIGGER master_record_history_immutable
            BEFORE UPDATE OR DELETE ON master_record_history
            FOR EACH ROW EXECUTE FUNCTION prevent_master_record_history_mutation();
    """)

    # ── survivorship_rules ────────────────────────────────────────────────────
    op.create_table(
        "survivorship_rules",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("domain", sa.Text(), nullable=False),
        sa.Column("field", sa.Text(), nullable=False),
        sa.Column("rule_type", sa.Text(), nullable=False, server_default="most_recent"),
        sa.Column("trusted_sources", sa.ARRAY(sa.Text()), nullable=True),
        sa.Column("weight", sa.Integer(), nullable=False, server_default="50"),
        sa.Column("active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("ai_inferred", sa.Boolean(), nullable=False, server_default="false"),
    )
    op.create_index("ix_survivorship_rules_tenant_domain", "survivorship_rules", ["tenant_id", "domain"])
    op.execute("""
        ALTER TABLE survivorship_rules ENABLE ROW LEVEL SECURITY;
        CREATE POLICY tenant_isolation_survivorship_rules ON survivorship_rules
            USING (tenant_id = current_setting('app.tenant_id')::uuid);
    """)


def downgrade() -> None:
    # Drop triggers first
    op.execute("DROP TRIGGER IF EXISTS master_record_history_immutable ON master_record_history;")
    op.execute("DROP FUNCTION IF EXISTS prevent_master_record_history_mutation();")

    # Drop policies
    op.execute("DROP POLICY IF EXISTS tenant_isolation_survivorship_rules ON survivorship_rules;")
    op.execute("DROP POLICY IF EXISTS tenant_isolation_master_record_history ON master_record_history;")
    op.execute("DROP POLICY IF EXISTS tenant_isolation_master_records ON master_records;")

    # Drop tables in reverse dependency order
    op.drop_table("survivorship_rules")
    op.drop_table("master_record_history")
    op.drop_table("master_records")
