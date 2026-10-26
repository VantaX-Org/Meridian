"""user token version: revoke a user's sessions on password change, reset and deactivation

Revision ID: 092
Revises: 091
Create Date: 2026-10-26

users.token_version (INTEGER NOT NULL DEFAULT 0). Access tokens carry it as the ``tv`` claim
(api/services/local_auth.create_access_token); LocalAuthMiddleware rejects a token whose ``tv`` is
below the user's current value. Changing or resetting a password and deactivating a user add one,
which revokes every session issued before. Tokens issued before this migration have no ``tv`` and
count as 0, so the upgrade signs nobody out.

No new table (so no new RLS policy). Adding a column with a constant default is metadata-only on
Postgres 11+, so the upgrade does not rewrite users. Downgrade drops the column.
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "092"
down_revision: str | None = "091"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("users", sa.Column("token_version", sa.Integer(), nullable=False, server_default="0"))


def downgrade() -> None:
    op.drop_column("users", "token_version")
