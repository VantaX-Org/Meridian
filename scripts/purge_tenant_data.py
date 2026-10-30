"""Purge all tenant data, keeping the system connections, for a client handover.

Removes everything this deployment learned from a customer system - analyses, findings,
record-level issues, profiles, config snapshots, extracted datasets, jobs, uploads - and
keeps only what re-connecting and re-analysing needs:

  tenants, users, sap_systems, system_credentials, system_module_map,
  sync_profiles, schema_migrations (alembic_version)

Scope, and how it relates to ``api/services/purge.py``: that service deletes ONE version
and its rows, with the ordering and the record-issue lifecycle worked out in detail
(``DELETE_ORDER``, ``UNLINK``, ``open_work``). This script is for handover, where the
whole tenant goes at once -- it empties every tenant-keyed table and keeps the
connections. Where the version-keyed tables are concerned it reuses that service's own
ordering rather than a second opinion.

The table list is not hand-written. It is derived from the live schema:

  * every table with a ``tenant_id`` column is a purge candidate;
  * the order comes from the foreign keys, so a table is emptied before anything it
    points at (deleting ``analysis_versions`` first fails: most of its children are
    RESTRICT, not CASCADE);
  * a table that references a KEPT table is only purged by deleting the rows that point
    at the tenant's data - never the kept rows - and the script refuses to run at all
    if a kept table itself carries a ``tenant_id`` that the purge would empty.

Usage::

    python scripts/purge_tenant_data.py --dry-run          # default: report only
    python scripts/purge_tenant_data.py --execute          # do it, in one transaction
    python scripts/purge_tenant_data.py --execute --keep-uploads

It runs inside a single transaction: any error rolls the whole purge back. Take a
database dump first (``scripts/backup.sh``); this is not reversible.
"""

from __future__ import annotations

import argparse
import os
import sys
from collections import defaultdict

from sqlalchemy import create_engine, text

# Kept: everything needed to connect to a system and run a fresh analysis.
KEEP = {
    "tenants",
    "users",
    "sap_systems",
    "system_credentials",
    "system_module_map",
    "sync_profiles",
    "alembic_version",
}

# Objects stored outside Postgres; reported, never touched here.
OBJECT_STORES = {
    "uploads (Garage/S3: the staged datasets under staging/<tenant>/<version>/)":
        "MINIO_BUCKET_UPLOADS — delete the tenant's prefix to reclaim the space",
}


def _db_url() -> str:
    url = os.getenv("DATABASE_URL_SYNC") or os.getenv("DATABASE_URL") or ""
    if not url:
        raise SystemExit("DATABASE_URL_SYNC (or DATABASE_URL) is required")
    return url.replace("postgresql+asyncpg://", "postgresql://")


def _clear_queue() -> str:
    """Drop queued Celery tasks and report running ones, so a purge is not followed by work
    that writes into the versions it just removed.

    A task already executing cannot be revoked reliably from here (it runs in a prefork child
    that may hold gigabytes of frames), so this reports those and the caller decides whether to
    restart the worker. Queued ones are simply discarded.
    """
    url = os.getenv("REDIS_URL") or os.getenv("CELERY_BROKER_URL") or ""
    if not url:
        return "not attempted (no REDIS_URL)"
    try:
        import redis  # type: ignore
    except Exception:
        return "not attempted (redis client unavailable)"
    try:
        client = redis.from_url(url)
        queued = client.llen("celery")
        client.delete("celery")
        return f"discarded {queued} queued task(s)"
    except Exception as e:
        return f"failed: {type(e).__name__}: {e}"


def _tenant_id() -> str:
    return os.getenv("MERIDIAN_TENANT_ID", "00000000-0000-0000-0000-000000000001")


