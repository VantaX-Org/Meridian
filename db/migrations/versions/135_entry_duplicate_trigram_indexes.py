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

The search reads the view ``entry_duplicate_population``, not ``master_records``. Row level security keeps every
non-leakproof expression above the policy, so under the app role no ``regexp_replace`` or ``%`` qual can reach an index
and each probe is a sequential scan (measured: 142 ms against 0.03 ms on 300,000 rows). A view runs with its owner's
rights, so when the owner bypasses row level security (the superuser that runs migrations) the indexes work, and the
view's own ``tenant_id`` filter takes the policy's place: same setting, same cast, and the same error when it is unset.
It must stay a plain view, because ``security_barrier`` would hold the quals back exactly as the policy does; that is
safe here since the app role runs only fixed SQL and cannot supply a function. If the migration role does not bypass
row level security the view is still correct, the policy applies to it, and the search is slow.
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
    op.execute("""
        CREATE OR REPLACE VIEW entry_duplicate_population AS
        SELECT tenant_id, domain, sap_object_key, own_fields, golden_fields FROM master_records
        WHERE tenant_id = current_setting('app.tenant_id')::uuid AND merged_into IS NULL""")
    op.execute("""
        DO $$ BEGIN
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'meridian_app') THEN
                GRANT SELECT ON entry_duplicate_population TO meridian_app;
            END IF;
        END $$""")
    if not op.get_bind().exec_driver_sql(
            "SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user").scalar():
        logging.getLogger("alembic.runtime.migration").warning(
            "the migration role does not bypass row level security; duplicate search at entry stays correct but "
            "scans the table instead of using its indexes until a role that does owns entry_duplicate_population")
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
    op.execute("DROP VIEW IF EXISTS entry_duplicate_population")
    # RESTRICT (the default) refuses when anything outside this migration still uses the extension, so a
    # pg_trgm another schema relies on stays; otherwise the downgrade leaves the database as it found it.
    op.execute("""
        DO $$ BEGIN
            DROP EXTENSION IF EXISTS pg_trgm;
        EXCEPTION WHEN dependent_objects_still_exist OR insufficient_privilege THEN NULL;
        END $$""")
