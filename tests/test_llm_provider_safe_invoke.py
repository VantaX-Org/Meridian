"""Unit tests for safe_invoke / safe_invoke_batch — timeout fallbacks and
batch ordering are critical to not crashing at 400k-record scale."""

from __future__ import annotations

import time

from llm.provider import safe_invoke, safe_invoke_batch


class _FakeResponse:
    def __init__(self, content: str) -> None:
        self.content = content


class _FakeLLM:
    def __init__(self, latency_s: float = 0.0, fail: bool = False) -> None:
        self.latency_s = latency_s
        self.fail = fail
        self.calls = 0

    def invoke(self, prompt):
        self.calls += 1
        if self.latency_s:
            time.sleep(self.latency_s)
        if self.fail:
            raise RuntimeError("boom")
        return _FakeResponse(f"ok:{prompt}")


def test_safe_invoke_returns_content_string():
    llm = _FakeLLM()
    out = safe_invoke(llm, "hello")
    assert out == "ok:hello"


def test_safe_invoke_times_out_gracefully():
    llm = _FakeLLM(latency_s=2.0)
    out = safe_invoke(llm, "hello", timeout_seconds=1)
    assert out is None  # timeout → None, no exception


def test_safe_invoke_swallows_exceptions():
    llm = _FakeLLM(fail=True)
    out = safe_invoke(llm, "hello", timeout_seconds=5)
    assert out is None


def test_safe_invoke_batch_preserves_order():
    llm = _FakeLLM()
    prompts = [f"p{i}" for i in range(5)]
    results = safe_invoke_batch(llm, prompts, timeout_seconds=10, max_workers=3)
    assert results == [f"ok:p{i}" for i in range(5)]


def test_safe_invoke_batch_empty_returns_empty():
    assert safe_invoke_batch(_FakeLLM(), []) == []