def _tenant_tables(conn) -> list[str]:
    rows = conn.execute(text("""
        SELECT c.table_name
          FROM information_schema.columns c
          JOIN information_schema.tables t
            ON t.table_schema = c.table_schema AND t.table_name = c.table_name
         WHERE c.table_schema = 'public' AND c.column_name = 'tenant_id'
           AND t.table_type = 'BASE TABLE'
         ORDER BY c.table_name
    """)).fetchall()
    return [r[0] for r in rows]


def _fk_edges(conn) -> list[tuple[str, str]]:
    """(child, parent) for every foreign key among public tables.

    Read from ``pg_constraint``, not ``information_schema.table_constraints``: the app connects
    as ``meridian_app`` and information_schema shows that role no constraints at all (the tables
    are owned by ``meridian``), so the earlier version returned zero edges. Zero edges made every
    table look independent, the delete order fell back to alphabetical, and the purge died on the
    first parent it reached - ``analysis_versions`` before ``cleaning_queue``, a foreign key that
    does exist. A silent empty result that produces a plausible-looking order is the worst
    possible failure here, which is why main() refuses to run when this comes back empty.
    """
    rows = conn.execute(text("""
        SELECT con.conrelid::regclass::text AS child,
               con.confrelid::regclass::text AS parent
          FROM pg_constraint con
          JOIN pg_class cl ON cl.oid = con.conrelid
          JOIN pg_namespace ns ON ns.oid = cl.relnamespace
         WHERE con.contype = 'f' AND ns.nspname = 'public'
    """)).fetchall()
    return [(r[0], r[1]) for r in rows]


def _service_order() -> list[str] | None:
    """``DELETE_ORDER`` from api/services/purge.py, when that module can be imported.

    That list is the reviewed order for the version-keyed tables; using it here keeps one
    answer to the ordering question. Returns None when the app package is unavailable, in
    which case the foreign keys decide.
    """
    try:
        from api.services.purge import DELETE_ORDER  # type: ignore
    except Exception:
        return None
    return [t for t, _ in DELETE_ORDER]


def _order(children: list[str], edges: list[tuple[str, str]]) -> list[str]:
    """Delete order: a child (which points at its parent) is emptied before its parent.

    ``edges`` are ``(child, parent)``. A table may go when nothing still in the set points
    at it, i.e. every one of its children has already been emptied.
    """
    children_of = defaultdict(set)  # parent -> {children that reference it}
    for child, parent in edges:
        if child != parent:
            children_of[parent].add(child)
    ordered = []
    remaining = set(children)
    while remaining:
        free = sorted(t for t in remaining if not (children_of[t] & remaining))
        if not free:  # a cycle: the transaction still guards; take alphabetically
            free = sorted(remaining)
        for t in free:
            ordered.append(t)
            remaining.discard(t)
    return ordered


