"""touches is set on every job payload, keyed by kind (spec 9.1)."""
import json
from unittest.mock import MagicMock

from api.services import jobs


def _make_client():
    client = MagicMock()
    store: dict[str, str] = {}
    client.setex.side_effect = lambda key, _ttl, raw: store.__setitem__(key, raw)
    client.get.side_effect = lambda key: store.get(key)
    client.pipeline.return_value = client
    client.execute.return_value = None
    return client, store


def test_start_job_analysis_sets_touches(monkeypatch):
    client, store = _make_client()
    monkeypatch.setattr(jobs, "_redis_client", lambda: client)
    jobs.start_job("t1", "job1", "analysis", "Analysis", status="running")
    saved = json.loads(store[jobs._key("t1", "job1")])
    assert saved["touches"] == ["object", "rule", "records", "run", "shell-counts"]


def test_start_job_upload_sets_touches(monkeypatch):
    client, store = _make_client()
    monkeypatch.setattr(jobs, "_redis_client", lambda: client)
    jobs.start_job("t1", "job2", "upload", "Upload", status="running")
    saved = json.loads(store[jobs._key("t1", "job2")])
    assert saved["touches"] == ["object", "rule", "records", "run", "shell-counts"]


def test_start_job_extraction_sets_touches(monkeypatch):
    client, store = _make_client()
    monkeypatch.setattr(jobs, "_redis_client", lambda: client)
    jobs.start_job("t1", "job3", "extraction", "Sync")
    saved = json.loads(store[jobs._key("t1", "job3")])
    assert saved["touches"] == ["systems", "run"]


def test_finish_job_preserves_touches(monkeypatch):
    client, store = _make_client()
    monkeypatch.setattr(jobs, "_redis_client", lambda: client)
    jobs.start_job("t1", "job4", "analysis", "Analysis", status="running")
    jobs.finish_job("t1", "job4", "completed")
    saved = json.loads(store[jobs._key("t1", "job4")])
    assert saved["touches"] == ["object", "rule", "records", "run", "shell-counts"]


def test_unknown_kind_gets_empty_touches(monkeypatch):
    client, store = _make_client()
    monkeypatch.setattr(jobs, "_redis_client", lambda: client)
    jobs.start_job("t1", "job5", "simulation", "Simulation")
    saved = json.loads(store[jobs._key("t1", "job5")])
    assert saved["touches"] == []


def test_run_sync_registers_job_with_touches(monkeypatch):
    client, store = _make_client()
    monkeypatch.setattr(jobs, "_redis_client", lambda: client)
    jobs.start_job("t1", "sync-run-1", "extraction", "Sync · ECC PRD", system_id="sys1")
    jobs.finish_job("t1", "sync-run-1", "completed", result={"version_id": "v1"})
    saved = json.loads(store[jobs._key("t1", "sync-run-1")])
    assert saved["touches"] == ["systems", "run"]
    assert saved["status"] == "completed"
    assert saved["result"] == {"version_id": "v1"}
