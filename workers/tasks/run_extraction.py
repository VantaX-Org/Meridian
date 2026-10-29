"""Celery task: extract a system's data for the selected modules, then run checks.

One analysis version per extraction (all modules together, so versions are
comparable run-to-run). Data is stored as a per-table parquet bundle
``staging/<tenant>/<version>/<TABLE>.parquet`` with ``TABLE.FIELD`` columns —
the exact shape the check engine evaluates at record grain. Per-table
coverage (rows, window, truncation, failures) is stored on the version.
"""

import io
from datetime import datetime, timedelta, timezone
import json
import logging
import os
import uuid
from typing import Callable, Optional

from celery import Task
from celery.exceptions import SoftTimeLimitExceeded
from sqlalchemy import text
from sqlalchemy.orm import Session

from api.services import jobs
from workers.celery_app import CONFIG_WAIT_RETRIES, CONFIG_WAIT_SECONDS, EXTRACT_TIME_LIMIT, celery_app
from workers.db import get_sync_engine, tenant_session

logger = logging.getLogger("meridian.workers.extraction")


def progress_key(system_id) -> str:
    """Redis key of the running download's progress (GET /systems/{id}/versions)."""
    return f"extract:{system_id}"


# Entry dates of documents a live system creates every day. Master-data dates are
# left out: a quiet vendor master is normal, a quiet general ledger is not.
_ACTIVITY_DATES = ("BKPF.CPUDT", "RBKP.CPUDT", "CDHDR.UDATE", "EKKO.AEDAT", "VBAK.ERDAT")


def latest_activity(frames: dict) -> str | None:
    """Latest document entry date in the extracted data (YYYY-MM-DD), None if none was read."""
    import pandas as pd
    latest = None
    for col in _ACTIVITY_DATES:
        df = frames.get(col.split(".")[0])
        if df is None or col not in df.columns:
            continue
        d = pd.to_datetime(df[col], format="%Y%m%d", errors="coerce").max()
        if pd.notna(d) and (latest is None or d > latest):
            latest = d
    return latest.date().isoformat() if latest is not None else None


DELTA_FULL_DAYS = int(os.getenv("MERIDIAN_DELTA_FULL_DAYS", "7"))


def delta_baseline(session, tenant_id: str, system_id: str, modules: list[str],
                   scope: Optional[dict[str, object]] = None) -> Optional[dict[str, object]]:
    """The latest stored version of the same system, objects and scope (id plus metadata) a
    delta can build on. A scoped manual baseline must never be picked for an unscoped (or
    differently scoped) extraction — the stored tables wouldn't cover the right rows."""
    row = session.execute(text("""
        SELECT id::text, metadata FROM analysis_versions
         WHERE tenant_id = :tid AND metadata->>'system_id' = :sid
           AND metadata->'modules' = CAST(:mods AS jsonb)
           AND metadata->'scope' = CAST(:scope AS jsonb)
           AND metadata->>'dataset_path' IS NOT NULL AND status <> 'failed'
         ORDER BY run_at DESC LIMIT 1
    """), {"tid": tenant_id, "sid": system_id, "mods": json.dumps(modules),
           "scope": json.dumps(scope or {})}).fetchone()
    return {**(row[1] or {}), "id": row[0]} if row else None


def delta_plan(baseline: Optional[dict[str, object]], now: datetime, full_days: int) -> Optional[tuple[str, str]]:
    """(since YYYYMMDD, full_at) when a delta may run, else None (read in full). A delta needs a
    baseline whose last full read is at most ``full_days`` old. The periodic full read catches
    records archived or deleted without a change document from tables SAP cannot count."""
    from sap.change_documents import since_date

    started = baseline.get("started_at") if baseline else None
    if not isinstance(started, str):
        return None
    prior = baseline.get("delta") if isinstance(baseline.get("delta"), dict) else {}
    full_at = str(prior.get("full_at") or started)
    if now - datetime.fromisoformat(full_at) > timedelta(days=full_days):
        return None
    return since_date(started), full_at


