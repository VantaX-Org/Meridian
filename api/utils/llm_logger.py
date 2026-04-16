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
) -> None:
    """Insert a row into llm_audit_log. Prompt content is hashed, never stored."""
    prompt_hash = hashlib.sha256(prompt.encode()).hexdigest()

    try:
        engine = _get_sync_engine()
        with Session(engine) as session:
            session.execute(text("SET app.tenant_id = :tid"), {"tid": str(tenant_id)})
            session.execute(
                text("""
                    INSERT INTO llm_audit_log (
                        id, tenant_id, service_name, model_version,
                        prompt_hash, token_count, latency_ms, success
                    ) VALUES (
                        gen_random_uuid(), :tenant_id, :service_name, :model_version,
                        :prompt_hash, :token_count, :latency_ms, :success
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
                },
            )
            session.commit()
    except Exception as e:
        logger.warning(f"Failed to log LLM call (non-fatal): {e}")
