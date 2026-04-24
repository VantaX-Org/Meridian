"""HTTP metrics + request-id middleware.

Populates the Prometheus Counter/Histogram in api.utils.metrics and
stamps a structured-logging request context so every log line emitted
during the request carries request_id, tenant_id, path, and method.

The middleware uses the *matched route template* (e.g. "/api/v1/rules/{rule_id}")
as the `route` label, not the raw URL — raw URLs would blow up label
cardinality on id-bearing paths.
"""

from __future__ import annotations

import time
from typing import Callable

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response
from starlette.types import ASGIApp

from api.utils.metrics import (
    HTTP_REQUESTS_IN_FLIGHT,
    HTTP_REQUESTS_TOTAL,
    HTTP_REQUEST_DURATION_SECONDS,
)
from api.utils.structured_logging import (
    bind_request_context,
    clear_request_context,
    new_request_id,
)


def _route_template(request: Request) -> str:
    """Return the matched route path template, or the raw path if unmatched.

    Starlette stores the matched route on request.scope["route"] after the
    router has run. BaseHTTPMiddleware wraps the app, so by the time we
    resolve the response the route is populated."""
    route = request.scope.get("route")
    if route is not None and hasattr(route, "path"):
        return route.path  # type: ignore[no-any-return]
    return request.url.path


class MetricsMiddleware(BaseHTTPMiddleware):
    def __init__(self, app: ASGIApp) -> None:
        super().__init__(app)

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        # /metrics endpoint itself is exempt so its scrape doesn't pollute
        # the histogram with noise.
        if request.url.path == "/metrics":
            return await call_next(request)

        request_id = request.headers.get("x-request-id") or new_request_id()
        bind_request_context(
            request_id=request_id,
            path=request.url.path,
            method=request.method,
        )

        HTTP_REQUESTS_IN_FLIGHT.inc()
        start = time.perf_counter()
        status_code = 500
        try:
            response = await call_next(request)
            status_code = response.status_code
            return response
        finally:
            duration = time.perf_counter() - start
            HTTP_REQUESTS_IN_FLIGHT.dec()

            route = _route_template(request)
            HTTP_REQUESTS_TOTAL.labels(
                method=request.method,
                route=route,
                status=str(status_code),
            ).inc()
            HTTP_REQUEST_DURATION_SECONDS.labels(
                method=request.method,
                route=route,
            ).observe(duration)

            # Stamp the id onto the outgoing response so operators can
            # cross-reference. Response may be None on early middleware
            # errors — guard.
            try:
                response.headers.setdefault("x-request-id", request_id)  # type: ignore[unbound-local]
            except Exception:
                pass

            clear_request_context()
