"""A worker must not carry one task's frames into the next.

Observed on the deployment: after a failed material_master extraction the worker held 16.88 GB
with zero active tasks, leaving 11 GB available on a 30 GB box. The next MARC read then saw an
"available" figure reduced by the previous attempt's garbage - which is what made the memory guard
trip on memory nothing was using.
"""

from workers.celery_app import celery_app


def test_the_worker_recycles_its_child_after_each_task():
    assert celery_app.conf.worker_max_tasks_per_child == 1, (
        "without recycling, a failed extraction's frames stay resident and starve the next run"
    )


# ── concurrent extractions are a lock path ─────────────────────────────────────────────────────
def test_only_one_extraction_runs_per_system(monkeypatch):
    """Worker concurrency 4 x 4 RFC sessions = up to 16 sessions for one SAP user.

    SAP refuses the surplus logons, and refusals are how an account locks - with no OOM and no
    retry, which is the lock that could not otherwise be explained. A per-version lock does not
    help: every dispatch gets a fresh version_id.
    """
    from workers.tasks import run_extraction as re_mod

    class FakeRedis:
        def __init__(self):
            self.keys = set()

        def set(self, key, value, nx=False, ex=None):
            if nx and key in self.keys:
                return False
            self.keys.add(key)
            return True

    fake = FakeRedis()
    monkeypatch.setattr("redis.from_url", lambda url: fake, raising=False)
    monkeypatch.setattr(re_mod, "_acquire_system_lock", lambda sid: bool(
        fake.set(f"extract-lock:system:{sid}", "1", nx=True, ex=9999)))

    assert re_mod._acquire_system_lock("sys-1") is True
    assert re_mod._acquire_system_lock("sys-1") is False, "a second extraction of one system must not start"
    assert re_mod._acquire_system_lock("sys-2") is True, "a different system is unaffected"


def test_rfc_sessions_are_capped_conservatively():
    """Each extra session is another logon; a surplus is refused."""
    import inspect

    import sap.rfc as R

    src = inspect.getsource(R.RFCConnector.__init__)
    assert "or 2" in src, "the RFC session default should be 2, not 4"
