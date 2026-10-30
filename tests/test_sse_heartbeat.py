"""An idle SSE stream sends bytes: a first comment at once, then a heartbeat while nothing is published.

get_message() returns None after its own 1 s poll, so a heartbeat timed by wait_for around it never fired
and proxies cut the idle stream (found in the October 2026 acceptance run: /jobs/events through next start).
"""

import asyncio

import pytest

from api.routes import events


class _PubSub:
    async def subscribe(self, channel: str) -> None:
        self.channel = channel

    async def get_message(self, ignore_subscribe_messages: bool = True, timeout: float = 1.0) -> None:
        await asyncio.sleep(0.01)
        return None

    async def unsubscribe(self, channel: str) -> None:
        pass

    async def close(self) -> None:
        pass


class _Redis:
    def pubsub(self) -> _PubSub:
        return _PubSub()

    async def close(self) -> None:
        pass


@pytest.mark.asyncio
async def test_idle_stream_sends_connected_then_heartbeats(monkeypatch: pytest.MonkeyPatch) -> None:
    import redis.asyncio as aioredis

    monkeypatch.setattr(aioredis, "from_url", lambda *a, **k: _Redis())
    monkeypatch.setattr(events, "HEARTBEAT_INTERVAL", 0.05)
    gen = events._subscribe_redis("events:t:jobs")
    first = await asyncio.wait_for(gen.__anext__(), 1)
    second = await asyncio.wait_for(gen.__anext__(), 1)
    third = await asyncio.wait_for(gen.__anext__(), 1)
    await gen.aclose()
    assert first == ": connected\n\n"
    assert second == third == ": heartbeat\n\n"
