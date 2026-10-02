"""Job registry (api/services/jobs.py) against an in-memory Redis stand-in, and the
composite DQS the Command Centre headline is built from."""

from __future__ import annotations

import json

import pytest

from api.services import jobs, task_progress


class FakeRedis:
    def __init__(self):
        self.kv: dict[str, bytes] = {}
        self.z: dict[str, dict[str, float]] = {}
        self.published: list[dict] = []

    # the subset jobs.py uses
    def setex(self, k, ttl, v):
        self.kv[k] = v.encode() if isinstance(v, str) else v

    def get(self, k):
        return self.kv.get(k)

    def mget(self, keys):
        return [self.kv.get(k) for k in keys]

    def delete(self, k):
        self.kv.pop(k, None)

    def zadd(self, k, mapping):
        self.z.setdefault(k, {}).update(mapping)

    def zremrangebyrank(self, k, lo, hi):
        ranked = sorted(self.z.get(k, {}).items(), key=lambda kv: kv[1])
        keep = ranked[-(-hi):] if hi < -1 else ranked  # hi = -INDEX_KEEP-1 → keep the newest INDEX_KEEP
        self.z[k] = dict(keep)

    def zrevrange(self, k, lo, hi):
        ranked = sorted(self.z.get(k, {}).items(), key=lambda kv: -kv[1])
        return [m for m, _ in ranked[lo:hi + 1]]

    def expire(self, k, ttl):
        pass

    def publish(self, channel, msg):
        self.published.append(json.loads(msg))

    def ping(self):
        return True

    def pipeline(self):
        return _Pipe(self)


class _Pipe:
    def __init__(self, r):
        self.r, self.ops = r, []

    def __getattr__(self, name):
        def record(*a, **k):
            self.ops.append((name, a, k))
            return self
        return record

    def execute(self):
        for name, a, k in self.ops:
            getattr(self.r, name)(*a, **k)
        self.ops = []


@pytest.fixture
def redis(monkeypatch):
    r = FakeRedis()
    monkeypatch.setattr(task_progress, "_redis_instance", r)
    monkeypatch.setattr(jobs, "_redis_client", lambda: r)
    return r


def test_extraction_job_lifecycle_and_stream(redis):
    jobs.start_job("t1", "dl-v1", "extraction", "Vendors", status="queued", system_id="s1", version_id="v1")
    assert jobs.get_job("t1", "dl-v1")["status"] == "queued"
    assert all(s["status"] == "queued" for s in jobs.get_job("t1", "dl-v1")["stages"])

    jobs.update_job("t1", "dl-v1", stage="read", rows_done=50, rows_total=200,
                    tables=[{"table": "LFA1", "status": "live", "rows": 50, "expected": 50},
                            {"table": "LFB1", "status": "running", "rows": 0, "expected": 150}])
    j = jobs.get_job("t1", "dl-v1")
    assert j["status"] == "running" and j["stage"] == "read"
    assert {s["id"]: s["status"] for s in j["stages"]} == {
        "connect": "done", "read": "running", "store": "queued", "register": "queued", "analyse": "queued"}
    assert 20 <= j["percent"] < 40          # second of five stages, a quarter through its rows
    assert j["tables"][1]["table"] == "LFB1"

    jobs.finish_job("t1", "dl-v1", result={"version_id": "v1"})
    j = jobs.get_job("t1", "dl-v1")
    assert j["status"] == "completed" and j["percent"] == 100 and j["finished_at"]
    assert all(s["status"] == "done" for s in j["stages"])

    # every write was published on the tenant stream as a full job object
    assert [p["event"] for p in redis.published] == ["job"] * 3
    assert redis.published[-1]["status"] == "completed"
    assert jobs.list_jobs("t1") == [j]
    assert jobs.list_jobs("t1", active_only=True) == []
    assert jobs.list_jobs("t2") == []        # another tenant sees nothing


def test_failure_marks_current_stage(redis):
    jobs.start_job("t1", "dl-v2", "extraction", "Materials")
    jobs.update_job("t1", "dl-v2", stage="store")
    jobs.finish_job("t1", "dl-v2", "failed", error="disk full")
    j = jobs.get_job("t1", "dl-v2")
    assert j["status"] == "failed" and j["error"] == "disk full"
    assert {s["id"]: s["status"] for s in j["stages"]}["store"] == "failed"
    assert {s["id"]: s["status"] for s in j["stages"]}["register"] == "queued"


def test_analysis_progress_mirrors_onto_the_job(redis):
    """update_task_progress (keyed by version_id, no tenant) drives the analysis job."""
    jobs.start_job("t1", "v9", "analysis", "Analysis", status="queued", progress_key="v9", version_id="v9")
    task_progress.update_task_progress("v9", status="processing", current_step="Running data quality checks",
                                       step_number=3, total_steps=6, rows_processed=10, total_rows=100)
    j = jobs.get_job("t1", "v9")
    assert j["status"] == "running" and j["stage"] == "checks" and j["message"] == "Running data quality checks"
    assert j["rows_done"] == 10 and j["rows_total"] == 100
    task_progress.update_task_progress("v9", status="completed", current_step="Analysis complete",
                                       step_number=6, total_steps=6, percent_complete=100)
    assert jobs.get_job("t1", "v9")["status"] == "completed"
    task_progress.update_task_progress("v9", status="failed", current_step="x", step_number=3, error="boom")
    assert jobs.get_job("t1", "v9")["error"] == "boom"
    # a version nobody registered is ignored, not an error
    task_progress.update_task_progress("unknown", status="processing", current_step="x", step_number=3)


def test_index_keeps_only_the_newest(redis):
    for i in range(jobs.INDEX_KEEP + 5):
        jobs.start_job("t1", f"j{i}", "analysis", "A")
    listed = jobs.list_jobs("t1", limit=500)
    assert len(listed) == jobs.INDEX_KEEP and listed[0]["id"] == f"j{jobs.INDEX_KEEP + 4}"


def test_registry_is_silent_without_redis(monkeypatch):
    monkeypatch.setattr(jobs, "_redis_client", lambda: None)
    jobs.start_job("t", "j", "analysis", "A")
    jobs.update_job("t", "j", stage="checks")
    jobs.finish_job("t", "j")
    assert jobs.get_job("t", "j") is None and jobs.list_jobs("t") == []


def test_composite_dqs_weights_modules_by_their_checks():
    from api.routes.findings import composite_dqs

    ap = {"composite_score": 90.0, "total_checks": 30, "capped": False,
          "dimension_scores": {"completeness": 95.0, "accuracy": 85.0}}
    mm = {"composite_score": 60.0, "total_checks": 10, "capped": True,
          "dimension_scores": {"completeness": 55.0, "validity": 70.0}}
    out = composite_dqs([{"accounts_payable": ap}, {"material_master": mm}])
    assert out["composite"] == 82.5                      # (90·30 + 60·10) / 40
    assert out["dimension_scores"]["completeness"] == 85.0  # (95·30 + 55·10) / 40
    assert out["dimension_scores"]["validity"] == 70.0      # only MM measures it
    assert out["modules"] == {"accounts_payable": 90.0, "material_master": 60.0} and out["capped"]
    assert composite_dqs([]) == {"composite": None, "dimension_scores": {}, "modules": {}}
    assert composite_dqs([None, {}])["composite"] is None
