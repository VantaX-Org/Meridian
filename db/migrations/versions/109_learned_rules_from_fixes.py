"""learned rules mined from stewards' fixes: two more proposal kinds and their evidence

Revision ID: 109
Revises: 108
Create Date: 2026-10-29

Independent of 104 and 105. learned_rule_proposals (migration 071) gets:

* kinds ``null`` (the field was blank in every fixed record: a null check) and ``invalid_value`` (the field held the
  same invalid value in every fixed record: a check that rejects it), mined by api/services/fix_mining.py from the
  values stewards entered through POST /work/decide;
* ``source``: ``data`` (the house-rule miner over a run's data, as before) or ``fixes``;
* ``evidence``: the count, sample keys, time span and who made the fixes, for the reviewer.

Proposals stay pending until a person approves them; nothing is enabled automatically.
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "109"
down_revision: str | None = "108"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_constraint("ck_learned_rule_kind", "learned_rule_proposals", type_="check")
    op.create_check_constraint("ck_learned_rule_kind", "learned_rule_proposals",
                               "kind IN ('dependency', 'value_set', 'format', 'range', 'null', 'invalid_value')")
    op.add_column("learned_rule_proposals", sa.Column("source", sa.Text(), nullable=False, server_default="data"))
    op.add_column("learned_rule_proposals", sa.Column("evidence", JSONB(), nullable=True))


def downgrade() -> None:
    op.execute("DELETE FROM learned_rule_proposals WHERE kind IN ('null', 'invalid_value')")
    op.drop_column("learned_rule_proposals", "evidence")
    op.drop_column("learned_rule_proposals", "source")
    op.drop_constraint("ck_learned_rule_kind", "learned_rule_proposals", type_="check")
    op.create_check_constraint("ck_learned_rule_kind", "learned_rule_proposals",
                               "kind IN ('dependency', 'value_set', 'format', 'range')")
