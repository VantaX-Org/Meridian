"""Learned minimum effects on real Postgres: the events query through the worker's sync session and the route's
asyncpg session, as a role under row level security, with two tenants deciding on the same monitor.

Runs with MERIDIAN_TEST_DB_URL (see tests/test_migration_waves_pg.py); skipped otherwise.
"""

from __future__ import annotations

import asyncio
import json
import os
import subprocess
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from urllib.parse import urlparse, urlunparse

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import Session

pytestmark = pytest.mark.skipif(not os.environ.get("MERIDIAN_TEST_DB_URL"), reason="MERIDIAN_TEST_DB_URL not set")

_ROLE = "meridian_monitor_app"
_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_MODULE = "material_master"
_NOW = datetime.now(timezone.utc)


@pytest.fixture(scope="module")
def engines():
    url = os.environ["MERIDIAN_TEST_DB_URL"]
    r = subprocess.run(["alembic", "upgrade", "head"], cwd=_ROOT, capture_output=True, text=True,
                       env={**os.environ, "DATABASE_URL_MIGRATE": url, "PYTHONPATH": _ROOT})
    assert r.returncode == 0, r.stderr
    owner = create_engine(url)
    with owner.begin() as c:
        if c.execute(text(f"SELECT 1 FROM pg_roles WHERE rolname = '{_ROLE}'")).scalar():
            c.execute(text(f"DROP OWNED BY {_ROLE} CASCADE"))
        c.execute(text(f"DROP ROLE IF EXISTS {_ROLE}"))
        c.execute(text(f"CREATE ROLE {_ROLE} LOGIN PASSWORD 'pw' NOSUPERUSER NOBYPASSRLS"))
        c.execute(text(f"GRANT USAGE ON SCHEMA public TO {_ROLE}"))
        c.execute(text(f"GRANT ALL ON ALL TABLES IN SCHEMA public TO {_ROLE}"))
    u = urlparse(url)
    role_url = urlunparse(("postgresql", f"{_ROLE}:pw@{u.hostname}:{u.port or 5432}", u.path, u.params, u.query, u.fragment))
    app = create_engine(role_url)
    yield owner, app, role_url.replace("postgresql://", "postgresql+asyncpg://", 1)
    app.dispose()
    with owner.begin() as c:
        c.execute(text(f"DROP OWNED BY {_ROLE} CASCADE"))
        c.execute(text(f"DROP ROLE {_ROLE}"))
    owner.dispose()


def _tenant_with_decisions(owner, decisions: list[tuple[str, float, float, datetime]]) -> str:
    """A tenant with one run and a decided fail-rate break on rule R1 per (status, observed, median, decided_at)."""
    tid = str(uuid.uuid4())
    with owner.begin() as c:
        c.execute(text("INSERT INTO tenants (id, name) VALUES (:t, :n)"), {"t": tid, "n": f"M-{tid[:8]}"})
        vid = c.execute(text("INSERT INTO analysis_versions (tenant_id, run_number) VALUES (:t, 1) RETURNING id"),
                        {"t": tid}).scalar()
        for n, (status, observed, median, at) in enumerate(decisions):
            # The unique key is (version, module, kind, subject), so each decision after the first gets its own run.
            v = vid if n == 0 else c.execute(text(
                "INSERT INTO analysis_versions (tenant_id, run_number) VALUES (:t, :r) RETURNING id"),
                {"t": tid, "r": n + 1}).scalar()
            c.execute(text("""
                INSERT INTO learned_monitor_breaks (tenant_id, version_id, module, kind, metric, subject_code, severity,
                                                    median, observed, baseline_runs, method, status, decided_by, decided_at)
                VALUES (:t, :v, :m, 'fail_rate_jump', 'fail_rate', 'R1', 'high', :med, :obs, 6, 'median_mad', :s,
                        'steward', :at)"""), {"t": tid, "v": v, "m": _MODULE, "med": median, "obs": observed, "s": status, "at": at})
    return tid


