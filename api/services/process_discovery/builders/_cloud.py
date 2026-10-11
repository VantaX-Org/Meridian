"""Shared by the SFX, ARB and CNQ builders."""

from __future__ import annotations

from typing import Optional

from api.services.process_discovery.events import BuildContext, Stamp


def in_window(ctx: BuildContext, when: Optional[Stamp]) -> Optional[Stamp]:
    """The stamp, or None when it falls before the run window.

    The Ariba and Concur connectors take no date argument (Task 19, ``process_event_targets``), so the
    window is applied here, per event. SuccessFactors is filtered at extraction; applying it again is a no-op."""
    if when is None or (ctx.window_from is not None and when[0].date() < ctx.window_from):
        return None
    return when
