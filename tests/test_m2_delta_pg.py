"""Delta extraction against a real Postgres (MERIDIAN_TEST_DB_URL), connector stubbed: a table with a change-date
field is re-read by date and merged over the previous extraction, every table is compared by row hash with the
previous extraction, the per-table change log is stored and listed, and the jobs stream reports rows read vs changed."""
from __future__ import annotations

import os
import uuid
from types import SimpleNamespace

import pandas as pd
import pytest
from sqlalchemy import create_engine, text

from api.services import delta_extraction as dx
from tests.m2_client import headers, make_client
from tests.m2_step9_seed import seed_step9

pytestmark = pytest.mark.skipif(not os.environ.get("MERIDIAN_TEST_DB_URL"), reason="MERIDIAN_TEST_DB_URL not set")


@pytest.fixture(scope="module")
def owner():
    eng = create_engine(os.environ["MERIDIAN_TEST_DB_URL"])
    yield eng
    eng.dispose()


def test_pure_parts():
    assert dx.change_date_where("LAEDA", "20261020") == "LAEDA >= '20261020'"
    with pytest.raises(ValueError):
        dx.change_date_where("LAEDA", "2026-10-20' OR 1=1")
    base = pd.DataFrame({"MATNR": ["1", "2", "3"], "MTART": ["FERT", "HALB", "ROH"]})
    fresh = pd.DataFrame({"MATNR": ["2", "4"], "MTART": ["FERT", "ROH"]})
    merged = dx.merge_by_key(base, fresh, ["MATNR"])
    assert sorted(merged.itertuples(index=False, name=None)) == [("1", "FERT"), ("2", "FERT"), ("3", "ROH"), ("4", "ROH")]
    a = dx.row_hashes(pd.DataFrame({"MARA.MATNR": ["1", "2"], "MARA.MTART": ["FERT", "HALB"]}), ["MARA.MATNR"])
    b = dx.row_hashes(pd.DataFrame({"MARA.MTART": ["FERT", "ROH"], "MARA.MATNR": ["1", "3"]}), ["MARA.MATNR"])
    assert a["MATNR=1"] == b["MATNR=1"] and len(a["MATNR=1"]) == 16  # column order does not matter
    assert dx.diff(dict(a), b) == (1, 0, 1, 1)


class Conn:
    def __init__(self, rows):
        self.rows, self.wheres = rows, []

    def read_table_full(self, table, cols, keys, where=None, max_rows=0, on_progress=None):
        self.wheres.append(where)
        return pd.DataFrame(self.rows, columns=cols)


def test_date_delta_read():
    from api.services.connectivity_manager import ConnectivityManager, DeltaRequest

    base = pd.DataFrame({"MATNR": ["1", "2"], "LAEDA": ["20260101", "20260101"], "MTART": ["FERT", "HALB"]})
    req = DeltaRequest("20261001", lambda t: base, by_change_date=True)
    conn = Conn([("2", "20261015", "FERT"), ("3", "20261016", "ROH")])
    cols = ["MATNR", "LAEDA", "MTART"]
    df, info = ConnectivityManager._date_delta_read(conn, "MARA", cols, ["MATNR"], "LVORM = ''", req, 3, 1000)
    assert conn.wheres == ["LAEDA >= '20261001' AND LVORM = ''"]
    assert info == {"since": "20261001", "field": "LAEDA", "mode": "change_date", "reread": 2}
    assert sorted(df["MATNR"]) == ["1", "2", "3"] and df.loc[df["MATNR"] == "2", "MTART"].item() == "FERT"
    # SAP counts another row than the merge holds (a deletion): read in full
    assert ConnectivityManager._date_delta_read(conn, "MARA", cols, ["MATNR"], None, req, 4, 1000) == (None, None)
    # no change-date field read, or no change-date field known
    assert ConnectivityManager._date_delta_read(conn, "MARA", ["MATNR"], ["MATNR"], None, req, None, 1000) == (None, None)
    assert ConnectivityManager._date_delta_read(conn, "MARC", ["MATNR"], ["MATNR"], None, req, None, 1000) == (None, None)


MARA_1 = {"MARA.MATNR": ["M1", "M2", "M3"], "MARA.LAEDA": ["20260101"] * 3, "MARA.MTART": ["FERT", "HALB", "ROH"]}
MARA_2 = {"MARA.MATNR": ["M1", "M2", "M4"], "MARA.LAEDA": ["20260101", "20261020", "20261021"],
          "MARA.MTART": ["FERT", "FERT", "ROH"]}
MARC = {"MARC.MATNR": ["M1", "M2"], "MARC.WERKS": ["1000", "1000"], "MARC.DISMM": ["PD", "ND"]}


