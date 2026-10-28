"""user lifecycle, per-account lockout and grant expiry

Revision ID: 096
Revises: 095
Create Date: 2026-10-28

users: invite lifecycle (invited_at, invite_sent_at, invite_status, invite_expires_at), per-account
lockout (failed_login_count, locked_until) and password_changed_at. user_role_scopes.expires_at: a grant
stops authorising at that instant and the nightly purge deletes it. All additive; existing rows keep
NULL (no expiry, no invite history) and a zero failed-login count. Downgrade drops the columns.
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "096"
down_revision: str | None = "095"
branch_labels: Sequence[str] | None = None
depends_on: Sequence[str] | None = None

_TZ = sa.DateTime(timezone=True)


def upgrade() -> None:
    op.add_column("users", sa.Column("invited_at", _TZ, nullable=True))
    op.add_column("users", sa.Column("invite_sent_at", _TZ, nullable=True))
    op.add_column("users", sa.Column("invite_status", sa.Text(), nullable=True))
    op.add_column("users", sa.Column("invite_expires_at", _TZ, nullable=True))
    op.add_column("users", sa.Column("failed_login_count", sa.Integer(), nullable=False, server_default="0"))
    op.add_column("users", sa.Column("locked_until", _TZ, nullable=True))
    op.add_column("users", sa.Column("password_changed_at", _TZ, nullable=True))
    op.create_check_constraint(
        "ck_users_invite_status", "users",
        "invite_status IS NULL OR invite_status IN ('queued', 'sent', 'failed', 'accepted')")
    op.add_column("user_role_scopes", sa.Column("expires_at", _TZ, nullable=True))
    op.create_index("ix_user_role_scopes_expires", "user_role_scopes", ["tenant_id", "expires_at"])


def downgrade() -> None:
    op.drop_index("ix_user_role_scopes_expires", table_name="user_role_scopes")
    op.drop_column("user_role_scopes", "expires_at")
    op.drop_constraint("ck_users_invite_status", "users", type_="check")
    for col in ("password_changed_at", "locked_until", "failed_login_count", "invite_expires_at",
                "invite_status", "invite_sent_at", "invited_at"):
        op.drop_column("users", col)
