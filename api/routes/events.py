"""Server-Sent Events endpoint for real-time analysis job progress.

Clients connect to GET /api/v1/events/{version_id} and receive SSE-formatted
updates as the analysis progresses. Events are published via Redis Pub/Sub
from Celery workers.
"""

import asyncio
import json
import logging
import time
from typing import AsyncGenerator

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse

from api.deps import Tenant, get_tenant

logger = logging.getLogger("meridian.events")

router = APIRouter(prefix="/api/v1", tags=["events"])

HEARTBEAT_INTERVAL = 15  # seconds: under the 30 s idle cut of common proxies


async def _subscribe_redis(channel: str) -> AsyncGenerator[str, None]:
    """Subscribe to a Redis Pub/Sub channel and yield SSE-formatted messages.

    Includes a heartbeat comment every HEARTBEAT_INTERVAL seconds to keep
    the connection alive through proxies and load balancers.
    """
    import redis.asyncio as aioredis
    from api.config import settings

    r = aioredis.from_url(settings.redis_url, decode_responses=True)
    pubsub = r.pubsub()

    try:
        await pubsub.subscribe(channel)
        logger.info(f"SSE subscribed to channel: {channel}")
        # A first byte at once: proxies that wait for the body before passing headers open the stream now.
        yield ": connected\n\n"
        last_sent = time.monotonic()

        while True:
            # get_message returns None after its 1 s poll, so the heartbeat is timed here, not by a
            # wait_for around it (that never expired, and an idle stream sent nothing until a proxy cut it).
            message = await pubsub.get_message(ignore_subscribe_messages=True, timeout=1.0)

            if message is None:
                if time.monotonic() - last_sent >= HEARTBEAT_INTERVAL:
                    # SSE comment (lines starting with ":" are comments): keeps the connection open
                    yield ": heartbeat\n\n"
                    last_sent = time.monotonic()
                continue

            if message["type"] == "message":
                data = message["data"]

                # Try to parse as JSON to extract event type
                try:
                    payload = json.loads(data)
                    event_type = payload.pop("event", "message")
                    data_str = json.dumps(payload)
                except (json.JSONDecodeError, TypeError):
                    event_type = "message"
                    data_str = str(data)

                yield f"event: {event_type}\ndata: {data_str}\n\n"
                last_sent = time.monotonic()

                # If the payload signals completion, close the stream
                if event_type in ("complete", "error", "cancelled"):
                    logger.info(f"SSE stream closing on '{event_type}' event for {channel}")
                    break

    except asyncio.CancelledError:
        logger.info(f"SSE client disconnected from {channel}")
    except Exception as e:
        logger.error(f"SSE subscription error on {channel}: {e}", exc_info=True)
        yield f"event: error\ndata: {json.dumps({'message': 'Internal stream error'})}\n\n"
    finally:
        await pubsub.unsubscribe(channel)
        await pubsub.close()
        await r.close()


@router.get("/events/{version_id}")
async def stream_events(version_id: str, tenant: Tenant = Depends(get_tenant)):
    """Server-Sent Events stream for analysis job progress.

    Workers publish JSON messages to the Redis channel
    ``events:{tenant_id}:{version_id}``. Each message may include an
    ``event`` key that maps to the SSE event type (e.g. ``progress``,
    ``complete``, ``error``).

    The stream sends a heartbeat comment every 15 seconds while idle and closes
    automatically when a ``complete``, ``error``, or ``cancelled`` event
    is received.
    """
    # No DB dependency here, on purpose: a stream must hold a Redis subscription only, never
    # a pooled Postgres connection (see api/routes/jobs.py:stream_jobs).
    channel = f"events:{tenant.id}:{version_id}"

    return StreamingResponse(
        _subscribe_redis(channel),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # disable nginx buffering
        },
    )
