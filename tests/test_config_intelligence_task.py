"""The per-version Config Intelligence task: frames → engine records → both engines."""

import asyncio

import pandas as pd
import pytest

from workers.tasks.run_config_intelligence import frames_to_records


def _frames():
    bkpf = pd.DataFrame({"BKPF.BUKRS": ["1000", "1000", "2000"], "BKPF.BLART": ["SA", "ZK", "KR"],
                         "BKPF.BELNR": ["0100000001", "9000000001", "1900000002"],
                         "BKPF.MONAT": ["01", "02", "03"], "BKPF.GJAHR": ["2026"] * 3})
    bseg = pd.DataFrame({"BSEG.BUKRS": ["1000", "1000"], "BSEG.BSCHL": ["40", "31"],
                         "BSEG.HKONT": ["0000400000", "0000160000"], "BSEG.ZZREGION": ["ZA", None]})
    return {"BKPF": bkpf, "BSEG": bseg}


def test_frames_to_records_strips_prefix_and_unions_keys():
    records = frames_to_records(_frames())
    assert len(records) == 5
    keys = set(records[0].keys())
    # the engines read records[0].keys(): every table's bare field names must be there
    assert {"BUKRS", "BLART", "BELNR", "MONAT", "GJAHR", "BSCHL", "HKONT", "ZZREGION"} <= keys
    assert not any("." in k for k in keys)
    # missing cells are None, never NaN, so `r.get(field) or ...` behaves
    assert all(r["BSCHL"] is None for r in records if r["BLART"] is not None)
    assert all(r["ZZREGION"] in ("ZA", None) for r in records)


def test_frames_to_records_caps_rows_largest_table_first():
    frames = {"A": pd.DataFrame({"A.X": range(100)}), "B": pd.DataFrame({"B.Y": range(10)})}
    records = frames_to_records(frames, limit=50)
    assert len(records) == 50 and all(r["X"] is not None for r in records)
    assert frames_to_records({}, limit=10) == []
    assert frames_to_records({"E": pd.DataFrame(columns=["E.X"])}) == []


def test_engines_run_on_flattened_frames():
    from api.services.config_intelligence.engine import ConfigIntelligenceEngine
    from api.services.z_object_intelligence.engine import ZObjectIntelligenceEngine

    records = frames_to_records(_frames())
    result = ConfigIntelligenceEngine().analyze(records)
    inventory = {(e.module, e.element_type, e.element_value) for e in result.config_inventory}
    assert ("FI", "document_type", "ZK") in inventory  # FI detected from BUKRS/BLART, custom type kept
    assert {e.module for e in result.config_inventory} >= {"FI"}
    assert len(result.processes) >= 1

    z = ZObjectIntelligenceEngine().analyze(records, None, None)
    names = {o.object_name for o in z.detection.detected_objects}
    assert "ZK" in names and "ZZREGION" in names


def test_variant_discovery_failure_does_not_fail_the_task(monkeypatch):
    """Discovery is best effort: the config run still completes and persists."""
    import contextlib
    from types import SimpleNamespace

    import api.services.config_intelligence.variant_discovery as vd
    import api.services.source_design as sd
    import workers.dataset as ds
    import workers.tasks.run_config_intelligence as task

    class _Result:
        def fetchone(self):
            return ({},)

    class _Session(contextlib.AbstractContextManager):
        def __init__(self, *_a, **_k):
            pass

        def __exit__(self, *_a):
            return None

        def execute(self, *_a, **_k):
            return _Result()

    frames = SimpleNamespace(frames=_frames(), unsplittable=[])
    monkeypatch.setattr(task, "Session", _Session)
    monkeypatch.setattr(task, "get_sync_engine", lambda: None)
    monkeypatch.setattr(sd, "dictionary_for", lambda *_a, **_k: None)
    monkeypatch.setattr(ds, "load_dataset", lambda *_a, **_k: (frames, None, 5, None))

    async def _z(_tenant):
        raise RuntimeError("skip z")

    persisted: list[str] = []

    async def _persist(*_a, **_k):
        persisted.append("config")
        return {"drift": 0}

    def _boom(*_a, **_k):
        raise RuntimeError("discovery broke")

    monkeypatch.setattr(task, "_z_context", _z)
    monkeypatch.setattr(task, "_persist", _persist)
    monkeypatch.setattr(vd, "discover_variants", _boom)

    out = task.run_config_intelligence.run("00000000-0000-0000-0000-0000000000aa",
                                           "00000000-0000-0000-0000-000000000001", "x")
    assert out["status"] == "complete" and out["process_variants"] == 0 and persisted == ["config"]


# ── _persist is one transaction ───────────────────────────────────────────────


class _AsyncSession:
    """Records statements and commits; `fail_on` raises inside save_run to simulate a mid-run failure."""

    def __init__(self, log: list):
        self.log = log

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_exc):
        self.log.append("close")
        return False

    async def execute(self, stmt, params=None):
        self.log.append(("sql", str(stmt).split()[0]))

    async def commit(self):
        self.log.append("commit")


def _persist_fixture(monkeypatch, save_run):
    import workers.tasks.run_config_intelligence as task

    log: list = []

    class _Engine:
        async def dispose(self):
            log.append("dispose")

    monkeypatch.setattr(task, "_async_url", lambda: "postgresql+asyncpg://x")
    monkeypatch.setattr(task, "create_async_engine", lambda *_a, **_k: _Engine())
    monkeypatch.setattr(task, "async_sessionmaker", lambda *_a, **_k: (lambda: _AsyncSession(log)))

    class _Cfg:
        async def save_run(self, db, tid, rid, result):
            log.append("save_run")
            await save_run()

        async def get_previous_run_id(self, db, tid, rid):
            return None

    import api.services.config_intelligence.persistence as cp

    monkeypatch.setattr(cp, "ConfigIntelligencePersistence", _Cfg)
    return task, log


def test_persist_commits_once_after_every_write(monkeypatch):
    async def ok():
        return None

    task, log = _persist_fixture(monkeypatch, ok)
    out = asyncio.run(task._persist("t1", "v1", object(), None))
    assert out == {"drift": 0}
    assert log.count("commit") == 1
    # the deletes and the save all precede the single commit
    assert log.index("save_run") < log.index("commit") < log.index("close")
    assert all(x[0] == "sql" for x in log[: log.index("save_run")] if isinstance(x, tuple))


def test_persist_failure_leaves_the_previous_results(monkeypatch):
    async def boom():
        raise RuntimeError("disk full")

    task, log = _persist_fixture(monkeypatch, boom)
    with pytest.raises(RuntimeError):
        asyncio.run(task._persist("t1", "v1", object(), None))
    # the deletes ran inside the same transaction and were never committed
    assert "commit" not in log
    assert any(x == ("sql", "DELETE") for x in log)
    assert log[-1] == "dispose" and "close" in log
