"""two-factor sign-in: an authenticator app code after the password, and single-use recovery codes

Revision ID: 094
Revises: 093
Create Date: 2026-10-26

users.totp_secret      TEXT, the RFC 6238 shared secret encrypted with credential_store (AES-256-GCM,
                       CREDENTIAL_MASTER_KEY + tenant id: the SAP password scheme). Set by setup;
                       a secret with totp_enabled false is an unconfirmed setup.
users.totp_enabled     BOOLEAN NOT NULL DEFAULT false. True once the user confirmed a code.
users.totp_last_step   BIGINT, the 30-second step of the last code accepted: a code for that step or
                       an earlier one is refused, so a seen code cannot be replayed.
tenants.require_2fa    BOOLEAN NOT NULL DEFAULT false. Users without two-factor sign-in are made to set
                       it up after the password. A column because the tenant has no general settings
                       store: each JSONB on tenants (retention, llm_config, ...) belongs to one feature.
user_recovery_codes    one row per recovery code: SHA-256 of the code (80 random bits), used_at once
                       spent. Tenant-scoped, with the RLS policy every tenant table has.

Constant defaults make the column adds metadata-only, so nothing is rewritten and nobody is asked for
a code after the upgrade. Downgrade drops the table and the columns (every user is back to password only).
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision: str = "094"
down_revision: str | None = "093"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLE = "user_recovery_codes"


def upgrade() -> None:
    op.add_column("users", sa.Column("totp_secret", sa.Text(), nullable=True))
    op.add_column("users", sa.Column("totp_enabled", sa.Boolean(), nullable=False, server_default="false"))
    op.add_column("users", sa.Column("totp_last_step", sa.BigInteger(), nullable=True))
    op.add_column("tenants", sa.Column("require_2fa", sa.Boolean(), nullable=False, server_default="false"))

    op.create_table(
        _TABLE,
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("tenant_id", UUID(as_uuid=True), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("code_hash", sa.Text(), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
    )
    op.create_index("uq_user_recovery_codes_user_hash", _TABLE, ["user_id", "code_hash"], unique=True)

    op.execute("ALTER TABLE user_recovery_codes ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE user_recovery_codes FORCE ROW LEVEL SECURITY")
    op.execute("DROP POLICY IF EXISTS user_recovery_codes_rls ON user_recovery_codes")
    op.execute("CREATE POLICY user_recovery_codes_rls ON user_recovery_codes "
               "USING (tenant_id = current_setting('app.tenant_id')::uuid)")


def downgrade() -> None:
    op.drop_table(_TABLE)
    op.drop_column("tenants", "require_2fa")
    op.drop_column("users", "totp_last_step")
    op.drop_column("users", "totp_enabled")
    op.drop_column("users", "totp_secret")
