"""api keys for service accounts

Revision ID: 099
Revises: 098
Create Date: 2026-10-28

api_keys: a long-lived credential for a scheduler or script. Each key belongs to a service user (a users row with
no password, whose email ends in the reserved service domain) and authenticates as that user, so it holds exactly
that user's grants and no more. ``key_prefix`` is the public part of ``mk_<prefix>.<secret>`` (unique, used to find
the row); ``key_hash`` is the SHA-256 of the secret, which is never stored. The only columns this adds to existing
tables: none. Tenant-scoped: ENABLE + FORCE row-level security with the tenant policy, like migration 097.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision: str = "099"
down_revision: Union[str, None] = "098"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TABLE = "api_keys"


def upgrade() -> None:
    op.create_table(
        _TABLE,
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("key_prefix", sa.Text(), nullable=False, unique=True),
        sa.Column("key_hash", sa.Text(), nullable=False),
        sa.Column("created_by", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_api_keys_tenant_id", _TABLE, ["tenant_id"])
    op.create_index("ix_api_keys_user_id", _TABLE, ["user_id"])
    op.execute("ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE api_keys FORCE ROW LEVEL SECURITY")
    op.execute("DROP POLICY IF EXISTS api_keys_rls ON api_keys")
    op.execute("CREATE POLICY api_keys_rls ON api_keys "
               "USING (tenant_id = current_setting('app.tenant_id')::uuid)")


def downgrade() -> None:
    op.drop_table(_TABLE)
