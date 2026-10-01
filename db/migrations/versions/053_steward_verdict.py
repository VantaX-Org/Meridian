"""record_issues.steward_verdict — the stewards' judgement of an issue ('real' or
'false_positive'), kept when a later run re-opens it. The pilot scorecard's precision
counts verdicts, not the current status: a record a steward confirmed as wrong is still
evidence after its fix failed and the issue came back.

Revision ID: 053
Revises: 052
Create Date: 2026-10-01
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "053"
down_revision: Union[str, None] = "052"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("record_issues", sa.Column("steward_verdict", sa.Text(), nullable=True))
    op.execute("UPDATE record_issues SET steward_verdict = CASE WHEN resolution = 'false_positive' "
               "THEN 'false_positive' ELSE 'real' END WHERE resolution IS NOT NULL")


def downgrade() -> None:
    op.drop_column("record_issues", "steward_verdict")
