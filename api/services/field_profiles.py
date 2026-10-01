"""Persist and read field profiles + candidate hidden rules (migration 051).

Written by workers/tasks/run_checks.py after each module's checks; read by
api/routes/field_profiles.py. Callers set ``app.tenant_id`` (RLS) first; every
statement also filters on ``tenant_id`` explicitly.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

logger = logging.getLogger("meridian.field_profiles")


def module_tables(module: str, frames: Any) -> list[str]:
    """The module's data tables — the tables its rules read — present in ``frames``."""
    from checks.frames import tables_of
    from checks.runner import get_required_columns

    try:
        tables = sorted(tables_of(get_required_columns(module)))
    except FileNotFoundError:
        return []
    present = set(frames.frames) | (set(frames.unsplittable) if frames.flat is not None else set())
    return [t for t in tables if t in present]


def store(session: Session, tenant_id: str, version_id: str, module: str,
          profiles: list[dict], dependencies: list[dict]) -> dict[str, int]:
    """Replace the version's profile of ``module`` (idempotent on re-analysis)."""
    p = {"tid": str(tenant_id), "vid": str(version_id), "m": module}
    session.execute(text("DELETE FROM field_profiles WHERE tenant_id = :tid AND version_id = :vid AND module = :m"), p)
    session.execute(text("DELETE FROM field_dependencies WHERE tenant_id = :tid AND version_id = :vid AND module = :m"), p)
    if profiles:
        session.execute(text("""
            INSERT INTO field_profiles (tenant_id, version_id, module, table_name, field, stats)
            VALUES (:tid, :vid, :m, :t, :f, CAST(:s AS jsonb))
            ON CONFLICT (version_id, module, table_name, field) DO UPDATE SET stats = EXCLUDED.stats
        """), [{**p, "t": r["table"], "f": r["field"], "s": json.dumps(r["stats"])} for r in profiles])
    if dependencies:
        session.execute(text("""
            INSERT INTO field_dependencies (tenant_id, version_id, module, table_name, determinant, dependent,
                                            support, populated_rows, violations, sample_keys)
            VALUES (:tid, :vid, :m, :t, :a, :b, :sup, :n, :viol, CAST(:keys AS jsonb))
            ON CONFLICT (version_id, module, determinant, dependent) DO UPDATE SET
                support = EXCLUDED.support, populated_rows = EXCLUDED.populated_rows, violations = EXCLUDED.violations,
                sample_keys = EXCLUDED.sample_keys, table_name = EXCLUDED.table_name
        """), [{**p, "t": d["table"], "a": d["determinant"], "b": d["dependent"], "sup": d["support"],
                "n": d["rows"], "viol": d["violations"], "keys": json.dumps(d["sample_keys"])}
               for d in dependencies])
    return {"fields": len(profiles), "dependencies": len(dependencies)}


def profile_and_store(engine: Any, tenant_id: str, version_id: str, module: str, frames: Any,
                      dictionary: Any) -> dict[str, int] | None:
    """Profile one module's tables and persist them. Never raises: profiling must
    not fail an analysis — a failure is logged and returns None."""
    try:
        from checks.profiling import profile_module

        tables = module_tables(module, frames)
        if not tables:
            return {"fields": 0, "dependencies": 0}
        profiles, deps = profile_module(frames, dictionary, tables)
        with Session(engine) as session:
            session.execute(text("SET app.tenant_id = :tid"), {"tid": str(tenant_id)})
            stats = store(session, tenant_id, version_id, module, profiles, deps)
            session.commit()
        return stats
    except Exception as e:  # noqa: BLE001 — profiling is best-effort
        logger.error(f"field profiling failed for version={version_id} module={module}: {e}", exc_info=True)
        return None
