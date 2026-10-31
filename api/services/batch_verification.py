"""The next run's verdict on a fix batch: "Verified on run 23 Oct 2026: 320 fixed, 8 still failing" (F09).

A run reconciles every item of a batch sent to SAP or waiting for its load (``remediation.reconcile``, called by
``record_issues.track`` while the run stores its issues): the item is ``fixed`` or ``still_failing`` on that run
(``recon_version``). ``verify`` then counts, per batch, the records the run covered (a record is still failing when
any of its changes is) and stores one row per batch and run in ``remediation_batch_verifications``. The worker task
``workers/tasks/verify_batches.py`` runs it after each run; it is idempotent (``ON CONFLICT DO NOTHING``), and only a
newly stored verdict that differs from the batch's previous one tells the steward who built the batch and the
approver (inbox and email) and fires ``batch.verified``. Deterministic SQL; counts only, never a field value.
"""
from __future__ import annotations

import logging
from datetime import datetime
from typing import Optional

from sqlalchemy import text
from sqlalchemy.orm import Session

logger = logging.getLogger("meridian.batch_verification")

_VERIFY_SQL = """
    WITH r AS (
        SELECT i.batch_id, i.scope, i.module, i.record_key, bool_or(i.recon_status = 'still_failing') AS failing
          FROM remediation_items i
          JOIN remediation_batches b ON b.id = i.batch_id AND b.tenant_id = i.tenant_id
         WHERE i.tenant_id = CAST(:t AS uuid) AND i.recon_version = CAST(:v AS uuid)
           AND b.status IN ('awaiting_load', 'exported')
         GROUP BY 1, 2, 3, 4)
    INSERT INTO remediation_batch_verifications (tenant_id, batch_id, version_id, run_at, records, fixed, still_failing)
    SELECT CAST(:t AS uuid), batch_id, CAST(:v AS uuid),
           (SELECT run_at FROM analysis_versions WHERE id = CAST(:v AS uuid) AND tenant_id = CAST(:t AS uuid)),
           count(*), count(*) FILTER (WHERE NOT failing), count(*) FILTER (WHERE failing)
      FROM r GROUP BY batch_id
    ON CONFLICT (batch_id, version_id) DO NOTHING
    RETURNING batch_id::text, records, fixed, still_failing, run_at"""

_PREVIOUS_SQL = """
    SELECT fixed, still_failing FROM remediation_batch_verifications
     WHERE tenant_id = CAST(:t AS uuid) AND batch_id = CAST(:b AS uuid) AND version_id <> CAST(:v AS uuid)
     ORDER BY run_at DESC NULLS LAST, created_at DESC LIMIT 1"""

LATEST_SQL = """
    SELECT DISTINCT ON (batch_id) batch_id::text AS batch_id, version_id::text AS version_id, run_at, records, fixed,
           still_failing, created_at AS verified_at
      FROM remediation_batch_verifications
     WHERE tenant_id = CAST(:t AS uuid) AND batch_id = ANY(CAST(:ids AS uuid[]))
     ORDER BY batch_id, run_at DESC NULLS LAST, created_at DESC"""


def day(moment: Optional[datetime]) -> str:
    """23 Oct 2026."""
    return f"{moment.day} {moment:%b %Y}" if moment else "the latest run"


def sentence(v: dict) -> str:
    """Verified on run 23 Oct 2026: 320 fixed, 8 still failing."""
    return f"Verified on run {day(v.get('run_at'))}: {v['fixed']} fixed, {v['still_failing']} still failing"


def out(row: dict) -> dict:
    """A stored verdict as the batch API returns it (``verification``)."""
    return {"version_id": row["version_id"], "run_at": row["run_at"].isoformat() if row["run_at"] else None,
            "records": int(row["records"]), "fixed": int(row["fixed"]), "still_failing": int(row["still_failing"]),
            "verified_at": row["verified_at"].isoformat() if row["verified_at"] else None, "sentence": sentence(row)}


def verify(session: Session, tenant_id: str, version_id: str) -> tuple[list[dict], list]:
    """Store the run's verdict on every batch it covered. Returns (the verdicts stored now, the emails to queue after
    the caller commits). A second call for the same run stores and tells nothing."""
    from api.services import handoff_notices, webhooks

    tid, vid = str(tenant_id), str(version_id)
    stored = [dict(r) for r in session.execute(text(_VERIFY_SQL), {"t": tid, "v": vid}).mappings().all()]
    jobs: list = []
    for v in stored:
        prev = session.execute(text(_PREVIOUS_SQL), {"t": tid, "b": v["batch_id"], "v": vid}).first()
        if prev is not None and (prev[0], prev[1]) == (v["fixed"], v["still_failing"]):
            continue  # the same verdict as the run before: nothing new to tell
        b = session.execute(text(
            "SELECT name, created_by::text, approved_by::text FROM remediation_batches WHERE id = CAST(:b AS uuid) "
            "AND tenant_id = CAST(:t AS uuid)"), {"b": v["batch_id"], "t": tid}).first()
        if b is None:
            continue
        head = sentence(v)
        body = (f"{head}." + (f" Open the {v['still_failing']} still failing to fix them again." if v["still_failing"]
                              else " Every record of the batch now passes."))
        jobs += handoff_notices.notify(
            session, tid, [b[1], b[2]], type_="batch_verified", title=f"Fix batch {b[0]}: {head[0].lower()}{head[1:]}",
            body=body, link=handoff_notices.batch_link(v["batch_id"]), key=f"batch_verified:{v['batch_id']}:{vid}",
            button="Open the batch")
        webhooks.emit_safe(session, tid, "batch.verified", {
            "batch_id": v["batch_id"], "name": b[0], "run_id": vid, "records": int(v["records"]),
            "fixed": int(v["fixed"]), "still_failing": int(v["still_failing"])})
    return stored, jobs


def latest(session_rows) -> dict[str, dict]:
    """{batch id: its latest verdict as the API returns it} from the rows of ``LATEST_SQL``."""
    return {r["batch_id"]: out(r) for r in session_rows}
