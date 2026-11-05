"""entry_duplicate_near_indexes: typo-tolerant duplicate search on identifier fields

Revision ID: 139
Revises: 138
Create Date: 2026-11-05

Migration 135 left tax numbers and part numbers exact, because trigram similarity cannot tell one wrong character from
another taxpayer. This adds the pass that can: a key within edit distance 1 (one wrong, missing or extra character, or
two neighbouring characters swapped) of a stored key.

The method is deletion neighbourhoods. ``entry_dup_variants(key)`` returns the key and every key made by deleting one
character. Two keys at distance 1 (substitution, insertion, deletion) or a swap of neighbours share at least one
variant, so ``entry_dup_variants(stored) && entry_dup_variants(candidate)`` finds them through a plain GIN index on
the array. Some pairs at distance 2 share a variant as well; the search checks the exact distance in Python and drops
them. No extension is needed, so unlike migration 135 nothing here depends on pg_trgm.

Keys shorter than 5 or longer than 40 normalised characters get NULL, so they are not indexed and a candidate of that
length is not searched this way: with fewer than 5 characters one wrong character is a large share of the key and the
neighbourhood overlaps too many strangers, and 40 bounds the index entry count per row.

The expression is the one migration 133 indexes, wrapped in the function, and the search reads the migration 135 view
``entry_duplicate_population`` so the index is usable under the app role (see migration 135). Indexes are built
CONCURRENTLY; a failed build leaves an invalid index, which the search ignores and reports as ``index_missing``.
"""
import logging
from typing import Sequence, Union

from alembic import op

revision: str = "139"
down_revision: Union[str, None] = "138"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

FIELDS = ["KNA1.STCD1", "KNA1.STCD2", "KNA1.STCEG", "MARA.BISMT", "MARA.MFRPN"]


def _name(f: str) -> str:
    return "ix_master_records_near_" + f.lower().replace(".", "_")


def upgrade() -> None:
    op.execute("""
        CREATE OR REPLACE FUNCTION entry_dup_variants(s text) RETURNS text[]
        LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
            SELECT CASE WHEN s IS NULL OR length(s) < 5 OR length(s) > 40 THEN NULL
                   ELSE array_prepend(s, ARRAY(SELECT overlay(s placing '' from i for 1)
                                               FROM generate_series(1, length(s)) i)) END
        $$""")
    with op.get_context().autocommit_block():
        for f in FIELDS:
            try:
                op.execute(
                    f"CREATE INDEX CONCURRENTLY IF NOT EXISTS {_name(f)} ON master_records USING gin "
                    f"(entry_dup_variants(upper(regexp_replace(COALESCE(own_fields, golden_fields)->>'{f}', "
                    f"'[^0-9A-Za-z]', '', 'g')))) WHERE merged_into IS NULL")
            except Exception as e:  # noqa: BLE001 - search reports index_missing and keeps its other passes
                logging.getLogger("alembic.runtime.migration").warning(
                    "index %s not built (%s); the near-value duplicate pass does not run until it is", _name(f), type(e).__name__)


def downgrade() -> None:
    with op.get_context().autocommit_block():
        for f in FIELDS:
            op.execute(f"DROP INDEX CONCURRENTLY IF EXISTS {_name(f)}")
    op.execute("DROP FUNCTION IF EXISTS entry_dup_variants(text)")
