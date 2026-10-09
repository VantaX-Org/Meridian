"""Tenant job registry: every long-running task the UI can watch, in one shape.

Downloads, config syncs, analyses (checks + AI insights) and uploads register
here so the frontend has one list ("what is running, what just finished") and
one live stream, instead of a poll per task type. Redis holds the state —
``job:{tenant}:{id}`` with a per-tenant index — and every write is also
published on ``events:{tenant}:jobs`` for the SSE route. Postgres stays the
record of what the job produced (analysis_versions, config_snapshots); the
registry is progress only, so every failure here is logged and swallowed.

Shape of a job::

    {id, kind, status, label, system_id, version_id,
     stage, stages: [{id, label, status}],          # status queued|running|done|failed|skipped
     percent, rows_done, rows_total, message,
     tables: [{table, status, rows, expected, ...}],  # extraction: one row per SAP table
     error, result, started_at, updated_at, finished_at}

``kind`` is one of extraction · config_sync · analysis · upload · simulation. ``status`` is
queued · running · completed · failed.
"""

from __future__ import annotations

import json
import logging
import time
from typing import Any, Optional

from api.services.task_progress import _redis_client

logger = logging.getLogger("meridian.jobs")

JOB_TTL_SECONDS = 7 * 24 * 3600
INDEX_KEEP = 200          # most recent jobs kept per tenant
ACTIVE = ("queued", "running")

STAGES: dict[str, list[tuple[str, str]]] = {
    "extraction": [("connect", "Connecting"), ("read", "Reading tables"), ("store", "Storing data"),
                   ("register", "Registering version"), ("analyse", "Analysis")],
    "config_sync": [("connect", "Connecting"), ("read", "Reading configuration"), ("store", "Storing snapshots")],
    "config_load": [("connect", "Connecting"), ("read", "Reading configuration"), ("store", "Storing snapshot"),
                    ("derive", "Deriving flows")],
    "analysis": [("load", "Loading data"), ("checks", "Running checks"), ("insights", "AI insights"),
                 ("report", "Building report")],
    "upload": [("parse", "Parsing file"), ("checks", "Running checks"), ("insights", "AI insights"),
               ("report", "Building report")],
    "simulation": [("load", "Loading data"), ("before", "Checks as is"), ("patch", "Applying fixes"),
                   ("after", "Checks after fixes"), ("score", "Scoring")],
}

# Entity-prefix list each job kind changes (spec section 9.1). The job tray
# invalidates only these React Query key prefixes when the job completes.
# "config_sync"/"config_load"/"simulation" have no Wave 1a consumer yet, so
# they touch nothing rather than guessing.
TOUCHES: dict[str, list[str]] = {
    "analysis": ["object", "rule", "records", "run", "shell-counts"],
    "upload": ["object", "rule", "records", "run", "shell-counts"],
    "extraction": ["systems", "run"],
    "simulation": ["records", "batch", "shell-counts"],
    "config_sync": ["systems", "run"],
    "config_load": ["systems", "run"],
}

# analysis progress (task_progress step numbers) → analysis job stage
_STEP_STAGE = {1: "load", 2: "load", 3: "checks", 4: "insights", 5: "report", 6: "report"}


def _key(tenant_id: str, job_id: str) -> str:
    return f"job:{tenant_id}:{job_id}"


def _index(tenant_id: str) -> str:
    return f"jobs:{tenant_id}"


def _owner_key(progress_key: str) -> str:
    return f"job_owner:{progress_key}"


def _now() -> float:
    return time.time()


def _stages(kind: str, current: Optional[str], failed: bool = False) -> list[dict]:
    out, seen = [], current is None
    for sid, label in STAGES.get(kind, []):
        if sid == current:
            out.append({"id": sid, "label": label, "status": "failed" if failed else "running"})
            seen = True
        else:
            out.append({"id": sid, "label": label, "status": "queued" if seen else "done"})
    return out


def _save(client, tenant_id: str, job: dict) -> None:
    job["updated_at"] = _now()
    job.setdefault("touches", TOUCHES.get(job.get("kind", ""), []))
    raw = json.dumps(job)
    pipe = client.pipeline()
    pipe.setex(_key(tenant_id, job["id"]), JOB_TTL_SECONDS, raw)
    pipe.zadd(_index(tenant_id), {job["id"]: job["updated_at"]})
    pipe.zremrangebyrank(_index(tenant_id), 0, -INDEX_KEEP - 1)
    pipe.expire(_index(tenant_id), JOB_TTL_SECONDS)
    pipe.publish(f"events:{tenant_id}:jobs", json.dumps({"event": "job", **job}))
    pipe.execute()


def start_job(tenant_id: str, job_id: str, kind: str, label: str, *, status: str = "running",
              progress_key: Optional[str] = None, **context: Any) -> None:
    """Register a job. ``progress_key`` lets ``update_task_progress`` (keyed by
    version_id) drive this job without knowing the tenant."""
    client = _redis_client()
    if client is None:
        return
    try:
        job = {"id": job_id, "kind": kind, "status": status, "label": label, "stage": None,
               "stages": _stages(kind, None) if status == "running" else
               [{"id": s, "label": lbl, "status": "queued"} for s, lbl in STAGES.get(kind, [])],
               "percent": 0, "rows_done": 0, "rows_total": 0, "message": "Queued" if status == "queued" else "",
               "tables": [], "error": None, "result": None,
               "started_at": _now(), "finished_at": None, **context}
        if progress_key:
            client.setex(_owner_key(progress_key), JOB_TTL_SECONDS, json.dumps([tenant_id, job_id]))
        _save(client, tenant_id, job)
    except Exception as exc:
        logger.warning("start_job %s failed: %s", job_id, exc)


