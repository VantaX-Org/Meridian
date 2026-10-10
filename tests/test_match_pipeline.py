"""Match pipeline: blocking finds planted duplicates at scale, scoring respects steward constraints.

The Postgres test runs with MERIDIAN_TEST_DB_URL. The app role is NOBYPASSRLS.
"""

from __future__ import annotations

import os
import random
import string
import subprocess
import uuid

import pandas as pd
import pytest

import workers.celery_app  # noqa: F401 — registers tasks, avoids the mining import cycle

_ROLE = "meridian_match_app"
pg = pytest.mark.skipif(not os.environ.get("MERIDIAN_TEST_DB_URL"), reason="MERIDIAN_TEST_DB_URL not set")
_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def test_candidate_pairs_find_planted_duplicates_in_10k_rows():
    from workers.tasks.run_match import candidate_pairs

    rng = random.Random(7)

    def word(prefix: str) -> str:
        return prefix + "".join(rng.choice(string.ascii_uppercase) for _ in range(5))

    rows = [{"BUT000.PARTNER": str(100000 + i), "BUT000.NAME_ORG1": f"{word('A')} {word('B')} {word('C')}",
             "ADRC.COUNTRY": "DE", "ADRC.POST_CODE1": str(1000 + i % 1000)} for i in range(9599)]
    planted = set()
    for n, base in enumerate(rng.sample(rows, 100)):
        pid = str(200000 + n)
        rows.append({**base, "BUT000.PARTNER": pid, "BUT000.NAME_ORG1": base["BUT000.NAME_ORG1"][:-1]})
        planted.add(tuple(sorted((base["BUT000.PARTNER"], pid))))
    # One postcode with 301 records: over max_block, so reported and never compared.
    rows += [{"BUT000.PARTNER": str(300000 + i), "BUT000.NAME_ORG1": f"{word('A')} {word('B')} {word('C')}",
              "ADRC.COUNTRY": "DE", "ADRC.POST_CODE1": "9999"} for i in range(301)]
    df = pd.DataFrame(rows)
    assert len(df) == 10_000

    pairs, stats = candidate_pairs(df, "business_partner")
    found = {tuple(sorted((df.at[a, "BUT000.PARTNER"], df.at[b, "BUT000.PARTNER"]))) for a, b, _ in pairs}
    assert found == planted
    assert stats == {"compared": 9699, "blocks_skipped_too_large": 1, "records_not_compared": 301,
                     "records_not_blocked": 0}


def test_records_without_a_block_are_counted_not_passed():
    from workers.tasks.run_match import candidate_pairs

    df = pd.DataFrame({"BUT000.PARTNER": ["1", "2", "3"], "BUT000.NAME_ORG1": ["ALPHA TRADING", "ALPHA TRADNG", None],
                       "ADRC.COUNTRY": ["DE", None, "DE"], "ADRC.POST_CODE1": ["10115", "10115", "10115"]})
    pairs, stats = candidate_pairs(df, "business_partner")
    assert pairs == []
    assert stats["records_not_blocked"] == 2


def test_run_match_is_registered_and_fanned_out():
    from pathlib import Path

    assert "workers.tasks.run_match.run_match" in workers.celery_app.celery_app.tasks
    src = Path(_ROOT, "workers/tasks/run_checks.py").read_text()
    assert "run_match.delay(version_id, tenant_id, module_name, parquet_path)" in src


def test_unknown_module_and_missing_columns_are_skipped():
    from workers.tasks.run_match import match_frame

    df = pd.DataFrame({"BUT000.PARTNER": ["1"], "BUT000.NAME_ORG1": ["ALPHA TRADING"]})
    assert match_frame(df, "employee_central", str(uuid.uuid4()), None)["status"] == "skipped"
    out = match_frame(df, "business_partner", str(uuid.uuid4()), None)
    assert out == {"status": "skipped", "reason": "missing columns: ADRC.COUNTRY, ADRC.POST_CODE1"}


