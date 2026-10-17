"""Upload lineage on a real Postgres: compare, baseline pinning, trends and the previous run never
cross objects; system runs stay scoped by system. Skipped without MERIDIAN_TEST_DB_URL."""

from __future__ import annotations

import json
import os
import subprocess
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
import pytest_asyncio
from fastapi import HTTPException

pytestmark = pytest.mark.skipif(not os.environ.get("MERIDIAN_TEST_DB_URL"),
                                reason="MERIDIAN_TEST_DB_URL not set")

T0 = datetime(2026, 10, 1, tzinfo=timezone.utc)
# the owner connection bypasses RLS, so object names are unique to this run: no other test's runs share a lineage
SFX = "_" + uuid.uuid4().hex[:6]


@pytest.fixture(scope="module")
def seeded():
    from sqlalchemy import create_engine, text

    url = os.environ["MERIDIAN_TEST_DB_URL"]
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    r = subprocess.run(["alembic", "upgrade", "head"], cwd=root, capture_output=True, text=True,
                       env={**os.environ, "DATABASE_URL_MIGRATE": url, "PYTHONPATH": root})
    assert r.returncode == 0, r.stderr
    eng = create_engine(url)
    tid, sid = str(uuid.uuid4()), str(uuid.uuid4())
    ids: dict[str, str] = {}

    def run(name, minutes, modules, system=None, baseline=False, label=None):
        ids[name] = str(uuid.uuid4())
        modules = [m + SFX for m in modules]
        md = {"modules": modules, **({"system_id": system} if system else {}), **({"baseline": True} if baseline else {})}
        c.execute(text("INSERT INTO analysis_versions (id, tenant_id, label, status, run_at, metadata, dqs_summary) "
                       "VALUES (:id, :t, :l, 'agents_complete', :r, CAST(:m AS jsonb), CAST(:q AS jsonb))"),
                  {"id": ids[name], "t": tid, "l": label or f"{name}_1k", "r": T0 + timedelta(minutes=minutes),
                   "m": json.dumps(md), "q": json.dumps({m: {"composite_score": 70} for m in modules})})

    with eng.begin() as c:
        c.execute(text("INSERT INTO tenants (id, name) VALUES (:t, :t)"), {"t": tid})
        run("bp", 0, ["business_partner"], baseline=True)
        run("ap1", 1, ["accounts_payable"])
        run("ap2", 2, ["accounts_payable"])
        run("co1", 3, ["controlling"])
        run("co2", 4, ["controlling"])
        run("mm", 5, ["material_master"])
        for i in range(13):  # more than the 12-run trend window of newer uploads of another object
            run(f"co_extra{i}", 10 + i, ["controlling"])
        run("sys1", 40, ["accounts_payable"], system=sid)
        run("sys2", 41, ["accounts_payable"], system=sid)
    yield eng, tid, ids
    with eng.begin() as c:
        c.execute(text("DELETE FROM analysis_versions WHERE tenant_id = :t"), {"t": tid})
        c.execute(text("DELETE FROM tenants WHERE id = :t"), {"t": tid})
    eng.dispose()


@pytest_asyncio.fixture
async def adb():
    from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

    url = os.environ["MERIDIAN_TEST_DB_URL"].replace("postgresql://", "postgresql+asyncpg://", 1)
    eng = create_async_engine(url)
    async with AsyncSession(eng) as s:
        yield s
    await eng.dispose()


def test_sql_key_matches_python_key(seeded):
    from sqlalchemy import text

    from api.services.run_lineage import lineage_key, lineage_sql
    eng, tid, _ = seeded
    with eng.connect() as c:
        rows = c.execute(text(f"SELECT {lineage_sql()} AS k, metadata, dqs_summary, label FROM analysis_versions "
                              "WHERE tenant_id = :t"), {"t": tid}).fetchall()
        extra = c.execute(text(
            f"SELECT {lineage_sql('x')} FROM (VALUES (CAST(NULL AS jsonb), CAST(NULL AS jsonb), 'business_partner_100k'),"
            " (CAST('{\"modules\": [\"sdb\", \"sd_x\"]}' AS jsonb), NULL, NULL)) AS x(metadata, dqs_summary, label)"
        )).scalars().all()
    assert all(r.k == lineage_key(r.metadata, r.dqs_summary, r.label) for r in rows)
    assert extra == ["upload:business_partner", "upload:sd_x+sdb"]


