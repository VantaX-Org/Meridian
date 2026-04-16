"""Add stripe_invoice_id to exception_billing

Revision ID: 010
Revises: 009
Create Date: 2026-03-17

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "010"
down_revision: Union[str, None] = "009"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "exception_billing",
        sa.Column("stripe_invoice_id", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("exception_billing", "stripe_invoice_id")
