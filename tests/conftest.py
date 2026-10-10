"""Tests run as a development deployment (no licence key needed; see api/middleware/licence.py)."""

import os
import zlib

import pytest

os.environ.setdefault("MERIDIAN_ENV", "development")


def pytest_collection_modifyitems(config: pytest.Config, items: list[pytest.Item]) -> None:
    """PYTEST_SHARD="i/n" keeps only shard i (1-based) of n, split by test id.

    CI runs the suite as n parallel jobs. Split per test, not per file: one
    rule-proof file holds over half the suite. Module fixtures are rebuilt
    in each shard that uses them.
    """
    shard = os.environ.get("PYTEST_SHARD")
    if not shard:
        return
    i, n = (int(p) for p in shard.split("/"))
    keep, drop = [], []
    for item in items:
        (keep if zlib.crc32(item.nodeid.encode()) % n == i - 1 else drop).append(item)
    if drop:
        config.hook.pytest_deselected(items=drop)
        items[:] = keep
