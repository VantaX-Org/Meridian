"""Golden-record write-back worker: simulate (read and diff) or apply an approved request.

Idempotent: each mode claims the request with a status transition (UPDATE ... WHERE status = ...
RETURNING), so a redelivered or repeated task finds nothing to claim and does nothing. Applying
re-reads each value before writing and writes only fields the approver saw as a change, so even a
re-run after a crash never writes the same field twice to a different value.

Connectors only through sap/ (api/services/golden_writeback.py connect_system); credentials are
decrypted here, at execution time, never stored on the request.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from celery.exceptions import SoftTimeLimitExceeded
from sqlalchemy import text

from workers.celery_app import celery_app
from workers.db import get_sync_engine, tenant_session

logger = logging.getLogger("meridian.worker.golden_writeback")


def _audit(session: Any, tenant_id: str, actor: str | None, action: str, request_id: str, after: dict) -> None:
    from api.services.golden_writeback import AUDIT_SQL

    session.execute(text(AUDIT_SQL), {"t": tenant_id, "u": actor or "", "a": action, "ei": request_id,
                                      "m": "TASK", "p": "workers.tasks.run_golden_writeback",
                                      "af": json.dumps(after, default=str)})


def run(session: Any, tenant_id: str, request_id: str, mode: str) -> dict:
    """Simulate or apply one request on a tenant session. Returns {status, counts} or {skipped}."""
    from api.services import golden_writeback as gw

    if mode not in ("simulate", "apply"):
        raise ValueError(f"unknown mode {mode}")
    claim_from, claim_to = ("simulating", "simulating") if mode == "simulate" else ("approved", "applying")
    row = session.execute(text(
        "UPDATE golden_writeback_requests r SET status = :to, updated_at = now() "
        "FROM master_records m WHERE r.id = :id AND r.tenant_id = :t AND r.status = :frm "
        "AND m.id = r.master_record_id AND m.tenant_id = r.tenant_id "
        "RETURNING r.targets, m.domain, m.sap_object_key, r.requested_by, r.approved_by, r.master_record_id"),
        {"id": request_id, "t": tenant_id, "frm": claim_from, "to": claim_to}).fetchone()
    session.commit()
    if not row:
        return {"skipped": True, "reason": f"request is not {claim_from}"}
    targets, domain, obj_key, requested_by, approved_by, record_id = row

    apply = mode == "apply"
    try:
        result = gw.execute_targets(targets or [], domain, obj_key, apply,
                                    lambda sid: gw.connect_system(session, tenant_id, sid))
    except Exception as e:  # noqa: BLE001 - any failure must release the claim, then re-raise
        # Not only connector errors: a credential that fails to decrypt or a malformed target would
        # otherwise leave the request 'applying'/'simulating', holding the record's one open slot forever.
        session.rollback()
        error = "Timed out" if isinstance(e, SoftTimeLimitExceeded) else f"Write-back failed ({type(e).__name__})"
        session.execute(text(
            "UPDATE golden_writeback_requests SET status = :st, error = :err, updated_at = now() "
            "WHERE id = :id AND tenant_id = :t AND status = :claimed"),
            {"id": request_id, "t": tenant_id, "st": "failed" if apply else "simulation_failed", "err": error,
             "claimed": claim_to})
        session.commit()
        logger.exception("golden write-back %s %s failed", mode, request_id)
        raise

    counts = gw.summarise(result)
    if apply:
        status = ("applied" if not counts.get("error") else
                  "applied_with_errors" if counts.get("written") else "failed")
    else:
        status = "simulated" if not counts.get("error") or counts.get("would_change") or counts.get("unchanged") \
            else "simulation_failed"
    stamp = "applied_at" if apply else "simulated_at"
    # Only the run that still holds the claim records its outcome: a simulation cancelled meanwhile
    # (superseded by a newer one) stays cancelled instead of coming back as simulated.
    done = session.execute(text(
        f"UPDATE golden_writeback_requests SET status = :st, targets = CAST(:tg AS jsonb), {stamp} = now(), "
        "updated_at = now() WHERE id = :id AND tenant_id = :t AND status = :claimed RETURNING id"),
        {"st": status, "tg": json.dumps(result, default=str), "id": request_id, "t": tenant_id,
         "claimed": claim_to}).fetchone()
    if done is None:
        session.commit()
        logger.info("golden write-back %s %s: no longer %s, result dropped", mode, request_id, claim_to)
        return {"skipped": True, "reason": f"request is no longer {claim_to}"}
    if apply:
        written = {x["field"]: x["golden_value"] for tg in result for x in tg["fields"] if x.get("result") == "written"}
        session.execute(text(
            "INSERT INTO master_record_history (id, tenant_id, master_record_id, changed_at, changed_by, change_type, "
            "previous_fields, new_fields, ai_was_involved) VALUES (gen_random_uuid(), :t, :rid, now(), "
            "(SELECT id FROM users WHERE CAST(id AS text) = :u), 'written_back', CAST(:prev AS jsonb), "
            "CAST(:new AS jsonb), false)"),
            {"t": tenant_id, "rid": str(record_id), "u": approved_by or "",
             "prev": json.dumps({x["field"]: x.get("current_value") for tg in result for x in tg["fields"]
                                 if x.get("result") == "written"}, default=str),
             "new": json.dumps(written, default=str)})
    _audit(session, tenant_id, approved_by if apply else requested_by,
           "golden_writeback.applied" if apply else "golden_writeback.simulated", request_id,
           {"status": status, "counts": counts, "master_record_id": str(record_id)})
    session.commit()
    logger.info("golden write-back %s %s: %s %s", mode, request_id, status, counts)
    return {"status": status, "counts": counts}


@celery_app.task(
    bind=True,
    name="workers.tasks.run_golden_writeback.run_golden_writeback",
    soft_time_limit=600,
    time_limit=660,
)
def run_golden_writeback(self, request_id: str, tenant_id: str, mode: str) -> dict:
    """Celery entry point: ``mode`` is ``simulate`` or ``apply``."""
    session = tenant_session(get_sync_engine(), tenant_id)
    try:
        return run(session, str(tenant_id), str(request_id), mode)
    finally:
        session.close()