def _kept_dependents(conn, purge: set[str]) -> list[tuple[str, str]]:
    """(child, parent) where the child is purged and the parent is kept."""
    out = []
    for child, parent in _fk_edges(conn):
        if child in purge and parent in KEEP:
            out.append((child, parent))
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    ap.add_argument("--execute", action="store_true", help="actually purge (default: dry run)")
    ap.add_argument("--dry-run", action="store_true", help="report only (the default)")
    ap.add_argument("--keep-uploads", action="store_true",
                    help="leave the staged parquet in the object store")
    ap.add_argument("--keep-queue", action="store_true",
                    help="leave queued Celery tasks alone (they will run against purged data)")
    ap.add_argument("--disable-triggers", action="store_true",
                    help="set session_replication_role=replica for the transaction so append-only "
                         "audit tables (master_record_history) can be cleared. Needs a superuser "
                         "connection; without it the purge stops at the first append-only table.")
    args = ap.parse_args()

    tenant = _tenant_id()
    engine = create_engine(_db_url())
    with engine.begin() as conn:
        conn.execute(text("SET LOCAL app.tenant_id = :t"), {"t": tenant})
        if args.disable_triggers:
            # Append-only audit tables have a BEFORE DELETE trigger (see
            # db/migrations/versions/012_golden_records.py). A whole-tenant purge is the one
            # operation that legitimately removes them, so the trigger is bypassed for this
            # transaction only - never for a normal delete path. Requires a superuser: the app
            # role (meridian_app) is refused, which is why this is opt-in.
            try:
                conn.execute(text("SET LOCAL session_replication_role = 'replica'"))
            except Exception as e:
                raise SystemExit(
                    f"--disable-triggers needs a superuser connection; this role was refused: {e}")
        tables = _tenant_tables(conn)
        if not tables:
            raise SystemExit("no table carries a tenant_id — wrong database?")

        # Safety: every KEEP table must be one this script never touches. Kept tables
        # legitimately carry a tenant_id (sap_systems, users, ...), so "has a tenant_id" is
        # what makes a table a *candidate*, not what disqualifies it - the first version of
        # this guard asserted the opposite and refused every run.
        purge = [t for t in tables if t not in KEEP]
        edges = _fk_edges(conn)
        if not edges:
            raise SystemExit(
                "refusing to run: no foreign keys were read, so there is no safe delete order. "
                "Every table would look independent and the purge would fail part-way through. "
                "Check that the connection role can see pg_constraint.")
        leaked = sorted(set(purge) & KEEP)
        if leaked:
            raise SystemExit(f"refusing to run: KEEP tables reached the purge set: {leaked}")
        # version-keyed tables first, in the reviewed order from the purge service; the
        # rest by foreign key (children before parents)
        service = _service_order()
        if service:
            head = [t for t in service if t in purge]
        else:
            head = []
        tail = [t for t in _order(purge, edges) if t not in head]
        ordered = head + tail
        restricted = _kept_dependents(conn, set(purge))

        print(f"tenant: {tenant}")
        kept_with_tid = sorted(KEEP & set(tables))
        print(f"tables with tenant_id: {len(tables)}")
        print(f"kept (skipped) even though they carry tenant_id: {kept_with_tid}")
        print(f"tables to purge: {len(ordered)}")
        print(f"purged tables that reference a kept table: {len(restricted)}")
        for child, parent in sorted(set(restricted)):
            print(f"    {child} -> {parent}   (only this tenant's rows are removed)")

        counts = {}
        for t in ordered:
            n = conn.execute(text(f'SELECT count(*) FROM "{t}" WHERE tenant_id = :t'),
                             {"t": tenant}).scalar()
            counts[t] = n
        total = sum(counts.values())
        nonempty = {t: n for t, n in counts.items() if n}
        print(f"\nrows to delete: {total} across {len(nonempty)} non-empty tables")
        for t, n in sorted(nonempty.items(), key=lambda kv: -kv[1])[:25]:
            print(f"    {t:44s} {n:>10,}")

        if not args.execute:
            print("\nDRY RUN — nothing deleted. Re-run with --execute.")
            print("\nOutside Postgres (not touched by this script):")
            for k, v in OBJECT_STORES.items():
                print(f"    {k}: {v}")
            return 0

        # children first, as computed
        for t in ordered:
            if counts[t]:
                conn.execute(text(f'DELETE FROM "{t}" WHERE tenant_id = :t'), {"t": tenant})
        print(f"\nDELETED {total} rows from {len(nonempty)} tables (single transaction).")

        left = {t: conn.execute(text(f'SELECT count(*) FROM "{t}" WHERE tenant_id = :t'),
                                {"t": tenant}).scalar() for t in ordered}
        remaining = {t: n for t, n in left.items() if n}
        if remaining:
            raise SystemExit(f"purge incomplete, rolling back: {remaining}")
        print("verified: no tenant rows remain in any purged table.")

        # Work already queued against the purged data must not run afterwards.
        if not args.keep_queue:
            print(f"celery queue: {_clear_queue()}")
            print("  if any extraction task was already running, restart the worker so it stops:")
            print("    docker restart docker-worker-1")
    return 0


if __name__ == "__main__":
    sys.exit(main())
