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


def test_safe_invoke_returns_promptly_on_timeout_even_if_call_never_finishes():
    """A hard timeout must let the caller return near timeout_seconds, not
    block until the slow underlying call eventually finishes on its own —
    ThreadPoolExecutor.__exit__ silently does the latter when used as a
    context manager, since it unconditionally shutdown(wait=True)s even
    while a TimeoutError is propagating out of the `with` block."""
    llm = _FakeLLM(latency_s=5.0)
    start = time.monotonic()
    out = safe_invoke(llm, "hello", timeout_seconds=0.5)
    elapsed = time.monotonic() - start
    assert out is None
    assert elapsed < 2.0, f"safe_invoke blocked for {elapsed:.2f}s waiting on a call it had already timed out on"


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


def test_safe_invoke_batch_returns_promptly_on_timeout_even_if_calls_never_finish():
    """Same hard-timeout guarantee as safe_invoke, for the batch path."""
    llm = _FakeLLM(latency_s=5.0)
    prompts = [f"p{i}" for i in range(4)]
    start = time.monotonic()
    results = safe_invoke_batch(llm, prompts, timeout_seconds=0.5, max_workers=4)
    elapsed = time.monotonic() - start
    assert results == [None, None, None, None]
    assert elapsed < 2.0, f"safe_invoke_batch blocked for {elapsed:.2f}s waiting on calls it had already timed out on"


# ── Tier 0 (LLM-less) deploy mode ───────────────────────────────────────────


def test_noop_llm_short_circuits_safe_invoke(monkeypatch):
    """LLM_PROVIDER=none → safe_invoke returns None without calling .invoke()."""
    from llm.provider import _NoopLLM

    monkeypatch.setenv("LLM_PROVIDER", "none")
    noop = _NoopLLM()
    assert safe_invoke(noop, "hello") is None


def test_noop_llm_short_circuits_batch(monkeypatch):
    from llm.provider import _NoopLLM

    monkeypatch.setenv("LLM_PROVIDER", "none")
    out = safe_invoke_batch(_NoopLLM(), ["a", "b", "c"])
    assert out == [None, None, None]


def test_is_llm_disabled_respects_env(monkeypatch):
    from llm.provider import is_llm_disabled

    monkeypatch.setenv("LLM_PROVIDER", "none")
    assert is_llm_disabled() is True
    monkeypatch.setenv("LLM_PROVIDER", "ollama")
    assert is_llm_disabled() is False


def test_build_llm_from_config_none_returns_noop():
    from llm.provider import _NoopLLM, build_llm_from_config

    llm = build_llm_from_config(provider="none")
    assert isinstance(llm, _NoopLLM)
