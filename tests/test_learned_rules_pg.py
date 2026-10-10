"""Learned rule proposals (migration 071): RLS and one row per fingerprint.

Runs with MERIDIAN_TEST_DB_URL (see tests/test_migration_waves_pg.py); skipped otherwise.
"""

from __future__ import annotations

import json
import os
import uuid

import pytest
from sqlalchemy import text

pytestmark = pytest.mark.skipif(not os.environ.get("MERIDIAN_TEST_DB_URL"), reason="MERIDIAN_TEST_DB_URL not set")

_ROLE = "meridian_learned_app"
_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


@pytest.fixture(scope="module")
def app_engine():
    import subprocess
    from urllib.parse import urlparse, urlunparse

    from sqlalchemy import create_engine

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
    tid = str(uuid.uuid4())
    with owner.begin() as c:
        c.execute(text("INSERT INTO tenants (id, name) VALUES (:t, :n)"), {"t": tid, "n": f"D-{tid[:8]}"})
    return tid


_INSERT = text("""
    INSERT INTO learned_rule_proposals (tenant_id, module, kind, table_name, determinant, field, fingerprint,
                                        body, confidence, support_rows, violations, sample_keys)
    VALUES (:tid, 'material_master', 'dependency', 'MARC', 'MARA.MTART', 'MARC.BESKZ', 'fp1',
            CAST(:body AS jsonb), 0.99, 1000, 10, '[]')
""")


def test_rls_isolates_tenants_and_fingerprint_is_unique(app_engine):
    owner, app = app_engine
    t1, t2 = _tenant(owner), _tenant(owner)
    body = json.dumps({"check_class": "dependency_check"})
    with app.begin() as c:
        c.execute(text("SET LOCAL app.tenant_id = :t"), {"t": t1})
        c.execute(_INSERT, {"tid": t1, "body": body})
    with app.begin() as c:
        c.execute(text("SET LOCAL app.tenant_id = :t"), {"t": t2})
        assert c.execute(text("SELECT count(*) FROM learned_rule_proposals")).scalar() == 0
    with pytest.raises(Exception, match="uq_learned_rule_proposals_fp"):
        with app.begin() as c:
            c.execute(text("SET LOCAL app.tenant_id = :t"), {"t": t1})
            c.execute(_INSERT, {"tid": t1, "body": body})


def test_approve_creates_active_versions_with_append_only_ids(app_engine):
    """api.routes.learned_rules.approve_sync: the sync core the approve route calls through
    db.run_sync. Each approval gets a fresh LR- id (never reused) and an active rule_versions
    row carrying the frozen ``allowed`` mapping; a second decision on the same proposal is
    refused."""
    from sqlalchemy.orm import Session

    from api.routes.learned_rules import approve_sync
    from checks.lifecycle import load_active_versions

    owner, app = app_engine
    t = _tenant(owner)
    body = json.dumps({"check_class": "dependency_check", "determinant": "MARA.MTART", "field": "MARC.BESKZ",
                       "allowed": {"ROH": ["F"]}, "grain": "MARC", "dimension": "consistency",
                       "message": "MARC.BESKZ does not follow MARA.MTART"})
    with Session(app) as s:
        s.execute(text("SET app.tenant_id = :t"), {"t": t})
        ids = []
        pid = None
        for fp in ("fp-a", "fp-b"):
            pid = s.execute(text(
                "INSERT INTO learned_rule_proposals (tenant_id, module, kind, table_name, determinant, field, "
                "fingerprint, body, confidence, support_rows, violations) VALUES (:t, 'material_master', "
                "'dependency', 'MARC', 'MARA.MTART', 'MARC.BESKZ', :fp, CAST(:b AS jsonb), 0.99, 1000, 10) "
                "RETURNING id"), {"t": t, "fp": fp, "b": body}).scalar()
            ids.append(approve_sync(s, t, str(pid), "high", None, "checker@example.test")["rule_id"])
        s.commit()
        assert ids == ["LR-000001", "LR-000002"]
        active = load_active_versions(s)
        assert active["LR-000001"]["module"] == "material_master" and active["LR-000001"]["severity"] == "high"
        with pytest.raises(LookupError):
            approve_sync(s, t, str(pid), "high", None, "checker@example.test")  # already decided


def test_reject_only_moves_pending_proposals(app_engine):
    """api.routes.learned_rules.reject_sync: rejecting twice (or a missing id) is refused, not
    silently re-applied — status only ever moves out of 'pending' once."""
    from sqlalchemy.orm import Session

    from api.routes.learned_rules import reject_sync

    owner, app = app_engine
    t = _tenant(owner)
    body = json.dumps({"check_class": "regex_check", "field": "MARA.MATNR", "pattern": "^[0-9]{18}$",
                       "dimension": "validity", "message": "shape"})
    with Session(app) as s:
        s.execute(text("SET app.tenant_id = :t"), {"t": t})
        pid = s.execute(text(
            "INSERT INTO learned_rule_proposals (tenant_id, module, kind, table_name, field, fingerprint, body, "
            "confidence, support_rows, violations) VALUES (:t, 'material_master', 'format', 'MARA', 'MARA.MATNR', "
            "'fp-reject', CAST(:b AS jsonb), 0.99, 1000, 10) RETURNING id"), {"t": t, "b": body}).scalar()
        assert reject_sync(s, t, str(pid), None, "checker@example.test") == "rejected"
        with pytest.raises(LookupError):
            reject_sync(s, t, str(pid), None, "checker@example.test")
        s.commit()
