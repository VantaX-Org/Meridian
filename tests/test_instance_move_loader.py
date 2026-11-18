"""Instance move loader: dry run, live run, error-rate stop, resume, retry-failed and the auth preflight."""

import httpx
import pandas as pd
from types import SimpleNamespace

from api.services.migration import instance_move as im
from checks.frames import TableFrames
from sap.base import CloudConnectionParams
from sap.successfactors import SuccessFactorsConnector

BASE = "https://sf.example.test"


class FakeConnector:
    def __init__(self, fail=()):
        self.fail, self.calls, self.pings = set(fail), [], 0

    def ping(self):
        self.pings += 1
        return True

    def upsert(self, entity, records, purge_type=None):
        self.calls.append((entity, [r["toyId"] for r in records], purge_type))
        return [{"index": i, "key": r["toyId"], "status": "failed" if r["toyId"] in self.fail else "ok",
                 "http_code": 400 if r["toyId"] in self.fail else 200, "message": ""} for i, r in enumerate(records)]


def _steps(n=4, batch=2):
    recs = [(f"toyId=T{i}", {"toyId": f"T{i}"}) for i in range(n)]
    return [{"entity": "ToyEntity", "wave": 1, "method": "upsert", "pass": 1, "purge_type": "full",
             "batches": [recs[i:i + batch] for i in range(0, n, batch)]}]


def test_dry_run_is_default_and_sends_nothing():
    c, store = FakeConnector(), im.MemoryStore()
    rep = im.load(_steps(), c, store)
    assert rep["status"] == "completed" and c.calls == [] and c.pings == 0
    assert {r["status"] for r in store.rows} == {"validated"} and len(store.rows) == 4


def test_live_run_sends_batches_and_records_status():
    c, store = FakeConnector(), im.MemoryStore()
    rep = im.load(_steps(), c, store, dry_run=False)
    assert rep["status"] == "completed" and c.pings == 1
    assert sorted(c.calls) == [("ToyEntity", ["T0", "T1"], "full"), ("ToyEntity", ["T2", "T3"], "full")]
    assert len(store.checkpoints) == 2 and all(r["row_hash"] for r in store.rows)


def test_parallel_upserts_overlap_but_record_in_batch_order():
    import threading, time
    live, peak, lock = [0], [0], threading.Lock()

    class Slow(FakeConnector):
        def upsert(self, entity, records, purge_type=None):
            with lock:
                live[0] += 1
                peak[0] = max(peak[0], live[0])
            time.sleep(0.05)
            with lock:
                live[0] -= 1
            return super().upsert(entity, records, purge_type)
    store = im.MemoryStore()
    rep = im.load(_steps(n=16, batch=2), Slow(), store, dry_run=False, workers=4)
    assert rep["status"] == "completed" and peak[0] > 1
    assert [r["key"] for r in store.rows] == [f"toyId=T{i}" for i in range(16)]


def test_error_rate_past_threshold_stops():
    c, store = FakeConnector(fail={"T0"}), im.MemoryStore()
    rep = im.load(_steps(n=10, batch=10), c, store, dry_run=False)
    assert rep["status"] == "stopped_error_rate" and "passed 5%" in rep["reason"]


def test_resume_skips_checkpointed_batches():
    store = im.MemoryStore()
    store.checkpoints.add(("ToyEntity", 1, 0))
    c = FakeConnector()
    im.load(_steps(), c, store, dry_run=False)
    assert c.calls == [("ToyEntity", ["T2", "T3"], "full")]


def test_retry_sends_only_failed_records():
    store = im.MemoryStore()
    c = FakeConnector()
    im.load(_steps(), c, store, dry_run=False, only={("ToyEntity", "toyId=T3")})
    assert c.calls == [("ToyEntity", ["T3"], "full")]


def test_non_upsert_steps_are_exported_not_sent():
    c, store = FakeConnector(), im.MemoryStore()
    step = {**_steps()[0], "method": "bapi"}
    im.load([step], c, store, dry_run=False)
    assert c.calls == [] and {r["status"] for r in store.rows} == {"exported"}


def _real(handler):
    c = SuccessFactorsConnector()
    c._params = CloudConnectionParams(base_url=BASE, company_id="toyco", auth_type="basic", password="not-real")
    c._client = httpx.Client(base_url=BASE, transport=httpx.MockTransport(handler))
    return c


def test_refused_preflight_sends_no_load_requests(monkeypatch):
    seen = []
    c = _real(lambda req: seen.append(req.method) or httpx.Response(200, json={"d": []}))

    def refuse():
        raise RuntimeError("401 Unauthorized")
    monkeypatch.setattr(c, "ping", refuse)
    rep = im.load(_steps(), c, im.MemoryStore(), dry_run=False)
    assert rep == {"status": "failed", "reason": im.REFUSED, "waves": []}
    assert "POST" not in seen


def test_unauthorised_ping_is_one_request_and_nothing_loaded():
    seen = []
    c = _real(lambda req: seen.append(req.method) or httpx.Response(401, text="no"))
    store = im.MemoryStore()
    rep = im.load(_steps(), c, store, dry_run=False)
    assert rep["status"] == "failed" and rep["reason"] in (im.REFUSED, im.UNREACHABLE)
    assert "POST" not in seen and len(seen) <= 1 and store.rows == []


def test_person_batches_keep_a_person_together():
    recs = [("USERID=u1|START_DATE=1", {}), ("USERID=u1|START_DATE=2", {}), ("USERID=u2|START_DATE=1", {})]
    assert [len(b) for b in im.person_batches({}, recs, size=1)] == [2, 1]


def test_step_records_identity_id_map_and_odata_dates():
    f = lambda n, key=False, typ="CHAR": SimpleNamespace(name=n, key=key, type=typ, source=f"ToyEntity.{n.lower()}",  # noqa: E731
                                                         check_table=None)
    tb = SimpleNamespace(fields={"USERID": f("USERID", True), "START_DATE": f("START_DATE", True, "DATS"),
                                 "NOTE": f("NOTE")})
    dic = SimpleNamespace(table=lambda n: tb)
    frames = TableFrames({"TOYT": pd.DataFrame({"TOYT.USERID": ["u1"], "TOYT.START_DATE": ["2020-01-01"],
                                                "TOYT.NOTE": [""]})})
    step = {"table": "TOYT", "entity": "ToyEntity", "method": "upsert"}
    recs = im.step_records(step, frames, dic, id_map={"u1": "u9"})
    [(key, rec)] = recs
    assert rec == {"userid": "u9", "start_date": "/Date(1577836800000)/"}  # blank NOTE left out
    assert im.step_records(step, frames, dic)[0][1]["userid"] == "u1"
