"""Cross-domain relationship graph

Revision ID: 016
Revises: 015
Create Date: 2026-03-18

New tables:
  - record_relationships: Cross-domain relationships between master records (RLS)
  - relationship_types: Reference table of known SAP cross-domain relationship types (no RLS)
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision: str = "016"
down_revision: Union[str, None] = "015"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── relationship_types (shared reference data — no RLS) ────────────────────
    op.create_table(
        "relationship_types",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("from_table", sa.Text(), nullable=False),
        sa.Column("to_table", sa.Text(), nullable=False),
        sa.Column("relationship_type", sa.Text(), nullable=False, unique=True),
        sa.Column("description", sa.Text(), nullable=True),
    )

    # Pre-populate the 5 known SAP cross-domain links
    op.execute("""
        INSERT INTO relationship_types (id, from_table, to_table, relationship_type, description)
        VALUES
            (gen_random_uuid(), 'BUT000', 'KNA1',  'bp_is_customer',          'Business Partner is a Customer'),
            (gen_random_uuid(), 'BUT000', 'LFA1',  'bp_is_vendor',            'Business Partner is a Vendor'),
            (gen_random_uuid(), 'MARA',   'MARC',  'material_at_plant',       'Material exists at Plant'),
            (gen_random_uuid(), 'SKA1',   'SKB1',  'gl_in_company_code',      'GL Account in Company Code'),
            (gen_random_uuid(), 'BSEG',   'BUT000','fi_posting_references_bp','FI Posting references Business Partner')
        ON CONFLICT DO NOTHING
    """)

    # ── record_relationships (tenant-scoped, RLS) ──────────────────────────────
    op.create_table(
        "record_relationships",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("from_domain", sa.Text(), nullable=False),
        sa.Column("from_key", sa.Text(), nullable=False),
        sa.Column("to_domain", sa.Text(), nullable=False),
        sa.Column("to_key", sa.Text(), nullable=False),
        sa.Column("relationship_type", sa.Text(), nullable=False),
        sa.Column("sap_link_table", sa.Text(), nullable=True),
        sa.Column("discovered_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("ai_inferred", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("ai_confidence", sa.Float(), nullable=True),
        sa.Column("impact_score", sa.Float(), nullable=True),
    )

    # Indexes for record_relationships
    op.create_index(
        "ix_record_relationships_tenant",
        "record_relationships",
        ["tenant_id"],
    )
    op.create_index(
        "ix_record_relationships_from",
        "record_relationships",
        ["tenant_id", "from_domain", "from_key"],
    )
    op.create_index(
        "ix_record_relationships_to",
        "record_relationships",
        ["tenant_id", "to_domain", "to_key"],
    )
    op.create_unique_constraint(
        "uq_record_relationships_pair",
        "record_relationships",
        ["tenant_id", "from_domain", "from_key", "to_domain", "to_key", "relationship_type"],
    )

    # RLS policy on record_relationships
    op.execute("""
        ALTER TABLE record_relationships ENABLE ROW LEVEL SECURITY;
        CREATE POLICY tenant_isolation_record_relationships
            ON record_relationships
            USING (tenant_id = current_setting('app.tenant_id')::uuid);
    """)


def downgrade() -> None:
    op.execute("DROP POLICY IF EXISTS tenant_isolation_record_relationships ON record_relationships")
    op.drop_table("record_relationships")
    op.drop_table("relationship_types")
