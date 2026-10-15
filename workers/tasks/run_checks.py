import gc
import json
from collections.abc import Callable, Iterable
from datetime import datetime, timezone
from itertools import groupby
import logging
import os
import threading
import time
import traceback

import pandas as pd
import yaml

from celery import Task
from celery.exceptions import SoftTimeLimitExceeded
from sqlalchemy import Engine, text
from sqlalchemy.orm import Session

from api.services.run_steps import record_step
from checks.base import reraise_soft_limit
from api.services.task_progress import (
    STEP_FINALISE,
    STEP_RUN_CHECKS,
    TOTAL_STEPS,
    _redis_client,
    update_task_progress,
)
from workers.celery_app import celery_app
from workers.db import get_sync_engine

logger = logging.getLogger("meridian.worker")

PROGRESS_THROTTLE_S = 5
HEARTBEAT_S = 30


def throttled(fn, interval: float = PROGRESS_THROTTLE_S):
    """Wrap ``fn`` so it runs at most once per ``interval`` s (time.monotonic)."""
    last = [float("-inf")]

    def wrapper(*a):
        now = time.monotonic()
        if now - last[0] >= interval:
            last[0] = now
            fn(*a)
    return wrapper


def start_heartbeat(version_id: str, last: dict, stop: threading.Event, interval: float = HEARTBEAT_S) -> threading.Thread:
    """Re-publish the last progress payload every ``interval`` s so job ``updated_at`` stays fresh
    through one long rule. Non-fatal: UX only."""
    def beat() -> None:
        while not stop.wait(interval):
            try:
                if last:
                    update_task_progress(version_id, **last)
            except Exception as exc:
                logger.warning("progress heartbeat failed: %s", exc)
    t = threading.Thread(target=beat, daemon=True, name="run-progress-heartbeat")
    t.start()
    return t

# One row per tenant, system (NULL = file upload), module and UTC day; the latest run of the
# day wins. Conflict target = uq_dqs_history_tenant_system_module_day (migration 067).
DQS_HISTORY_UPSERT = text("""
    INSERT INTO dqs_history (
        id, tenant_id, system_id, module_id, dqs_score,
        completeness, accuracy, consistency, timeliness, uniqueness, validity, finding_count
    ) VALUES (
        gen_random_uuid(), :tenant_id, CAST(:system_id AS uuid), :module_id, :dqs_score,
        :completeness, :accuracy, :consistency, :timeliness, :uniqueness, :validity, :finding_count
    )
    ON CONFLICT (tenant_id, (COALESCE(system_id::text, 'upload')), module_id,
                 ((recorded_at AT TIME ZONE 'UTC')::date))
    DO UPDATE SET dqs_score = EXCLUDED.dqs_score, completeness = EXCLUDED.completeness,
                  accuracy = EXCLUDED.accuracy, consistency = EXCLUDED.consistency,
                  timeliness = EXCLUDED.timeliness, uniqueness = EXCLUDED.uniqueness,
                  validity = EXCLUDED.validity, finding_count = EXCLUDED.finding_count,
                  recorded_at = EXCLUDED.recorded_at
""")


def enqueue_wave_reruns(session, tenant_id, system_id, version_id) -> int:
    """Re-run the migration analysis of every open wave sourced from this system against
    the version just analysed, so the cockpit trend follows the monitoring schedule.
    Signed-off waves are frozen. Uploads have no system and re-run nothing."""
    if not system_id:
        return 0
    import uuid as _uuid

    from workers.tasks.run_migration import run_migration

    waves = session.execute(text(
        "SELECT id, modules, target_system_id, target_release FROM migration_waves "
        "WHERE tenant_id = :t AND source_system_id = :s AND signed_off_at IS NULL AND cardinality(modules) > 0"),
        {"t": str(tenant_id), "s": str(system_id)}).fetchall()
    for w in waves:
        run_id = str(_uuid.uuid4())
        dest = str(w.target_system_id) if w.target_system_id else None
        session.execute(text(
            "INSERT INTO migration_runs (id, tenant_id, mode, source_system_id, dest_system_id, modules, status, wave_id) "
            "VALUES (:id, :t, 'source_to_destination', :s, :d, :m, 'queued', :wid)"),
            {"id": run_id, "t": str(tenant_id), "s": str(system_id), "d": dest, "m": list(w.modules),
             "wid": str(w.id)})
        session.commit()
        task = run_migration.delay(str(tenant_id), run_id, "source_to_destination", str(system_id), dest,
                                   list(w.modules), str(version_id), w.target_release)
        session.execute(text("UPDATE migration_runs SET task_id = :tid WHERE id = :rid"), {"tid": task.id, "rid": run_id})
        session.commit()
    return len(waves)


def _live_reference_values(engine, tenant_id: str, metadata: dict) -> dict[str, set[str]]:
    """``TABLE.FIELD`` → values from the source system's live config snapshots.

    Only snapshots with ``source='live'`` count — the SAP-standard baseline is
    already what the rule's own ``reference_values`` encode.
    """
    system_id = metadata.get("system_id")
    if not system_id:
        return {}
    out: dict[str, set[str]] = {}
    with Session(engine) as session:
        session.execute(text("SET app.tenant_id = :tid"), {"tid": str(tenant_id)})
        rows = session.execute(
            text("SELECT config_table, config_data FROM config_snapshots "
                 "WHERE system_id = :sid AND source = 'live'"),
            {"sid": system_id},
        ).fetchall()
    for table, data in rows:
        for rec in data or []:
            for col, val in rec.items():
                if val not in (None, ""):
                    out.setdefault(f"{table}.{col}", set()).add(str(val).strip())
    return out


STALE_DAYS = 30


def snapshot_as_of(session, metadata: dict) -> str | None:
    """The date the version's data was read from the source: what ageing, freshness
    and future-date rules measure against, so a re-analysis of an old version does
    not age it by the wall clock. In order: an explicit ``as_of`` (set it when the
    source system is itself an older copy), the extraction's ``downloaded_at``, the
    sync run's start. None (uploads) means now.

    A source whose last document entry (``latest_activity``) is more than
    STALE_DAYS before the download is a frozen copy: its data is as of that last
    entry, and ageing it by the download date would fail every open item."""
    import pandas as pd
    downloaded = metadata.get("downloaded_at")
    try:
        if not metadata.get("as_of") and downloaded and metadata.get("latest_activity") and \
                pd.Timestamp(downloaded).tz_localize(None) - pd.Timestamp(metadata["latest_activity"]) \
                > pd.Timedelta(days=STALE_DAYS):
            logger.warning(f"source data ends {metadata['latest_activity']}, downloaded {downloaded}: "
                           "measuring as of the last entry")
            downloaded = metadata["latest_activity"]
    except (ValueError, TypeError):
        pass
    candidates = [metadata.get("as_of"), downloaded]
    if metadata.get("sync_run_id"):
        row = session.execute(text("SELECT started_at FROM sync_runs WHERE id = :id"),
                              {"id": str(metadata["sync_run_id"])}).fetchone()
        candidates.append(row[0] if row else None)
    for value in candidates:
        if value in (None, ""):
            continue
        try:
            return pd.Timestamp(value).isoformat()
        except (ValueError, TypeError):
            logger.warning(f"ignoring unparseable as-of date {value!r}")
    return None


def _live_config_frames(engine, tenant_id: str, metadata: dict, tables: set[str]) -> dict[str, pd.DataFrame]:
    """Live configuration tables (T370T) as ``TABLE.FIELD`` frames, for the
    population lookups of checks/population.py; the extraction stores them as
    config snapshots, not data tables."""
    system_id = metadata.get("system_id")
    if not system_id or not tables:
        return {}
    with Session(engine) as session:
        session.execute(text("SET app.tenant_id = :tid"), {"tid": str(tenant_id)})
        rows = session.execute(
            text("SELECT config_table, config_data FROM config_snapshots "
                 "WHERE system_id = :sid AND source = 'live' AND config_table = ANY(:t) ORDER BY synced_at"),
            {"sid": system_id, "t": sorted(tables)},
        ).fetchall()
    # the latest snapshot per table wins
    return {t: pd.DataFrame(data or []).rename(columns=lambda c, t=t: f"{t}.{c}") for t, data in rows}