def test_minimums_are_learned_per_tenant_through_the_worker_and_the_route(engines):
    from api.routes.learned_monitors import _thresholds
    from api.services import learned_monitors as lm

    owner, app, async_url = engines
    day = timedelta(days=1)
    t1 = _tenant_with_decisions(owner, [("expected", 7.0, 2.0, _NOW - day),         # effect 5, minimum 5.25
                                        ("expected", 30.0, 2.0, _NOW - 91 * day)])  # older than the window
    t2 = _tenant_with_decisions(owner, [("expected", 4.0, 1.0, _NOW - day)])        # effect 3, minimum 3.15

    def worker(tid: str) -> dict:
        with Session(app) as s, s.begin():
            s.execute(text("SELECT set_config('app.tenant_id', :t, true)"), {"t": tid})
            return lm.learned_minimums(s, tid, _MODULE, _NOW)

    assert worker(t1) == {("fail_rate", "R1"): 5.0 * lm.LEARN_MARGIN}
    assert worker(t2) == {("fail_rate", "R1"): 3.0 * lm.LEARN_MARGIN}

    async def route(tid: str) -> list:
        eng = create_async_engine(async_url)
        try:
            async with AsyncSession(eng) as db, db.begin():
                await db.execute(text("SELECT set_config('app.tenant_id', :t, true)"), {"t": tid})
                return await _thresholds(db, SimpleNamespace(id=uuid.UUID(tid)), [_MODULE])
        finally:
            await eng.dispose()

    got = asyncio.run(route(t1))
    assert [(x.module, x.metric, x.subject_code, x.min_effect) for x in got] == [
        (_MODULE, "fail_rate", "R1", 5.0 * lm.LEARN_MARGIN)]
    assert len(got[0].moves) == 1


def test_another_tenants_id_reads_nothing_under_row_level_security(engines):
    from api.services import learned_monitors as lm

    owner, app, _ = engines
    t1 = _tenant_with_decisions(owner, [("expected", 7.0, 2.0, _NOW - timedelta(days=1))])
    t2 = _tenant_with_decisions(owner, [])
    with Session(app) as s, s.begin():
        s.execute(text("SELECT set_config('app.tenant_id', :t, true)"), {"t": t2})
        assert lm.learned_minimums(s, t1, _MODULE, _NOW) == {}


def _score_tenant(owner, current: float = 88.0) -> tuple[str, str]:
    """A tenant with six earlier finished runs scoring 90, an 'expected' score break (effect 3, so the learned
    minimum is 3.15) and a current run scoring ``current``. Returns (tenant id, current run id)."""
    tid = str(uuid.uuid4())
    with owner.begin() as c:
        c.execute(text("INSERT INTO tenants (id, name) VALUES (:t, :n)"), {"t": tid, "n": f"M-{tid[:8]}"})
        first = None
        for n in range(1, 8):
            vid = c.execute(text(
                "INSERT INTO analysis_versions (tenant_id, run_number, run_at, status, dqs_summary) "
                "VALUES (:t, :n, :at, 'complete', CAST(:d AS jsonb)) RETURNING id::text"),
                {"t": tid, "n": n, "at": _NOW - timedelta(days=10 - n),
                 "d": '{"%s": {"composite_score": %s}}' % (_MODULE, 90.0 if n < 7 else current)}).scalar()
            first = first or vid
        c.execute(text("""
            INSERT INTO learned_monitor_breaks (tenant_id, version_id, module, kind, metric, subject_code, severity,
                                                median, observed, baseline_runs, method, status, decided_by, decided_at)
            VALUES (:t, :v, :m, 'score_drop', 'score', '', 'high', 90, 87, 6, 'median_mad', 'expected', 'steward',
                    :at)"""), {"t": tid, "v": first, "m": _MODULE, "at": _NOW - timedelta(days=1)})
    return tid, vid


def _store(app, tid: str, vid: str) -> int:
    from api.services import learned_monitors as lm
    with Session(app) as s, s.begin():
        s.execute(text("SELECT set_config('app.tenant_id', :t, true)"), {"t": tid})
        return lm.detect_and_store(s, tid, vid, _MODULE)


def _rows(owner, tid: str, vid: str) -> list[tuple]:
    with owner.begin() as c:
        return [tuple(r) for r in c.execute(text(
            "SELECT status, kind, metric FROM learned_monitor_breaks WHERE tenant_id = :t AND version_id = CAST(:v AS uuid) "
            "ORDER BY 1"), {"t": tid, "v": vid})]


def test_a_break_below_the_raised_minimum_is_stored_quietly_replaced_and_confirmable(engines):
    from api.services import learned_monitors as lm

    owner, app, _ = engines
    tid, vid = _score_tenant(owner)
    assert _store(app, tid, vid) == 0                     # raises nothing
    assert _rows(owner, tid, vid) == [("below_minimum", "score_drop", "score")]
    assert _store(app, tid, vid) == 0                     # a rerun replaces it, never doubles it
    assert _rows(owner, tid, vid) == [("below_minimum", "score_drop", "score")]
    with owner.begin() as c:
        assert c.execute(text("SELECT count(*) FROM learned_monitor_breaks WHERE tenant_id = :t AND status = 'open'"),
                         {"t": tid}).scalar() == 0

    with owner.begin() as c:                              # the steward confirms it
        c.execute(text("UPDATE learned_monitor_breaks SET status = 'acknowledged', decided_by = 'steward', decided_at = :at "
                       "WHERE tenant_id = :t AND status = 'below_minimum'"), {"t": tid, "at": _NOW})
    with Session(app) as s, s.begin():
        s.execute(text("SELECT set_config('app.tenant_id', :t, true)"), {"t": tid})
        assert lm.learned_minimums(s, tid, _MODULE, _NOW + timedelta(minutes=1)) == {("score", ""): 2.0}
    assert _store(app, tid, vid) == 1                     # at the lowered minimum the same drop now counts as a break,
    # but the steward's acknowledged row on this run and subject stays as it is (the unique key keeps it)
    assert _rows(owner, tid, vid) == [("acknowledged", "score_drop", "score")]


