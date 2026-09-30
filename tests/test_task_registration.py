"""Every task the beat schedule or the API enqueues must be registered in the worker."""

import re
from pathlib import Path

from workers.celery_app import celery_app

ROOT = Path(__file__).resolve().parent.parent


def test_beat_schedule_tasks_are_registered():
    missing = [
        entry["task"]
        for entry in celery_app.conf.beat_schedule.values()
        if entry["task"] not in celery_app.tasks
    ]
    assert missing == []


def test_enqueued_task_modules_are_registered():
    """`from workers.tasks.X import Y` followed by Y.delay/apply_async must resolve."""
    pat = re.compile(r"from (workers\.tasks[\w.]*) import (\w+)")
    unregistered = set()
    for path in list((ROOT / "api").rglob("*.py")) + list((ROOT / "workers").rglob("*.py")):
        src = path.read_text()
        for module, name in pat.findall(src):
            if f"{name}.delay(" not in src and f"{name}.apply_async(" not in src:
                continue
            registered = {t.name for t in celery_app.tasks.values() if t.__module__ == module}
            if not any(n.endswith(f".{name}") or n == name for n in registered) and not any(
                getattr(t, "__name__", "") == name and t.__module__ == module
                for t in celery_app.tasks.values()
            ):
                unregistered.add(f"{module}.{name} (in {path.relative_to(ROOT)})")
    assert sorted(unregistered) == []
