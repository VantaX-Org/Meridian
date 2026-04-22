"""LLM audit logger — logs every LLM call to llm_audit_log without storing prompt content."""

import hashlib
import logging
import os

from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

logger = logging.getLogger("meridian.llm_logger")


def _get_sync_engine():
    url = os.getenv("DATABASE_URL_SYNC", os.getenv("DATABASE_URL", ""))
    url = url.replace("postgresql+asyncpg://", "postgresql://")
    return create_engine(url)


def log_llm_call(
    tenant_id: str,
    service_name: str,
    prompt: str,
    model_version: str,
    token_count: int,
    latency_ms: int,
    success: bool,
    deterministic_hit: bool = False,
    skip_reason: str | None = None,
) -> None:
    """Insert a row into llm_audit_log. Prompt content is hashed, never stored.

    When ``deterministic_hit=True``, the row records a decision that was made
    *without* calling the LLM — this powers the `/api/v1/metrics/llm-savings`
    endpoint that shows how many calls were short-circuited by deterministic
    rules. ``skip_reason`` is a short token (e.g. 'closed_domain', 'canonical',
    'cache_hit') that explains why no LLM round-trip happened.
    """
    prompt_hash = hashlib.sha256(prompt.encode()).hexdigest()

    try:
        engine = _get_sync_engine()
        with Session(engine) as session:
            session.execute(text("SET app.tenant_id = :tid"), {"tid": str(tenant_id)})
            session.execute(
                text("""
                    INSERT INTO llm_audit_log (
                        id, tenant_id, service_name, model_version,
                        prompt_hash, token_count, latency_ms, success,
                        deterministic_hit, skip_reason
                    ) VALUES (
                        gen_random_uuid(), :tenant_id, :service_name, :model_version,
                        :prompt_hash, :token_count, :latency_ms, :success,
                        :deterministic_hit, :skip_reason
                    )
                """),
                {
                    "tenant_id": tenant_id,
                    "service_name": service_name,
                    "model_version": model_version,
                    "prompt_hash": prompt_hash,
                    "token_count": token_count,
                    "latency_ms": latency_ms,
                    "success": success,
                    "deterministic_hit": deterministic_hit,
                    "skip_reason": skip_reason,
                },
            )
            session.commit()
    except Exception as e:
        logger.warning(f"Failed to log LLM call (non-fatal): {e}")


def log_deterministic_skip(
    tenant_id: str,
    service_name: str,
    skip_reason: str,
    *,
    model_version: str = "deterministic",
) -> None:
    """Convenience: record that a deterministic short-circuit avoided an LLM call."""
    log_llm_call(
        tenant_id=tenant_id,
        service_name=service_name,
        prompt=f"deterministic:{service_name}:{skip_reason}",
        model_version=model_version,
        token_count=0,
        latency_ms=0,
        success=True,
        deterministic_hit=True,
        skip_reason=skip_reason,
    )