def test_the_new_kinds_and_status_pass_the_check_constraints_and_the_migration_is_applied(engines):
    owner, _, _ = engines
    tid, vid = _score_tenant(owner)
    with owner.begin() as c:
        assert c.execute(text("SELECT version_num FROM alembic_version")).scalar() >= "145"
        for n, (kind, metric, subject, status) in enumerate([("field_emptied", "blank_pct", "MARA.MATKL", "below_minimum"),
                                                              ("cardinality_shift", "distinct_pct", "MARA.MATKL", "open"),
                                                              ("pattern_shift", "pattern_pct", "MARA.MTART", "open"),
                                                              ("format_break", "unparse_pct", "MARA.NTGEW", "open"),
                                                              *[("range_shift", m, f"MARA.F{m}", "open") for m in
                                                                ("num_mean", "num_max", "num_min", "date_max", "date_min")]]):
            c.execute(text("""
                INSERT INTO learned_monitor_breaks (tenant_id, version_id, module, kind, metric, subject_code, severity,
                                                    median, observed, baseline_runs, method, status)
                VALUES (:t, CAST(:v AS uuid), :m, :k, :me, :s, 'high', 10, 99, 6, 'median_mad', :st)"""),
                      {"t": tid, "v": vid, "m": _MODULE, "k": kind, "me": metric, "s": subject, "st": status})


def _profile_tenant(owner, now_stats: dict, earlier_stats: dict, personal: bool = False) -> tuple[str, str]:
    """A tenant with six earlier finished runs and a current one, each with field profiles of MARA.MTART (shapes),
    MARA.BRGEW (numbers) and MARA.LAEDA (dates). Returns (tenant id, current run id)."""
    tid = str(uuid.uuid4())
    with owner.begin() as c:
        c.execute(text("INSERT INTO tenants (id, name) VALUES (:t, :n)"), {"t": tid, "n": f"M-{tid[:8]}"})
        for n in range(1, 8):
            vid = c.execute(text(
                "INSERT INTO analysis_versions (tenant_id, run_number, run_at, status, dqs_summary) "
                "VALUES (:t, :n, :at, 'complete', CAST(:d AS jsonb)) RETURNING id::text"),
                {"t": tid, "n": n, "at": _NOW - timedelta(days=10 - n), "d": '{"%s": {"composite_score": 90}}' % _MODULE}).scalar()
            for field, stats in (now_stats if n == 7 else earlier_stats).items():
                c.execute(text("INSERT INTO field_profiles (tenant_id, version_id, module, table_name, field, stats) "
                               "VALUES (:t, CAST(:v AS uuid), :m, 'MARA', :f, CAST(:s AS jsonb))"),
                          {"t": tid, "v": vid, "m": _MODULE, "f": field, "s": json.dumps(stats)})
    return tid, vid


def _stats(shapes=None, num=None, dates=None, **kw):
    return {"rows": 1000, "blank": 0, "distinct": 40, "shapes": shapes or [{"shape": "AAAA", "share": 0.97}],
            **({"numeric": num} if num else {}), **({"dates": dates} if dates else {}), **kw}


def _detect(app, tid, vid):
    from api.services import learned_monitors as lm
    with Session(app) as s, s.begin():
        s.execute(text("SELECT set_config('app.tenant_id', :t, true)"), {"t": tid})
        return lm.detect(s, tid, vid, _MODULE)["breaks"]


