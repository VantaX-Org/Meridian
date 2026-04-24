"""Audit middleware — flush_pending_audits() shutdown drain test.

Verifies that in-flight fire-and-forget audit tasks are awaited by the
lifespan shutdown path rather than dropped when the pod is recycled.
Uses pure-python coroutines as stand-ins for real DB writes so we can
run without a live Postgres.
"""

from __future__ import annotations

import asyncio

import pytest

from api.middleware import audit


@pytest.mark.asyncio
async def test_flush_awaits_pending_tasks() -> None:
    """A task registered into _pending_audit_tasks is awaited by flush_pending_audits."""
    # Reset shared state in case a prior test polluted it.
    audit._pending_audit_tasks.clear()

    completed: list[int] = []

    async def _fake_write(n: int) -> None:
        await asyncio.sleep(0.05)
        completed.append(n)

    for i in range(5):
        task = asyncio.create_task(_fake_write(i))
        audit._pending_audit_tasks.add(task)
        task.add_done_callback(audit._pending_audit_tasks.discard)

    # Before flush: tasks still in flight.
    assert len(audit._pending_audit_tasks) == 5

    drained = await audit.flush_pending_audits(timeout=5.0)

    assert drained == 5
    assert sorted(completed) == [0, 1, 2, 3, 4]
    assert len(audit._pending_audit_tasks) == 0


@pytest.mark.asyncio
async def test_flush_with_no_pending_tasks_returns_zero() -> None:
    """Empty pending set: flush is a no-op."""
    audit._pending_audit_tasks.clear()
    drained = await audit.flush_pending_audits(timeout=1.0)
    assert drained == 0


@pytest.mark.asyncio
async def test_flush_respects_timeout() -> None:
    """A stuck task doesn't hang flush past the timeout."""
    audit._pending_audit_tasks.clear()

    async def _slow_write() -> None:
        # Longer than the flush timeout — simulates a stuck DB.
        await asyncio.sleep(2.0)

    task = asyncio.create_task(_slow_write())
    audit._pending_audit_tasks.add(task)
    task.add_done_callback(audit._pending_audit_tasks.discard)

    # Flush should return even though the task isn't done yet.
    drained = await audit.flush_pending_audits(timeout=0.2)
    assert drained == 0  # task hasn't completed — nothing actually drained
    # Clean up so the pending set doesn't leak into sibling tests.
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass
    audit._pending_audit_tasks.clear()