def update_job(tenant_id: str, job_id: str, *, stage: Optional[str] = None, percent: Optional[int] = None,
               rows_done: Optional[int] = None, rows_total: Optional[int] = None, message: Optional[str] = None,
               tables: Optional[list[dict]] = None, **fields: Any) -> None:
    client = _redis_client()
    if client is None:
        return
    try:
        job = get_job(tenant_id, job_id)
        if job is None:
            return
        job["status"] = "running"
        if stage is not None:
            job["stage"] = stage
            job["stages"] = _stages(job["kind"], stage)
        if tables is not None:
            job["tables"] = tables
        if rows_done is not None:
            job["rows_done"] = int(rows_done)
        if rows_total is not None:
            job["rows_total"] = int(rows_total)
        if message is not None:
            job["message"] = message
        job["percent"] = int(percent) if percent is not None else stage_percent(job)
        job.update(fields)
        _save(client, tenant_id, job)
    except Exception as exc:
        logger.warning("update_job %s failed: %s", job_id, exc)


def finish_job(tenant_id: str, job_id: str, status: str = "completed", *, error: Optional[str] = None,
               result: Optional[dict] = None, message: Optional[str] = None) -> None:
    client = _redis_client()
    if client is None:
        return
    try:
        job = get_job(tenant_id, job_id)
        if job is None:
            return
        failed = status == "failed"
        job.update({"status": status, "error": (error or None) and str(error)[:500], "result": result,
                    "finished_at": _now(), "percent": job["percent"] if failed else 100,
                    "message": message or ("Failed" if failed else "Complete")})
        if failed:
            job["stages"] = _stages(job["kind"], job.get("stage"), failed=True)
        else:
            job["stages"] = [{**s, "status": "done" if s["status"] != "skipped" else s["status"]} for s in job["stages"]]
        _save(client, tenant_id, job)
    except Exception as exc:
        logger.warning("finish_job %s failed: %s", job_id, exc)


def stage_percent(job: dict) -> int:
    """Stage boundaries split 0–100 evenly; rows interpolate inside the current stage."""
    stages = STAGES.get(job["kind"], [])
    ids = [s for s, _ in stages]
    if not stages or job.get("stage") not in ids:
        return int(job.get("percent") or 0)
    width = 100 / len(stages)
    base = ids.index(job["stage"]) * width
    within = min(1.0, job["rows_done"] / job["rows_total"]) if job.get("rows_total") else 0.0
    return min(99, int(base + within * width))


def get_job(tenant_id: str, job_id: str) -> Optional[dict]:
    client = _redis_client()
    if client is None:
        return None
    try:
        raw = client.get(_key(tenant_id, job_id))
        return json.loads(raw) if raw else None
    except Exception as exc:
        logger.warning("get_job %s failed: %s", job_id, exc)
        return None


def list_jobs(tenant_id: str, *, active_only: bool = False, limit: int = 50) -> list[dict]:
    """Most recently updated first."""
    client = _redis_client()
    if client is None:
        return []
    try:
        ids = client.zrevrange(_index(tenant_id), 0, INDEX_KEEP - 1)
        if not ids:
            return []
        raws = client.mget([_key(tenant_id, i.decode() if isinstance(i, bytes) else i) for i in ids])
        jobs = [json.loads(r) for r in raws if r]
        if active_only:
            jobs = [j for j in jobs if j["status"] in ACTIVE]
        return jobs[:limit]
    except Exception as exc:
        logger.warning("list_jobs failed: %s", exc)
        return []


def mirror_progress(progress_key: str, payload: dict) -> None:
    """Reflect an ``update_task_progress`` write onto the job registered for it."""
    client = _redis_client()
    if client is None:
        return
    try:
        raw = client.get(_owner_key(progress_key))
        if not raw:
            return
        tenant_id, job_id = json.loads(raw)
        status = payload.get("status")
        if status == "completed":
            finish_job(tenant_id, job_id, "completed", message=payload.get("current_step") or None)
        elif status == "failed":
            finish_job(tenant_id, job_id, "failed", error=payload.get("error") or payload.get("current_step"))
        else:
            job = get_job(tenant_id, job_id)
            if job is None:
                return
            if status == "queued":
                job["status"] = "queued"
                job["message"] = payload.get("current_step") or "Queued"
                _save(client, tenant_id, job)
                return
            update_job(tenant_id, job_id, stage=_STEP_STAGE.get(int(payload.get("step_number") or 0)),
                       percent=payload.get("percent_complete"), rows_done=payload.get("rows_processed"),
                       rows_total=payload.get("total_rows"), message=payload.get("current_step"))
    except Exception as exc:
        logger.warning("mirror_progress %s failed: %s", progress_key, exc)