@pytest.mark.asyncio
async def test_compare_defaults_stay_in_the_upload_objects(seeded, adb):
    from api.routes.versions import _resolve_pair
    _, _, ids = seeded
    pick = lambda v2: _resolve_pair(adb, None, ids[v2])  # noqa: E731
    # the pinned business_partner baseline is not controlling's, nor accounts_payable's
    assert str((await pick("co2"))[0]) == ids["co1"]
    assert str((await pick("ap2"))[0]) == ids["ap1"]
    assert str((await pick("sys2"))[0]) == ids["sys1"]  # system runs: unchanged
    # the first run of each lineage, and a single-run upload object, have nothing to compare with
    for single in ("mm", "bp", "ap1", "co1", "sys1"):
        with pytest.raises(HTTPException) as e:
            await pick(single)
        assert e.value.status_code == 404 and e.value.detail["reason"] == "no_baseline"


@pytest.mark.asyncio
async def test_pinning_is_per_upload_lineage(seeded, adb):
    from sqlalchemy import text

    from api.routes.versions import _resolve_pair, pin_baseline
    eng, tid, ids = seeded
    tenant = SimpleNamespace(id=uuid.UUID(tid))
    out = await pin_baseline(ids["co1"], True, adb, tenant)
    assert out["scope"] == f"upload:controlling{SFX}"
    try:
        with eng.connect() as c:
            pinned = set(c.execute(text("SELECT id::text FROM analysis_versions WHERE tenant_id = :t "
                                        "AND metadata->>'baseline' = 'true'"), {"t": tid}).scalars())
        assert pinned == {ids["bp"], ids["co1"]}  # business_partner keeps its own baseline
        assert str((await _resolve_pair(adb, None, ids["co_extra12"]))[0]) == ids["co1"]
    finally:
        await pin_baseline(ids["co1"], False, adb, tenant)


def test_monitor_pairs_a_baseline_with_the_newest_run_of_its_own_objects(seeded):
    from sqlalchemy.orm import Session

    from api.services import monitor
    eng, _tid, ids = seeded
    with Session(eng) as s:
        mine = [m for m in monitor.status(s) if m["baseline"]["id"] == ids["bp"]]
        assert len(mine) == 1 and mine[0]["scope"] == "upload" and mine[0]["lineage"] == f"upload:business_partner{SFX}"
        assert mine[0]["latest"]["id"] == ids["bp"]  # not the newest controlling upload
        base = s.execute(__import__("sqlalchemy").text(monitor._BASELINE_SQL), {"scope": "upload", "v": ids["co2"]})
        assert base.fetchone() is None  # the business_partner baseline is not controlling's


def test_trends_and_previous_run_stay_in_the_upload_objects(seeded):
    from sqlalchemy.orm import Session

    from api.services import insights_aggregate as agg
    eng, tid, ids = seeded
    with Session(eng) as s:
        out = agg.trends(s, tid, ids["ap2"], None)
        assert out["lineage"] == f"upload:accounts_payable{SFX}"
        assert [r["version_id"] for r in out["runs"]] == [ids["ap1"], ids["ap2"]]
        co = agg.trends(s, tid, ids["co2"], None)
        assert len(co["runs"]) == 12 and ids["bp"] not in {r["version_id"] for r in co["runs"]}
        assert agg.previous_version(s, tid, agg.resolve_version(s, tid, ids["co1"])) is None
        assert str(agg.previous_version(s, tid, agg.resolve_version(s, tid, ids["ap2"]))["id"]) == ids["ap1"]


@pytest.mark.asyncio
async def test_current_state_holds_the_latest_run_of_every_uploaded_object(seeded, adb):
    """Default findings and the DQS aggregate read one run per lineage: each uploaded object's
    newest upload, not the single newest upload standing in for all of them."""
    from api.routes.findings import _latest_version_ids
    _, tid, ids = seeded
    got = {str(v) for v in await _latest_version_ids(adb, SimpleNamespace(id=tid))}
    assert got == {ids["bp"], ids["ap2"], ids["co_extra12"], ids["mm"], ids["sys2"]}
