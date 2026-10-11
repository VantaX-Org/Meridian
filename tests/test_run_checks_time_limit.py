"""A run_checks task that hits its soft time limit must end with the version marked
'failed'. The engine used to turn SoftTimeLimitExceeded into a rule error and run
on, so the hard limit killed the worker with the version still 'running'."""

from unittest.mock import MagicMock, patch

import pytest
from celery.exceptions import SoftTimeLimitExceeded

from checks.runner import run_checks as engine_run_checks
from tests.checks.test_runner import _make_bp_dataframe


def test_engine_does_not_swallow_the_soft_time_limit() -> None:
    from checks.types.null_check import NullCheck

    with patch.object(NullCheck, "evaluate", side_effect=SoftTimeLimitExceeded()), \
            pytest.raises(SoftTimeLimitExceeded):
        engine_run_checks("business_partner", _make_bp_dataframe(20), "t1")


def test_soft_time_limit_marks_the_version_failed() -> None:
    from workers.tasks import run_checks as mod

    engine = MagicMock()
    engine.connect.return_value.execute.return_value.scalar.return_value = True  # lock acquired
    with patch.object(mod, "get_sync_engine", return_value=engine), \
            patch.object(mod, "_run_checks", side_effect=SoftTimeLimitExceeded()), \
            patch.object(mod, "_redis_client", return_value=None), \
            patch.object(mod, "_mark_failed") as failed:
        mod.run_checks.push_request(id="task-1")
        try:
            with pytest.raises(SoftTimeLimitExceeded):
                mod.run_checks.run("v1", "t1", "path")
        finally:
            mod.run_checks.pop_request()
    failed.assert_called_once()
    assert failed.call_args.args[1:3] == ("t1", "v1")
    assert "time limit" in failed.call_args.args[3]


# ── no broad handler on the run_checks path may swallow the soft limit ─────────

def _lazy_frames():
    from tests.checks.test_lazy_frames import MODULE, _bundle, _frames
    return MODULE, _frames(_bundle(rows=10), True)


def test_soft_limit_in_prefetch_ends_the_run() -> None:
    from checks.frames import TableFrames

    module, frames = _lazy_frames()
    with patch.object(TableFrames, "prefetch", side_effect=SoftTimeLimitExceeded()), \
            pytest.raises(SoftTimeLimitExceeded):
        engine_run_checks(module, frames, "t1", as_of="2026-01-01")


def test_soft_limit_in_on_progress_ends_the_run() -> None:
    def progress(done: int, total: int, rule_id: str) -> None:
        raise SoftTimeLimitExceeded()

    with pytest.raises(SoftTimeLimitExceeded):
        engine_run_checks("business_partner", _make_bp_dataframe(20), "t1", on_progress=progress)


def test_soft_limit_in_run_rule_outside_the_check_ends_the_run() -> None:
    import checks.runner as runner

    with patch.object(runner, "apply_context", side_effect=SoftTimeLimitExceeded()), \
            pytest.raises(SoftTimeLimitExceeded):
        engine_run_checks("business_partner", _make_bp_dataframe(20), "t1")


def test_soft_limit_in_grain_grouping_ends_the_run() -> None:
    from checks.frames import TableFrames

    orig, calls = TableFrames.grain_for, []

    def first_call_hits_the_limit(self: TableFrames, *a: object, **kw: object) -> str | None:
        calls.append(1)
        if len(calls) == 1:
            raise SoftTimeLimitExceeded()
        return orig(self, *a, **kw)

    with patch.object(TableFrames, "grain_for", first_call_hits_the_limit), pytest.raises(SoftTimeLimitExceeded):
        engine_run_checks("business_partner", _make_bp_dataframe(20), "t1")


def test_soft_limit_in_prefetch_planning_is_not_swallowed() -> None:
    import checks.runner as runner
    from checks.runner import _rule_columns

    module, frames = _lazy_frames()
    with patch.object(runner, "_frame_inputs", side_effect=SoftTimeLimitExceeded()), \
            pytest.raises(SoftTimeLimitExceeded):
        _rule_columns({"check_class": "null_check", "field": "MARA.MATNR"}, frames, None)