def baseline_loader(prefix: str) -> Callable[[str], "Optional[pd.DataFrame]"]:
    """``load(table)``: the baseline bundle's table with plain field names, or None if it has none."""
    import pandas as pd

    from api.config import settings
    from api.services.storage import download_file
    from workers.dataset import parquet_name

    def load(table: str) -> Optional[pd.DataFrame]:
        try:
            data = download_file(settings.minio_bucket_uploads, f"{prefix}{parquet_name(table)}")
        except Exception as e:  # ponytail: any storage miss reads the table in full; narrow once storage errors are typed
            logger.warning(f"Delta baseline {prefix}{parquet_name(table)}: {e}")
            return None
        df = pd.read_parquet(io.BytesIO(data))
        return df.fillna("").astype(str).rename(columns=lambda c: c.split(".", 1)[-1])

    return load


def wait_for_config(task: Task, session: Session, system_id: str) -> str:
    """'loaded' when the system has a completed config load; retry while a fresh load runs; else 'baseline'."""
    from api.services.config_pairing import config_basis

    basis = config_basis(session, system_id)
    if basis == "loading" and task.request.retries < CONFIG_WAIT_RETRIES:
        raise task.retry(countdown=CONFIG_WAIT_SECONDS, max_retries=CONFIG_WAIT_RETRIES)
    return "loaded" if basis == "loaded" else "baseline"


def _acquire_version_lock(version_id: str) -> bool:
    """One extraction per version, across worker restarts.

    ``run_extraction`` is declared ``acks_late=True, reject_on_worker_lost=True`` so that a crash
    does not silently lose a finished read. The cost is that the broker REQUEUES a task whose
    worker died, and a restart - every deploy - therefore re-runs an extraction that may already
    be hours in. Two concurrent extractions of the same version then compete: they double the SAP
    reads and, worse, each opens its own RFC sessions. Repeated logons against a strict SAP user
    lock it ("too many failed attempts"), which is exactly what happened on a pilot customer's sandbox.

    A Redis key per version makes the redelivered copy exit immediately instead. The TTL is the
    extraction limit, so a genuinely dead run frees the lock without operator action.
    """
    try:
        import redis  # type: ignore

        from workers.celery_app import celery_app
        url = celery_app.conf.broker_url
        if not url:
            return True
        client = redis.from_url(url)
        return bool(client.set(f"extract-lock:{version_id}", "1", nx=True, ex=EXTRACT_TIME_LIMIT))
    except Exception:
        return True  # never block an extraction because the lock backend is unavailable


# The system lock is refreshed on every progress update and expires an hour after the last one, so
# a dead run cannot block a retry for the whole extraction limit. A static TTL that long would mean
# a failed attempt locked the system out until tomorrow.
SYSTEM_LOCK_TTL = 3600


def _touch_system_lock(system_id: str) -> None:
    """Extend the system lock while the extraction is alive."""
    try:
        import redis  # type: ignore

        from workers.celery_app import celery_app
        url = celery_app.conf.broker_url
        if not url:
            return
        redis.from_url(url).expire(f"extract-lock:system:{system_id}", SYSTEM_LOCK_TTL)
    except Exception:
        pass


def _acquire_system_lock(system_id: str) -> bool:
    """One extraction per SYSTEM at a time, not merely per version.

    A version lock stops a redelivered copy of the same run, but every dispatch gets a fresh
    version_id - so two runs of the same object, or of two objects on one system, could overlap
    freely. With worker concurrency 4 and up to 4 RFC sessions per extraction (MERIDIAN_RFC_PARALLEL),
    that is up to 16 simultaneous sessions for one SAP user against a typical limit of 6. SAP
    refuses the surplus logons, and refused logons are how an account ends up locked - with no OOM
    and no retry anywhere in the picture, which is exactly the lock that could not be explained.

    Returns False when another extraction already holds this system.
    """
    try:
        import redis  # type: ignore

        from workers.celery_app import celery_app
        url = celery_app.conf.broker_url
        if not url:
            return True
        client = redis.from_url(url)
        return bool(client.set(f"extract-lock:system:{system_id}", "1", nx=True, ex=SYSTEM_LOCK_TTL))
    except Exception:
        return True


