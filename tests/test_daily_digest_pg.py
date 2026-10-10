"""daily_digest builds next-best actions from the same inputs as GET /analytics/prescriptive
and puts them in the digest notification's body.

Runs with MERIDIAN_TEST_DB_URL (see tests/test_drilldown_routes_pg.py); skipped otherwise."""

from __future__ import annotations

import logging
import os
import subprocess
import uuid

import pytest

pytestmark = pytest.mark.skipif(not os.environ.get("MERIDIAN_TEST_DB_URL"),
                                reason="MERIDIAN_TEST_DB_URL not set")


def test_digest_next_actions_from_latest_version(monkeypatch: pytest.MonkeyPatch,
                                                  caplog: pytest.LogCaptureFixture) -> None:
    from sqlalchemy import create_engine, text

    from workers import scheduler

    url = os.environ["MERIDIAN_TEST_DB_URL"]
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    r = subprocess.run(["alembic", "upgrade", "head"], cwd=root, capture_output=True, text=True,
                       env={**os.environ, "DATABASE_URL_MIGRATE": url, "PYTHONPATH": root})
    assert r.returncode == 0, r.stderr
    engine = create_engine(url)
    tid, vid = str(uuid.uuid4()), str(uuid.uuid4())
    monkeypatch.setattr(scheduler, "get_sync_engine", lambda: engine)
    monkeypatch.setattr(scheduler, "_get_tenants", lambda _s: [{"id": tid}])
    try:
        with engine.begin() as c:
            c.execute(text("INSERT INTO tenants (id, name) VALUES (:t, 'D-digest')"), {"t": tid})
            c.execute(text("INSERT INTO analysis_versions (id, tenant_id, status) VALUES (:v, :t, 'complete')"),
                      {"v": vid, "t": tid})
            c.execute(text("INSERT INTO findings (id, tenant_id, version_id, module, check_id, severity, dimension, "
                           "affected_count, total_count) VALUES (gen_random_uuid(), :t, :v, 'fi_gl', "
                           "'FI-GL-001', 'critical', 'completeness', 40, 100)"), {"v": vid, "t": tid})
        with caplog.at_level(logging.WARNING):
            scheduler.daily_digest()
        assert "prescriptive analytics failed" not in caplog.text
        with engine.begin() as c:
            c.execute(text("SELECT set_config('app.tenant_id', :t, false)"), {"t": tid})
            body = c.execute(text("SELECT body FROM notifications WHERE tenant_id = :t "
                                  "AND type = 'daily_digest'"), {"t": tid}).scalar()
        assert "Next: FI-GL-001: fi_gl (critical, 40 records)" in body
    finally:
        with engine.begin() as c:
            for t in ("notifications", "findings", "analysis_versions", "tenants"):
                c.execute(text(f"DELETE FROM {t} WHERE {'id' if t == 'tenants' else 'tenant_id'} = :t"),
                          {"t": tid})
        engine.dispose()
