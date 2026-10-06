"""Process flows derived from configuration, one per analysed dataset version.

  process_derivations  jsonb ProcessModelDocument (source "config") with per-node evidence:
                       config keys and codes only, never transactional or master data

Revision ID: 063
Revises: 062
Create Date: 2026-10-06
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision: str = "063"
down_revision: Union[str, None] = "062"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "process_derivations",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id"), nullable=False),
        sa.Column("version_id", UUID(as_uuid=True), nullable=False),
        sa.Column("system_type", sa.Text(), nullable=False),
        sa.Column("document", JSONB(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.UniqueConstraint("tenant_id", "version_id", name="uq_process_derivations"),
    )
    op.create_index("ix_process_derivations_tenant", "process_derivations",
                    ["tenant_id", sa.text("created_at DESC")])
    op.execute("ALTER TABLE process_derivations ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE process_derivations FORCE ROW LEVEL SECURITY")
    op.execute("DROP POLICY IF EXISTS process_derivations_rls ON process_derivations")
    op.execute("CREATE POLICY process_derivations_rls ON process_derivations "
               "USING (tenant_id = current_setting('app.tenant_id')::uuid)")


def downgrade() -> None:
    op.drop_table("process_derivations")
