"""Structured JSON logging + tenant/request context enrichment.

Switches the root logger to emit one JSON object per line so log
aggregators (Loki, CloudWatch, Datadog) can index by tenant, request
id, path, status, and latency without regex gymnastics.

Enabled when `LOG_FORMAT=json` (default in prod compose files). Falls
back to the existing human-readable format when unset.

Enrichment hooks:
  - `bind_request_context(request_id, tenant_id, path, method)` — sets
    a ContextVar read by the formatter so every log inside the request
    includes the context automatically.
  - `clear_request_context()` — resets the ContextVar at request end.
"""

from __future__ import annotations

import contextvars
import logging
import os
import sys
import uuid
from typing import Any

try:
    from pythonjsonlogger import jsonlogger  # type: ignore
except ImportError:  # pragma: no cover — optional dep guarded in requirements.txt
    jsonlogger = None  # type: ignore


# ContextVar holds the request-scoped fields so the formatter can attach
# them to every log record emitted *during* the request, including logs
# from deeper services (Celery submissions, SAP connector errors, etc).
_request_context: contextvars.ContextVar[dict[str, Any]] = contextvars.ContextVar(
    "meridian_request_context", default={}
)


def bind_request_context(**fields: Any) -> None:
    """Stamp fields onto the current request's logging context."""
    current = dict(_request_context.get() or {})
    current.update({k: v for k, v in fields.items() if v is not None})
    _request_context.set(current)


def clear_request_context() -> None:
    _request_context.set({})


class _ContextFilter(logging.Filter):
    """Injects ContextVar fields onto every LogRecord.

    JSON formatter output is controlled by record.__dict__, so we bolt
    the fields onto the record before the formatter runs.
    """

    def filter(self, record: logging.LogRecord) -> bool:
        ctx = _request_context.get() or {}
        for k, v in ctx.items():
            # Don't clobber a field that the caller explicitly set via `extra=`.
            if not hasattr(record, k):
                setattr(record, k, v)
        return True


if jsonlogger is not None:

    class _JsonFormatter(jsonlogger.JsonFormatter):  # type: ignore[misc]
        """Adds canonical fields (timestamp, level, service, request_id) every line."""

        def add_fields(
            self,
            log_record: dict[str, Any],
            record: logging.LogRecord,
            message_dict: dict[str, Any],
        ) -> None:
            super().add_fields(log_record, record, message_dict)
            # Canonical keys first so they sort predictably in a log viewer.
            log_record.setdefault("timestamp", log_record.pop("asctime", None))
            log_record["level"] = record.levelname
            log_record["logger"] = record.name
            log_record.setdefault("service", os.environ.get("SERVICE_NAME", "meridian-api"))
else:

    class _JsonFormatter(logging.Formatter):  # type: ignore[no-redef]
        def format(self, record: logging.LogRecord) -> str:  # pragma: no cover
            return super().format(record)


def configure_logging() -> None:
    """Install the JSON formatter if requested; otherwise leave stdlib defaults.

    Idempotent — safe to call multiple times (e.g. from both api.main and
    the worker entrypoint)."""
    root = logging.getLogger()
    # Remove any handler we installed previously so re-running doesn't stack them.
    for handler in list(root.handlers):
        if getattr(handler, "_meridian_structured", False):
            root.removeHandler(handler)

    log_format = os.environ.get("LOG_FORMAT", "text").lower()
    log_level = os.environ.get("LOG_LEVEL", "INFO").upper()
    root.setLevel(log_level)

    handler = logging.StreamHandler(sys.stdout)
    handler._meridian_structured = True  # type: ignore[attr-defined]
    handler.addFilter(_ContextFilter())

    if log_format == "json":
        if jsonlogger is None:
            # Requirements.txt pins python-json-logger; if it's absent we fall
            # back to text but warn loudly so deploys notice.
            root.warning("LOG_FORMAT=json but python-json-logger not installed — falling back to text")
            handler.setFormatter(
                logging.Formatter("%(asctime)s %(name)s %(levelname)s %(message)s")
            )
        else:
            fmt = "%(asctime)s %(levelname)s %(name)s %(message)s"
            handler.setFormatter(_JsonFormatter(fmt, rename_fields={"message": "msg"}))
    else:
        handler.setFormatter(
            logging.Formatter("%(asctime)s %(name)s %(levelname)s %(message)s")
        )

    root.addHandler(handler)


def new_request_id() -> str:
    """Short request id — UUID4 without dashes, first 16 chars."""
    return uuid.uuid4().hex[:16]
