import pandas as pd

from checks.frames import TableFrames
from checks.runner import run_checks
import workers.tasks.run_checks as wt


def _frames():
    return TableFrames.from_flat(pd.DataFrame({"LFA1.LIFNR": ["V1", "V2"], "LFA1.NAME1": ["A", ""],
                                               "LFA1.LAND1": ["ZA", "DE"], "LFA1.KTOKK": ["KRED"] * 2}))


def test_on_progress_called_once_per_rule_with_increasing_done():
    calls = []
    run_checks("accounts_payable", _frames(), "t", on_progress=lambda d, t, r: calls.append((d, t, r)))
    assert calls and [c[0] for c in calls] == list(range(len(calls)))
    assert {c[1] for c in calls} == {len(calls)} and all(c[2] for c in calls)


def test_heartbeat_republishes_last_payload_until_stopped(monkeypatch):
    import threading
    sent = []
    monkeypatch.setattr(wt, "update_task_progress", lambda vid, **kw: sent.append((vid, kw)))
    stop = threading.Event()
    t = wt.start_heartbeat("v", {"current_step": "x"}, stop, interval=0.01)
    while not sent:
        pass
    stop.set()
    t.join(1)
    assert sent[0] == ("v", {"current_step": "x"}) and not t.is_alive()


def test_throttle_limits_calls_to_one_per_interval(monkeypatch):
    now = [100.0]
    monkeypatch.setattr(wt.time, "monotonic", lambda: now[0])
    got = []
    f = wt.throttled(lambda *a: got.append(a), 5)
    for t in (100.0, 101.0, 104.9, 105.0, 106.0):
        now[0] = t
        f(1, 2, "R")
    assert len(got) == 2
