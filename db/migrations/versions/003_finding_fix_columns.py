"""Add rule_context, value_fix_map, record_fixes columns to findings

Revision ID: 003
Revises: 002
Create Date: 2026-03-16

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "003"
down_revision: Union[str, None] = "002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("findings", sa.Column("rule_context", postgresql.JSONB(), nullable=True))
    op.add_column("findings", sa.Column("value_fix_map", postgresql.JSONB(), nullable=True))
    op.add_column("findings", sa.Column("record_fixes", postgresql.JSONB(), nullable=True))


def downgrade() -> None:
    op.drop_column("findings", "record_fixes")
    op.drop_column("findings", "value_fix_map")
    op.drop_column("findings", "rule_context")
