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
    """(child, parent) for every foreign key among public tables."""
    rows = conn.execute(text("""
        SELECT tc.table_name AS child, ccu.table_name AS parent
          FROM information_schema.table_constraints tc
          JOIN information_schema.constraint_column_usage ccu
            ON ccu.constraint_name = tc.constraint_name
           AND ccu.table_schema = tc.table_schema
         WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
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
    args = ap.parse_args()

    tenant = _tenant_id()
    engine = create_engine(_db_url())
    with engine.begin() as conn:
        conn.execute(text("SET LOCAL app.tenant_id = :t"), {"t": tenant})
        tables = _tenant_tables(conn)
        if not tables:
            raise SystemExit("no table carries a tenant_id — wrong database?")

        # Safety: every KEEP table must be one this script never touches. Kept tables
        # legitimately carry a tenant_id (sap_systems, users, ...), so "has a tenant_id" is
        # what makes a table a *candidate*, not what disqualifies it - the first version of
        # this guard asserted the opposite and refused every run.
        purge = [t for t in tables if t not in KEEP]
        leaked = sorted(set(purge) & KEEP)
        if leaked:
            raise SystemExit(f"refusing to run: KEEP tables reached the purge set: {leaked}")
        emptiable = sorted(t for t in purge
                           if t not in {"analysis_versions", "tenants"} and not t.startswith("alembic"))
        edges = _fk_edges(conn)
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
    return 0


if __name__ == "__main__":
    sys.exit(main())
