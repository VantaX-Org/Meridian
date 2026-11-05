"""Batch write-back worker: send an approved batch to SAP in chunks, restartable.

The send endpoint creates a writeback_runs row and one writeback_run_records row per record (values from the approved
batch items) and enqueues this task. Each invocation is a bounded slice: it claims the run (queued -> running), takes
pending records in chunks, one RFC connection per chunk and system, and commits to Postgres after every record. Before
a record goes to SAP it is marked 'sending' and committed, so a crash leaves at most that one record in doubt.

Restart safety. sap/bapi_writeback.py write_record writes absolute proposed values, re-reads nothing, and its last step
(BAPI_TRANSACTION_COMMIT) can be lost with the answer. A record left 'sending' therefore may be committed in SAP or not,
and a resend could overwrite a later change. It is never resent: it becomes 'needs_check' (an operator looks in SAP and
may requeue it on purpose). Records still 'pending' are untouched by a crash and go on at resume.

A slice ends by re-queueing itself (status queued) while records remain. Only a 'queued' run can be claimed, so a
redelivered task finds nothing to do. A run whose worker died stays 'running' with an old heartbeat; the resume endpoint
takes it over (the stale limit is above the task hard limit, so the old worker is gone by then).
"""

from __future__ import annotations

import json
import logging
import os
import time
from typing import Any, Callable, Optional

from sqlalchemy import text

from workers.celery_app import celery_app
from workers.db import get_sync_engine, tenant_session

logger = logging.getLogger("meridian.worker.batch_writeback")

_AUDIT = ("INSERT INTO audit_log (tenant_id, actor_user_id, actor_email, action, entity_type, entity_id, method, path, "
          "status_code, after_json) VALUES (:t, (SELECT id FROM users WHERE CAST(id AS text) = :u AND tenant_id = :t), "
          "NULLIF(:l, ''), :a, 'writeback_run', :ei, 'TASK', 'workers.tasks.run_batch_writeback', 200, "
          "CAST(:af AS jsonb))")


def counts(session: Any, tenant_id: str, run_id: str) -> dict[str, int]:
    rows = session.execute(text("SELECT state, count(*) FROM writeback_run_records WHERE run_id = :r AND tenant_id = :t "
                                "GROUP BY state"), {"r": run_id, "t": tenant_id}).fetchall()
    return {s: int(n) for s, n in rows}


def audit(session: Any, tenant_id: str, run_id: str, user: str, label: Optional[str], action: str, after: dict) -> None:
    session.execute(text(_AUDIT), {"t": tenant_id, "u": user or "", "l": label or "", "a": action, "ei": run_id,
                                   "af": json.dumps(after, default=str)})


def _system_params(session: Any, tenant_id: str, system_id: str):
    row = session.execute(text("""
        SELECT s.host, s.client, s.sysnr, c.encrypted_password
          FROM sap_systems s JOIN system_credentials c ON c.system_id = s.id
         WHERE s.tenant_id = :tid AND CAST(s.id AS text) = :sid
           AND s.system_type IN ('ecc', 's4hana_onprem', 'ewm')
         LIMIT 1"""), {"tid": tenant_id, "sid": system_id}).fetchone()
    if not row:
        return None
    from api.services.credential_store import decrypt_password
    from sap.base import SAPConnectionParams

    return SAPConnectionParams(host=row[0], client=row[1] or "", sysnr=row[2] or "",
                               user=os.getenv("SAP_RFC_USER", "RFC_USER"), password=decrypt_password(tenant_id, row[3]))


def _finish_state(session: Any, tenant_id: str, run_id: str, status: str, reason: Optional[str], user: str,
                  label: Optional[str], action: str) -> dict:
    """Close or pause the run, with the audit event and its counts."""
    c = counts(session, tenant_id, run_id)
    closed = status in ("completed", "completed_with_errors", "cancelled")
    session.execute(text("UPDATE writeback_runs SET status = :s, pause_reason = :r, heartbeat_at = now(), "
                         "finished_at = CASE WHEN :closed THEN now() ELSE finished_at END "
                         "WHERE id = :id AND tenant_id = :t"),
                    {"s": status, "r": reason, "closed": closed, "id": run_id, "t": tenant_id})
    audit(session, tenant_id, run_id, user, label, action, {"status": status, "reason": reason, "counts": c})
    session.commit()
    logger.info("batch write-back %s: %s %s", run_id, status, c)
    return {"status": status, "counts": c}