def _extract_stub(calls, mara: dict, mara_delta: dict | None):
    def extract(self, system_id, modules, scope=None, progress=None, sink=None, delta=None):
        calls.append(delta)
        cov = []
        for table, data, info in (("MARA", mara, mara_delta), ("MARC", MARC, None)):
            entry = {"table": table, "status": "live", "rows": len(next(iter(data.values()))), "purpose": "data",
                     "modules": ["material_master"], "seconds": 0.5, "complete": True}
            if info:
                entry["delta"] = info
            cov.append(entry)
            sink(table, pd.DataFrame(data), entry)
        return {}, cov
    return extract


def _patch(monkeypatch, store, calls, mara, mara_delta, events):
    from api.services import connectivity_manager as cm
    from api.services import jobs, source_design, storage

    keys = {"MARA": ["MANDT", "MATNR"], "MARC": ["MANDT", "MATNR", "WERKS"]}
    monkeypatch.setattr(source_design, "dictionary_for",
                        lambda s, sid: SimpleNamespace(table=lambda t: SimpleNamespace(keys=keys.get(t, []))))
    monkeypatch.setattr(storage, "upload_file", lambda b, o, d, ct="": store.__setitem__(o, d))
    monkeypatch.setattr(cm.ConnectivityManager, "extract", _extract_stub(calls, mara, mara_delta))
    monkeypatch.setattr(jobs, "update_job", lambda *a, **k: events.append(k))


@pytest.mark.anyio
async def test_delta_extraction_change_log(owner, monkeypatch):
    from workers.tasks.run_extraction import run_extraction

    s = seed_step9(owner)
    tid, ecc = s["tid"], s["ecc"]
    store, calls, events = {}, [], []
    _patch(monkeypatch, store, calls, MARA_1, None, events)
    v1 = str(uuid.uuid4())
    out = run_extraction(tid, ecc, ["material_master"], analyse=False, version_id=v1, delta=True)
    assert out["status"] == "success" and calls[-1] is None  # nothing to build a delta on yet
    with owner.connect() as c:
        c.execute(text("SELECT set_config('app.tenant_id', :t, false)"), {"t": tid})
        n = c.execute(text("SELECT count(*) FROM record_hashes WHERE tenant_id = :t AND version_id = :v"),
                      {"t": tid, "v": v1}).scalar()
    assert n == 5  # 3 MARA + 2 MARC rows hashed for the next delta

    # the second delta: MARA re-read by LAEDA (2 rows), MARC read in full; both compared by hash
    events.clear()
    _patch(monkeypatch, store, calls, MARA_2, {"since": "20261019", "field": "LAEDA", "mode": "change_date", "reread": 2},
           events)
    v2 = str(uuid.uuid4())
    out = run_extraction(tid, ecc, ["material_master"], analyse=False, version_id=v2, delta=True)
    assert out["status"] == "success"
    req = calls[-1]
    assert req is not None and req.by_change_date is True and len(req.since) == 8

    deps, client = make_client(monkeypatch, tid, s["ann"])
    await deps.engine.dispose()
    async with client:
        r = await client.get(f"/api/v1/versions/{v2}/changes", headers=headers("viewer"))
        assert r.status_code == 200, r.text
        b = r.json()
        first = (await client.get(f"/api/v1/versions/{v1}/changes", headers=headers("viewer"))).json()
        assert (await client.get(f"/api/v1/versions/{uuid.uuid4()}/changes", headers=headers())).status_code == 404
    tables = {t["table"]: t for t in b["tables"]}
    assert {k: tables["MARA"][k] for k in ("mode", "rows_read", "rows_total", "inserted", "updated", "deleted", "unchanged")} == \
        {"mode": "change_date", "rows_read": 2, "rows_total": 3, "inserted": 1, "updated": 1, "deleted": 1, "unchanged": 1}
    assert {k: tables["MARC"][k] for k in ("mode", "rows_read", "inserted", "updated", "deleted", "unchanged")} == \
        {"mode": "full", "rows_read": 2, "inserted": 0, "updated": 0, "deleted": 0, "unchanged": 2}
    assert b["totals"] == {"rows_read": 4, "rows_total": 5, "inserted": 1, "updated": 1, "deleted": 1, "unchanged": 3,
                           "changed": 3}
    assert b["delta"]["baseline_version_id"] == v1
    assert all(t["inserted"] is None for t in first["tables"]) and first["totals"]["changed"] is None

    # the jobs stream: rows read vs changed, per table and in total
    stored = [e for e in events if "rows_changed" in e]
    assert stored[-1]["rows_read"] == 4 and stored[-1]["rows_changed"] == 3
    assert any(e["message"] == "Stored MARA: 2 read, 3 changed" for e in stored)

    with owner.connect() as c:
        c.execute(text("SELECT set_config('app.tenant_id', :t, false)"), {"t": tid})
        keys = sorted(r[0] for r in c.execute(text("SELECT record_key FROM record_hashes WHERE tenant_id = :t "
                                                   "AND module = 'material_master'"), {"t": tid}).fetchall())
    assert keys == ["MARA:MATNR=M1", "MARA:MATNR=M2", "MARA:MATNR=M4", "MARC:MATNR=M1|WERKS=1000", "MARC:MATNR=M2|WERKS=1000"]
