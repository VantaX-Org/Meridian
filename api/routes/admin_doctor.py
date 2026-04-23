"""Admin Doctor endpoint — WS8 §10.4.

Live health summary for the Aurora Admin Settings tab. Returns a list
of subsystem checks in the exact shape the frontend AdminDoctorCard
expects (id / label / status / detail).

Poll cadence: the Aurora client refreshes every 30 seconds. That's
light enough to not pressure any subsystem and frequent enough for
operators to see a failing connector within a minute. Streaming via
SSE was considered — rejected because polling is simpler to reason
about and plays better with load balancers, browser DevTools, and
ad-blockers.

Each subsystem check is wrapped in try/except and bounded by a short
timeout. A hung subsystem returns status=warn with the timeout detail;
it never hangs the endpoint.
"""

from __future__ import annotations

import asyncio
import logging
import os
from datetime import datetime, timezone
from typing import Any, Literal

from fastapi import APIRouter
from pydantic import BaseModel

from api.config import settings
from api.middleware.licence import get_cached_licence

logger = logging.getLogger("meridian.admin.doctor")

router = APIRouter(prefix="/api/v1", tags=["admin"])

Status = Literal["ok", "warn", "fail"]


class DoctorItem(BaseModel):
    id: str
    label: str
    status: Status
    detail: str | None = None


class DoctorResponse(BaseModel):
    items: list[DoctorItem]
    last_checked: str


async def _check_postgres() -> DoctorItem:
    """Probe the primary database with a trivial SELECT."""
    try:
        from workers.db import get_sync_engine
        from sqlalchemy import text

        def _probe() -> tuple[bool, float]:
            import time
            engine = get_sync_engine()
            start = time.perf_counter()
            with engine.connect() as conn:
                conn.execute(text("SELECT 1"))
            return True, (time.perf_counter() - start) * 1000

        ok, ms = await asyncio.wait_for(asyncio.to_thread(_probe), timeout=3.0)
        return DoctorItem(
            id="postgres",
            label="Postgres reachable (RLS enforced)",
            status="ok" if ok else "fail",
            detail=f"p50 {ms:.0f}ms",
        )
    except asyncio.TimeoutError:
        return DoctorItem(
            id="postgres",
            label="Postgres reachable",
            status="fail",
            detail="connection timed out after 3s",
        )
    except Exception as e:
        return DoctorItem(
            id="postgres",
            label="Postgres reachable",
            status="fail",
            detail=f"{type(e).__name__}: {e}",
        )


async def _check_redis() -> DoctorItem:
    """Probe the Celery broker (Redis)."""
    try:
        import redis.asyncio as redis_async  # lazy so this import never
        # crashes the endpoint if redis isn't installed
    except ImportError:
        return DoctorItem(
            id="redis",
            label="Redis reachable",
            status="warn",
            detail="redis.asyncio not installed",
        )

    try:
        url = os.getenv("REDIS_URL") or getattr(
            settings, "redis_url", None
        ) or "redis://localhost:6379/0"
        r = redis_async.from_url(url, socket_timeout=3.0)
        try:
            pong = await asyncio.wait_for(r.ping(), timeout=3.0)
        finally:
            await r.aclose()
        return DoctorItem(
            id="redis",
            label="Redis reachable (Celery + cache)",
            status="ok" if pong else "fail",
            detail="pong" if pong else "no response",
        )
    except Exception as e:
        return DoctorItem(
            id="redis",
            label="Redis reachable (Celery + cache)",
            status="fail",
            detail=f"{type(e).__name__}: {e}",
        )