def rule_set_fingerprint(modules: list[str], overrides: dict, generated: list[dict] | None = None) -> str:
    """Identifies the rules a run applied (YAML + governance + app version) — trend
    points produced by different rule sets are flagged as not comparable."""
    import hashlib
    from pathlib import Path

    from checks.runner import _find_module_yaml

    h = hashlib.sha256()
    for m in sorted(modules):
        try:
            h.update(Path(_find_module_yaml(m)).read_bytes())
        except FileNotFoundError:
            h.update(m.encode())
    h.update(json.dumps(overrides, sort_keys=True).encode())
    for f in ("checks/rules/value_lexicon.yaml", "sap/dictionaries/populations.yaml"):
        h.update((Path(__file__).resolve().parents[2] / f).read_bytes())
    h.update(json.dumps(generated or [], sort_keys=True).encode())  # config-derived rules change with the config
    version_file = Path("/app/VERSION")
    if version_file.exists():
        h.update(version_file.read_bytes())
    return h.hexdigest()[:16]


# A full extract (e.g. a quarter of BSEG) needs far more than the old 5 minutes;
# checks on a capped material master (~21M rows) run past 30. Same ceiling as extraction.
#
# The default is 24 h, not 6, because the ceiling has to clear the *whole* run, and the
# tail of a run is the cross-run issue lifecycle (api/services/record_issues.py::track),
# whose cost scales with the system's accumulated record_issues rather than with the
# rules. Measured on the Komatsu sandbox (8-core Xeon, 30 GB): SuccessFactors finished
# that step in ~2 minutes against 235K failing records, while the ECC system — 2.78M
# record_issues rows, 1.94M of them left by an earlier material_master run — took over
# 5 h 50 m and was killed at the old 6 h limit, leaving a `partial` version whose DQS
# was never written out even though every module had finished. 24 h clears that with
# headroom for a system several times larger.
#
# Raising it is safe to do by halves: a run killed by this limit is recorded, not lost
# (the checkpoint in `metadata.checks_checkpoint` keeps every finished module and
# `_mark_failed` writes the rest as `missing`), and the lost-delivery guard below still
# stops a task that is genuinely killing its worker. Set MERIDIAN_CHECKS_TIME_LIMIT on a
# deployment whose largest object needs longer still.
_CHECKS_LIMIT = int(os.getenv("MERIDIAN_CHECKS_TIME_LIMIT", str(24 * 3600)))


# A worker the kernel OOM-kills never acknowledges its task, so with acks_late and
# reject_on_worker_lost the broker redelivers it, and the next worker dies the same
# way, without end. Every delivery increments a per-task-id counter in Redis that
# only a finished run (complete or failed) clears, so the counter holds the number of
# deliveries that died. The broker's ``redelivered`` flag cannot do this: it is a
# boolean, not a count, and the Redis transport does not set it reliably.
_MAX_LOST = 2

def _lost_error(n: int) -> str:
    return f"checks worker lost {n} times (out of memory or restart); aborted"


_TIME_LIMIT_ERROR = f"checks exceeded the time limit of {_CHECKS_LIMIT}s; aborted"
_DELIVERY_TTL = 2 * 24 * 3600

# Check runs at once across all workers (each holds a full dataset in memory); a run that
# finds every slot taken is retried after _SLOT_WAIT_S. Session advisory locks, so a killed
# worker frees its slot.
_CHECKS_SLOTS = max(1, int(os.getenv("MERIDIAN_CHECKS_SLOTS", "1")))
_SLOT_KEY = "meridian:run_checks:slot:"
_SLOT_WAIT_S = 60


def _delivery_key(task_id: str) -> str:
    return f"meridian:run_checks:deliveries:{task_id}"


def _count_delivery(task_id: str | None) -> int:
    """This delivery's number (1 = first); 0 when it cannot be counted (no task id, no Redis)."""
    client = _redis_client() if task_id else None
    if client is None:
        return 0
    try:
        n = int(client.incr(_delivery_key(task_id)))
        client.expire(_delivery_key(task_id), _DELIVERY_TTL)
        return n
    except Exception as e:  # never fail an analysis over its delivery counter
        reraise_soft_limit(e)
        logger.warning(f"run_checks delivery counter unavailable: {e}")
        return 0


def _clear_deliveries(task_id: str | None) -> None:
    client = _redis_client() if task_id else None
    if client is None:
        return
    try:
        client.delete(_delivery_key(task_id))
    except Exception as e:
        reraise_soft_limit(e)
        logger.warning(f"run_checks delivery counter not cleared: {e}")


def _mark_failed(engine: Engine, tenant_id: str, version_id: str, error: str) -> None:
    """Record a failed check run on the version, its run step and its live progress.

    Modules the run's checkpoint holds keep their findings: the version is then ``partial``,
    its DQS summary scores those modules and marks every other one ``missing`` (no score,
    never counted as clean), and ``metadata.checks_partial`` names both sets."""
    check_step_num, check_step_name = STEP_RUN_CHECKS
    with Session(engine) as session:
        session.execute(text("SET app.tenant_id = :tid"), {"tid": str(tenant_id)})
        meta = session.execute(text("SELECT metadata FROM analysis_versions WHERE id = :vid AND tenant_id = :tid"),
                               {"vid": version_id, "tid": tenant_id}).scalar() or {}
        done: dict[str, dict] = (meta.get("checks_checkpoint") or {}).get("modules") or {}
        if done:
            from api.services.scoring import score_module
            missing = [m for m in meta.get("modules") or [] if m not in done]
            summary = {m: e["dqs"] for m, e in done.items()} | {
                m: {**score_module([], {}, module=m).model_dump(), "missing": True, "reason": error} for m in missing}
            partial = {"completed": sorted(done), "missing": missing, "error": error,
                       "at": datetime.now(timezone.utc).isoformat()}
            session.execute(text(
                "UPDATE analysis_versions SET status = 'partial', dqs_summary = CAST(:s AS jsonb), "
                "metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('checks_partial', CAST(:p AS jsonb)) "
                "WHERE id = :vid AND tenant_id = :tid"),
                {"vid": version_id, "tid": tenant_id, "s": json.dumps(summary), "p": json.dumps(partial)})
        else:
            session.execute(
                text("UPDATE analysis_versions SET status = 'failed' WHERE id = :vid AND tenant_id = :tid"),
                {"vid": version_id, "tid": tenant_id},
            )
        session.commit()
    record_step(engine, tenant_id, version_id, check_step_num, check_step_name, status="failed",
                error_detail=error)
    update_task_progress(
        version_id,
        status="failed",
        current_step="Data quality checks failed",
        step_number=check_step_num,
        total_steps=TOTAL_STEPS,
        error=error,
    )


def _open_checkpoint(engine: Engine, tenant_id: str, version_id: str, rule_set: str, dataset: str) -> dict:
    """``metadata.checks_checkpoint``: the modules an earlier, unfinished run of the same rule
    set on the same dataset completed, which this run resumes rather than re-runs. Anything
    else starts the version over. An earlier run's failing records stay until each check
    replaces its own, so a rerun that dies early leaves the record browser populated."""
    with Session(engine) as session:
        session.execute(text("SET app.tenant_id = :tid"), {"tid": str(tenant_id)})
        cp = session.execute(text("SELECT metadata->'checks_checkpoint' FROM analysis_versions WHERE id = :vid"),
                             {"vid": version_id}).scalar() or {}
        if cp.get("rule_set") == rule_set and cp.get("dataset") == dataset and cp.get("modules") is not None:
            return cp
        cp = {"rule_set": rule_set, "dataset": dataset, "modules": {}}
        session.execute(text(
            "UPDATE analysis_versions SET metadata = (COALESCE(metadata, '{}'::jsonb) - 'checks_partial') "
            "|| jsonb_build_object('checks_checkpoint', CAST(:cp AS jsonb)) WHERE id = :vid"),
            {"vid": version_id, "cp": json.dumps(cp)})
        session.commit()
    return cp


def _enrich(engine: Engine, tenant_id: str, results: list, cost_model: dict) -> None:
    """Root cause and cost of poor data quality, on ``results`` in place."""
    # Root-cause classification against Config Intelligence: bad_data / bad_config / both,
    # so the Workbench and Fix Playbook show WHY a finding exists. No-op without a CI run.
    try:
        from checks.root_cause import enrich_results_with_root_cause
        enrich_results_with_root_cause(engine, str(tenant_id), results)
    except Exception as e:
        reraise_soft_limit(e)
        logger.warning(f"root_cause enrichment failed, continuing: {e}")

    # Cost of poor data quality + impact ranking. Rule results are priced in the runner
    # (from their failing records); Z-table and DDIC results here, from their severity.
    from checks import cost as dq_cost
    for r in results:
        if r.error:
            continue
        if r.cost_at_risk is None:
            r.cost_at_risk, r.cost_formula = dq_cost.price(
                dq_cost.resolve({"id": r.check_id, "module": r.module, "severity": r.severity}, cost_model),
                r.affected_count)
        blocked = dq_cost.blocked_features(r.check_id)
        if blocked and r.affected_count:
            r.details = {**(r.details or {}), "blocked_features": blocked}


