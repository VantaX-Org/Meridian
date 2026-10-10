"""match_scores: one row per pair per tenant and domain

Revision ID: 073
Revises: 068
Create Date: 2026-10-10

The match pipeline rescores every pair on every analysis. A pair is the same pair in
either key order, so uniqueness is on LEAST/GREATEST of the two keys. Existing
duplicates are removed first, keeping a reviewed row (then the newest). Open
merge-decision queue items that pointed at a removed row are removed with it. The
cleanup is not limited to rows this migration just deleted: every open
merge_decision item whose source match_scores row is missing is deleted, including
orphans that pre-date this migration.
Both tables are FORCE RLS, so the cleanup runs with FORCE lifted for the owner.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "073"
down_revision: Union[str, None] = "068"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TABLES = ("match_scores", "stewardship_queue")


def upgrade() -> None:
    for t in _TABLES:
        op.execute(f"ALTER TABLE {t} NO FORCE ROW LEVEL SECURITY")
    op.execute("""
        DELETE FROM match_scores WHERE id IN (
            SELECT id FROM (
                SELECT id, row_number() OVER (
                    PARTITION BY tenant_id, domain,
                                 LEAST(candidate_a_key, candidate_b_key),
                                 GREATEST(candidate_a_key, candidate_b_key)
                    ORDER BY (reviewed_at IS NOT NULL) DESC, created_at DESC, id DESC) AS n
                FROM match_scores) d
            WHERE d.n > 1)
    """)
    op.execute("""
        DELETE FROM stewardship_queue
        WHERE item_type = 'merge_decision' AND status = 'open'
          AND source_id NOT IN (SELECT id FROM match_scores)
    """)
    for t in _TABLES:
        op.execute(f"ALTER TABLE {t} FORCE ROW LEVEL SECURITY")
    op.create_index("uq_match_scores_pair", "match_scores",
                    ["tenant_id", "domain", sa.text("LEAST(candidate_a_key, candidate_b_key)"),
                     sa.text("GREATEST(candidate_a_key, candidate_b_key)")], unique=True)


def downgrade() -> None:
    op.drop_index("uq_match_scores_pair", table_name="match_scores")