def _export_once(session: Any, tenant_id: str, run_id: str, batch_id: str, user: str, label: Optional[str]) -> None:
    """The first committed record moves the batch to Sent to SAP, exactly once per run (same as the former
    synchronous send): batch status, one event per item, work list refresh and the batch.sent webhook."""
    first = session.execute(text("UPDATE writeback_runs SET exported_at = now() WHERE id = :id AND tenant_id = :t "
                                 "AND exported_at IS NULL RETURNING id"), {"id": run_id, "t": tenant_id}).fetchone()
    if not first:
        return
    session.execute(text("UPDATE remediation_batches SET status = 'exported', exported_at = now() "
                         "WHERE id = :id AND tenant_id = :t"), {"id": batch_id, "t": tenant_id})
    session.execute(text("INSERT INTO remediation_events (tenant_id, batch_id, item_id, user_id, user_label, action, "
                         "to_value) SELECT :t, :b, id, CAST(:u AS uuid), :l, 'exported', 'bapi' "
                         "FROM remediation_items WHERE batch_id = :b"),
                    {"t": tenant_id, "b": batch_id, "u": user, "l": label or "system"})
    from api.services import webhooks, worklist

    worklist.refresh_batch(session, tenant_id, batch_id)
    webhooks.batch_event(session, tenant_id, str(batch_id), "batch.sent")


def classify(res: Any) -> tuple[str, Optional[str]]:
    """(state, error) of one write_record result. Anything SAP may have changed without a confirmed commit is
    needs_check; only a record SAP never saw or that SAP clearly refused is failed."""
    if res.committed:
        return "committed", None
    if res.applied or (res.error and res.simulated):
        # the real call ran (or may have) and the commit is not confirmed: SAP may hold the change
        why = res.error or "SAP did not confirm the commit"
        return "needs_check", f"{why}; check this record in SAP before sending it again"
    if res.error:
        return "failed", res.error
    if not res.fields and res.export:
        return "export_only", None
    bad = next((m for m in res.simulate_messages if m.get("type") in ("E", "A")), None)
    return "failed", (bad or {}).get("message") or "SAP refused the change; see its RETURN messages"