def _upsert_findings(session: Session, version_id: str, tenant_id: str, results: list) -> None:
    """One ``findings`` row per check of this version (a rerun updates it in place)."""
    from checks import cost as dq_cost
    finding_rows = [
        {
            "version_id": version_id,
            "tenant_id": tenant_id,
            "module": check_result.module,
            "check_id": check_result.check_id,
            "severity": check_result.severity,
            "dimension": check_result.dimension,
            "affected_count": check_result.affected_count,
            "total_count": check_result.total_count,
            "pass_rate": check_result.pass_rate,
            "details": json.dumps({**(check_result.details or {}),
                                   **({"error": check_result.error} if check_result.error else {})}),
            "rule_context": json.dumps(check_result.rule_context) if check_result.rule_context else "{}",
            "value_fix_map": json.dumps(check_result.value_fix_map) if check_result.value_fix_map else "{}",
            "record_fixes": json.dumps(check_result.record_fixes) if check_result.record_fixes else "[]",
            "cost_at_risk": check_result.cost_at_risk,
            "cost_formula": check_result.cost_formula,
            "impact_score": dq_cost.impact(check_result.cost_at_risk,
                                           len((check_result.details or {}).get("blocked_features") or []),
                                           check_result.severity),
        }
        for check_result in results
    ]
    if finding_rows:  # a single executemany: a per-row loop was ~200x slower on 500+ findings
        session.execute(
            text("""
                INSERT INTO findings (
                    id, version_id, tenant_id, module, check_id, severity,
                    dimension, affected_count, total_count, pass_rate, details,
                    rule_context, value_fix_map, record_fixes,
                    cost_at_risk, cost_formula, impact_score
                ) VALUES (
                    gen_random_uuid(), :version_id, :tenant_id, :module, :check_id,
                    :severity, :dimension, :affected_count, :total_count, :pass_rate,
                    CAST(:details AS jsonb),
                    CAST(:rule_context AS jsonb),
                    CAST(:value_fix_map AS jsonb),
                    CAST(:record_fixes AS jsonb),
                    :cost_at_risk, :cost_formula, :impact_score
                )
                ON CONFLICT (version_id, check_id, tenant_id) DO UPDATE SET
                    module = EXCLUDED.module, severity = EXCLUDED.severity,
                    dimension = EXCLUDED.dimension, affected_count = EXCLUDED.affected_count,
                    total_count = EXCLUDED.total_count, pass_rate = EXCLUDED.pass_rate,
                    details = EXCLUDED.details, rule_context = EXCLUDED.rule_context,
                    value_fix_map = EXCLUDED.value_fix_map, record_fixes = EXCLUDED.record_fixes,
                    cost_at_risk = EXCLUDED.cost_at_risk, cost_formula = EXCLUDED.cost_formula,
                    impact_score = EXCLUDED.impact_score
            """),
            finding_rows,
        )


def _restore_module(session: Session, version_id: str, module: str, entry: dict,
                    keep_keys: set[str], fold: Callable[[str, str, Iterable[str]], None]) -> list:
    """A checkpointed module's results, read back from its stored findings. Its failing
    records go to ``fold`` as the run's own rules do, and stay on the results of ``keep_keys``
    (record-level suppressions)."""
    from checks.base import CheckResult
    checks: dict[str, list[str | None]] = entry["checks"]  # check_id -> [grain, field]
    out: dict[str, CheckResult] = {}
    for f in session.execute(text(
            "SELECT check_id, severity, dimension, affected_count, total_count, pass_rate, details, rule_context, "
            "value_fix_map, record_fixes, cost_at_risk, cost_formula FROM findings "
            "WHERE version_id = :vid AND check_id = ANY(:ids)"), {"vid": version_id, "ids": list(checks)}):
        details = dict(f.details or {})
        grain, field = checks[f.check_id]
        out[f.check_id] = CheckResult(
            check_id=f.check_id, module=module, field=field or "", severity=f.severity, dimension=f.dimension,
            passed=f.affected_count == 0, affected_count=f.affected_count, total_count=f.total_count,
            pass_rate=float(f.pass_rate), message=str(details.get("message") or ""), details=details,
            error=details.get("error"), rule_context=f.rule_context or None, value_fix_map=f.value_fix_map or None,
            record_fixes=f.record_fixes or None, grain=grain,
            cost_at_risk=None if f.cost_at_risk is None else float(f.cost_at_risk), cost_formula=f.cost_formula)
    keys: dict[str, list[str]] = {}
    rows = session.connection().execution_options(stream_results=True, yield_per=50_000).execute(text(
        "SELECT check_id, record_key FROM finding_records WHERE version_id = :vid AND check_id = ANY(:ids) "
        "ORDER BY check_id"), {"vid": version_id, "ids": list(out)})
    for cid, group in groupby(rows, key=lambda row: row[0]):
        batch = [row[1] for row in group]
        fold(cid, out[cid].field, batch)
        if cid in keep_keys:
            keys[cid] = batch
    for cid, batch in keys.items():
        out[cid].failing_record_keys = batch
    return list(out.values())


@celery_app.task(bind=True, name="workers.tasks.run_checks.run_checks",
                 soft_time_limit=_CHECKS_LIMIT, time_limit=_CHECKS_LIMIT + 60,
                 # Redelivered after a worker restart; every write below upserts, so a rerun is safe.
                 acks_late=True, reject_on_worker_lost=True,
                 # Unlimited, because the slot wait below retries this task for as long as another
                 # run holds the only checks slot, which can be hours. Celery's retry() falls back
                 # to this attribute whenever the call site passes max_retries=None, so without it
                 # the wait exhausts the 3 automatic retries (the dispatch default) and the queued
                 # run is dropped with MaxRetriesExceededError: the platform then shows it as
                 # "pending" forever and nothing ever runs it. The crash-loop guard is unaffected —
                 # it counts lost *deliveries* (_count_delivery), and a slot wait is not a delivery.
                 max_retries=None)
def run_checks(self: Task, version_id: str, tenant_id: str, parquet_path: str,
               reanalyse: bool = False) -> dict[str, str | int]:
    """Execute the full check suite against a dataset (``reanalyse``: again, on the same version)."""
    engine = get_sync_engine()
    # One run per version: concurrent runs each load the full dataset and exhaust memory.
    # A session-level advisory lock is freed by Postgres if the worker is killed mid-run.
    lock = engine.connect()
    try:
        if not lock.execute(text("SELECT pg_try_advisory_lock(hashtext(:v))"), {"v": version_id}).scalar():
            logger.warning(f"run_checks already running for version_id={version_id}, skipping")
            return {"version_id": version_id, "status": "already_running"}
        # Runs of different versions share the worker's memory too: at most _CHECKS_SLOTS at once
        # across all workers; the rest wait in the queue (a retry, not a held worker process).
        slot = next((k for k in (f"{_SLOT_KEY}{i}" for i in range(_CHECKS_SLOTS))
                     if lock.execute(text("SELECT pg_try_advisory_lock(hashtext(:k))"), {"k": k}).scalar()), None)
        if slot is None:
            lock.execute(text("SELECT pg_advisory_unlock(hashtext(:v))"), {"v": version_id})
            logger.info(f"run_checks for version_id={version_id} waits for a free checks slot")
            raise self.retry(countdown=_SLOT_WAIT_S, max_retries=None)
        try:
            task_id = self.request.id
            try:  # only a killed worker skips the clearing and leaves its delivery counted
                lost = _count_delivery(task_id)
                if lost > _MAX_LOST:
                    msg = _lost_error(lost - 1)  # this delivery is the one aborted, not a lost one
                    logger.error(f"run_checks {task_id} for version_id={version_id}: {msg}")
                    _mark_failed(engine, tenant_id, version_id, msg)
                    return {"version_id": version_id, "status": "failed", "error": msg}
                return _run_checks(self, engine, version_id, tenant_id, parquet_path, reanalyse)
            except SoftTimeLimitExceeded:  # the hard limit follows and runs no handler: fail the version now
                logger.error(f"run_checks {task_id} for version_id={version_id}: {_TIME_LIMIT_ERROR}")
                _mark_failed(engine, tenant_id, version_id, _TIME_LIMIT_ERROR)
                raise
            finally:
                _clear_deliveries(task_id)
        finally:  # nested: a soft time limit between the unlocks still frees both
            try:
                lock.execute(text("SELECT pg_advisory_unlock(hashtext(:k))"), {"k": slot})
            finally:
                lock.execute(text("SELECT pg_advisory_unlock(hashtext(:v))"), {"v": version_id})
    finally:  # the pooled connection never goes back holding a lock
        try:
            lock.execute(text("SELECT pg_advisory_unlock_all()"))
        except SoftTimeLimitExceeded:  # unlock cut short: drop the session, Postgres frees its locks
            lock.invalidate()
            raise
        finally:
            lock.close()