def _release_system_lock(system_id: str) -> None:
    """Free the system when the extraction ends, however it ends, so the next download need not wait out the TTL."""
    try:
        import redis  # type: ignore

        from workers.celery_app import celery_app
        url = celery_app.conf.broker_url
        if not url:
            return
        redis.from_url(url).delete(f"extract-lock:system:{system_id}")
    except Exception:
        pass


@celery_app.task(
    bind=True,
    name="workers.tasks.run_extraction.run_extraction",
    soft_time_limit=EXTRACT_TIME_LIMIT,
    time_limit=EXTRACT_TIME_LIMIT + 60,
    acks_late=True,
    reject_on_worker_lost=True,
)
def run_extraction(self, tenant_id, system_id, modules, include_config=True, sync_type="both",
                   scope=None, analyse=True, label=None, version_id=None, delta=False, purpose=None):
    """Download ``modules`` (business objects) from ``system_id`` into a new version.

    The version is stored as ``extracted`` with its objects, scope and per-object
    record counts; analysis runs now when ``analyse`` else on request
    (POST /api/v1/versions/{id}/analyse). Every download is a new version.
    Progress is reported to the job registry as job ``dl-<version_id>``
    (api/services/jobs.py); the caller may pre-register it as queued.
    ``delta`` re-reads only what SAP's change documents say changed since the previous version.
    ``purpose`` marks a download made for something other than data quality (process discovery): it is recorded on
    the version and the DQ side effects (module map, table profiles) are skipped.
    """
    if version_id and not _acquire_version_lock(str(version_id)):
        logger.warning(
            "extraction for version %s is already running (redelivered after a restart); "
            "exiting rather than starting a second read of the same system", version_id)
        return {"version_id": str(version_id), "status": "duplicate_ignored"}
    if not _acquire_system_lock(str(system_id)):
        logger.warning(
            "an extraction is already running against system %s; not starting a second one. "
            "Concurrent extractions multiply RFC sessions for one SAP user and SAP refuses the "
            "surplus logons, which locks the account.", system_id)
        return {"version_id": str(version_id), "status": "system_busy"}

    try:
        return _extract(self, tenant_id, system_id, modules, include_config, sync_type, scope, analyse, label,
                        version_id, delta, purpose)
    finally:
        _release_system_lock(str(system_id))


