"""Finished runs are ``complete``, ``agents_complete``, ``ai_enriched``, ``agents_failed`` or ``partial``:
one shared predicate (api/services/version_status.py) in every reader, and
/versions/compare resolves ``v1`` itself, answering 404 ``no_baseline`` when the
system has no earlier finished run."""

import uuid
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.deps import Tenant, get_db, get_tenant
from api.routes import analytics, record_issues, reports, rule_authoring, systems, versions
from api.services import contract_compliance
from api.services.version_status import ENDED, FINISHED, finished_sql

ROOT = Path(__file__).resolve().parent.parent
PREDICATE = "IN ('complete', 'agents_complete', 'ai_enriched', 'agents_failed', 'partial')"


class _Res:
    def __init__(self, rows):
        self.rows = rows

    def fetchall(self):
        return self.rows

    def fetchone(self):
        return self.rows[0] if self.rows else None

    first = fetchone

    def scalar(self):
        return self.rows[0][0] if self.rows else None

    def scalars(self):
        return [r[0] for r in self.rows]

    def mappings(self):
        return self

    def all(self):
        return self.rows


class _Db:
    """Answers each statement from the first (needle, rows) pair whose needle is in its SQL."""

    def __init__(self, answers=()):
        self.answers, self.sql = list(answers), []

    async def execute(self, stmt, params=None):
        try:
            text = str(stmt.compile(compile_kwargs={"literal_binds": True}))
        except Exception:
            text = str(stmt)
        self.sql.append(text)
        for needle, rows in self.answers:
            if needle in text:
                return _Res(rows)
        return _Res([])


def _client(router, db) -> TestClient:
    app = FastAPI()
    app.include_router(router)

    async def _db():
        yield db

    app.dependency_overrides[get_db] = _db
    app.dependency_overrides[get_tenant] = lambda: Tenant(uuid.uuid4(), "T", [])
    return TestClient(app)


@pytest.fixture(autouse=True)
def _dev_roles(monkeypatch):
    monkeypatch.setenv("MERIDIAN_DEV_ROLE_HEADER", "1")


H = {"X-User-Role": "admin"}


def test_predicate_shape():
    assert FINISHED == ("complete", "agents_complete", "ai_enriched", "agents_failed", "partial")
    assert set(ENDED) == set(FINISHED) | {"failed"}
    assert finished_sql() == "status " + PREDICATE
    assert finished_sql("v.status") == "v.status " + PREDICATE


def test_no_reader_still_requires_status_complete():
    for rel in ("api/routes/versions.py", "api/routes/analytics.py", "api/routes/record_issues.py",
                "api/routes/systems.py", "api/services/contract_compliance.py", "api/routes/rule_authoring.py"):
        src = (ROOT / rel).read_text()
        assert "status = 'complete'" not in src and 'status == "complete"' not in src, rel
        assert "version_status" in src, rel
    assert versions._DONE is ENDED
    assert rule_authoring._DONE == finished_sql()


SCOPE_NEEDLE = "SELECT COALESCE(metadata->>'system_id', 'upload') FROM analysis_versions"


@pytest.mark.anyio
async def test_resolve_pair_picks_newest_finished_earlier_run():
    v2, v1 = uuid.uuid4(), uuid.uuid4()
    db = _Db([(SCOPE_NEEDLE, [("sys-1",)]), ("SELECT id FROM analysis_versions", [(v1,)])])
    assert await versions._resolve_pair(db, None, str(v2)) == (v1, v2)
    [baseline] = [s for s in db.sql if "ORDER BY (metadata->>'baseline')" in s]
    assert f"AND status {PREDICATE}" in baseline


@pytest.mark.anyio
async def test_resolve_pair_without_baseline_is_404_no_baseline():
    db = _Db([(SCOPE_NEEDLE, [("sys-1",)])])
    with pytest.raises(Exception) as e:
        await versions._resolve_pair(db, None, str(uuid.uuid4()))
    assert e.value.status_code == 404 and e.value.detail["reason"] == "no_baseline"


def test_compare_without_v1_is_not_422_and_reports_no_baseline():
    c = _client(versions.router, _Db([(SCOPE_NEEDLE, [("sys-1",)])]))
    r = c.get(f"/api/v1/versions/compare?v2={uuid.uuid4()}", headers=H)
    assert r.status_code == 404 and r.json()["detail"]["reason"] == "no_baseline"
    r = c.get(f"/api/v1/versions/compare/records?v2={uuid.uuid4()}", headers=H)
    assert r.status_code == 404 and r.json()["detail"]["reason"] == "no_baseline"


def test_compare_pdf_reports_no_baseline():
    c = _client(reports.router, _Db([(SCOPE_NEEDLE, [("sys-1",)])]))
    r = c.get(f"/api/v1/reports/compare.pdf?v2={uuid.uuid4()}", headers=H)
    assert r.status_code == 404 and r.json()["detail"]["reason"] == "no_baseline"


def test_analytics_latest_run_accepts_every_finished_status():
    db = _Db()
    c = _client(analytics.router, db)
    for url in ("/api/v1/analytics/prescriptive", "/api/v1/analytics/impact", "/api/v1/analytics/sprints"):
        db.sql.clear()
        assert c.get(url, headers=H).status_code == 200, url
        latest = [s for s in db.sql if "FROM analysis_versions" in s]
        assert latest and all(f"analysis_versions.status {PREDICATE}" in s for s in latest), url


class _IssueRow:
    check_id, record_key, scope = "C1", "k", "upload"
    _mapping = {"check_id": "C1", "record_key": "k", "scope": "upload"}


def test_record_issue_history_and_systems_list_use_the_predicate():
    db = _Db([("WHERE ri.id", [_IssueRow()])])
    c = _client(record_issues.router, db)
    c.get(f"/api/v1/issues/{uuid.uuid4()}", headers=H)
    assert any(f"v.status {PREDICATE}" in s and "finding_records" in s for s in db.sql)

    db = _Db()
    c = _client(systems.router, db)
    assert c.get("/api/v1/systems", headers=H).status_code == 200
    assert any(f"v.status {PREDICATE}" in s and "last_analysis_at" in s for s in db.sql)


def test_contract_freshness_reads_every_finished_run():
    class S:
        def __init__(self):
            self.sql = []

        def execute(self, stmt, params=None):
            self.sql.append(str(stmt))
            return _Res([])

    s = S()
    assert contract_compliance.evaluate_freshness(s, "t") == []
    assert any(f"WHERE status {PREDICATE}" in q for q in s.sql)
