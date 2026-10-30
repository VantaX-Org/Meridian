"""Celery task: write an approved master data change request to SAP (api/services/change_requests.py run_in_sap).

Idempotent: the task works only on a request in status creating, holds a per-request advisory lock for the whole run
(a second worker for the same request returns at once), and stores the phase reached (``committing`` just before the
commit is sent) in its own transaction. A request found in ``committing`` without a created key is never sent again:
the commit may have gone through, so it fails with that reason for a person to check in SAP. A connection failure
before the commit is retried (three times, a minute apart); anything SAP refuses is final. Live write-back
(MERIDIAN_LIVE_WRITEBACK_ENABLED) and sandbox mode are checked again here, at send time. Logs carry ids, the object and
the outcome, never a field value.
"""
from __future__ import annotations

import logging
import os
from datetime import datetime, timezone
from typing import Optional

from celery.exceptions import SoftTimeLimitExceeded
from sqlalchemy import text

from api.services import change_requests as crs
from workers.celery_app import celery_app
from workers.db import get_sync_engine, tenant_session

logger = logging.getLogger("meridian.worker.change_requests")

MAX_RETRIES = 3
RETRY_SECONDS = 60
MAYBE_CREATED = ("An earlier attempt reached the commit and its outcome is unknown; check in SAP whether the record "
                 "exists before trying again")


class _Retry(Exception):
    pass


def _params(session, tid: str, system_id: Optional[str]):
    row = session.execute(text(
        "SELECT s.host, s.client, s.sysnr, c.encrypted_password FROM sap_systems s JOIN system_credentials c "
        "ON c.system_id = s.id WHERE s.tenant_id = CAST(:t AS uuid) AND s.id = CAST(:s AS uuid) "
        "AND s.system_type IN ('ecc', 's4hana_onprem', 'ewm') LIMIT 1"), {"t": tid, "s": system_id}).fetchone()
    if row is None:
        return None
    from api.services.credential_store import decrypt_password
    from sap.base import SAPConnectionParams
    return SAPConnectionParams(host=row[0], client=row[1] or "", sysnr=row[2] or "",
                               user=os.getenv("SAP_RFC_USER", "RFC_USER"), password=decrypt_password(tid, row[3]))


def process(engine, tid: str, cr_id: str, attempt: int = 0, max_retries: int = MAX_RETRIES) -> dict:
    """One attempt. Returns {"status": ...}; raises _Retry when a connection failure before the commit may be
    retried."""
    from api.config import settings
    from api.services.sandbox import held_back_sync
    from sap import get_connector
    from sap.base import SAPConnectorError

    with engine.connect() as lock:
        if not lock.execute(text("SELECT pg_try_advisory_lock(hashtext(:k))"), {"k": f"cr:{cr_id}"}).scalar():
            return {"status": "busy"}
        try:
            with tenant_session(engine, tid) as s:
                cr = crs.load(s, tid, cr_id, lock=True)
                if cr["status"] != "creating":
                    return {"status": cr["status"], "skipped": True}
                if cr["sap_phase"] in ("committing", "committed") and not cr["sap_key"]:
                    crs.transition(s, tid, cr, "failed", None, "system", MAYBE_CREATED, notify=True,
                                   reason=MAYBE_CREATED, completed_at=datetime.now(timezone.utc))
                    s.commit()
                    return {"status": "failed"}
                reason = None
                if not settings.live_writeback_enabled:
                    reason = crs.LIVE_OFF
                elif held_back_sync(s, tid, "write_back", "change_request", cr_id):
                    reason = crs.SANDBOX
                params = None if reason else _params(s, tid, cr["target_system_id"])
                if not reason and params is None:
                    reason = crs.NO_SYSTEM
                if reason:
                    crs.transition(s, tid, cr, "approved", None, "system", reason, event="export",
                                   delivery="export", reason=reason, export=crs.export_file(cr, reason))
                    s.commit()
                    return {"status": "approved", "reason": reason}
                s.execute(text("UPDATE change_requests SET sap_attempts = sap_attempts + 1, updated_at = now() "
                               "WHERE id = CAST(:i AS uuid) AND tenant_id = CAST(:t AS uuid)"), {"i": cr_id, "t": tid})
                s.commit()

            def persist(phase: str) -> None:
                with tenant_session(engine, tid) as p:
                    p.execute(text("UPDATE change_requests SET sap_phase = :p, updated_at = now() WHERE id = CAST(:i AS uuid) "
                                   "AND tenant_id = CAST(:t AS uuid)"), {"p": phase, "i": cr_id, "t": tid})
                    p.commit()

            try:
                with get_connector() as conn:
                    conn.connect(params)
                    with tenant_session(engine, tid) as s:
                        out = crs.run_in_sap(s, tid, cr, conn, persist)
            except SAPConnectorError as e:
                err = "PyRFC not installed" if "pyrfc_not_installed" in str(e) else f"RFC connection failed: {e}"
                with tenant_session(engine, tid) as s:
                    cur = crs.load(s, tid, cr_id, lock=True)
                    if cur["sap_phase"] not in ("committing", "committed") and attempt < max_retries:
                        raise _Retry(err) from e
                    crs.transition(s, tid, cur, "failed", None, "system", err, notify=True, reason=err,
                                   completed_at=datetime.now(timezone.utc))
                    s.commit()
                return {"status": "failed", "reason": err}

            with tenant_session(engine, tid) as s:
                cur = crs.load(s, tid, cr_id, lock=True)
                status = out.pop("status")
                cols = {k: v for k, v in out.items() if k in ("sap_key", "sap_result", "reason", "delivery", "export")}
                if status in ("created", "failed"):
                    cols["completed_at"] = datetime.now(timezone.utc)
                if status == "created":
                    cols["sap_phase"] = "committed"
                crs.transition(s, tid, cur, status, None, "system", out.get("reason"), notify=True,
                               event=None if status != "approved" else "export", **cols)
                s.commit()
            logger.info("change request %s (%s %s): %s", cr_id, cr["kind"], cr["object"], status)
            return {"status": status}
        finally:
            lock.execute(text("SELECT pg_advisory_unlock(hashtext(:k))"), {"k": f"cr:{cr_id}"})


@celery_app.task(name="workers.tasks.change_requests.write_to_sap", bind=True, max_retries=MAX_RETRIES,
                 soft_time_limit=240, time_limit=300)
def write_to_sap(self, tenant_id: str, request_id: str) -> dict:
    try:
        return process(get_sync_engine(), tenant_id, request_id, attempt=self.request.retries)
    except _Retry as e:
        logger.warning("change request %s: connection failed, retrying", request_id)
        raise self.retry(exc=e, countdown=RETRY_SECONDS)
    except SoftTimeLimitExceeded:
        logger.warning("change request %s: time limit reached; it stays creating for the next attempt", request_id)
        return {"status": "timed_out"}
