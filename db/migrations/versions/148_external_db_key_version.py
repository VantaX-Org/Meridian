"""external_db_connections.key_version, so scripts/rotate-credential-key.py can rotate its passwords

Revision ID: 148
Revises: 147
Create Date: 2026-11-05

Matches system_credentials.key_version: 1 until the master key is rotated.
"""
from typing import Sequence, Union

from alembic import op

revision: str = "148"
down_revision: Union[str, None] = "147"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE external_db_connections ADD COLUMN IF NOT EXISTS key_version integer NOT NULL DEFAULT 1")


def downgrade() -> None:
    op.execute("ALTER TABLE external_db_connections DROP COLUMN IF EXISTS key_version")
