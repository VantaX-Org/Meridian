"""Celery beat task: sample component health every 5 minutes for the status page's 30-day uptime.

Probes the API (its /health over the internal network), the database, Redis with the queue depths, the workers,
object storage and, when it is the LLM provider, the bundled Ollama (api/services/health_probe.py), then writes one
health_samples row per component per tenant on the 5-minute slot. Idempotent: a slot already written is skipped
(ON CONFLICT DO NOTHING), so a duplicate or late tick changes nothing. Samples older than 35 days are pruned in
the same pass. No LLM, no SAP data.
"""
from __future__ import annotations

import logging

from celery.exceptions import SoftTimeLimitExceeded

import time

from api.services.health_probe import BEAT_KEY, _redis_client, collect, degraded, record_samples
from workers.celery_app import celery_app
from workers.db import get_sync_engine

logger = logging.getLogger("meridian.worker.health_samples")


@celery_app.task(name="workers.tasks.health_samples.sample_health", soft_time_limit=60, time_limit=90)
def sample_health() -> dict:
    try:  # the /health beat component reads this stamp
        _redis_client().set(BEAT_KEY, time.time(), ex=24 * 3600)
    except Exception:  # noqa: BLE001 - a missed stamp shows as a stale beat, never fails the sample
        logger.warning("could not stamp the beat tick")
    engine = get_sync_engine()
    try:
        components = collect(engine)
        written = record_samples(engine, components)
    except SoftTimeLimitExceeded:
        logger.warning("health sample timed out")
        return {"written": 0, "timed_out": True}
    logger.info("health sample: %s rows (%s)", written, ", ".join(f"{c.id}={c.status}" for c in components))
    if bad := degraded(components):
        logger.warning("health sample: degraded components %s", ", ".join(bad))
    return {"written": written, "components": {c.id: c.status for c in components}, "degraded": bad}