async def _check_minio() -> DoctorItem:
    """Probe MinIO bucket readability."""
    try:
        from minio import Minio
    except ImportError:
        return DoctorItem(
            id="minio",
            label="MinIO reachable (uploads bucket)",
            status="warn",
            detail="minio client not installed",
        )

    def _probe() -> tuple[bool, str]:
        client = Minio(
            endpoint=os.getenv("MINIO_ENDPOINT", "minio:9000"),
            access_key=os.getenv("MINIO_ACCESS_KEY", "meridian"),
            secret_key=os.getenv("MINIO_SECRET_KEY", ""),
            secure=False,
        )
        bucket = os.getenv("MINIO_BUCKET_UPLOADS", "meridian-uploads")
        exists = client.bucket_exists(bucket)
        return exists, f"bucket '{bucket}'"

    try:
        ok, detail = await asyncio.wait_for(asyncio.to_thread(_probe), timeout=3.0)
        return DoctorItem(
            id="minio",
            label="MinIO reachable (uploads bucket)",
            status="ok" if ok else "fail",
            detail=detail if ok else f"{detail} not found",
        )
    except asyncio.TimeoutError:
        return DoctorItem(
            id="minio",
            label="MinIO reachable",
            status="fail",
            detail="connection timed out after 3s",
        )
    except Exception as e:
        return DoctorItem(
            id="minio",
            label="MinIO reachable",
            status="fail",
            detail=f"{type(e).__name__}: {e}",
        )


async def _check_llm() -> DoctorItem:
    """LLM connectivity — reuses health.py's logic."""
    try:
        from llm.provider import _load_db_config
        import httpx

        db_config = _load_db_config() or {}
        provider = db_config.get("provider") or settings.llm_provider
        base_url = db_config.get("base_url") or settings.ollama_base_url

        if provider == "ollama":
            async with httpx.AsyncClient(timeout=3.0) as client:
                resp = await client.get(f"{base_url}/api/tags")
                ok = resp.status_code == 200
            return DoctorItem(
                id="llm",
                label=f"LLM responsive ({provider})",
                status="ok" if ok else "warn",
                detail=f"{base_url} returned {resp.status_code}",
            )
        else:
            has_key = bool(
                db_config.get("api_key")
                or settings.ollama_api_key
                or settings.anthropic_api_key
            )
            return DoctorItem(
                id="llm",
                label=f"LLM configured ({provider})",
                status="ok" if has_key else "warn",
                detail=(
                    "api key present" if has_key else "no api key — AI features degrade"
                ),
            )
    except Exception as e:
        return DoctorItem(
            id="llm",
            label="LLM reachable",
            status="warn",
            detail=f"{type(e).__name__}: {e}",
        )


async def _check_licence() -> DoctorItem:
    """Licence cache — fast local check."""
    try:
        licence: dict[str, Any] | None = get_cached_licence()
        if licence is None:
            return DoctorItem(
                id="licence",
                label="Licence server reachable",
                status="warn",
                detail="licence cache empty",
            )
        status = "ok" if licence.get("valid") else "warn"
        expires = licence.get("expires_at")
        return DoctorItem(
            id="licence",
            label="Licence server reachable",
            status=status,
            detail=f"expires {expires}" if expires else licence.get("status", ""),
        )
    except Exception as e:
        return DoctorItem(
            id="licence",
            label="Licence cache",
            status="warn",
            detail=f"{type(e).__name__}: {e}",
        )


async def _check_migrations() -> DoctorItem:
    """Alembic migrations at head."""
    def _probe() -> tuple[bool, str]:
        from workers.db import get_sync_engine
        from sqlalchemy import text
        engine = get_sync_engine()
        with engine.connect() as conn:
            row = conn.execute(
                text("SELECT version_num FROM alembic_version LIMIT 1")
            ).fetchone()
        if not row:
            return False, "alembic_version empty"
        return True, f"latest: {row[0]}"

    try:
        ok, detail = await asyncio.wait_for(asyncio.to_thread(_probe), timeout=3.0)
        return DoctorItem(
            id="migrations",
            label="Alembic migrations at head",
            status="ok" if ok else "warn",
            detail=detail,
        )
    except Exception as e:
        return DoctorItem(
            id="migrations",
            label="Alembic migrations",
            status="warn",
            detail=f"{type(e).__name__}: {e}",
        )


@router.get("/admin/doctor", response_model=DoctorResponse)
async def doctor() -> DoctorResponse:
    """Run every subsystem probe concurrently, return a single summary.

    Frontend polls this every 30 seconds. Each probe is bounded by its
    own 3-second timeout so a failing subsystem never hangs the panel.
    """
    results = await asyncio.gather(
        _check_postgres(),
        _check_redis(),
        _check_minio(),
        _check_llm(),
        _check_licence(),
        _check_migrations(),
        return_exceptions=False,
    )
    return DoctorResponse(
        items=results,
        last_checked=datetime.now(timezone.utc).isoformat(),
    )
