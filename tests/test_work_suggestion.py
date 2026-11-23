"""Suggestion object of /work/records rows: built from the page extras, safety only where the check names a field."""
from __future__ import annotations

import asyncio
from types import SimpleNamespace

from api.routes import work

ROW = SimpleNamespace(version_id="v", module="material_master", record_key="K1")


def _run(extra):
    return asyncio.run(work._suggestions(None, SimpleNamespace(id="t"), [ROW], extra))[("v", "material_master", "K1")]


def test_none_without_suggestion():
    assert _run({}) is None
    assert _run({("v", "material_master", "K1"): {"_sg": None}}) is None


def test_no_field_means_no_safety():
    sg = {"value": "EA", "source": "rule", "confidence": "high", "why": "Use EA", "check_id": "MM014", "field": None}
    assert _run({("v", "material_master", "K1"): {"_sg": sg, "_scope": "s"}}) == {
        "value": "EA", "source": "rule", "confidence": "high", "why": "Use EA", "safety": None}
