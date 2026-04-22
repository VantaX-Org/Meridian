"""Mining orchestrator — fans out dedup, anomaly and relationship tasks.

Consumes the latest completed `analysis_versions` row for a tenant, looks up
the per-module parquet paths that were produced by the extraction task, and
fans out `run_dedup`, `run_anomaly` and `run_relationship` to the worker pool.

No LLM usage anywhere in this path.
"""

from __future__ import annotations

import logging
from typing import Optional

from sqlalchemy import text
from sqlalchemy.orm import Session

from workers.celery_app import celery_app
from workers.db import get_sync_engine

from workers.tasks.mining.anomaly import run_anomaly
from workers.tasks.mining.dedup import run_dedup
from workers.tasks.mining.relationship import run_relationship

logger = logging.getLogger("meridian.worker.mining.orchestrator")


def _get_version_modules(session: Session, tenant_id: str, version_id: str) -> list[tuple[str, str]]:
    """Return [(module_id, parquet_path), ...] for a version.

    Each module's parquet_path is taken from the `findings` table's module_upload
    metadata (or from `analysis_versions.metadata_json.module_paths` if present).
    """
    result = session.execute(
        text(
            """
            SELECT metadata_json
            FROM analysis_versions
            WHERE tenant_id = :tid AND id = :vid
            """
        ),
        {"tid": tenant_id, "vid": version_id},
    )
    row = result.fetchone()
    if not row:
        return []
    meta = row[0] or {}
    module_paths = (meta or {}).get("module_paths") or {}
    return [(m, p) for m, p in module_paths.items() if p]


@celery_app.task(
    bind=True,
    name="workers.tasks.mining.orchestrator.run_mining_for_version",
    soft_time_limit=900,
    time_limit=1020,
)
def run_mining_for_version(
    self,
    tenant_id: str,
    version_id: str,
    *,
    modules: Optional[list[str]] = None,
    include: Optional[list[str]] = None,
) -> dict:
    """Fan out mining tasks for all modules in a given analysis version.

    Args:
        tenant_id: tenant UUID
        version_id: analysis_versions.id
        modules: optional whitelist of module ids (else all from version metadata)
        include: which mining tasks to run — subset of {"dedup","anomaly","relationship"}

    Returns summary {dispatched: N, skipped: N, errors: N}.
    """
    include_set = set(include or ["dedup", "anomaly", "relationship"])
    engine = get_sync_engine()
    dispatched = 0
    skipped = 0

    with Session(engine) as session:
        session.execute(text("SET app.tenant_id = :tid"), {"tid": str(tenant_id)})
        module_pairs = _get_version_modules(session, tenant_id, version_id)

    if not module_pairs:
        logger.info(
            "run_mining_for_version: no module_paths for tenant=%s version=%s",
            tenant_id, version_id,
        )
        return {"dispatched": 0, "skipped": 0, "errors": 0, "reason": "no_modules"}

    if modules:
        allowed = set(modules)
        module_pairs = [(m, p) for m, p in module_pairs if m in allowed]

    tasks = []
    for module_id, parquet_path in module_pairs:
        if "dedup" in include_set:
            tasks.append(run_dedup.s(version_id, tenant_id, module_id, parquet_path))
        if "anomaly" in include_set:
            tasks.append(run_anomaly.s(version_id, tenant_id, module_id, parquet_path))
        if "relationship" in include_set:
            tasks.append(run_relationship.s(version_id, tenant_id, module_id, parquet_path))

    for sig in tasks:
        try:
            sig.apply_async()
            dispatched += 1
        except Exception as e:
            logger.warning("Mining dispatch failed: %s", e)
            skipped += 1

    logger.info(
        "run_mining_for_version: tenant=%s version=%s dispatched=%d skipped=%d modules=%d",
        tenant_id, version_id, dispatched, skipped, len(module_pairs),
    )
    return {
        "tenant_id": tenant_id,
        "version_id": version_id,
        "modules": len(module_pairs),
        "dispatched": dispatched,
        "skipped": skipped,
        "errors": 0,
    }


@celery_app.task(
    name="workers.tasks.mining.orchestrator.nightly_mining_all_tenants",
    soft_time_limit=1800, time_limit=1920,
)
def nightly_mining_all_tenants() -> dict:
    """Beat-scheduled: pick latest complete version per tenant, run mining."""
    engine = get_sync_engine()
    results: list[dict] = []
    with Session(engine) as session:
        tenants = session.execute(text("SELECT id FROM tenants")).fetchall()

    for (tid,) in tenants:
        tid_s = str(tid)
        try:
            with Session(engine) as session:
                session.execute(text("SET app.tenant_id = :tid"), {"tid": tid_s})
                row = session.execute(
                    text(
                        """
                        SELECT id FROM analysis_versions
                        WHERE tenant_id = :tid
                          AND status IN ('complete', 'agents_complete')
                        ORDER BY run_at DESC
                        LIMIT 1
                        """
                    ),
                    {"tid": tid_s},
                ).fetchone()
            if not row:
                continue
            res = run_mining_for_version.delay(tid_s, str(row[0]))
            results.append({"tenant_id": tid_s, "task_id": res.id})
        except Exception as e:
            logger.warning("nightly mining failed for tenant=%s: %s", tid_s, e)

    return {"tenants_dispatched": len(results)}
