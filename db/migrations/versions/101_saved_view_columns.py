"""saved views remember their columns and density

Revision ID: 101
Revises: 100
Create Date: 2026-10-29

saved_views gains ``columns`` (jsonb list of column keys, in order; NULL = the page's default columns) and
``density`` (text, e.g. 'compact' or 'comfortable'; NULL = the page's default). Existing rows keep NULL in both.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "101"
down_revision: Union[str, None] = "100"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("saved_views", sa.Column("columns", JSONB(), nullable=True))
    op.add_column("saved_views", sa.Column("density", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("saved_views", "density")
    op.drop_column("saved_views", "columns")
