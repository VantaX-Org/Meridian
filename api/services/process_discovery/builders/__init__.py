"""One builder module per L1 (spec §2.3). Each exposes ``MAPPING`` and ``build(frames, ctx)``."""

from __future__ import annotations

from importlib import import_module
from types import ModuleType

from api.services.process_discovery import L1S


def builder(l1: str) -> ModuleType:
    if l1 not in L1S:
        raise KeyError(l1)
    return import_module(f"{__name__}.{l1.lower()}")