def _extract(self, tenant_id, system_id, modules, include_config, sync_type, scope, analyse, label, version_id, delta,
             purpose):
    """The extraction proper, run while the system lock is held."""
    from api.services.task_progress import publish_progress

    engine = get_sync_engine()
    if sync_type != "config":
        with tenant_session(engine, tenant_id) as s:
            config_basis = wait_for_config(self, s, system_id)  # raises Retry outside the task's try block
    else:
        config_basis = "loaded"
    version_id = version_id or str(uuid.uuid4())
    job_id = f"dl-{version_id}"
    if jobs.get_job(tenant_id, job_id) is None:
        jobs.start_job(tenant_id, job_id, "extraction", label or ", ".join(modules), system_id=system_id,
                       modules=modules, version_id=version_id)
    jobs.update_job(tenant_id, job_id, stage="connect", message="Connecting to the system")
    # the system page's download bar reads this per-system key; the Runs tab reads the job
    started = {"job_id": job_id, "label": label, "objects": modules,
               "started_at": datetime.now(timezone.utc).isoformat()}

    def progress(p: dict, ttl: int = EXTRACT_TIME_LIMIT + 60) -> None:
        _touch_system_lock(str(system_id))
        publish_progress(progress_key(system_id), {**started, "status": "running", **{k: v for k, v in p.items() if k != "tables"}}, ttl)

    progress({"step": "connecting", "percent": 0})
    try:
        with tenant_session(engine, tenant_id) as session:
            from api.services.connectivity_manager import ConnectivityManager

            manager = ConnectivityManager(session, tenant_id)
            if sync_type == "config":
                result = manager.sync_config(system_id, modules)
                jobs.finish_job(tenant_id, job_id, result=result)
                return result

            def _progress(p: dict) -> None:
                progress({"step": "reading", **p})
                tables = p.get("tables") or []
                jobs.update_job(tenant_id, job_id, stage="read", tables=tables,
                                rows_done=sum(t["rows"] for t in tables), rows_total=sum(t["expected"] or 0 for t in tables),
                                message=f"Reading {p['table']}" if p.get("table") else "Reading tables")

            from api.config import settings
            from api.services.source_design import dictionary_for
            from api.services.storage import upload_file
            from workers.dataset import parquet_name

            prefix = f"staging/{tenant_id}/{version_id}/"
            from api.services import delta_extraction
            baseline = delta_baseline(session, tenant_id, system_id, modules, scope) if delta else None
            # the previous extraction left row hashes: compare every table with it, read dated tables by change date
            compare = bool(baseline) and delta_extraction.hashes_exist(session, tenant_id, baseline["id"])
            changes: list = []
            stored_rows: dict[str, int] = {}
            activity: list[str] = []
            profiles: list[tuple[str, dict, list[dict]]] = []
            dictionary = dictionary_for(session, system_id)

            def store(table: str, df, entry: dict) -> None:
                """One data table, straight to the bundle: the frame is dropped once uploaded."""
                # Refuse a write that would risk an OOM kill: SIGKILL cannot be caught, so the
                # SAP sessions would be left dangling and SAP would lock the user.
                #
                # Only the ADDITIONAL allocation counts here. The frame is already resident, so
                # MemAvailable excludes it - checking the whole frame against current availability
                # can only ever fail for a large table, and did: MARC's read completed with all
                # 18,333,093 rows, then "needs about 17.1 GB and only 14.7 GB is available" refused
                # it, when 17.1 + 14.7 was simply the box's total. The write itself converts one
                # column at a time, so what it actually needs is a few columns' worth of headroom.
                from sap.rfc import require_memory
                _frame = int(df.memory_usage(deep=True).sum())
                _per_col = _frame // max(len(df.columns), 1)
                require_memory(_per_col * 4, f"storing {table}")

                buf = io.BytesIO()
                # arrow-backed strings, converted ONE COLUMN AT A TIME.
                #
                # `df.astype("string[pyarrow]")` builds a second copy of the whole frame before
                # writing. For MARC that is the difference between a ~18 GB peak and ~36 GB, and
                # 36 GB is an OOM kill on a 30 GB box: the read itself succeeded (all 18,333,093
                # rows) and the worker was killed by the kernel during the write, which is exactly
                # how the material_master baseline kept dying at the very end.
                for _col in df.columns:
                    if df[_col].dtype != "string[pyarrow]":
                        df[_col] = df[_col].astype("string[pyarrow]")
                df.to_parquet(buf, index=False)
                # Upload failure fails the extraction — never report success
                # for data the checks cannot read.
                upload_file(settings.minio_bucket_uploads, f"{prefix}{parquet_name(table)}", buf.getvalue())
                del buf
                stored_rows[table] = len(df)
                if (d := latest_activity({table: df})) is not None:
                    activity.append(d)
                if not purpose:
                    profiles.append(_profile(session, tenant_id, system_id, version_id, modules, table, df, entry,
                                             dictionary))
                jobs.update_job(tenant_id, job_id, stage="read", rows_done=sum(stored_rows.values()),
                                message=f"Stored {table}")
                if delta and not purpose:  # the per-table change log; hashes kept for the next delta
                    t_dict = dictionary.table(table) if dictionary is not None else None
                    key_cols = [f"{table}.{k}" for k in (getattr(t_dict, "keys", None) or []) if f"{table}.{k}" in df.columns]
                    obj = next((m for m in entry.get("modules", ()) if m in modules), modules[0])
                    change = delta_extraction.track_table(session, tenant_id, version_id, obj, table, df, key_cols,
                                                          entry, compare)
                    changes.append(change)
                    session.commit()
                    jobs.update_job(tenant_id, job_id, stage="read", rows_done=sum(stored_rows.values()),
                                    rows_read=sum(c.rows_read for c in changes),
                                    rows_changed=sum(c.changed or 0 for c in changes),
                                    message=f"Stored {table}: {change.rows_read:,} read"
                                            + (f", {change.changed:,} changed" if change.changed is not None else ""))

            from api.services.connectivity_manager import DeltaRequest

            dplan = delta_plan(baseline, datetime.now(timezone.utc), DELTA_FULL_DAYS) if delta else None
            request = DeltaRequest(dplan[0], baseline_loader(str(baseline["dataset_path"])), by_change_date=compare) \
                if dplan and baseline else None
            frames, coverage = manager.extract(system_id, modules, scope=scope, progress=_progress, sink=store,
                                               delta=request)
            fell_back = request is None or any(c["table"] == "CDHDR:delta" and c["status"] == "delta_fallback"
                                               for c in coverage)
            delta_meta = {"full_at": started["started_at"]} if fell_back else \
                {"baseline_version_id": baseline["id"], "since": dplan[0], "full_at": dplan[1]}
            progress({"step": "saving", "percent": 99})
            jobs.update_job(tenant_id, job_id, stage="store", message="Storing data")
            # refresh the live configuration the value rules compare against
            from workers.tasks.run_discovery import _store_config
            for c in coverage:
                if c.get("purpose") == "config" and c["table"] in frames:
                    df = frames[c["table"]]
                    _store_config(session, tenant_id, system_id, "*", c["table"],
                                  df.rename(columns=lambda x: x.split(".", 1)[-1]).to_dict(orient="records"))
            # non-ABAP connectors return their data tables in frames: store them the same way
            for c in coverage:
                if c["status"] == "live" and c.get("purpose", "data") == "data" and c["table"] in frames \
                        and c["table"] not in stored_rows:
                    store(c["table"], frames.pop(c["table"]), c)
            if not stored_rows:
                if not purpose:
                    _mark_modules(session, tenant_id, system_id, modules, "failed", 0)
                progress({"status": "failed", "error": "No data tables were read"}, 3600)
                jobs.finish_job(tenant_id, job_id, "failed", error="No data table could be read",
                                result={"coverage": coverage})
                logger.error(f"Extraction from {system_id} produced no data tables: {coverage}")
                return {"status": "failed", "coverage": coverage}
            jobs.update_job(tenant_id, job_id, stage="register", message="Registering version")

            from checks.frames import _graph
            anchors = _graph()[1]
            object_rows = {m: stored_rows[anchors[m]] for m in modules if anchors.get(m) in stored_rows}
            total_rows = int(sum(stored_rows.values()))
            # Number this run within its lineage and point at the run it repeats, so two runs of the
            # same objects are distinguishable in the picker ("run 2", "re-run of run 1") instead of
            # only by their timestamps (migration 093).
            session.execute(
                text("""
                    INSERT INTO analysis_versions
                        (id, tenant_id, status, label, metadata, run_number, parent_version_id)
                    SELECT :vid, :tid, :st, :label, CAST(:meta AS jsonb),
                           COALESCE((SELECT max(run_number) FROM analysis_versions
                                      WHERE tenant_id = CAST(:tid AS uuid)
                                        AND COALESCE(metadata->>'system_id', 'upload')
                                            = COALESCE(:sysid, 'upload')), 0) + 1,
                           (SELECT id FROM analysis_versions
                             WHERE tenant_id = CAST(:tid AS uuid)
                               AND COALESCE(metadata->>'system_id', 'upload')
                                   = COALESCE(:sysid, 'upload')
                               AND COALESCE(metadata->'modules', '[]'::jsonb)
                                   = CAST(:mods AS jsonb)
                             ORDER BY run_at DESC, id DESC LIMIT 1)
                """),
                {"vid": version_id, "tid": tenant_id, "st": "pending" if analyse else "extracted",
                 "label": label, "sysid": system_id, "mods": json.dumps(modules),
                 "meta": json.dumps({
                    "modules": modules, "source": "extraction", "trigger": "manual", "system_id": system_id,
                    "config_basis": config_basis,
                    "scope": scope or {}, **({"purpose": purpose} if purpose else {}),
                    "started_at": started["started_at"],
                    "downloaded_at": datetime.now(timezone.utc).isoformat(),
                    "latest_activity": max(activity) if activity else None,
                    # SAP system-local time vs UTC; None = unknown (checks treat it as 0)
                    "sap_utc_offset_seconds": getattr(manager, "sap_utc_offset_seconds", None),
                    "dataset_path": prefix, "object_rows": object_rows,
                    "coverage": coverage, "row_count": total_rows,
                    "delta": delta_meta,
                    # every data table read completely (row count reconciled, no truncation, no paging drift)
                    "extraction_complete": all(c.get("complete", True) for c in coverage if c["status"] == "live")
                                           and not any(c["status"] == "failed" for c in coverage),
                })},
            )
            session.commit()

            if changes:  # the version row exists now
                delta_extraction.record_changes(session, tenant_id, version_id, changes)
                session.commit()
            failed = {c["table"] for c in coverage if c["status"] == "failed" or c.get("complete") is False}
            if not purpose:
                _mark_modules(session, tenant_id, system_id, modules, "partial" if failed else "success", total_rows)
                jobs.update_job(tenant_id, job_id, stage="register", message="Recording table profiles")
                _store_profiles(session, tenant_id, system_id, version_id, profiles)

        progress({"status": "complete", "percent": 100, "version_id": version_id}, 300)
        if analyse:
            from workers.tasks.run_checks import run_checks
            jobs.start_job(tenant_id, version_id, "analysis", label or ", ".join(modules), status="queued",
                           progress_key=version_id, system_id=system_id, version_id=version_id)
            run_checks.delay(version_id, tenant_id, prefix)
        jobs.finish_job(tenant_id, job_id, result={"version_id": version_id, "coverage": coverage,
                                                   "analysis": "queued" if analyse else "on_request"},
                        message="Download complete" + (" — analysis queued" if analyse else ""))
        logger.info(f"Extraction {version_id}: {len(stored_rows)} tables, analysis {'enqueued' if analyse else 'on request'}")
        return {"status": "success", "version_id": version_id, "coverage": coverage}

    except SoftTimeLimitExceeded:
        logger.error("Extraction task timed out")
        progress({"status": "failed", "error": f"Timed out after {EXTRACT_TIME_LIMIT // 60} minutes"}, 3600)
        with Session(engine) as session:
            session.execute(text("SET app.tenant_id = :tid"), {"tid": str(tenant_id)})
            if not purpose:
                _mark_modules(session, tenant_id, system_id, modules, "failed", 0)
        jobs.finish_job(tenant_id, job_id, "failed", error="Timed out")
        return {"status": "failed", "error": "timeout"}
    except Exception as e:
        progress({"status": "failed", "error": str(e)[:300]}, 3600)
        jobs.finish_job(tenant_id, job_id, "failed", error=str(e) or e.__class__.__name__)
        raise