def test_value_pattern_and_range_breaks_are_collected_from_field_profiles(engines):
    owner, app, _ = engines
    good = {"MTART": _stats(), "BRGEW": _stats(num={"min": 1.0, "max": 100.0, "mean": 50.0, "non_numeric": 0}),
            "LAEDA": _stats(dates={"min": "2015-01-01", "max": "2024-06-01", "invalid": 0})}
    bad = {"MTART": _stats(shapes=[{"shape": "9999", "share": 0.6}, {"shape": "AAAA", "share": 0.37}]),
           "BRGEW": _stats(num={"min": 1.0, "max": 9000.0, "mean": 400.0, "non_numeric": 120}),
           "LAEDA": _stats(dates={"min": "2015-01-01", "max": "2021-01-01", "invalid": 0})}
    tid, vid = _profile_tenant(owner, bad, good)
    got = {(b["metric"], b["subject_code"]): b for b in _detect(app, tid, vid)}
    assert ("pattern_pct", "MARA.MTART") in got and ("unparse_pct", "MARA.BRGEW") in got
    # the mean and the largest value both left their band, but a field keeps its strongest range_shift only
    assert ("num_max", "MARA.BRGEW") in got and ("num_mean", "MARA.BRGEW") not in got and ("date_max", "MARA.LAEDA") in got
    assert ("num_min", "MARA.BRGEW") not in got and ("date_min", "MARA.LAEDA") not in got
    # the store keeps one range_shift per field and run (unique key), the strongest one, and it all passes the CHECKs
    assert _store(app, tid, vid) == 4
    with owner.begin() as c:
        rows = {(k, s) for k, s in c.execute(text("SELECT kind, subject_code FROM learned_monitor_breaks WHERE tenant_id = :t"),
                                                {"t": tid})}
    assert rows == {("pattern_shift", "MARA.MTART"), ("format_break", "MARA.BRGEW"), ("range_shift", "MARA.BRGEW"),
                    ("range_shift", "MARA.LAEDA")}


def test_a_stable_field_and_a_date_moving_forward_raise_nothing(engines):
    owner, app, _ = engines
    old = {"BRGEW": _stats(num={"min": 1.0, "max": 100.0, "mean": 50.0, "non_numeric": 0}),
           "LAEDA": _stats(dates={"min": "2015-01-01", "max": "2024-06-01", "invalid": 0}), "MTART": _stats()}
    new = {**old, "LAEDA": _stats(dates={"min": "2015-01-01", "max": "2026-06-01", "invalid": 0}),
           "BRGEW": _stats(num={"min": 1.0, "max": 101.0, "mean": 50.5, "non_numeric": 0})}
    tid, vid = _profile_tenant(owner, new, old)
    assert _detect(app, tid, vid) == []


def test_a_sampled_profile_gives_no_extreme_and_a_personal_field_gives_only_a_count(engines):
    owner, app, _ = engines
    num = {"min": 1.0, "max": 100.0, "mean": 50.0, "non_numeric": 0}
    old = {"BRGEW": _stats(num=num, sampled=True), "NAME1": _stats(num=num, mask_reason="privacy"),
           "MTART": _stats(mask_reason="privacy")}
    new = {"BRGEW": _stats(num={"min": 0.0, "max": 9e6, "mean": 52.0, "non_numeric": 0}, sampled=True),
           "NAME1": _stats(num={"min": 0.0, "max": 9e6, "mean": 9000.0, "non_numeric": 300}, mask_reason="privacy"),
           "MTART": _stats(shapes=[{"shape": "9999", "share": 1.0}], mask_reason="privacy")}
    tid, vid = _profile_tenant(owner, new, old)
    from api.services import learned_monitors as lm
    with Session(app) as s, s.begin():
        s.execute(text("SELECT set_config('app.tenant_id', :t, true)"), {"t": tid})
        _, series, mine = lm.collect(s, tid, vid, _MODULE)
    keys = set(series) | set(mine)
    assert "num_mean|MARA.BRGEW" in keys and "num_max|MARA.BRGEW" not in keys and "num_min|MARA.BRGEW" not in keys
    assert not any(k.split("|")[0] in ("num_mean", "num_max", "num_min", "pattern_pct") and k.endswith(("NAME1", "MTART")) for k in keys)
    brk = _detect(app, tid, vid)
    assert [(b["metric"], b["subject_code"]) for b in brk] == [("unparse_pct", "MARA.NAME1")]
    f = lm.facts({**brk[0], "expected_low": brk[0]["low"], "expected_high": brk[0]["high"]}, "Name")
    assert "9000" not in str(f) and "9e+06" not in str(f)


def test_a_field_under_the_minimum_rows_is_not_watched(engines):
    owner, app, _ = engines
    small = {"BRGEW": {**_stats(num={"min": 1.0, "max": 100.0, "mean": 50.0, "non_numeric": 0}), "rows": 60}}
    tid, vid = _profile_tenant(owner, small, small)
    from api.services import learned_monitors as lm
    with Session(app) as s, s.begin():
        s.execute(text("SELECT set_config('app.tenant_id', :t, true)"), {"t": tid})
        _, series, mine = lm.collect(s, tid, vid, _MODULE)
    assert not [k for k in set(series) | set(mine) if "BRGEW" in k]
