"""Migration 073 and the match_scores upsert: one row per pair, reviewed rows are final.

Runs with MERIDIAN_TEST_DB_URL. The app role is NOBYPASSRLS so the policy is really exercised.
"""

from __future__ import annotations

import os
import subprocess
import uuid

import pytest

_ROLE = "meridian_pair_app"
pg = pytest.mark.skipif(not os.environ.get("MERIDIAN_TEST_DB_URL"), reason="MERIDIAN_TEST_DB_URL not set")
_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

_RULES = [("BUT000.NAME_ORG1", "name_legal", 60, 0.85), ("ADRC.STREET", "address_tokens", 25, 0.7),
          ("ADRC.CITY1", "exact", 15, 1.0)]
_A = {"BUT000.NAME_ORG1": "ALPHA TRADING", "ADRC.STREET": "MAIN STREET 1", "ADRC.CITY1": "BERLIN"}
_B = {"BUT000.NAME_ORG1": "ALPHA TRADNG", "ADRC.STREET": "HARBOUR ROAD 9", "ADRC.CITY1": "BERLIN"}


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


def _tenant(owner) -> str:
    from sqlalchemy import text

    tid = str(uuid.uuid4())
    with owner.begin() as c:
        c.execute(text("INSERT INTO tenants (id, name) VALUES (:t, :n)"), {"t": tid, "n": f"P-{tid[:8]}"})
    return tid


def _rules(owner, tid: str) -> None:
    from sqlalchemy import text

    with owner.begin() as c:
        for f, m, w, th in _RULES:
            c.execute(text("INSERT INTO match_rules (id, tenant_id, domain, field, match_type, weight, threshold) "
                           "VALUES (gen_random_uuid(), :t, 'business_partner', :f, :m, :w, :th)"),
                      {"t": tid, "f": f, "m": m, "w": w, "th": th})


def _count(owner, table: str, tid: str) -> int:
    from sqlalchemy import text

    with owner.begin() as c:
        return c.execute(text(f"SELECT COUNT(*) FROM {table} WHERE tenant_id = :t"), {"t": tid}).scalar()


@pg
def test_migration_keeps_one_row_per_pair_and_drops_orphaned_items(app_engine):
    from sqlalchemy import text

    owner, _app = app_engine
    _alembic("downgrade", "068")
    try:
        t = _tenant(owner)
        with owner.begin() as c:
            for a, b, reviewed in [("1", "2", False), ("2", "1", True), ("1", "2", False)]:
                sid = c.execute(text(
                    "INSERT INTO match_scores (id, tenant_id, candidate_a_key, candidate_b_key, domain, "
                    "total_score, auto_action, reviewed_at) VALUES (gen_random_uuid(), :t, :a, :b, "
                    "'business_partner', 0.7, 'queued', CASE WHEN :r THEN now() END) RETURNING id"),
                    {"t": t, "a": a, "b": b, "r": reviewed}).scalar()
                c.execute(text("INSERT INTO stewardship_queue (id, tenant_id, item_type, source_id, domain) "
                               "VALUES (gen_random_uuid(), :t, 'merge_decision', :s, 'business_partner')"),
                          {"t": t, "s": sid})
    finally:
        _alembic("upgrade", "head")
    with owner.begin() as c:
        rows = c.execute(text("SELECT candidate_a_key, reviewed_at IS NOT NULL AS reviewed FROM match_scores "
                              "WHERE tenant_id = :t"), {"t": t}).all()
        items = c.execute(text("SELECT COUNT(*) FROM stewardship_queue WHERE tenant_id = :t "
                               "AND source_id IN (SELECT id FROM match_scores)"), {"t": t}).scalar()
    assert [(r.candidate_a_key, r.reviewed) for r in rows] == [("2", True)]
    assert items == 1
    assert _count(owner, "stewardship_queue", t) == 1


@pg
def test_rescoring_a_pair_keeps_one_row_and_one_queue_entry(app_engine):
    from sqlalchemy.orm import Session

    from api.services.match_engine import score_candidate_pair

    owner, app = app_engine
    t = _tenant(owner)
    _rules(owner, t)
    with Session(app) as s:
        first = score_candidate_pair(t, "business_partner", _A, _B, "1", "2", s)
        score_candidate_pair(t, "business_partner", _B, _A, "2", "1", s)
    assert first["auto_action"] == "queued"
    assert _count(owner, "match_scores", t) == 1
    assert _count(owner, "cleaning_queue", t) == 1


@pg
def test_a_reviewed_pair_is_not_rescored(app_engine):
    from sqlalchemy import text
    from sqlalchemy.orm import Session

    from api.services.match_engine import score_candidate_pair

    owner, app = app_engine
    t = _tenant(owner)
    _rules(owner, t)
    with Session(app) as s:
        score_candidate_pair(t, "business_partner", _A, _B, "1", "2", s)
    with owner.begin() as c:
        c.execute(text("UPDATE match_scores SET reviewed_at = now(), steward_decision = 'reject', "
                       "total_score = 0.5 WHERE tenant_id = :t"), {"t": t})
    with Session(app) as s:
        score_candidate_pair(t, "business_partner", _A, _B, "1", "2", s)
    with owner.begin() as c:
        totals = c.execute(text("SELECT total_score FROM match_scores WHERE tenant_id = :t"), {"t": t}).scalars().all()
    assert totals == [0.5]
    assert _count(owner, "cleaning_queue", t) == 1