def _mark_modules(session, tenant_id, system_id, modules, status, rows) -> None:
    for module in modules:
        session.execute(
            text("""
                INSERT INTO system_module_map (id, tenant_id, system_id, module, last_synced_at,
                                               last_sync_status, row_count, config_synced)
                VALUES (gen_random_uuid(), :tid, :sid, :mod, now(), :st, :cnt, true)
                ON CONFLICT (tenant_id, system_id, module)
                DO UPDATE SET last_synced_at = now(), last_sync_status = :st, row_count = :cnt
            """),
            {"tid": tenant_id, "sid": system_id, "mod": module, "st": status, "cnt": rows},
        )
    session.commit()


_FINDING_SQL = text("""
    INSERT INTO findings (id, version_id, tenant_id, module, check_id, severity, dimension,
                          affected_count, total_count, pass_rate, details, finding_type)
    VALUES (gen_random_uuid(), :vid, :tid, :module, :check_id, :severity, :dimension,
            :affected, :total, NULL, CAST(:details AS jsonb), 'anomaly')
    ON CONFLICT (version_id, check_id, tenant_id) DO UPDATE SET
        module = EXCLUDED.module, severity = EXCLUDED.severity, dimension = EXCLUDED.dimension,
        affected_count = EXCLUDED.affected_count, total_count = EXCLUDED.total_count,
        details = EXCLUDED.details, finding_type = 'anomaly'
""")


