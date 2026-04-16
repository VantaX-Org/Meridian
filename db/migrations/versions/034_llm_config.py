"""Add llm_config JSONB column to tenants table.

Revision ID: 034
Revises: 033
Create Date: 2026-04-15
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "034"
down_revision: Union[str, None] = "033"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("tenants", sa.Column("llm_config", JSONB, nullable=True))


def downgrade() -> None:
    op.drop_column("tenants", "llm_config")