def _alembic(*args: str) -> None:
    r = subprocess.run(["alembic", *args], cwd=_ROOT, capture_output=True, text=True,
                       env={**os.environ, "DATABASE_URL_MIGRATE": os.environ["MERIDIAN_TEST_DB_URL"],
                            "PYTHONPATH": _ROOT})
    assert r.returncode == 0, r.stderr


@pytest.fixture(scope="module")
def app_engine():
    from urllib.parse import urlparse, urlunparse

    from sqlalchemy import create_engine, text

    url = os.environ["MERIDIAN_TEST_DB_URL"]
    _alembic("upgrade", "head")
    owner = create_engine(url)
    with owner.begin() as c:
        if c.execute(text("SELECT 1 FROM pg_roles WHERE rolname = :r"), {"r": _ROLE}).scalar():
            c.execute(text(f"DROP OWNED BY {_ROLE} CASCADE"))
        c.execute(text(f"DROP ROLE IF EXISTS {_ROLE}"))
        c.execute(text(f"CREATE ROLE {_ROLE} LOGIN PASSWORD 'pw' NOSUPERUSER NOBYPASSRLS"))
        c.execute(text(f"GRANT USAGE, CREATE ON SCHEMA public TO {_ROLE}"))
        c.execute(text(f"GRANT ALL ON ALL TABLES IN SCHEMA public TO {_ROLE}"))
    u = urlparse(url)
    app = create_engine(urlunparse((u.scheme, f"{_ROLE}:pw@{u.hostname}:{u.port or 5432}",
                                    u.path, u.params, u.query, u.fragment)))
    yield owner, app
    app.dispose()
    with owner.begin() as c:
        c.execute(text(f"DROP OWNED BY {_ROLE} CASCADE"))
        c.execute(text(f"DROP ROLE {_ROLE}"))
    owner.dispose()


@pg
def test_match_frame_seeds_rules_skips_blocked_pairs_and_is_rerunnable(app_engine):
    from sqlalchemy import text
    from sqlalchemy.orm import Session

    from workers.tasks.run_match import match_frame

    owner, app = app_engine
    t = str(uuid.uuid4())
    with owner.begin() as c:
        c.execute(text("INSERT INTO tenants (id, name) VALUES (:t, :n)"), {"t": t, "n": f"M-{t[:8]}"})
        c.execute(text("INSERT INTO mdm_pair_constraints (id, tenant_id, domain, key_lo, key_hi, kind) "
                       "VALUES (gen_random_uuid(), :t, 'business_partner', '3', '4', 'do_not_match')"), {"t": t})
    df = pd.DataFrame(
        [["1", "ALPHA TRADING", "DE", "10115", "MAIN STREET 1", "BERLIN"],
         ["2", "ALPHA TRADNG", "DE", "10115", "HARBOUR ROAD 9", "BERLIN"],
         ["3", "BETA SUPPLIES", "DE", "10115", None, None],
         ["4", "BETA SUPPLIE", "DE", "10115", None, None]],
        columns=["BUT000.PARTNER", "BUT000.NAME_ORG1", "ADRC.COUNTRY", "ADRC.POST_CODE1", "ADRC.STREET",
                 "ADRC.CITY1"])

    with Session(app) as s:
        out = match_frame(df, "business_partner", t, s)
    assert (out["status"], out["candidates"], out["blocked"], out["scored"], out["queued"]) == ("complete", 2, 1, 1, 1)

    with Session(app) as s:
        again = match_frame(df, "business_partner", t, s)
    assert again["scored"] == 1

    with owner.begin() as c:
        def count(table: str) -> int:
            return c.execute(text(f"SELECT COUNT(*) FROM {table} WHERE tenant_id = :t"), {"t": t}).scalar()
        assert count("match_rules") == 3
        assert count("match_scores") == 1
        assert count("cleaning_queue") == 1
        keys = c.execute(text("SELECT candidate_a_key, candidate_b_key FROM match_scores WHERE tenant_id = :t"),
                         {"t": t}).one()
    assert tuple(keys) == ("1", "2")
