"""Component health for the status page, the diagnostics bundle and the 5-minute health samples.

Components: ``api``, ``db``, ``redis``, ``workers`` (with the Celery queue depths), ``garage`` (object storage) and
``ollama`` (only when the LLM provider is the bundled Ollama). Every probe is synchronous, bounded by a short
timeout and never raises: a failure is a ``down`` status with the exception's class name (never its message, which
can carry a DSN or a key). Statuses: up | degraded | down | not_configured.

``record_samples`` writes one row per component per tenant into health_samples, on a 5-minute slot (ON CONFLICT
DO NOTHING, so a repeated tick writes nothing), and prunes samples older than SAMPLE_KEEP_DAYS.
``uptime`` reads them back: per component, the share of samples that were not ``down``, and overall the share of
slots in which no core component (api, db, redis, workers) was down.
"""
from __future__ import annotations

import concurrent.futures
import json
import logging
import os
import time
from collections.abc import Callable
from dataclasses import asdict, dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from sqlalchemy import text
from sqlalchemy.engine import Engine

logger = logging.getLogger("meridian.health_probe")

SAMPLE_MINUTES = 5
SAMPLE_KEEP_DAYS = 35
UPTIME_DAYS = 30
CORE = ("api", "db", "redis", "workers")
LABELS = {"api": "API", "db": "Database", "redis": "Cache and queue", "workers": "Background workers",
          "garage": "Object storage", "ollama": "Local AI model"}
PROBE_TIMEOUT_S = 3.0


def queue_names() -> list[str]:
    return [q.strip() for q in os.getenv("MERIDIAN_STATUS_QUEUES", "celery").split(",") if q.strip()]


def queue_warn_depth() -> int:
    try:
        return max(1, int(os.getenv("MERIDIAN_STATUS_QUEUE_WARN", "100")))
    except ValueError:
        return 100


@dataclass
class Component:
    id: str
    label: str
    status: str
    latency_ms: Optional[int] = None
    detail: Optional[str] = None
    data: dict[str, Any] = field(default_factory=dict)

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


def _timed(fn: Callable[[], Component], cid: str, timeout: float = PROBE_TIMEOUT_S) -> Component:
    """Run one probe in a thread, bounded by ``timeout``; a hang or an exception is ``down``."""
    pool = concurrent.futures.ThreadPoolExecutor(max_workers=1)
    fut = pool.submit(fn)
    try:
        return fut.result(timeout=timeout)
    except concurrent.futures.TimeoutError:
        return Component(cid, LABELS[cid], "down", detail=f"no answer within {timeout:.0f} s")
    except Exception as e:  # noqa: BLE001 - class name only
        return Component(cid, LABELS[cid], "down", detail=type(e).__name__)
    finally:
        pool.shutdown(wait=False)


def _ms(start: float) -> int:
    return int((time.perf_counter() - start) * 1000)


def probe_db(engine: Engine) -> Component:
    def run() -> Component:
        start = time.perf_counter()
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        return Component("db", LABELS["db"], "up", _ms(start))
    return _timed(run, "db")


def _redis_client():  # type: ignore[no-untyped-def]
    import redis

    url = os.getenv("REDIS_URL", "redis://redis:6379/0")
    return redis.from_url(url, socket_timeout=PROBE_TIMEOUT_S, socket_connect_timeout=PROBE_TIMEOUT_S)


def probe_redis() -> tuple[Component, dict[str, Optional[int]]]:
    """(redis component, queue name -> depth or None when Redis cannot say)."""
    depths: dict[str, Optional[int]] = {q: None for q in queue_names()}

    def run() -> Component:
        client = _redis_client()
        start = time.perf_counter()
        client.ping()
        ms = _ms(start)
        for q in depths:
            depths[q] = int(client.llen(q))
        return Component("redis", LABELS["redis"], "up", ms)
    return _timed(run, "redis"), depths


