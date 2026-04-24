"""Prometheus metrics registry for the Meridian API.

One module so every import reaches the same Counter/Histogram objects.
Metrics are exposed at /metrics (see api/routes/prom_metrics.py) and
populated by api/middleware/metrics.py plus a few call-site hooks for
Celery tasks and the LLM provider.

Naming follows the Prometheus conventions:
    meridian_<subject>_<verb>{_total|_seconds|_bytes}

Label cardinality is kept low on purpose — tenant_id is NOT a label
because a tenant proliferation would blow up the metric count. Per-tenant
views belong in the product analytics surface, not /metrics.
"""

from __future__ import annotations

from prometheus_client import CollectorRegistry, Counter, Histogram, Gauge


# Dedicated registry so we don't pick up the default process/gc
# collectors twice if something else (e.g. a worker) imports prometheus_client
# in the same python image.
REGISTRY = CollectorRegistry()


# ── HTTP ─────────────────────────────────────────────────────────────────────

HTTP_REQUESTS_TOTAL = Counter(
    "meridian_http_requests_total",
    "Count of HTTP requests handled, by method, route, and status.",
    labelnames=("method", "route", "status"),
    registry=REGISTRY,
)

HTTP_REQUEST_DURATION_SECONDS = Histogram(
    "meridian_http_request_duration_seconds",
    "HTTP request duration, by method and route.",
    labelnames=("method", "route"),
    # Buckets tuned for a data-quality API: most calls are reads under 200ms,
    # a few uploads + analyses sit in the 1-30s band.
    buckets=(0.01, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0, 30.0, 60.0),
    registry=REGISTRY,
)

HTTP_REQUESTS_IN_FLIGHT = Gauge(
    "meridian_http_requests_in_flight",
    "Requests currently being handled.",
    registry=REGISTRY,
)


# ── Celery ───────────────────────────────────────────────────────────────────

CELERY_TASKS_TOTAL = Counter(
    "meridian_celery_tasks_total",
    "Celery tasks executed, by task name and status (success | failure).",
    labelnames=("task", "status"),
    registry=REGISTRY,
)

CELERY_TASK_DURATION_SECONDS = Histogram(
    "meridian_celery_task_duration_seconds",
    "Celery task runtime, by task name.",
    labelnames=("task",),
    buckets=(1.0, 5.0, 15.0, 30.0, 60.0, 120.0, 300.0, 600.0, 1800.0),
    registry=REGISTRY,
)


# ── LLM ──────────────────────────────────────────────────────────────────────

LLM_CALLS_TOTAL = Counter(
    "meridian_llm_calls_total",
    "LLM calls dispatched, by service + result (success | error | deterministic_hit).",
    labelnames=("service", "result"),
    registry=REGISTRY,
)

LLM_CALL_DURATION_SECONDS = Histogram(
    "meridian_llm_call_duration_seconds",
    "LLM call latency, by service.",
    labelnames=("service",),
    buckets=(0.1, 0.5, 1.0, 2.0, 5.0, 10.0, 30.0, 60.0, 120.0),
    registry=REGISTRY,
)


# ── Audit ────────────────────────────────────────────────────────────────────

AUDIT_ROWS_TOTAL = Counter(
    "meridian_audit_rows_total",
    "audit_log rows appended, by result (written | dropped).",
    labelnames=("result",),
    registry=REGISTRY,
)

AUDIT_PENDING = Gauge(
    "meridian_audit_pending",
    "Outstanding fire-and-forget audit writes.",
    registry=REGISTRY,
)


# ── Checks engine ────────────────────────────────────────────────────────────

CHECKS_EXECUTIONS_TOTAL = Counter(
    "meridian_checks_executions_total",
    "Check rule executions, by engine (pandas | polars) and module.",
    labelnames=("engine", "module"),
    registry=REGISTRY,
)
