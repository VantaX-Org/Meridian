"""data owners

Revision ID: 074
Revises: 073
Create Date: 2026-10-10

A named owner and steward per object (module id), rule (check id) or system.
Triage auto-assign uses them before the tenant's fallback owner. Field ownership
stays on glossary_terms.data_steward_id.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision: str = "074"
down_revision: Union[str, None] = "073"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "data_owners",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("kind", sa.Text(), nullable=False),
        sa.Column("ref", sa.Text(), nullable=False),
        sa.Column("owner_user_id", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("steward_user_id", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"),
                  nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.CheckConstraint("kind IN ('object', 'rule', 'system')", name="ck_data_owners_kind"),
        sa.UniqueConstraint("tenant_id", "kind", "ref", name="uq_data_owners_kind_ref"),
    )
    op.execute("ALTER TABLE data_owners ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE data_owners FORCE ROW LEVEL SECURITY")
    op.execute("DROP POLICY IF EXISTS data_owners_rls ON data_owners")
    op.execute("CREATE POLICY data_owners_rls ON data_owners "
               "USING (tenant_id = current_setting('app.tenant_id')::uuid)")


def downgrade() -> None:
    op.execute("DROP POLICY IF EXISTS data_owners_rls ON data_owners")
    op.drop_table("data_owners")
