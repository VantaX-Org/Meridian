"""Remediation items carry the auto_fix confidence of a rule proposal (high|medium|low).

High-confidence rule proposals can be bulk-accepted by a second person.

Revision ID: 065
Revises: 064
Create Date: 2026-10-07
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "065"
down_revision: Union[str, None] = "064"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("remediation_items", sa.Column("confidence", sa.Text(), nullable=True))
    op.add_column("remediation_items", sa.Column("accepted", sa.Boolean(), nullable=False,
                                                 server_default=sa.text("false")))
    op.create_check_constraint("ck_remediation_items_confidence", "remediation_items",
                               "confidence IS NULL OR confidence IN ('high', 'medium', 'low')")


def downgrade() -> None:
    op.drop_constraint("ck_remediation_items_confidence", "remediation_items", type_="check")
    op.drop_column("remediation_items", "accepted")
    op.drop_column("remediation_items", "confidence")
