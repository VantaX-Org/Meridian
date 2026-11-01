"""record context: the classification codes around each flagged record, for rule self-tuning

Revision ID: 122
Revises: 121
Create Date: 2026-11-01

* finding_records.context and record_issues.context: jsonb ``{"TABLE.FIELD": "code"}`` of the flagged record,
  at most 8 low-cardinality classification codes (material type, account group, employee class) taken from
  columns the module's shipped rules already read (checks/record_context.py). Codes only, never free text,
  names, amounts or personal data. record_issues takes it on insert and on every re-flag, so checks/self_tune.py
  can propose an exclusion on a non-key code (MARA.MTART) as well as on a key part (WERKS).

Both tables are tenant-scoped and already ENABLE + FORCE row-level security with the tenant policy; a new
column needs no policy change.
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "122"
down_revision: str | None = "121"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("finding_records", sa.Column("context", JSONB(), nullable=True))
    op.add_column("record_issues", sa.Column("context", JSONB(), nullable=True))


def downgrade() -> None:
    op.drop_column("record_issues", "context")
    op.drop_column("finding_records", "context")