def test_soft_limit_in_fix_enrichment_ends_the_run() -> None:
    from checks.base import CheckResult

    with patch.object(CheckResult, "model_copy", side_effect=SoftTimeLimitExceeded()), \
            pytest.raises(SoftTimeLimitExceeded):
        engine_run_checks("business_partner", _make_bp_dataframe(20), "t1")


def test_soft_limit_in_regex_vectorising_ends_the_run() -> None:
    import pandas as pd
    from checks.types.regex_check import RegexCheck

    df = pd.DataFrame({"T.F": ["a", "b"]})
    with patch("pandas.core.strings.accessor.StringMethods.match", side_effect=SoftTimeLimitExceeded()), \
            pytest.raises(SoftTimeLimitExceeded):
        RegexCheck({"id": "R1", "field": "T.F", "pattern": "a"}).evaluate(df)


def test_soft_limit_in_auto_fix_verification_is_not_swallowed() -> None:
    import pandas as pd
    from checks import auto_fix

    def evaluate(df: pd.DataFrame) -> None:
        raise SoftTimeLimitExceeded()

    df = pd.DataFrame({"T.F": ["a "]})
    with patch.object(auto_fix, "_spec", return_value={"steps": []}), \
            patch.object(auto_fix, "_steps", return_value=("a", "high")), pytest.raises(SoftTimeLimitExceeded):
        auto_fix.proposals({"field": "T.F"}, df, pd.Series([True]), evaluate=evaluate)


def _broad_handlers(source: str, skip: str = "") -> tuple[int, list[int]]:
    """(number of broad handlers, line numbers of those that can swallow SoftTimeLimitExceeded).

    Broad: bare ``except:``, ``except Exception``/``BaseException``, or a tuple naming either. A
    handler is guarded when its first statement is ``reraise_soft_limit(...)`` or an earlier handler
    of the same ``try`` catches SoftTimeLimitExceeded. Handlers inside function ``skip`` are ignored."""
    import ast

    def names(t: ast.expr | None) -> set[str]:
        elts = t.elts if isinstance(t, ast.Tuple) else [t] if t is not None else []
        return {e.id if isinstance(e, ast.Name) else getattr(e, "attr", "") for e in elts}

    tree = ast.parse(source)
    skipped = {id(n) for f in ast.walk(tree) if isinstance(f, ast.FunctionDef) and f.name == skip
               for n in ast.walk(f)}
    broad, bad = 0, []
    for t in ast.walk(tree):
        if not isinstance(t, ast.Try) or id(t) in skipped:
            continue
        for k, h in enumerate(t.handlers):
            if not (h.type is None or names(h.type) & {"Exception", "BaseException"}):
                continue
            broad += 1
            first = h.body[0]
            if any("SoftTimeLimitExceeded" in names(p.type) for p in t.handlers[:k]) or (
                    isinstance(first, ast.Expr) and isinstance(first.value, ast.Call)
                    and getattr(first.value.func, "id", "") == "reraise_soft_limit"):
                continue
            bad.append(h.lineno)
    return broad, bad


def test_broad_handler_scan_sees_tuples_bare_and_base_exception() -> None:
    src = """
try: pass
except (ValueError, Exception): pass
try: pass
except: pass
try: pass
except BaseException as e: pass
try: pass
except ValueError: pass
try: pass
except Exception as e:
    reraise_soft_limit(e)
try: pass
except SoftTimeLimitExceeded: raise
except Exception: pass
"""
    assert _broad_handlers(src) == (5, [3, 5, 7])


def test_every_broad_handler_in_the_task_reraises_the_soft_limit() -> None:
    """Every broad handler in the run_checks task (bar the progress heartbeat thread, which the
    soft limit never reaches) lets SoftTimeLimitExceeded through."""
    import inspect

    from workers.tasks import run_checks as mod

    broad, bad = _broad_handlers(inspect.getsource(mod), skip="beat")
    assert broad > 20 and bad == []