def _run_checks(self: Task, engine: Engine, version_id: str, tenant_id: str, parquet_path: str,
                reanalyse: bool) -> dict[str, str | int]:
    logger.info(f"run_checks started: version_id={version_id}, tenant_id={tenant_id}")

    with Session(engine) as session:
        # Step 1: Set RLS context
        session.execute(text("SET app.tenant_id = :tid"), {"tid": str(tenant_id)})

        # Check idempotency — if already complete, skip
        result = session.execute(
            text("SELECT status FROM analysis_versions WHERE id = :vid AND tenant_id = :tid"),
            {"vid": version_id, "tid": tenant_id},
        )
        row = result.fetchone()
        if row and row[0] == "complete" and not reanalyse:
            logger.info(f"Version {version_id} already complete, skipping")
            return {"version_id": version_id, "status": "complete"}

        # Step 2: Update status to running
        session.execute(
            text("UPDATE analysis_versions SET status = 'running' WHERE id = :vid AND tenant_id = :tid"),
            {"vid": version_id, "tid": tenant_id},
        )
        session.commit()

    # Announce "Running data quality checks" as soon as the worker picks up the job.
    check_step_num, check_step_name = STEP_RUN_CHECKS
    record_step(engine, tenant_id, version_id, check_step_num, check_step_name, status="running")
    update_task_progress(
        version_id,
        status="processing",
        current_step=check_step_name,
        step_number=check_step_num,
        total_steps=TOTAL_STEPS,
    )
    last_progress: dict = {"current_step": check_step_name, "step_number": check_step_num, "total_steps": TOTAL_STEPS}
    hb_stop = threading.Event()
    start_heartbeat(version_id, last_progress, hb_stop)

    try:
        # Step 3: Load the dataset (extraction bundle or flat upload).
        with Session(engine) as session:
            session.execute(text("SET app.tenant_id = :tid"), {"tid": str(tenant_id)})
            meta_row = session.execute(
                text("SELECT metadata FROM analysis_versions WHERE id = :vid"),
                {"vid": version_id},
            ).fetchone()
            tenant_row = session.execute(
                text("SELECT dqs_weights, cost_model FROM tenants WHERE id = :tid"), {"tid": str(tenant_id)},
            ).fetchone()
            as_of = snapshot_as_of(session, (meta_row[0] if meta_row else None) or {})
            # remember where the dataset lives (migration analysis re-reads it) and the
            # date its date-relative rules were measured against
            session.execute(
                text("UPDATE analysis_versions SET metadata = COALESCE(metadata, '{}'::jsonb) "
                     "|| jsonb_build_object('dataset_path', CAST(:p AS text), "
                     "'checks_as_of', CAST(:a AS text)) WHERE id = :vid"),
                {"vid": version_id, "p": parquet_path, "a": as_of},
            )
            session.commit()
        metadata = (meta_row[0] if meta_row else None) or {}
        modules = metadata.get("modules", [])
        tenant_weights = (tenant_row[0] if tenant_row else None) or {}
        cost_model = (tenant_row[1] if tenant_row else None) or {}

        from api.services.source_design import dictionary_for
        from workers.dataset import load_dataset

        with Session(engine) as session:
            session.execute(text("SET app.tenant_id = :tid"), {"tid": str(tenant_id)})
            # source system's own DDIC (live snapshot) over the SAP-standard bundle
            dictionary = dictionary_for(session, metadata.get("system_id"))
            # rules generated from this system's own field-status customizing
            from checks.field_status_rules import extra_fields, load_config, material_fields
            from sap.field_status_config import conversion_maps, resolve_all, resolve_material
            fs_config = load_config(session, metadata.get("system_id"))
            fs_resolutions = resolve_all(fs_config)
            fs_material = resolve_material(fs_config, dictionary)
        fs_extra = {**extra_fields(fs_resolutions)}
        for t, fs in material_fields(fs_material).items():
            fs_extra[t] = fs_extra.get(t, set()) | fs
        frames, df, row_count, col_count = load_dataset(
            parquet_path, dictionary, modules, extra={f"{t}.{f}" for t, fs in fs_extra.items() for f in fs},
            conversions=conversion_maps(fs_config), lazy=True)

        logger.info(f"Loaded DataFrame: {row_count} rows, {col_count} columns")
        frames.incomplete = {c["table"] for c in metadata.get("coverage") or []
                             if c.get("complete") is False or c.get("truncated")}
        # windowed / scoped reads: fine to judge, but not a complete list to look references up in
        frames.partial = {c["table"] for c in metadata.get("coverage") or [] if c.get("partial")}

        # Records per module = rows of the module's anchor table (flat upload: all rows).
        from checks.frames import _graph
        from checks.runner import is_overlay
        anchors = _graph()[1]
        module_rows = {m: (len(frames.frames[anchors[m]]) if anchors.get(m) in frames.frames else row_count)
                       for m in modules if not is_overlay(m)}  # an overlay owns no records
        with Session(engine) as session:
            session.execute(text("SET app.tenant_id = :tid"), {"tid": str(tenant_id)})
            session.execute(text("UPDATE analysis_versions SET metadata = COALESCE(metadata, '{}'::jsonb) "
                                 "|| jsonb_build_object('module_rows', CAST(:mr AS jsonb)) WHERE id = :vid"),
                            {"mr": json.dumps(module_rows), "vid": version_id})
            session.commit()

        if row_count > 500_000:
            logger.warning(f"Large dataset detected ({row_count} rows). Analysis may take several minutes.")

        self.update_state(state='PROGRESS', meta={
            'stage': 'loaded',
            'message': f'Loaded {row_count} rows, {col_count} columns',
            'progress': 10,
        })
        record_step(engine, tenant_id, version_id, check_step_num, check_step_name, status="running")
        update_task_progress(
            version_id,
            current_step=check_step_name,
            step_number=check_step_num,
            total_steps=TOTAL_STEPS,
            rows_processed=0,
            total_rows=row_count,
        )

        # Step 6: Run checks for each module
        from checks.runner import run_checks as execute_checks

        all_results = []
        live_refs = _live_reference_values(engine, tenant_id, metadata)
        from checks.population import lookup_tables
        frames.config = _live_config_frames(engine, tenant_id, metadata, lookup_tables() - set(frames.frames))
        from checks.overrides import load_overrides
        with Session(engine) as session:
            session.execute(text("SET app.tenant_id = :tid"), {"tid": str(tenant_id)})
            rule_overrides = load_overrides(session)
            from checks import lifecycle
            authored = lifecycle.authored_rules(
                {rid: o["body"] for rid, o in rule_overrides.items() if "body" in o})
            sup_rules, sup_records = lifecycle.load_suppressions(session)
            from checks.field_status_rules import generate, generate_material
            fs_rules = generate(fs_resolutions, modules)
            material_rules = generate_material(fs_material, modules)
            session.execute(text("UPDATE analysis_versions SET metadata = COALESCE(metadata, '{}'::jsonb) "
                                 "|| jsonb_build_object('field_status', CAST(:fs AS jsonb)) WHERE id = :vid"),
                            {"vid": version_id, "fs": json.dumps([
                                {"segment": r.segment.id, "definition": r.fauna, "reason": r.reason,
                                 "account_groups": len(r.groups),
                                 "rules": sum(1 for x in fs_rules if x["grain"] == r.segment.record_table)}
                                for r in fs_resolutions] + ([
                                {"segment": "material_master", "definition": "T130A/T130F",
                                 "reason": "" if fs_material else "material field selection not read from the system",
                                 "account_groups": len({g for v in fs_material.values() for g in v}),
                                 "rules": len(material_rules)}] if "material_master" in modules else []))})
            session.commit()
            fs_rules = fs_rules + material_rules
            from checks.field_status_rules import suppressed_fields
            fs_suppressed = suppressed_fields(fs_resolutions, fs_material)
            # tenant rules: dependencies a steward accepted from profiled data (profile page)
            # and checks a steward authored in the rule studio (conditions carry their dimension)
            mined_rules = [
                {"id": r.name.split(":", 1)[0], "module": r.module, "severity": r.severity,
                 "dimension": "consistency", "rule_authority": "customer_configured",
                 "message": r.description, **(r.conditions or {})}
                for r in session.execute(text(
                    "SELECT name, module, severity, description, conditions FROM rules "
                    "WHERE source IN ('mined', 'custom') AND enabled AND module = ANY(:m) ORDER BY name"),
                    {"m": list(modules)})]
        # misplaced values, placeholders, swaps, dead-in-text records (checks/value_placement.py)
        from checks import config_rules, country_rules, value_placement
        from checks.runner import _find_module_yaml
        # overlay modules (S/4HANA readiness) re-judge tables other modules own:
        # no generated rules, profiling, cleaning, mining or golden records of their own
        data_modules = [m for m in modules if not is_overlay(m)]
        vp_rules = []
        for m in data_modules:
            try:
                static = yaml.safe_load(_find_module_yaml(m).read_text()).get("rules", [])
            except FileNotFoundError:
                continue
            vp_rules += value_placement.generate(m, static, dictionary)
            vp_rules += country_rules.generate(m, static, fs_config, dictionary)  # T005 / BNKA
            vp_rules += config_rules.generate(m, fs_config, dictionary)  # T685A / T582A
        fs_rules = fs_rules + vp_rules + authored + mined_rules
        # A referential rule whose check table is itself an extracted data table (MARA.MATNR,
        # LFA1.LIFNR, MLAN.MATNR) must judge against the extract's full frame. The config load
        # reads only T* customising tables, so _live_reference_values cannot supply these — fill
        # them from the frames, otherwise the reference would be absent (not_evaluable) or, worse,
        # a truncated read that turns almost every value into a false "invalid reference".
        import re as _re
        from checks.runner import module_rules
        # The referential/domain rules live in the module YAML (material_master.yaml, …), not in
        # fs_rules (the generated field-status rules) — iterate both, deduplicated by id.
        _data_rules = list(fs_rules)
        _seen_ids = {r.get("id") for r in _data_rules}
        for _m in modules:
            for _r in module_rules(_m):
                if _r.get("enabled") is False or _r.get("id") in _seen_ids:
                    continue
                _seen_ids.add(_r.get("id"))
                _data_rules.append(_r)
        for _r in _data_rules:
            if _r.get("check_class") not in ("referential_check", "domain_value_check"):
                continue  # exists_check resolves its target from the frames already
            _f = dictionary.resolve(_r.get("field") or "")
            _ct = getattr(_f, "check_table", None) if _f else None
            _cf = getattr(_f, "check_field", None) if _f else None
            if not (_ct and _cf) or _re.match(r"^T[0-9A-Z]", _ct):
                continue  # config table, already supplied from config_snapshots
            _key = f"{_ct}.{_cf}"
            _df = frames.frames.get(_ct)
            # Always take a data-table reference from the frame, overriding any stale value a
            # previous config load left in config_snapshots (the old loader read data tables like
            # MARA truncated to MAX_ROWS, and those rows linger until the next load).
            if _df is not None and _key in _df.columns:
                live_refs[_key] = set(_df[_key].dropna().astype(str).str.strip())
        module_count = max(len(modules), 1)
        outliers: dict[str, dict] = {}
        # coverage (rules that produced no result) and clean records per driving object,
        # both fed from the rule loop so full failing key sets are never held per rule
        from api.services.scoring import CleanRecords
        from checks.base import CheckResult
        skips: dict[str, dict[str, int]] = {}
        trackers = {m: CleanRecords(anchors.get(m) if anchors.get(m) in frames.frames else None,
                                    dictionary.keys(anchors[m]) if anchors.get(m) else (), n)
                    for m, n in module_rows.items()}
        from api.services.record_issues import store_records
        from api.services.scoring import score_all_modules, scoring_config
        governance = {**rule_overrides, "_suppressed": sorted(sup_rules)
                      + sorted(f"{c}:{k}" for c, ks in sup_records.items() for k in ks)}
        rule_set = rule_set_fingerprint(modules, governance, fs_rules)
        # a checkpoint resumes only under the same rules, measuring date, cost model and live
        # reference values (uploads measure as of now: the day, so a same-day rerun still resumes).
        # The reference fingerprint matters: a referential rule's result depends on the source
        # system's live config, so re-loading config (e.g. the check tables the value rules read)
        # must invalidate the checkpoint and re-run those rules, not resurrect their old skips.
        import hashlib
        ref_fingerprint = hashlib.sha256(json.dumps(
            {k: sorted(v) for k, v in live_refs.items()}, sort_keys=True).encode()).hexdigest()[:16]
        resume_key = hashlib.sha256(json.dumps(
            [rule_set, as_of or datetime.now(timezone.utc).date().isoformat(), cost_model, ref_fingerprint],
            sort_keys=True, default=str).encode()).hexdigest()[:16]
        resumed: dict[str, dict] = _open_checkpoint(engine, tenant_id, version_id, resume_key, parquet_path)["modules"]
        # cells a specific rule already reports on that record: the DDIC pass does not report them twice
        reported: dict[str, set[str]] = {}
        rule_fields = {r["id"]: r["fields"] for r in fs_rules if r.get("id") and r.get("fields")}  # e.g. swaps
        lost: set[str] = set()  # checks whose failing records could not be stored

        def fold(check_id: str, field: str, keys: Iterable[str]) -> None:
            for col in rule_fields.get(check_id) or ([field] if field and "." in field else []):
                reported.setdefault(col, set()).update(keys)

        def feed(r: CheckResult, report: bool = True) -> None:
            """Stream the rule's failing records to finding_records and keep on the result only
            what the rest of the run reads, so a module's record values never pile up in memory.
            Best effort: a failure here voids the module's clean-record figure, never the run."""
            if r.failing_record_keys:
                try:
                    with Session(engine) as session:
                        session.execute(text("SET app.tenant_id = :tid"), {"tid": str(tenant_id)})
                        store_records(session, str(tenant_id), str(version_id), [r])
                        session.commit()
                except Exception as e:
                    reraise_soft_limit(e)
                    lost.add(r.check_id)
                    logger.exception(f"failing records of {r.check_id} not stored: {e}")
                if report:
                    fold(r.check_id, r.field, r.failing_record_keys)
                if r.check_id not in sup_records:  # record-level suppressions are discounted at scoring
                    r.failing_record_keys = None
            r.failing_record_values = None
            keys = r._all_failing_keys
            tracker = trackers.get(r.module)
            if tracker is None or keys is None or r.check_id in sup_rules:
                return
            try:
                if sup_records.get(r.check_id):
                    keys = keys[~keys.isin(sup_records[r.check_id])]
                tracker.add(r.check_id, keys)
            except Exception as e:
                reraise_soft_limit(e)
                logger.warning(f"Clean-record tracking failed on {r.check_id}: {e}", exc_info=True)
                tracker.failing, tracker.reason = None, f"clean-record tracking failed on {r.check_id}"
        for idx, module_name in enumerate(modules):
            if module_name in resumed:  # completed by an earlier run of the same rules on the same data
                entry = resumed[module_name]
                with Session(engine) as session:
                    session.execute(text("SET app.tenant_id = :tid"), {"tid": str(tenant_id)})
                    all_results.extend(_restore_module(session, version_id, module_name, entry, set(sup_records), fold))
                skips[module_name] = entry["skips"]
                outliers.update(entry["outliers"])
                lost.update(entry.get("lost") or [])
                trackers.pop(module_name, None)  # its clean-record figure comes from the checkpoint
                logger.info(f"Resumed checks for module {module_name} from the checkpoint")
                continue
            logger.info(f"Running checks for module: {module_name}")
            self.update_state(state='PROGRESS', meta={
                'stage': 'checking',
                'message': f'Running checks for {module_name}',
                'progress': 20 + (idx * 60 // module_count),
            })
            # Interpolate row progress across modules so the bar moves smoothly
            # even for a single-module run with 2000 rows.
            rows_done_before = int((idx / module_count) * row_count)
            record_step(engine, tenant_id, version_id, check_step_num, check_step_name, status="running")
            def publish_rule(done, total, rule_id, idx=idx, module_name=module_name):
                last_progress.update(
                    current_step=f"{check_step_name} — {module_name} | rule {done}/{total} | {rule_id}",
                    rows_processed=int((idx + done / max(total, 1)) / module_count * row_count))
                update_task_progress(version_id, **last_progress)

            on_rule = throttled(publish_rule)

            last_progress.update(current_step=f"{check_step_name} — {module_name}",
                                 rows_processed=rows_done_before, total_rows=row_count)
            update_task_progress(version_id, **last_progress)
            results = execute_checks(module_name, frames, tenant_id, reference_values=live_refs,
                                     overrides=rule_overrides, extra_rules=fs_rules, suppressed=fs_suppressed,
                                     cost_model=cost_model, as_of=as_of,
                                     sap_utc_offset_seconds=metadata.get("sap_utc_offset_seconds"),
                                     on_progress=on_rule, stats=skips.setdefault(module_name, {}),
                                     on_result=feed)
            # joined frames are cached per pass; at millions of rows holding them all runs out of memory
            frames.clear_cache()
            module_outliers: dict[str, dict] = {}
            if module_name in data_modules:
                from checks.outliers import find as find_outliers
                module_outliers = find_outliers(module_name, frames)  # reported, never scored
                outliers.update(module_outliers)
                frames.clear_cache()
                # Field profile + candidate hidden rules of the module's tables
                # (checks/profiling.py, ≤ 200k rows per table). Best-effort: a
                # profiling failure is logged and never fails the analysis.
                try:
                    from api.services.field_profiles import profile_and_store
                    prof = profile_and_store(engine, str(tenant_id), str(version_id), module_name, frames, dictionary)
                    logger.info(f"field profile for {module_name}: {prof}")
                except Exception as e:
                    reraise_soft_limit(e)
                    logger.error(f"field profiling failed for {module_name}, continuing: {e}", exc_info=True)
            # Checkpoint: the module's findings, score and run inputs are stored now, so a time limit
            # or a lost worker later in the run keeps them (the version ends partial) and a rerun of
            # the same rules on the same data resumes after them.
            _enrich(engine, tenant_id, results, cost_model)
            module_dqs = score_all_modules(lifecycle.for_scoring(results, sup_rules, sup_records), tenant_weights,
                                           {module_name: skips[module_name]})[module_name].model_dump()
            if module_name in trackers:
                module_dqs.update(trackers[module_name].result())
            entry = {"checks": {r.check_id: [r.grain, r.field] for r in results}, "skips": skips[module_name],
                     "outliers": module_outliers, "dqs": module_dqs,
                     "lost": sorted(lost & {r.check_id for r in results})}
            with Session(engine) as session:
                session.execute(text("SET app.tenant_id = :tid"), {"tid": str(tenant_id)})
                _upsert_findings(session, version_id, tenant_id, results)
                session.execute(text(
                    "UPDATE analysis_versions SET metadata = jsonb_set(metadata, "
                    "ARRAY['checks_checkpoint', 'modules', CAST(:m AS text)], CAST(:e AS jsonb)) WHERE id = :vid"),
                    {"vid": version_id, "m": module_name, "e": json.dumps(entry)})
                session.commit()
            all_results.extend(results)
            del results
            gc.collect()  # the module's frames and results are released before the next module loads
            # Post-module tick so users see movement between modules.
            rows_done_after = int(((idx + 1) / module_count) * row_count)
            record_step(engine, tenant_id, version_id, check_step_num, check_step_name, status="running")
            last_progress.update(current_step=f"{check_step_name} — {module_name}", rows_processed=rows_done_after)
            update_task_progress(version_id, **last_progress)

        hb_stop.set()  # checks stage over; later stages publish their own progress
        checkpointed = len(all_results)  # results from here on are the post-passes' (Z-table, DDIC)

        frames.clear_cache()  # a failed outlier pass must not leave a decoded frame behind
        # Step 6c: Z-table (customer-namespace) rules. The standard rule
        # packs target SAP-delivered tables only; customers with heavy
        # Y*/Z* customisation get validation coverage via this pass. Rules
        # whose fields aren't in the extract skip silently via the runner.
        try:
            from checks.ztables import discover_ztable_rules
            from checks.runner import REGISTRY as CHECK_REGISTRY
            zt_rules = discover_ztable_rules(tenant_id=str(tenant_id))
            if zt_rules:
                logger.info(f"Running {len(zt_rules)} Z-table rule(s)")
                for rule in zt_rules:
                    if as_of:
                        rule = {**rule, "_as_of": as_of}
                    if metadata.get("sap_utc_offset_seconds") is not None:
                        rule = {**rule, "_sap_utc_offset_seconds": metadata["sap_utc_offset_seconds"]}
                    check_cls = CHECK_REGISTRY.get(rule.get("check_class", ""))
                    if check_cls is None:
                        continue
                    try:
                        from checks.runner import rule_columns
                        built = frames.frame_for(rule_columns(rule), grain=rule.get("grain"),
                                                 optional=check_cls(rule).optional_columns())
                        res = check_cls(rule).run(built[0], key_cols=built[2], grain=built[1]) if built else None
                        if res is not None:
                            feed(res)
                            res._all_failing_keys = None
                            all_results.append(res)
                    except Exception as e:
                        reraise_soft_limit(e)
                        logger.warning(
                            f"Z-table rule {rule.get('id')} failed: {e}"
                        )
        except Exception as e:
            reraise_soft_limit(e)
            logger.warning(f"Z-table check pass failed, continuing: {e}")

        frames.clear_cache()  # the conformance pass decodes every column: nothing may accumulate
        # Step 6d: DDIC conformance — every extracted field against the
        # source system's own dictionary definition (type, length, case,
        # fixed values, live check-table values).
        try:
            from checks.ddic_conformance import run_conformance
            from checks.frames import tables_of
            from checks.runner import get_required_columns
            owner: dict[str, str] = {}
            for m in modules:
                try:
                    for t in tables_of(get_required_columns(m)):
                        owner.setdefault(t, m)
                except FileNotFoundError:
                    continue
            # fields a rule already checks against their allowed values — not reported twice
            value_checked = {r["field"] for r in fs_rules if r.get("field")
                             and r.get("check_class") in ("referential_check", "domain_value_check")}
            for m in modules:
                try:
                    value_checked |= {r["field"] for r in yaml.safe_load(_find_module_yaml(m).read_text()).get("rules", [])
                                      if r.get("field") and r.get("check_class") in ("referential_check", "domain_value_check")}
                except FileNotFoundError:
                    continue
            table_frames = dict(frames.frames)
            if frames.flat is not None:
                for t in frames.unsplittable:
                    table_frames[t] = frames.flat[[c for c in frames.flat.columns if c.startswith(t + ".")]]
            for table, tdf in table_frames.items():
                t0 = time.monotonic()
                keys = [f"{table}.{k}" for k in dictionary.keys(table)]
                for res in run_conformance(table, tdf, dictionary, owner.get(table, modules[0] if modules else ""),
                                           keys, live_refs, value_checked, reported):
                    feed(res, report=False)
                    res._all_failing_keys = None
                    all_results.append(res)
                logger.info(f"DDIC conformance {table}: {len(tdf)} rows x {len(tdf.columns)} cols "
                            f"in {time.monotonic() - t0:.1f}s")
                try:  # the heartbeat thread is stopped by now
                    last_progress.update(current_step="DDIC conformance")
                    update_task_progress(version_id, **last_progress)
                except Exception as exc:
                    reraise_soft_limit(exc)
                    logger.warning("progress update failed: %s", exc)
        except Exception as e:
            reraise_soft_limit(e)
            logger.warning(f"DDIC conformance pass failed, continuing: {e}", exc_info=True)

        logger.info(f"Total check results: {len(all_results)}")

        # root cause and cost of the post-pass results (each module's were set at its checkpoint)
        post = all_results[checkpointed:]
        _enrich(engine, tenant_id, post, cost_model)
        all_results[checkpointed:] = post

        # Step 7-8: Score all modules
        # suppressed rules / records (rule_suppressions) stay out of the score until they expire
        dqs_results = score_all_modules(lifecycle.for_scoring(all_results, sup_rules, sup_records), tenant_weights,
                                        skips)
        dqs_summary = {mod: result.model_dump() for mod, result in dqs_results.items()}
        for mod, tracker in trackers.items():
            if mod in dqs_summary:
                dqs_summary[mod].update(tracker.result())
        for mod, entry in resumed.items():  # clean records of a resumed module: as its checkpoint stored them
            if mod in dqs_summary:
                dqs_summary[mod].update({k: entry["dqs"].get(k) for k in ("clean_record_pct", "clean_records")
                                         if k in entry["dqs"]})

        # Step 9: findings of the post-passes (every module's were stored at its checkpoint)
        with Session(engine) as session:
            session.execute(text("SET app.tenant_id = :tid"), {"tid": str(tenant_id)})
            _upsert_findings(session, version_id, tenant_id, post)

            self.update_state(state='PROGRESS', meta={
                'stage': 'saving',
                'message': f'Saved {len(all_results)} findings',
                'progress': 85,
            })
            # Checks finished + deterministic report ready — mark as completed.
            final_step_num, final_step_name = STEP_FINALISE
            record_step(engine, tenant_id, version_id, final_step_num, final_step_name, status="running")
            update_task_progress(
                version_id,
                status="completed",
                current_step="Analysis complete",
                step_number=final_step_num,
                total_steps=TOTAL_STEPS,
                rows_processed=row_count,
                total_rows=row_count,
                percent_complete=100,
            )
            record_step(engine, tenant_id, version_id, final_step_num, final_step_name, status="complete")

            if reanalyse:
                # checks that no longer run (disabled / removed) drop out of this version,
                # unless an exception or write-back record still points at them
                session.execute(text("""
                    DELETE FROM findings f
                     WHERE f.version_id = :vid AND NOT (f.check_id = ANY(:ids)) AND f.finding_type = 'rule'
                       AND NOT EXISTS (SELECT 1 FROM exceptions e WHERE e.linked_finding_id = f.id)
                       AND NOT EXISTS (SELECT 1 FROM write_back_log w WHERE w.finding_id = f.id)
                """), {"vid": version_id, "ids": [r.check_id for r in all_results]})

            # Step 9b: record-level findings + cross-run issue lifecycle
            # (savepoint: a failure here never loses the findings above).
            try:
                from api.services.record_issues import scope_of, track
                if lost:  # an issue whose records were not stored would be resolved as fixed
                    raise RuntimeError(f"failing records of {len(lost)} check(s) not stored: {sorted(lost)[:5]}")
                with session.begin_nested():
                    # each failing check replaced its records as it streamed; the rest no longer fail here
                    session.execute(text(
                        "DELETE FROM finding_records WHERE version_id = :vid AND tenant_id = :tid "
                        "AND check_id <> ALL(:ids)"),
                        {"vid": version_id, "tid": str(tenant_id),
                         "ids": [r.check_id for r in all_results if r.affected_count > 0]})
                    stats = track(session, str(tenant_id), str(version_id), scope_of(metadata), all_results, frames,
                                  store=False)
                logger.info(f"record issues for {version_id}: {stats}")
                if "lifecycle" not in stats:  # newest run of this system: check exported fix batches
                    from api.services.remediation import reconcile
                    with session.begin_nested():
                        n = reconcile(session, str(tenant_id), str(version_id), scope_of(metadata))
                    logger.info(f"remediation items reconciled for {version_id}: {n}")
                    try:  # post-cleanup monitor: compare with the system's pinned baseline
                        from api.services import monitor
                        with session.begin_nested():
                            summary = monitor.check(session, str(tenant_id), str(version_id), scope_of(metadata))
                        if summary:
                            logger.info(f"monitor for {version_id}: {summary['new_records']} regressed record(s), "
                                        f"batch {summary['batch_id']}")
                            with session.begin_nested():
                                monitor.notify(session, str(tenant_id), str(version_id), summary)
                    except Exception as e:
                        reraise_soft_limit(e)
                        logger.error(f"baseline monitor failed for {version_id}: {e}", exc_info=True)
            except Exception as e:
                reraise_soft_limit(e)
                logger.error(f"record-level tracking failed for {version_id}: {e}", exc_info=True)

            # Step 9c: route new / re-opened issues to owners and start their SLA clocks
            try:
                from api.services.triage import apply_sla, auto_assign
                with session.begin_nested():
                    assigned = auto_assign(session, str(tenant_id))
                    started = apply_sla(session, str(tenant_id))
                logger.info(f"triage for {version_id}: assigned={assigned} sla_started={started}")
            except Exception as e:
                reraise_soft_limit(e)
                logger.error(f"triage auto-assign failed for {version_id}: {e}", exc_info=True)

            # Step 10: Update version with DQS summary + which rule set produced it
            analysis = {"at": datetime.now(timezone.utc).isoformat(), "rule_set": rule_set, "checks": len(all_results)}
            session.execute(
                text("""
                    UPDATE analysis_versions
                    SET status = 'complete', dqs_summary = CAST(:summary AS jsonb),
                        metadata = (COALESCE(metadata, '{}'::jsonb) - 'checks_checkpoint' - 'checks_partial')
                            || jsonb_build_object('rule_set', CAST(:rs AS text), 'analysed_at', CAST(:at AS text),
                                                  'field_usage', CAST(:fu AS jsonb), 'outliers', CAST(:ol AS jsonb),
                                                  'scoring', CAST(:sc AS jsonb))
                            || jsonb_build_object('analyses', COALESCE(metadata->'analyses', '[]'::jsonb)
                                                              || jsonb_build_array(CAST(:an AS jsonb)))
                    WHERE id = :vid AND tenant_id = :tid
                """),
                {
                    "vid": version_id,
                    "tid": tenant_id,
                    "summary": json.dumps(dqs_summary),
                    "rs": analysis["rule_set"], "at": analysis["at"], "an": json.dumps(analysis),
                    "ol": json.dumps(outliers),
                    # the scoring config this run's DQS was computed under (GET /scores/history)
                    "sc": json.dumps(scoring_config(tenant_weights)),
                    # a field systematically used for other data (>30 % of ≥20 values): one field-level
                    # finding, not scored — the records are already flagged by its VP- rule
                    "fu": json.dumps([{"field": r.field, "module": r.module, "share": round(r.affected_count / r.total_count, 3),
                                       "detected": (r.details or {}).get("detected", {})}
                                      for r in all_results if r.check_id.startswith("VP-") and r.total_count >= 20
                                      and r.affected_count / r.total_count > 0.3]),
                },
            )
            session.commit()

        # dqs_history: one row per system, module and day (latest run wins)
        with Session(engine) as session:
            session.execute(text("SET app.tenant_id = :tid"), {"tid": str(tenant_id)})
            for module_name in modules:
                mod_summary = dqs_summary.get(module_name, {})
                if mod_summary.get("composite_score") is None:
                    continue  # no rule executed: no score to chart
                dims = mod_summary.get("dimension_scores", {})
                session.execute(DQS_HISTORY_UPSERT, {
                    "tenant_id": tenant_id,
                    "system_id": metadata.get("system_id"),
                    "module_id": module_name,
                    "dqs_score": mod_summary.get("composite_score", 0),
                    "completeness": dims.get("completeness", 0),
                    "accuracy": dims.get("accuracy", 0),
                    "consistency": dims.get("consistency", 0),
                    "timeliness": dims.get("timeliness", 0),
                    "uniqueness": dims.get("uniqueness", 0),
                    "validity": dims.get("validity", 0),
                    "finding_count": sum(1 for r in all_results if r.module == module_name),
                })
            session.commit()
        logger.info(f"Upserted dqs_history for {len(modules)} modules")

        # Generate deterministic report immediately (no LLM, <1 second)
        try:
            from api.services.deterministic_report import generate_deterministic_report

            findings_for_report = [
                {
                    "check_id": r.check_id,
                    "module": r.module,
                    "severity": r.severity,
                    "dimension": r.dimension,
                    "affected_count": r.affected_count,
                    "total_count": r.total_count,
                    "pass_rate": r.pass_rate,
                    "message": (r.details or {}).get("message", ""),
                    "field": (r.details or {}).get("field", ""),
                    "check_class": (r.rule_context or {}).get("check_class", ""),
                    "rule_context": r.rule_context or {},
                    "value_fix_map": r.value_fix_map or {},
                }
                for r in all_results
            ]

            report = generate_deterministic_report(
                version_id=version_id,
                tenant_id=tenant_id,
                module_names=modules,
                findings=findings_for_report,
                dqs_scores=dqs_summary,
                thresholds=scoring_config(tenant_weights)["thresholds"],
            )

            with Session(engine) as session:
                session.execute(text("SET app.tenant_id = :tid"), {"tid": str(tenant_id)})
                session.execute(
                    text("""
                        INSERT INTO reports (id, version_id, tenant_id, report_json, generated_at)
                        VALUES (gen_random_uuid(), :vid, :tid, CAST(:report AS jsonb), now())
                        ON CONFLICT (version_id, tenant_id) DO UPDATE SET report_json = CAST(:report AS jsonb)
                    """),
                    {"vid": version_id, "tid": tenant_id, "report": json.dumps(report)},
                )
                session.commit()
            logger.info(f"Deterministic report generated for version_id={version_id}")
        except Exception as e:
            reraise_soft_limit(e)
            logger.warning(f"Deterministic report generation failed (non-fatal): {e}")

        logger.info(f"run_checks complete: version_id={version_id}, findings={len(all_results)}")

        # Create notification for analysis completion
        try:
            from api.services.notifications import create_notification_sync
            with Session(engine) as session:
                session.execute(text("SET app.tenant_id = :tid"), {"tid": str(tenant_id)})
                module_list = ", ".join(modules)
                create_notification_sync(
                    tenant_id=tenant_id,
                    user_id=None,
                    type="finding",
                    title=f"New analysis complete: {len(all_results)} findings in {module_list}",
                    body=f"Analysis run finished with {len(all_results)} findings across {len(modules)} module(s).",
                    link=f"/findings?version_id={version_id}",
                    session=session,
                )
                session.commit()
        except Exception as e:
            reraise_soft_limit(e)
            logger.warning(f"Failed to create analysis notification (non-fatal): {e}")

        # Enqueue agent pipeline (skippable for fast-feedback testing)
        import os
        if os.getenv("SKIP_AGENTS", "").lower() in ("true", "1", "yes"):
            logger.info("SKIP_AGENTS=true — skipping agent pipeline")
        else:
            from workers.tasks.run_agents import run_agents
            run_agents.delay(version_id, tenant_id)
            logger.info(f"Enqueued run_agents for version_id={version_id}")

        # Enqueue background AI enrichment for the deterministic report
        if os.getenv("SKIP_AI_ENRICHMENT", "").lower() not in ("true", "1", "yes"):
            try:
                from workers.tasks.ai_enrich_report import ai_enrich_report
                ai_enrich_report.delay(version_id, tenant_id)
                logger.info(f"Enqueued ai_enrich_report for version_id={version_id}")
            except Exception as e:
                reraise_soft_limit(e)
                logger.warning(f"Failed to enqueue ai_enrich_report (non-fatal): {e}")
        else:
            logger.info("SKIP_AI_ENRICHMENT=true — skipping AI report enrichment")

        # Enqueue cleaning detection (non-blocking — failure is non-fatal)
        try:
            from workers.tasks.run_cleaning import run_cleaning
            for module_name in data_modules:
                run_cleaning.delay(version_id, tenant_id, module_name, parquet_path)
            logger.info(f"Enqueued run_cleaning for version_id={version_id}, modules={modules}")
        except Exception as e:
            reraise_soft_limit(e)
            logger.warning(f"Failed to enqueue run_cleaning (non-fatal): {e}")

        # Config Intelligence + Z-object profiling on this version's data
        # (non-blocking). Nothing called these engines before, so the Process
        # workspace's config pages stayed empty.
        try:
            from workers.tasks.run_config_intelligence import run_config_intelligence
            run_config_intelligence.delay(version_id, tenant_id, parquet_path)
            logger.info(f"Enqueued run_config_intelligence for version_id={version_id}")
        except Exception as e:
            reraise_soft_limit(e)
            logger.warning(f"Failed to enqueue run_config_intelligence (non-fatal): {e}")

        # Data contracts (quality / volume / schema) against this run
        try:
            from workers.tasks.evaluate_contracts import evaluate_contracts
            evaluate_contracts.delay(version_id, tenant_id)
        except Exception as e:
            reraise_soft_limit(e)
            logger.warning(f"Failed to enqueue evaluate_contracts (non-fatal): {e}")

        # Alert thresholds (failing-check counts, DQS drop, per-module floors)
        try:
            from workers.tasks.send_notifications import send_notification
            send_notification.delay(version_id, tenant_id, "thresholds")
        except Exception as e:
            reraise_soft_limit(e)
            logger.warning(f"Failed to enqueue threshold alerts (non-fatal): {e}")

        # Migration waves sourced from this system re-run against the fresh version
        try:
            with Session(engine) as session:
                session.execute(text("SET app.tenant_id = :tid"), {"tid": str(tenant_id)})
                n = enqueue_wave_reruns(session, tenant_id, metadata.get("system_id"), version_id)
            if n:
                logger.info(f"Enqueued {n} migration wave re-run(s) for version_id={version_id}")
        except Exception as e:
            reraise_soft_limit(e)
            logger.warning(f"Failed to enqueue migration wave re-runs (non-fatal): {e}")

        # Enqueue exception scan (non-blocking — failure is non-fatal)
        try:
            from workers.tasks.run_exception_scan import run_exception_scan
            run_exception_scan.delay(version_id, tenant_id)
            logger.info(f"Enqueued run_exception_scan for version_id={version_id}")
        except Exception as e:
            reraise_soft_limit(e)
            logger.warning(f"Failed to enqueue run_exception_scan (non-fatal): {e}")

        # Enqueue proven-cost metrics (non-blocking — failure is non-fatal)
        try:
            from workers.tasks.compute_proven_cost import compute_proven_cost
            compute_proven_cost.delay(version_id, tenant_id, parquet_path)
            logger.info(f"Enqueued compute_proven_cost for version_id={version_id}")
        except Exception as e:
            reraise_soft_limit(e)
            logger.warning(f"Failed to enqueue compute_proven_cost (non-fatal): {e}")

        # Enqueue mining — dedup / match / anomaly / relationship (non-blocking).
        # Mirrors the run_cleaning fan-out: each module's mining runs against
        # the same uploaded parquet and writes data_duplicates / match_scores /
        # data_anomalies / data_relationships, which back the Dedup, merge queue,
        # Mining and Relationships pages. run_match returns at once for modules
        # it does not match. Failure is non-fatal — it must never block analysis completion.
        try:
            from workers.tasks.mining.dedup import run_dedup
            from workers.tasks.mining.anomaly import run_anomaly
            from workers.tasks.mining.relationship import run_relationship
            from workers.tasks.run_match import run_match
            for module_name in data_modules:
                run_dedup.delay(version_id, tenant_id, module_name, parquet_path)
                run_match.delay(version_id, tenant_id, module_name, parquet_path)
                run_anomaly.delay(version_id, tenant_id, module_name, parquet_path)
                run_relationship.delay(version_id, tenant_id, module_name, parquet_path)
            logger.info(
                f"Enqueued mining (dedup/match/anomaly/relationship) for "
                f"version_id={version_id}, modules={modules}"
            )
        except Exception as e:
            reraise_soft_limit(e)
            logger.warning(f"Failed to enqueue mining tasks (non-fatal): {e}")

        # Enqueue golden-record build (non-blocking — failure is non-fatal).
        # Registers the uploaded records as master_records via the existing
        # survivorship engine (golden_record_engine), so the Golden Records
        # workbench reflects real uploaded data. Previously that engine had
        # no caller at all.
        try:
            from workers.tasks.build_golden_records import build_golden_records
            for module_name in data_modules:
                build_golden_records.delay(version_id, tenant_id, module_name, parquet_path)
            logger.info(
                f"Enqueued build_golden_records for version_id={version_id}, "
                f"modules={modules}"
            )
        except Exception as e:
            reraise_soft_limit(e)
            logger.warning(f"Failed to enqueue build_golden_records (non-fatal): {e}")

        # Root cause by origin from SAP change documents (non-blocking, non-fatal; skips uploads)
        try:
            from workers.tasks.root_cause import root_cause_findings
            root_cause_findings.delay(version_id, tenant_id)
        except Exception as e:
            reraise_soft_limit(e)
            logger.warning(f"Failed to enqueue root_cause_findings (non-fatal): {e}")

        return {"version_id": version_id, "status": "complete", "findings_count": len(all_results)}

    except SoftTimeLimitExceeded:
        raise  # run_checks marks the version failed with the time-limit reason
    except Exception as e:
        # Step 12: On failure, update status
        logger.error(f"run_checks failed: {traceback.format_exc()}")
        _mark_failed(engine, tenant_id, version_id, str(e) or e.__class__.__name__)
        raise
    finally:
        hb_stop.set()
