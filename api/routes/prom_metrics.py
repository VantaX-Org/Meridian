"""Prometheus /metrics endpoint.

Unauthenticated on purpose: standard Prometheus scrape pattern assumes
the endpoint is only reachable on the cluster's internal network. In
customer deployments the endpoint is exposed only on the private docker
network (nginx doesn't proxy it), so external scrapers never see it.

Mounted at the root `/metrics` so standard Prometheus service-discovery
finds it without extra config.
"""

from fastapi import APIRouter
from starlette.responses import Response

from prometheus_client import CONTENT_TYPE_LATEST, generate_latest

from api.utils.metrics import REGISTRY


router = APIRouter(tags=["metrics"])


@router.get("/metrics", include_in_schema=False)
async def prometheus_metrics() -> Response:
    """Expose the Prometheus text format for scraping."""
    payload = generate_latest(REGISTRY)
    return Response(content=payload, media_type=CONTENT_TYPE_LATEST)
