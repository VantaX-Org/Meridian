"""Suppression list (D-27): an erased record key stays out of extracts. Real Postgres, synthetic keys.

Reuses the world fixture of test_subject_requests_pg (two tenants, in-memory object store).
"""
from __future__ import annotations

import io
import json
import uuid

import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq
import pytest
from sqlalchemy import text

from api.services import subject_requests as svc
from api.services import suppression
from tests.test_subject_requests_pg import ACTOR, _erase, _schema, pg, world  # noqa: F401


def _extract(t):
    buf = io.BytesIO()
    pq.write_table(pa.table({"PA0001.PERNR": ["00000001", "00000002", "00000001"],
                             "PA0001.SUBTY": ["0001", "0001", "0002"]}), buf)
    return f"staging/{t}/v2/PA0001.parquet", buf.getvalue()


def _shown(sess, t):
    with sess(t) as s:
        return svc.suppressions(s, t)


@pg
def test_erasure_writes_suppression_and_extracts_drop_the_key(world):
    engine, a, b, store, sess = world
    name, data = _extract(a)
    out, counts, _ = suppression.filter_parquet(name, data)
    assert out is data and counts == {}                      # empty list: bytes untouched, no per-row work
    _erase(sess, a)
    with engine.connect() as c:
        rows = c.execute(text("SELECT key_fields, key_hmac FROM subject_suppressions WHERE tenant_id = :t"),
                         {"t": a}).fetchall()
    assert len(rows) == 1 and rows[0][0] == "PERNR|SUBTY" and "00000001" not in rows[0][1]
    suppression.invalidate(a)
    out, counts, tenant = suppression.filter_parquet(name, data)
    assert tenant == a and sum(counts.values()) == 1
    # only the full key matches: PERNR 00000001 with SUBTY 0002 stays
    assert pq.read_table(io.BytesIO(out)).column("PA0001.SUBTY").to_pylist() == ["0001", "0002"]
    nb, db = _extract(b)                                      # another tenant is not affected
    assert suppression.filter_parquet(nb, db)[0] is db
    suppression.record_dropped(a, counts)
    shown = _shown(sess, a)
    assert shown["dropped_total"] == 1 and shown["active_keys"] == 1
    assert "00000001" not in json.dumps(shown, default=str)


@pg
def test_upload_and_read_paths_drop_the_key(world, monkeypatch):
    engine, a, b, store, sess = world
    _erase(sess, a)
    suppression.invalidate(a)
    name, data = _extract(a)
    import importlib

    from api.services import storage
    importlib.reload(storage)                                 # the world fixture replaced upload_file
    sent = {}

    class Client:
        def put_object(self, bucket, obj, stream, length, content_type):
            sent[obj] = stream.read()

        def get_object(self, bucket, obj):
            class R:
                def read(self_): return data
                def close(self_): pass
                def release_conn(self_): pass
            return R()

    monkeypatch.setattr(storage, "get_minio_client", lambda: Client())
    storage.upload_file("b", name, data)
    assert pq.read_table(io.BytesIO(sent[name])).num_rows == 2
    storage.upload_file("b", name, data, suppress=False)
    assert pq.read_table(io.BytesIO(sent[name])).num_rows == 3
    from workers import dataset
    assert pq.read_table(io.BytesIO(dataset._read(Client(), "b", name))).num_rows == 2
    assert _shown(sess, a)["dropped_total"] == 1              # the upload counted, the read did not


@pg
def test_filter_frame_and_lift(world):
    engine, a, b, store, sess = world
    _erase(sess, a)
    suppression.invalidate(a)
    df = pd.DataFrame({"PERNR": ["00000001", "00000002"], "SUBTY": ["0001", "0001"]})
    out, counts = suppression.filter_frame(a, df)
    assert out["PERNR"].tolist() == ["00000002"] and sum(counts.values()) == 1
    rid = _shown(sess, a)["items"][0]["request_id"]
    with sess(a) as s, pytest.raises(svc.SubjectError) as e:
        svc.lift(s, a, rid, ACTOR, "short")
    assert e.value.code == "reason_required"
    with sess(a) as s:
        svc.lift(s, a, rid, ACTOR, "subject re-employed, record is legitimate again")
    assert len(suppression.filter_frame(a, df)[0]) == 2
    with sess(a) as s, pytest.raises(svc.SubjectError) as e:
        svc.lift(s, a, str(uuid.uuid4()), ACTOR, "no such request at all")
    assert e.value.code == "suppression_unknown"
    with engine.connect() as c:
        assert c.execute(text("SELECT count(*) FROM audit_log WHERE tenant_id = :t AND action = "
                              "'subject_suppression_lift'"), {"t": a}).scalar() == 1


@pg
def test_suppression_rls_under_app_role(world):
    engine, a, b, store, sess = world
    _erase(sess, a)
    with engine.connect() as c:
        c.execute(text("SET ROLE meridian_app"))
        try:
            c.execute(text("SELECT set_config('app.tenant_id', :t, false)"), {"t": b})
            assert c.execute(text("SELECT count(*) FROM subject_suppressions")).scalar() == 0
            c.execute(text("SELECT set_config('app.tenant_id', :t, false)"), {"t": a})
            assert c.execute(text("SELECT count(*) FROM subject_suppressions")).scalar() == 1
        finally:
            c.execute(text("RESET ROLE"))
            c.rollback()


@pg
def test_suppression_fails_closed_when_lookup_fails(world, monkeypatch):
    engine, a, b, store, sess = world
    suppression._cache.clear()

    def boom(t):
        raise RuntimeError("db down")

    monkeypatch.setattr(suppression, "_db", boom)
    name, data = _extract(a)
    with pytest.raises(RuntimeError):
        suppression.filter_parquet(name, data)