def _profile(session, tenant_id, system_id, version_id, modules, table, df, entry, dictionary) -> tuple[str, dict, list[dict]]:
    """Profile one data table while its frame is still in memory (checks/anomaly.py)
    and compute its deviations from the system's previous extractions. Returns the
    profile and the finding rows; nothing is written here because table_profiles
    references the version row, which does not exist until every table is stored.
    Best effort: a failure here never fails the download."""
    from checks import anomaly

    try:
        profile = {**anomaly.profile_table(df, table, dictionary),
                   "window": entry.get("window"), "truncated": bool(entry.get("truncated"))}
        history = session.execute(text("""
            SELECT profile FROM table_profiles
             WHERE tenant_id = :tid AND system_id = :sid AND table_name = :t AND version_id <> :vid
             ORDER BY created_at DESC LIMIT :n
        """), {"tid": tenant_id, "sid": system_id, "t": table, "vid": version_id,
               "n": anomaly.HISTORY}).scalars().all()[::-1]
        module = next((m for m in entry.get("modules", ()) if m in modules), modules[0])
        rows = [{"vid": version_id, "tid": tenant_id, "module": module, "check_id": anomaly.check_id(a),
                 "severity": a["severity"], "dimension": a["dimension"], "affected": a["affected"],
                 "total": a["total"], "details": json.dumps({k: a[k] for k in (
                     "message", "metric", "table", "field", "expected", "observed", "samples")})}
                for a in anomaly.detect(table, profile, history, df, dictionary)]
        return table, profile, rows
    except Exception as e:
        logger.warning(f"Extraction {version_id}: profiling {table} failed: {e}", exc_info=True)
        return table, {"rows": int(len(df)), "columns": {}}, []


def _store_profiles(session, tenant_id, system_id, version_id, profiles) -> None:
    """Store each table's profile as the next runs' baseline and its deviations as
    findings of type 'anomaly'. Best effort: a failure here never fails the download."""
    try:
        found = 0
        for table, profile, rows in profiles:
            session.execute(text("""
                INSERT INTO table_profiles (tenant_id, version_id, system_id, table_name, row_count, profile)
                VALUES (:tid, :vid, :sid, :t, :rows, CAST(:p AS jsonb))
                ON CONFLICT (version_id, table_name) DO UPDATE SET row_count = EXCLUDED.row_count,
                                                                   profile = EXCLUDED.profile
            """), {"tid": tenant_id, "vid": version_id, "sid": system_id, "t": table,
                   "rows": profile["rows"], "p": json.dumps(profile)})
            if rows:
                session.execute(_FINDING_SQL, rows)
            found += len(rows)
            session.commit()  # per table: a later failure keeps what is done
        logger.info(f"Extraction {version_id}: {len(profiles)} tables profiled, {found} anomalies")
    except Exception as e:
        session.rollback()
        logger.warning(f"Extraction {version_id}: anomaly detection failed: {e}", exc_info=True)
