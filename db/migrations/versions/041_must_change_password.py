"""Add must_change_password flag to users so the bootstrap admin forces
a password rotation on first login.

Since the deploy script seeds a default `admin@meridian.local` / `admin`
user on every fresh customer install, there's a real risk the operator
never changes it — and those credentials are effectively public
knowledge. This migration (plus the auth handler + frontend changes)
forces the change before the account can do anything.

Revision ID: 041
Revises: 040
Create Date: 2026-04-24
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "041"
down_revision: Union[str, None] = "040"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column(
            "must_change_password",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )
    # Seeded bootstrap admin(s) — flip the flag on anyone using the
    # default password. Can't detect "default password" directly from
    # hash, so we match the well-known bootstrap email. Operators who
    # never use that email get no change.
    op.execute(
        """
        UPDATE users
        SET must_change_password = true
        WHERE email = 'admin@meridian.local'
        """
    )


def downgrade() -> None:
    op.drop_column("users", "must_change_password")
