"""Add local auth columns: password_hash on users, jwt_secret on tenants.

Revision ID: 026
Revises: 025
Create Date: 2026-03-31
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "026"
down_revision: Union[str, None] = "025"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("users", sa.Column("password_hash", sa.Text(), nullable=True))
    op.add_column("tenants", sa.Column("jwt_secret", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("tenants", "jwt_secret")
    op.drop_column("users", "password_hash")
