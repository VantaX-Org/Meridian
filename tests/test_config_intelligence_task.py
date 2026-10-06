"""The per-version Config Intelligence task: frames → engine records → both engines."""

import pandas as pd

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