def probe_workers(redis_up: bool, depths: dict[str, Optional[int]]) -> Component:
    """Celery workers answering a broadcast ping within a second; degraded when a queue is backed up."""
    queues = [{"name": q, "depth": d} for q, d in depths.items()]
    if not redis_up:
        return Component("workers", LABELS["workers"], "down", detail="the queue broker is unreachable",
                         data={"online": 0, "queues": queues})

    def run() -> Component:
        from workers.celery_app import celery_app

        start = time.perf_counter()
        replies = celery_app.control.ping(timeout=1.0) or []
        online = len(replies)
        backlog = max((d or 0 for d in depths.values()), default=0)
        status = "down" if online == 0 else ("degraded" if backlog >= queue_warn_depth() else "up")
        detail = None if status == "up" else ("no worker answered" if online == 0 else f"{backlog} tasks waiting")
        return Component("workers", LABELS["workers"], status, _ms(start), detail,
                         {"online": online, "queues": queues})
    comp = _timed(run, "workers")
    comp.data.setdefault("online", 0)
    comp.data.setdefault("queues", queues)
    return comp


def probe_garage() -> Component:
    def run() -> Component:
        from api.config import settings
        from api.services.storage import get_minio_client

        start = time.perf_counter()
        ok = get_minio_client().bucket_exists(settings.minio_bucket_uploads)
        return Component("garage", LABELS["garage"], "up" if ok else "degraded", _ms(start),
                         None if ok else "the uploads bucket is missing")
    return _timed(run, "garage", timeout=PROBE_TIMEOUT_S + 2)


def llm_provider(engine: Optional[Engine], tenant_id: Optional[str] = None) -> tuple[str, Optional[str]]:
    """(provider name, Ollama base URL or None): the tenant's stored choice, else the environment. Never a key."""
    from api.config import settings

    provider, base = settings.llm_provider, settings.ollama_base_url
    if engine is not None:
        try:
            with engine.connect() as conn:
                row = conn.execute(text(
                    "SELECT llm_config->>'provider', llm_config->>'base_url' FROM tenants WHERE id = :t"),
                    {"t": tenant_id or os.getenv("MERIDIAN_TENANT_ID", "00000000-0000-0000-0000-000000000001")}
                ).fetchone()
            if row and row[0]:
                provider, base = row[0], row[1] or base
        except Exception:  # noqa: BLE001, S110 - fall back to the environment
            pass
    return provider, base if provider == "ollama" else None


def probe_ollama(base_url: str) -> Component:
    def run() -> Component:
        import httpx

        start = time.perf_counter()
        resp = httpx.get(f"{base_url.rstrip('/')}/api/tags", timeout=PROBE_TIMEOUT_S)
        ok = resp.status_code == 200
        return Component("ollama", LABELS["ollama"], "up" if ok else "degraded", _ms(start),
                         None if ok else f"answered {resp.status_code}")
    return _timed(run, "ollama", timeout=PROBE_TIMEOUT_S + 1)


def probe_api_http() -> Component:
    """For the worker's sample: the API's own /health over the internal network."""
    def run() -> Component:
        import httpx

        url = os.getenv("MERIDIAN_API_INTERNAL_URL", "http://api:8000").rstrip("/") + "/health"
        start = time.perf_counter()
        resp = httpx.get(url, timeout=PROBE_TIMEOUT_S)
        return Component("api", LABELS["api"], "up" if resp.status_code == 200 else "degraded", _ms(start),
                         None if resp.status_code == 200 else f"answered {resp.status_code}")
    return _timed(run, "api", timeout=PROBE_TIMEOUT_S + 1)