def run(session: Any, tenant_id: str, run_id: str, enqueue: Callable[[int], None],
        sleep: Callable[[float], None] = time.sleep, clock: Callable[[], float] = time.monotonic) -> dict:
    """One bounded slice of a run on a tenant session. ``enqueue(countdown)`` re-queues the task for the rest."""
    from api.config import settings
    from api.services.sandbox import held_back_sync
    from sap import get_connector
    from sap.base import SAPConnectorError
    from sap.bapi_writeback import write_record

    claim = session.execute(text(
        "UPDATE writeback_runs SET status = 'running', heartbeat_at = now(), started_at = COALESCE(started_at, now()), "
        "pause_reason = NULL WHERE id = :id AND tenant_id = :t AND status = 'queued' "
        "RETURNING batch_id, requested_by, requested_label"), {"id": run_id, "t": tenant_id}).fetchone()
    session.commit()
    if not claim:
        return {"skipped": True, "reason": "run is not queued"}
    batch_id, user, label = str(claim[0]), claim[1], claim[2]

    def stop(status: str, reason: Optional[str], action: str) -> dict:
        session.rollback()
        return _finish_state(session, tenant_id, run_id, status, reason, user, label, action)

    if not settings.live_writeback_enabled:
        return stop("paused", "Live SAP write-back is off on this deployment; resume once it is turned on",
                    "writeback_run.paused")
    if held_back_sync(session, tenant_id, "write_back", "bapi", batch_id):
        session.commit()  # keep the skip held_back_sync recorded
        return stop("paused", "Sandbox mode is on: nothing is written back to SAP. Resume after the sandbox exit",
                    "writeback_run.paused")
    session.commit()

    deadline = clock() + settings.writeback_slice_seconds
    fails = int(session.execute(text("SELECT conn_failures FROM writeback_runs WHERE id = :id"),
                                {"id": run_id}).scalar() or 0)

    def lost_connection(reason: str) -> Optional[dict]:
        """Count one connection failure; the run pauses at the limit (the remaining records are left pending)."""
        nonlocal fails
        fails += 1
        session.execute(text("UPDATE writeback_runs SET conn_failures = :n, heartbeat_at = now() WHERE id = :id"),
                        {"n": fails, "id": run_id})
        session.commit()
        if fails >= settings.writeback_max_connect_failures:
            return stop("paused", f"{fails} connection failures in a row: {reason}. The remaining records were not "
                                  "sent; check the SAP connection, then resume", "writeback_run.paused")
        sleep(settings.writeback_connect_retry_seconds)
        return None

    while True:
        status = session.execute(text("SELECT status FROM writeback_runs WHERE id = :id"), {"id": run_id}).scalar()
        if status == "cancelling":
            return stop("cancelled", None, "writeback_run.cancelled")
        if clock() >= deadline:
            moved = session.execute(text("UPDATE writeback_runs SET status = 'queued', heartbeat_at = now() "
                                         "WHERE id = :id AND status = 'running' RETURNING id"), {"id": run_id}).fetchone()
            session.commit()
            if moved:
                enqueue(settings.writeback_chunk_pause_seconds)
                return {"requeued": True}
            continue  # cancelled while we looked: the next pass finishes it
        rows = session.execute(text(
            "SELECT id, system_id, module, record_key, changes FROM writeback_run_records "
            "WHERE run_id = :r AND tenant_id = :t AND state = 'pending' ORDER BY seq LIMIT :n"),
            {"r": run_id, "t": tenant_id, "n": settings.writeback_chunk_size}).fetchall()
        session.commit()
        if not rows:
            c = counts(session, tenant_id, run_id)
            bad = c.get("failed", 0) + c.get("needs_check", 0)
            return stop("completed_with_errors" if bad else "completed", None, "writeback_run.completed")
        groups: dict[tuple[str, str], list] = {}
        for r in rows:
            groups.setdefault((r[1], r[2]), []).append(r)
        for (system_id, module), recs in groups.items():
            params = _system_params(session, tenant_id, system_id)
            if params is None:
                session.execute(text("UPDATE writeback_run_records SET state = 'failed', error = :e, updated_at = now() "
                                     "WHERE id = ANY(CAST(:ids AS uuid[])) AND tenant_id = :t"),
                                {"e": "No registered SAP system with stored credentials holds this record; deliver it "
                                      "with the export", "ids": [str(r[0]) for r in recs], "t": tenant_id})
                session.commit()
                continue
            try:
                with get_connector() as conn:
                    conn.connect(params)
                    cache: dict = {}
                    for rid, _, _, key, changes in recs:
                        if clock() >= deadline:
                            break
                        session.execute(text("UPDATE writeback_run_records SET state = 'sending', attempts = attempts + 1, "
                                             "updated_at = now() WHERE id = :id"), {"id": rid})
                        session.execute(text("UPDATE writeback_runs SET heartbeat_at = now() WHERE id = :id"),
                                        {"id": run_id})
                        session.commit()  # from here SAP may change; a crash leaves this one record 'sending'
                        try:
                            res = write_record(conn, module, key, dict(changes), apply=True, cache=cache)
                        except Exception as e:  # noqa: BLE001 - unknown outcome: never resend, pause for a person
                            session.rollback()
                            session.execute(text("UPDATE writeback_run_records SET state = 'needs_check', error = :e, "
                                                 "updated_at = now() WHERE id = :id"),
                                            {"e": f"Interrupted ({type(e).__name__}); check this record in SAP before "
                                                  "sending it again", "id": rid})
                            session.commit()
                            logger.exception("batch write-back %s record failed unexpectedly", run_id)
                            return stop("paused", f"A worker error interrupted the run ({type(e).__name__}); the record "
                                                  "in doubt needs a check in SAP", "writeback_run.paused")
                        if res.connector_error and not res.simulated:
                            # SAP never saw this record: back to pending, then reconnect
                            session.execute(text("UPDATE writeback_run_records SET state = 'pending', "
                                                 "updated_at = now() WHERE id = :id"), {"id": rid})
                            session.commit()
                            out = lost_connection(res.error or "connection lost")
                            if out:
                                return out
                            break
                        state, err = classify(res)
                        session.execute(text("UPDATE writeback_run_records SET state = :s, error = :e, "
                                             "result = CAST(:r AS jsonb), updated_at = now() WHERE id = :id"),
                                        {"s": state, "e": err, "r": json.dumps(res.as_dict(), default=str), "id": rid})
                        if res.export:  # fields this system sends to the export instead (e.g. a classic-release vendor)
                            session.execute(text("UPDATE writeback_runs SET export_only = export_only + :n "
                                                 "WHERE id = :id"), {"n": len(res.export), "id": run_id})
                        if state == "committed":
                            _export_once(session, tenant_id, run_id, batch_id, user, label)
                        if fails:
                            fails = 0
                            session.execute(text("UPDATE writeback_runs SET conn_failures = 0 WHERE id = :id"),
                                            {"id": run_id})
                        session.commit()
                        if res.connector_error:  # in doubt and the connection is gone
                            out = lost_connection(res.error or "connection lost")
                            if out:
                                return out
                            break
            except SAPConnectorError as e:
                session.rollback()
                if "pyrfc_not_installed" in str(e):
                    return stop("paused", "PyRFC is not installed on the worker; install it, then resume",
                                "writeback_run.paused")
                out = lost_connection(f"RFC connection failed: {e}")
                if out:
                    return out
        if settings.writeback_chunk_pause_seconds:
            sleep(settings.writeback_chunk_pause_seconds)


@celery_app.task(
    bind=True,
    name="workers.tasks.run_batch_writeback.run_batch_writeback",
    soft_time_limit=540,
    time_limit=600,
)
def run_batch_writeback(self, run_id: str, tenant_id: str) -> dict:
    """Celery entry point: one slice of a run; re-enqueues itself while records remain."""
    session = tenant_session(get_sync_engine(), tenant_id)
    try:
        return run(session, str(tenant_id), str(run_id),
                   lambda countdown: run_batch_writeback.apply_async(args=[str(run_id), str(tenant_id)],
                                                                    countdown=countdown or 0))
    finally:
        session.close()
