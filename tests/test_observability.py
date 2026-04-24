"""Prometheus registry + structured logging sanity tests.

Doesn't need a live FastAPI app — validates that the registry emits the
expected metric families and that the JSON formatter stamps the request
context onto every record.
"""

from __future__ import annotations

import io
import json
import logging

import pytest

from api.utils import metrics
from api.utils.structured_logging import (
    bind_request_context,
    clear_request_context,
    configure_logging,
)


def test_metrics_registry_exposes_all_families() -> None:
    from prometheus_client import generate_latest

    # Touch each family once so it appears in the output.
    metrics.HTTP_REQUESTS_TOTAL.labels(method="GET", route="/health", status="200").inc()
    metrics.HTTP_REQUEST_DURATION_SECONDS.labels(method="GET", route="/health").observe(0.01)
    metrics.HTTP_REQUESTS_IN_FLIGHT.inc()
    metrics.HTTP_REQUESTS_IN_FLIGHT.dec()
    metrics.CELERY_TASKS_TOTAL.labels(task="run_checks", status="success").inc()
    metrics.CELERY_TASK_DURATION_SECONDS.labels(task="run_checks").observe(1.0)
    metrics.LLM_CALLS_TOTAL.labels(service="triage", result="success").inc()
    metrics.LLM_CALL_DURATION_SECONDS.labels(service="triage").observe(0.5)
    metrics.AUDIT_ROWS_TOTAL.labels(result="written").inc()
    metrics.AUDIT_PENDING.set(0)
    metrics.CHECKS_EXECUTIONS_TOTAL.labels(engine="polars", module="business_partner").inc()

    payload = generate_latest(metrics.REGISTRY).decode()

    for family in (
        "meridian_http_requests_total",
        "meridian_http_request_duration_seconds",
        "meridian_http_requests_in_flight",
        "meridian_celery_tasks_total",
        "meridian_celery_task_duration_seconds",
        "meridian_llm_calls_total",
        "meridian_llm_call_duration_seconds",
        "meridian_audit_rows_total",
        "meridian_audit_pending",
        "meridian_checks_executions_total",
    ):
        assert family in payload, f"expected {family} in /metrics payload"


def test_json_logging_stamps_request_context(monkeypatch: pytest.MonkeyPatch) -> None:
    pytest.importorskip("pythonjsonlogger")

    monkeypatch.setenv("LOG_FORMAT", "json")
    configure_logging()

    buf = io.StringIO()
    # Reuse the JSON formatter + context filter from the root handler we just installed.
    root = logging.getLogger()
    src = next(h for h in root.handlers if getattr(h, "_meridian_structured", False))
    h = logging.StreamHandler(buf)
    h.setFormatter(src.formatter)
    for f in src.filters:
        h.addFilter(f)
    root.addHandler(h)

    bind_request_context(request_id="r-1", tenant_id="t-1", path="/api/v1/rules")
    try:
        logger = logging.getLogger("meridian.test")
        logger.info("hello", extra={"rule_id": "abc"})
    finally:
        clear_request_context()
        root.removeHandler(h)

    line = buf.getvalue().strip().splitlines()[-1]
    payload = json.loads(line)
    assert payload["msg"] == "hello"
    assert payload["request_id"] == "r-1"
    assert payload["tenant_id"] == "t-1"
    assert payload["rule_id"] == "abc"
    assert payload["level"] == "INFO"
