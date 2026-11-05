"""entry_duplicate_trigram_indexes: typo-tolerant duplicate search at entry (pg_trgm)

Revision ID: 135
Revises: 134
Create Date: 2026-11-05

Adds the pg_trgm extension and one GIN trigram index per free-text block field of
api/services/entry_duplicates.py (material description, customer name, business partner name), on the same
expression as migration 133's indexes so the search can probe them with the ``%`` operator. Tax numbers and part
numbers get none: a near match on those is another taxpayer or another part, not a typo.

pg_trgm is a trusted extension (Postgres 13 and later) and ships with the postgres:16 image, so any role that may
create objects in the database can install it. If the migration role cannot, this migration does NOT fail the
upgrade: it logs a warning and builds no index, and the duplicate search keeps its exact pass and reports that the
similar pass did not run (``fuzzy.reason``). Install the extension as a superuser later and re-run this revision's
index statements (or ``alembic downgrade 134 && alembic upgrade head``) to turn it on.

Indexes are built CONCURRENTLY so writers are not blocked; that cannot run inside alembic's transaction, hence the
autocommit block. A failed concurrent build leaves an invalid index, which the search ignores.
"""
import logging
from typing import Sequence, Union

from alembic import op

revision: str = "135"
down_revision: Union[str, None] = "134"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

FIELDS = ["BUT000.NAME_ORG1", "KNA1.NAME1", "MAKT.MAKTX"]


def _name(f: str) -> str:
    return "ix_master_records_trgm_" + f.lower().replace(".", "_")


def upgrade() -> None:
    with op.get_context().autocommit_block():
        conn = op.get_bind()
        try:
            op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
        except Exception as e:  # noqa: BLE001 - lacking CREATE on the database must not take down an upgrade
            logging.getLogger("alembic.runtime.migration").warning(
                "pg_trgm could not be installed (%s); duplicate search at entry runs exact-only until it is", type(e).__name__)
            return
        if not conn.exec_driver_sql("SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm'").first():
            return
        for f in FIELDS:
            try:
                op.execute(
                    f"CREATE INDEX CONCURRENTLY IF NOT EXISTS {_name(f)} ON master_records USING gin "
                    f"((upper(regexp_replace(COALESCE(own_fields, golden_fields)->>'{f}', '[^0-9A-Za-z]', '', 'g'))) "
                    f"gin_trgm_ops) WHERE merged_into IS NULL")
            except Exception as e:  # noqa: BLE001 - e.g. no CREATE on the table's schema; search reports index_missing
                logging.getLogger("alembic.runtime.migration").warning(
                    "index %s not built (%s); duplicate search at entry runs exact-only until it is", _name(f), type(e).__name__)


def downgrade() -> None:
    with op.get_context().autocommit_block():
        for f in FIELDS:
            op.execute(f"DROP INDEX CONCURRENTLY IF EXISTS {_name(f)}")
