"""Proven-cost metrics persisted per analysis version by compute_proven_cost.

Runs with MERIDIAN_TEST_DB_URL, same skip convention as test_s4_dry_run_route.py.
"""

from __future__ import annotations

import io
import json
import os
import uuid

import pandas as pd
import pytest
from sqlalchemy import create_engine, text

pytestmark = pytest.mark.skipif(
    not os.getenv("MERIDIAN_TEST_DB_URL"), reason="requires MERIDIAN_TEST_DB_URL"
)


@pytest.fixture
def seeded():
    engine = create_engine(os.environ["MERIDIAN_TEST_DB_URL"])
    t1, t2, vid = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())
    with engine.begin() as c:
        for t in (t1, t2):
            c.execute(text("INSERT INTO tenants (id, name) VALUES (:t, :t)"), {"t": t})
        c.execute(text("INSERT INTO analysis_versions (id, tenant_id, status, metadata) "
                       "VALUES (:v, :t, 'complete', CAST(:m AS jsonb))"),
                  {"v": vid, "t": t1, "m": json.dumps({"system_id": None})})
        c.execute(text("INSERT INTO finding_records (tenant_id, version_id, check_id, module, record_key) "
                       "VALUES (:t, :v, 'MM140', 'mm_purchasing', 'MATNR=M1|WERKS=W')"),
                  {"t": t1, "v": vid})
    yield {"t1": t1, "t2": t2, "vid": vid, "engine": engine}
    with engine.begin() as c:
        c.execute(text("DELETE FROM proven_cost_results WHERE tenant_id IN (:t1, :t2)"), {"t1": t1, "t2": t2})
        c.execute(text("DELETE FROM finding_records WHERE tenant_id IN (:t1, :t2)"), {"t1": t1, "t2": t2})
        c.execute(text("DELETE FROM analysis_versions WHERE tenant_id IN (:t1, :t2)"), {"t1": t1, "t2": t2})
        c.execute(text("DELETE FROM tenants WHERE id IN (:t1, :t2)"), {"t1": t1, "t2": t2})
    engine.dispose()


def test_compute_proven_cost_persists_and_is_idempotent(seeded, monkeypatch):
    from tests.test_proven_cost import _po_frames
    from workers.tasks.compute_proven_cost import compute_proven_cost

    monkeypatch.setattr("workers.dataset.load_dataset",
                        lambda *a, **k: (_po_frames(), None, 4, 4))

    for _ in range(2):  # idempotent: ON CONFLICT upsert, not duplicate rows
        out = compute_proven_cost.run(seeded["vid"], seeded["t1"], "x/")
        assert out

    engine = seeded["engine"]
    with engine.begin() as c:
        c.execute(text("SET app.tenant_id = :t"), {"t": seeded["t1"]})
        rows = c.execute(text("SELECT metric, amount, check_ids FROM proven_cost_results "
                              "WHERE version_id = :v"), {"v": seeded["vid"]}).fetchall()
    assert len(rows) == 4
    late_po = next(r for r in rows if r[0] == "late_po")
    assert float(late_po[1]) == 1070.0
    assert list(late_po[2]) == ["MM140"]


def test_compute_proven_cost_is_tenant_isolated(seeded, monkeypatch):
    from tests.test_proven_cost import _po_frames
    from workers.tasks.compute_proven_cost import compute_proven_cost

    monkeypatch.setattr("workers.dataset.load_dataset",
                        lambda *a, **k: (_po_frames(), None, 4, 4))
    compute_proven_cost.run(seeded["vid"], seeded["t1"], "x/")

    engine = seeded["engine"]
    with engine.begin() as c:
        # The test role connects as a superuser, which always bypasses RLS;
        # SET ROLE to the non-superuser app role so the policy is actually enforced.
        c.execute(text("SET ROLE meridian_app"))
        c.execute(text("SET app.tenant_id = :t"), {"t": seeded["t2"]})
        rows = c.execute(text("SELECT metric FROM proven_cost_results WHERE version_id = :v"),
                         {"v": seeded["vid"]}).fetchall()
        c.execute(text("RESET ROLE"))  # pooled connection must not stay as meridian_app for teardown
    assert rows == []


class _FakeResponse:
    def __init__(self, data: bytes) -> None:
        self._buf = io.BytesIO(data)

    def read(self) -> bytes:
        return self._buf.read()

    def close(self) -> None:
        pass

    def release_conn(self) -> None:
        pass


class _FakeObj:
    def __init__(self, name: str) -> None:
        self.object_name = name


