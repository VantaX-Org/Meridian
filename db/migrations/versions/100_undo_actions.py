"""undo window for work decisions

Revision ID: 100
Revises: 099
Create Date: 2026-10-29

undo_actions: one row per mutating decision (decide, group accept-all / set-value, assign, batch approve / send-back)
holding what the decision did (``payload``) and what puts it back (``inverse``), so POST /api/v1/actions/undo can
revert it within ten minutes. ``user_id`` is the deciding user's id as text (the same owner key saved_views uses,
'local' when auth is off). ``undone_at`` is set once, when the inverse has been applied. Tenant-scoped: ENABLE +
FORCE row-level security with the tenant policy, like migration 099.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision: str = "100"
down_revision: Union[str, None] = "099"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TABLE = "undo_actions"


def upgrade() -> None:
    op.create_table(
        _TABLE,
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", sa.Text(), nullable=False),
        sa.Column("kind", sa.Text(), nullable=False),
        sa.Column("payload", JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("inverse", JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("undone_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_undo_actions_tenant_user", _TABLE, ["tenant_id", "user_id", sa.text("created_at DESC")])
    op.execute("ALTER TABLE undo_actions ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE undo_actions FORCE ROW LEVEL SECURITY")
    op.execute("DROP POLICY IF EXISTS undo_actions_rls ON undo_actions")
    op.execute("CREATE POLICY undo_actions_rls ON undo_actions "
               "USING (tenant_id = current_setting('app.tenant_id')::uuid)")


def downgrade() -> None:
    op.drop_table(_TABLE)
