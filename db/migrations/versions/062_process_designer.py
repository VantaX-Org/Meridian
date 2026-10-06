"""Process designer: versioned process models and discovered process variants.

  process_models          one row per named model (draft | published)
  process_model_versions  immutable jsonb snapshot per save
  process_variants        discovery output per analysed dataset version:
                          counts and dates per (table, field, value) only

Revision ID: 062
Revises: 061
Create Date: 2026-10-06
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision: str = "062"
down_revision: Union[str, None] = "061"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TABLES = ("process_models", "process_model_versions", "process_variants")


def upgrade() -> None:
    op.create_table(
        "process_models",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("status", sa.Text(), nullable=False, server_default="draft"),
        sa.Column("current_version", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_by", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.UniqueConstraint("tenant_id", "name", name="uq_process_models_name"),
        sa.CheckConstraint("status IN ('draft', 'published')", name="ck_process_models_status"),
    )

    op.create_table(
        "process_model_versions",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("model_id", UUID(as_uuid=True), sa.ForeignKey("process_models.id", ondelete="CASCADE"),
                  nullable=False),
        sa.Column("version_no", sa.Integer(), nullable=False),
        sa.Column("document", JSONB(), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("created_by", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.UniqueConstraint("model_id", "version_no", name="uq_process_model_versions"),
    )
    op.create_index("ix_process_model_versions_model", "process_model_versions",
                    ["tenant_id", "model_id", sa.text("version_no DESC")])

    op.create_table(
        "process_variants",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("version_id", UUID(as_uuid=True), nullable=False),
        sa.Column("process_id", sa.Text(), nullable=False),
        sa.Column("l4_id", sa.Text(), nullable=True),
        sa.Column("sap_table", sa.Text(), nullable=False),
        sa.Column("sap_field", sa.Text(), nullable=False),
        sa.Column("value", sa.Text(), nullable=False),
        sa.Column("doc_count", sa.BigInteger(), nullable=False),
        sa.Column("first_seen", sa.Date(), nullable=True),
        sa.Column("last_seen", sa.Date(), nullable=True),
        sa.Column("classification", sa.Text(), nullable=False),
        sa.Column("config_table", sa.Text(), nullable=True),
        sa.Column("evidence", sa.Text(), nullable=False, server_default="extracted"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.UniqueConstraint("tenant_id", "version_id", "sap_table", "sap_field", "value",
                            name="uq_process_variants"),
        sa.CheckConstraint("classification IN ('implemented', 'dormant', 'configured_not_used', "
                           "'customer_specific')", name="ck_process_variants_class"),
    )
    op.create_index("ix_process_variants_version", "process_variants", ["tenant_id", "version_id"])

    for t in _TABLES:
        op.execute(f"ALTER TABLE {t} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {t} FORCE ROW LEVEL SECURITY")
        op.execute(f"DROP POLICY IF EXISTS {t}_rls ON {t}")
        op.execute(f"CREATE POLICY {t}_rls ON {t} USING (tenant_id = current_setting('app.tenant_id')::uuid)")


def downgrade() -> None:
    for t in reversed(_TABLES):
        op.drop_table(t)