class _FakeMinioClient:
    """Two parquet objects under "x/"; EKKO is in the `tables` allow-list, LFA1 is not."""

    def __init__(self) -> None:
        self._tables = {
            "EKKO": pd.DataFrame({"EBELN": ["P1"]}),
            "LFA1": pd.DataFrame({"LIFNR": ["V1"]}),
        }

    def list_objects(self, bucket: str, prefix: str):
        return [_FakeObj(f"{prefix}{name}.parquet") for name in self._tables]

    def get_object(self, bucket: str, name: str):
        table = name.rsplit("/", 1)[-1][: -len(".parquet")]
        buf = io.BytesIO()
        self._tables[table].to_parquet(buf)
        return _FakeResponse(buf.getvalue())


def test_load_dataset_tables_filter_skips_unlisted_tables(monkeypatch):
    """ponytail: the OOM fix is a plain allow-list — this is its only check."""
    from sap.ddic import get_dictionary
    from workers import dataset as dataset_mod

    monkeypatch.setattr(dataset_mod, "_client", lambda: _FakeMinioClient())
    frames, flat, row_count, col_count = dataset_mod.load_dataset(
        "x/", get_dictionary("s4hana"), None, tables={"EKKO"})
    assert flat is None
    assert set(frames.frames) == {"EKKO"}
    assert row_count == 1


@pytest.mark.anyio
async def test_dotted_frames_reach_the_proven_cost_panel(seeded, monkeypatch):
    """End to end over production-shaped (TABLE.FIELD) frames: the task writes rows and
    GET /insights/proven-cost reads a non-zero total back."""
    from httpx import ASGITransport, AsyncClient

    from api import deps as api_deps
    from api.main import app
    from tests.test_proven_cost import _po_frames
    from tests.test_proven_cost_route import _patch_tenant
    from workers.tasks.compute_proven_cost import compute_proven_cost

    with seeded["engine"].begin() as c:
        c.execute(text("UPDATE tenants SET cost_model = CAST(:cm AS jsonb) WHERE id = :t"),
                  {"cm": json.dumps({"currency": "ZAR"}), "t": seeded["t1"]})
    frames = _po_frames()
    assert all("." in c for df in frames.frames.values() for c in df.columns)
    monkeypatch.setattr("workers.dataset.load_dataset", lambda *a, **k: (frames, None, 4, 4))
    compute_proven_cost.run(seeded["vid"], seeded["t1"], "x/")

    _patch_tenant(monkeypatch, seeded["t1"])
    await api_deps.engine.dispose()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        r = await client.get("/api/v1/insights/proven-cost",
                             headers={"X-User-Role": "admin", "Authorization": "Bearer test-token"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["version_id"] == seeded["vid"] and body["total"] == 1070.0
    late = next(row for row in body["rows"] if row["metric"] == "late_po")
    assert late["check_ids"] == ["MM140"]


def test_soft_time_limit_fails_the_task(seeded, monkeypatch):
    """A timeout must surface as a task failure, never as a silent empty result."""
    from celery.exceptions import SoftTimeLimitExceeded

    from api.services import proven_cost as pc
    from tests.test_proven_cost import _po_frames
    from workers.tasks.compute_proven_cost import compute_proven_cost

    monkeypatch.setattr("workers.dataset.load_dataset", lambda *a, **k: (_po_frames(), None, 4, 4))

    def _slow(*a: object, **k: object) -> list[pc.MetricRow]:
        raise SoftTimeLimitExceeded()

    monkeypatch.setattr(pc, "compute", _slow)
    with pytest.raises(SoftTimeLimitExceeded):
        compute_proven_cost.run(seeded["vid"], seeded["t1"], "x/")


def test_bundle_without_transaction_tables_is_a_no_op(seeded, monkeypatch):
    from workers.tasks.compute_proven_cost import compute_proven_cost

    def _empty(*a: object, **k: object) -> None:
        raise ValueError("No table parquet files under x/")

    monkeypatch.setattr("workers.dataset.load_dataset", _empty)
    assert compute_proven_cost.run(seeded["vid"], seeded["t1"], "x/") == {}


def test_load_dataset_tables_filter_prunes_flat_columns(monkeypatch, tmp_path):
    from sap.ddic import get_dictionary
    from workers import dataset as dataset_mod

    flat = pd.DataFrame({"EKKO.EBELN": ["P1"], "EKKO.WAERS": ["ZAR"], "LFA1.LIFNR": ["V1"], "LFA1.NAME1": ["N"]})
    buf = io.BytesIO()
    flat.to_parquet(buf)

    class _Client:
        def get_object(self, bucket: str, name: str) -> _FakeResponse:
            return _FakeResponse(buf.getvalue())

    monkeypatch.setattr(dataset_mod, "_client", lambda: _Client())
    frames, df, _, cols = dataset_mod.load_dataset("x.parquet", get_dictionary("s4hana"), None, tables={"EKKO"})
    assert set(df.columns) == {"EKKO.EBELN", "EKKO.WAERS"} and cols == 2
    assert set(frames.frames) == {"EKKO"}
