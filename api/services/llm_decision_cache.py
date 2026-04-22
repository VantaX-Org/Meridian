"""Persistent LLM decision cache — survives Redis flushes.

Any service that calls an LLM with a content-addressable input should first
check this cache; on miss, call the LLM, then store the decision. At 400k-
record scale this pushes second-run cost to zero.

Usage:
    from api.services.llm_decision_cache import cache_get, cache_set, hash_input

    key = hash_input({"a": "...", "b": "..."})
    cached = cache_get(tenant_id, "ai_semantic_matcher", key)
    if cached is not None:
        return cached["score"]
    score = ...  # call LLM
    cache_set(tenant_id, "ai_semantic_matcher", key, {"score": score}, ttl_hours=24*7)
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

logger = logging.getLogger("meridian.llm_decision_cache")


def _sync_engine():
    url = os.getenv("DATABASE_URL_SYNC", os.getenv("DATABASE_URL", ""))
    url = url.replace("postgresql+asyncpg://", "postgresql://")
    return create_engine(url)


def hash_input(payload: Any) -> str:
    """Stable sha256 of a JSON-serialisable payload (keys sorted)."""
    s = json.dumps(payload, sort_keys=True, default=str, separators=(",", ":"))
    return hashlib.sha256(s.encode()).hexdigest()


def cache_get(tenant_id: str, service_name: str, input_hash: str) -> dict | None:
    """Return the cached decision dict, or None on miss / expired."""
    try:
        engine = _sync_engine()
        with Session(engine) as session:
            session.execute(text("SET app.tenant_id = :tid"), {"tid": str(tenant_id)})
            row = session.execute(
                text(
                    """
                    SELECT decision, expires_at
                    FROM llm_decision_cache
                    WHERE tenant_id = :tid
                      AND service_name = :svc
                      AND input_hash = :h
                      AND (expires_at IS NULL OR expires_at > now())
                    """
                ),
                {"tid": str(tenant_id), "svc": service_name, "h": input_hash},
            ).fetchone()
            if row is None:
                return None
            return row[0] if isinstance(row[0], dict) else json.loads(row[0])
    except Exception as e:
        logger.debug(f"cache_get miss due to error (treated as miss): {e}")
        return None


def cache_set(
    tenant_id: str,
    service_name: str,
    input_hash: str,
    decision: dict,
    *,
    ttl_hours: int | None = 24 * 7,
    deterministic_hit: bool = False,
) -> None:
    """Upsert a decision into the cache. TTL default 7 days."""
    expires_at = (
        datetime.now(timezone.utc) + timedelta(hours=ttl_hours)
        if ttl_hours is not None
        else None
    )
    try:
        engine = _sync_engine()
        with Session(engine) as session:
            session.execute(text("SET app.tenant_id = :tid"), {"tid": str(tenant_id)})
            session.execute(
                text(
                    """
                    INSERT INTO llm_decision_cache (
                        id, tenant_id, service_name, input_hash,
                        decision, deterministic_hit, expires_at
                    ) VALUES (
                        gen_random_uuid(), :tid, :svc, :h,
                        CAST(:decision AS jsonb), :det_hit, :expires_at
                    )
                    ON CONFLICT ON CONSTRAINT uq_llm_decision_cache_key DO UPDATE
                    SET decision = EXCLUDED.decision,
                        deterministic_hit = EXCLUDED.deterministic_hit,
                        expires_at = EXCLUDED.expires_at
                    """
                ),
                {
                    "tid": str(tenant_id),
                    "svc": service_name,
                    "h": input_hash,
                    "decision": json.dumps(decision, default=str),
                    "det_hit": deterministic_hit,
                    "expires_at": expires_at,
                },
            )
            session.commit()
    except Exception as e:
        logger.warning(f"cache_set failed (non-fatal): {e}")


def purge_expired() -> int:
    """Delete rows past ``expires_at``. Returns the number of rows deleted."""
    try:
        engine = _sync_engine()
        with Session(engine) as session:
            result = session.execute(
                text(
                    """
                    DELETE FROM llm_decision_cache
                    WHERE expires_at IS NOT NULL AND expires_at < now()
                    """
                )
            )
            session.commit()
            return int(result.rowcount or 0)
    except Exception as e:
        logger.warning(f"purge_expired failed: {e}")
        return 0
