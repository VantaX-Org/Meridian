"""LLM savings & observability metrics.

Surfaces how many LLM calls were avoided by the deterministic layer.

Endpoints (all prefixed /api/v1):
    GET  /metrics/llm-savings           — summary of deterministic vs LLM calls
    GET  /metrics/llm-savings/by-service — per-service breakdown
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.deps import Tenant, get_db, get_tenant
from api.services.rbac import require_permission

router = APIRouter(prefix="/api/v1", tags=["llm_metrics"])


class LLMSavingsSummary(BaseModel):
    window_hours: int
    total_decisions: int
    llm_calls: int
    deterministic_hits: int
    deterministic_ratio: float
    total_tokens: int
    total_latency_ms: int
    avg_llm_latency_ms: float


class ServiceSavings(BaseModel):
    service_name: str
    llm_calls: int
    deterministic_hits: int
    deterministic_ratio: float
    avg_llm_latency_ms: float


def _since(hours: int) -> datetime:
    return datetime.now(timezone.utc) - timedelta(hours=hours)


@router.get("/metrics/llm-savings", response_model=LLMSavingsSummary)
async def llm_savings_summary(
    hours: int = Query(24, ge=1, le=24 * 30),
    tenant: Tenant = Depends(get_tenant),
    db: AsyncSession = Depends(get_db),
    _: None = Depends(require_permission("mdm.read")),
) -> LLMSavingsSummary:
    """Summary of deterministic-vs-LLM decisions across all services."""
    since = _since(hours)

    result = await db.execute(
        text(
            """
            SELECT
              COUNT(*)::bigint                                       AS total,
              COALESCE(SUM(CASE WHEN deterministic_hit THEN 1 ELSE 0 END), 0)::bigint AS det_hits,
              COALESCE(SUM(CASE WHEN deterministic_hit THEN 0 ELSE 1 END), 0)::bigint AS llm_calls,
              COALESCE(SUM(token_count), 0)::bigint                  AS tokens,
              COALESCE(SUM(latency_ms), 0)::bigint                   AS total_latency,
              COALESCE(AVG(CASE WHEN NOT deterministic_hit THEN latency_ms END), 0)::float AS avg_latency
            FROM llm_audit_log
            WHERE tenant_id = :tid
              AND called_at >= :since
            """
        ),
        {"tid": str(tenant.tenant_id), "since": since},
    )
    row = result.fetchone()
    if row is None:
        return LLMSavingsSummary(
            window_hours=hours, total_decisions=0, llm_calls=0,
            deterministic_hits=0, deterministic_ratio=0.0,
            total_tokens=0, total_latency_ms=0, avg_llm_latency_ms=0.0,
        )

    total = int(row[0] or 0)
    det_hits = int(row[1] or 0)
    llm_calls = int(row[2] or 0)
    ratio = (det_hits / total) if total > 0 else 0.0

    return LLMSavingsSummary(
        window_hours=hours,
        total_decisions=total,
        llm_calls=llm_calls,
        deterministic_hits=det_hits,
        deterministic_ratio=round(ratio, 4),
        total_tokens=int(row[3] or 0),
        total_latency_ms=int(row[4] or 0),
        avg_llm_latency_ms=round(float(row[5] or 0.0), 2),
    )


@router.get("/metrics/llm-savings/by-service", response_model=list[ServiceSavings])
async def llm_savings_by_service(
    hours: int = Query(24, ge=1, le=24 * 30),
    tenant: Tenant = Depends(get_tenant),
    db: AsyncSession = Depends(get_db),
    _: None = Depends(require_permission("mdm.read")),
) -> list[ServiceSavings]:
    """Per-service breakdown — useful for finding services still dominated by LLM."""
    since = _since(hours)

    result = await db.execute(
        text(
            """
            SELECT service_name,
                   COALESCE(SUM(CASE WHEN deterministic_hit THEN 0 ELSE 1 END), 0)::bigint AS llm_calls,
                   COALESCE(SUM(CASE WHEN deterministic_hit THEN 1 ELSE 0 END), 0)::bigint AS det_hits,
                   COALESCE(AVG(CASE WHEN NOT deterministic_hit THEN latency_ms END), 0)::float AS avg_latency
            FROM llm_audit_log
            WHERE tenant_id = :tid
              AND called_at >= :since
            GROUP BY service_name
            ORDER BY (llm_calls + det_hits) DESC
            """
        ),
        {"tid": str(tenant.tenant_id), "since": since},
    )
    rows = result.fetchall()

    out: list[ServiceSavings] = []
    for service_name, llm_calls, det_hits, avg_latency in rows:
        total = int(llm_calls) + int(det_hits)
        ratio = (int(det_hits) / total) if total > 0 else 0.0
        out.append(
            ServiceSavings(
                service_name=service_name,
                llm_calls=int(llm_calls),
                deterministic_hits=int(det_hits),
                deterministic_ratio=round(ratio, 4),
                avg_llm_latency_ms=round(float(avg_latency or 0.0), 2),
            )
        )
    return out