def collect(engine: Engine, *, api: Optional[Component] = None, tenant_id: Optional[str] = None
            ) -> list[Component]:
    """Every component, probed concurrently. ``api`` given: the caller is the API itself and is up."""
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        f_db = pool.submit(probe_db, engine)
        f_redis = pool.submit(probe_redis)
        f_garage = pool.submit(probe_garage)
        f_api = None if api else pool.submit(probe_api_http)
        _provider, base = llm_provider(engine, tenant_id)
        f_ollama = pool.submit(probe_ollama, base) if base else None
        redis_c, depths = f_redis.result()
        workers = probe_workers(redis_c.status == "up", depths)
        out = [api or f_api.result(), f_db.result(), redis_c, workers, f_garage.result()]  # type: ignore[union-attr]
        if f_ollama is not None:
            out.append(f_ollama.result())
    return out


def overall(components: list[Component]) -> str:
    """operational | degraded | outage: outage when a core component is down."""
    if any(c.status == "down" and c.id in CORE for c in components):
        return "outage"
    if any(c.status in ("down", "degraded") for c in components):
        return "degraded"
    return "operational"


def slot(now: datetime) -> datetime:
    now = now.astimezone(timezone.utc)
    return now.replace(minute=now.minute - now.minute % SAMPLE_MINUTES, second=0, microsecond=0)


def record_samples(engine: Engine, components: list[Component], now: Optional[datetime] = None) -> int:
    """One row per component per tenant at this 5-minute slot; prune old rows. Returns rows written."""
    at = slot(now or datetime.now(timezone.utc))
    written = 0
    with engine.connect() as conn:
        tenants = [str(r[0]) for r in conn.execute(text("SELECT id FROM tenants")).fetchall()]
    for tid in tenants:
        with engine.begin() as conn:
            conn.execute(text("SELECT set_config('app.tenant_id', :t, true)"), {"t": tid})
            for c in components:
                written += conn.execute(text(
                    "INSERT INTO health_samples (tenant_id, sampled_at, component, status, latency_ms, detail) "
                    "VALUES (:t, :at, :c, :s, :ms, CAST(:d AS jsonb)) "
                    "ON CONFLICT (tenant_id, sampled_at, component) DO NOTHING"),
                    {"t": tid, "at": at, "c": c.id, "s": c.status, "ms": c.latency_ms,
                     "d": json.dumps({"detail": c.detail, **c.data}) if (c.detail or c.data) else None}).rowcount
            conn.execute(text("DELETE FROM health_samples WHERE tenant_id = :t AND sampled_at < :cut"),
                         {"t": tid, "cut": at - timedelta(days=SAMPLE_KEEP_DAYS)})
    return written


UPTIME_SQL = """
    SELECT component, count(*) AS samples, count(*) FILTER (WHERE status <> 'down') AS up
      FROM health_samples WHERE tenant_id = :t AND sampled_at >= :since AND status <> 'not_configured'
     GROUP BY component ORDER BY component"""
SLOTS_SQL = """
    SELECT date_trunc('day', sampled_at) AS day, count(*) AS slots,
           count(*) FILTER (WHERE NOT bad) AS up
      FROM (SELECT sampled_at, bool_or(status = 'down' AND component = ANY(:core)) AS bad
              FROM health_samples WHERE tenant_id = :t AND sampled_at >= :since
             GROUP BY sampled_at) s
     GROUP BY 1 ORDER BY 1"""


def pct(up: int, total: int) -> Optional[float]:
    return round(100.0 * up / total, 3) if total else None


def uptime_from_rows(per_component: list[Any], per_day: list[Any]) -> dict[str, Any]:
    days = [{"date": d.date().isoformat() if hasattr(d, "date") else str(d), "slots": int(n),
             "uptime_pct": pct(int(u), int(n))} for d, n, u in per_day]
    slots, up = sum(d["slots"] for d in days), sum(int(r[2]) for r in per_day)
    return {"days": UPTIME_DAYS, "sample_minutes": SAMPLE_MINUTES, "overall_pct": pct(up, slots), "slots": slots,
            "components": [{"id": c, "label": LABELS.get(c, c), "samples": int(n), "uptime_pct": pct(int(u), int(n))}
                           for c, n, u in per_component],
            "by_day": days}
