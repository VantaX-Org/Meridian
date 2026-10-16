"""POST /api/v1/learned-rules/mine dispatches for the version's own modules and dataset,
and answers 409 (not 202) when there is nothing to mine.

An upload stores ``metadata.modules`` + ``metadata.parquet_path`` (api/routes/upload.py);
the orchestrator once read only ``module_paths`` and reported ``no_modules`` for every upload."""

import uuid

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.deps import Tenant, get_db, get_tenant
from api.routes.learned_rules import router
from workers.tasks.mining import orchestrator

TID = uuid.uuid4()
VID = uuid.uuid4()


class _Result:
    def __init__(self, row):
        self._row = row

    def fetchone(self):
        return self._row


class _DB:
    def __init__(self, meta, exists=True):
        self.meta, self.exists = meta, exists
        self.sql = []

    async def execute(self, stmt, params=None):
        self.sql.append((" ".join(str(stmt).split()), params))
        if "FROM analysis_versions" in str(stmt):
            return _Result((self.meta,) if self.exists else None)
        return _Result(None)


def _client(db) -> TestClient:
    api = FastAPI()
    api.include_router(router)

    async def _db():
        yield db

    api.dependency_overrides[get_db] = _db
    api.dependency_overrides[get_tenant] = lambda: Tenant(TID, "T", [])
    return TestClient(api)


@pytest.fixture(autouse=True)
def _dev_roles(monkeypatch):
    monkeypatch.setenv("MERIDIAN_DEV_ROLE_HEADER", "1")


def _post(client):
    return client.post("/api/v1/learned-rules/mine", json={"version_id": str(VID)}, headers={"X-User-Role": "admin"})


def test_upload_version_is_mined_for_its_own_modules(monkeypatch):
    calls = []
    monkeypatch.setattr(orchestrator.run_mining_for_version, "delay", lambda *a, **k: calls.append((a, k)))
    db = _DB({"modules": ["mm_purchasing"], "parquet_path": "staging/t/f.parquet"})
    r = _post(_client(db))
    assert r.status_code == 202, r.text
    assert r.json() == {"queued": True, "modules": ["mm_purchasing"]}
    assert calls == [((str(TID), str(VID)), {"modules": ["mm_purchasing"], "include": ["house_rules"]})]
    assert db.sql[0][0].startswith("SELECT set_config('app.tenant_id'")
    assert any("WHERE id = :v AND tenant_id = :t" in s for s, _ in db.sql)


def test_extraction_version_is_mined_per_module_path(monkeypatch):
    calls = []
    monkeypatch.setattr(orchestrator.run_mining_for_version, "delay", lambda *a, **k: calls.append((a, k)))
    db = _DB({"modules": ["fi_gl", "accounts_payable"],
              "module_paths": {"fi_gl": "d/fi_gl.parquet", "accounts_payable": "d/ap.parquet"}})
    r = _post(_client(db))
    assert r.status_code == 202 and r.json()["modules"] == ["accounts_payable", "fi_gl"]
    assert calls[0][1]["modules"] == ["accounts_payable", "fi_gl"]


@pytest.mark.parametrize("meta", [
    {},
    None,
    {"modules": ["fi_gl"]},                       # no dataset stored
    {"parquet_path": "staging/t/f.parquet"},      # no modules
    {"modules": [], "module_paths": {"fi_gl": None}},
])
def test_nothing_to_mine_is_409_and_queues_nothing(monkeypatch, meta):
    calls = []
    monkeypatch.setattr(orchestrator.run_mining_for_version, "delay", lambda *a, **k: calls.append((a, k)))
    r = _post(_client(_DB(meta)))
    assert r.status_code == 409, r.text
    assert "no stored module dataset" in r.json()["detail"]
    assert calls == []


def test_unknown_version_is_404(monkeypatch):
    monkeypatch.setattr(orchestrator.run_mining_for_version, "delay", lambda *a, **k: pytest.fail("queued"))
    assert _post(_client(_DB({}, exists=False))).status_code == 404


# --- the orchestrator's own view of a version ------------------------------------------------

def test_mining_targets_prefers_module_paths_then_falls_back_to_the_single_dataset():
    assert orchestrator.mining_targets({"module_paths": {"fi_gl": "a", "co": ""}, "modules": ["x"],
                                        "parquet_path": "p"}) == [("fi_gl", "a")]
    assert orchestrator.mining_targets({"modules": ["fi_gl", "fi_gl", "co"], "parquet_path": "p"}) == \
        [("fi_gl", "p"), ("co", "p")]
    assert orchestrator.mining_targets({"modules": ["fi_gl"], "dataset_path": "d", "parquet_path": "p"}) == \
        [("fi_gl", "d")]
    assert orchestrator.mining_targets({"modules": ["fi_gl"]}) == []
    assert orchestrator.mining_targets(None) == []


class _Session:
    def __init__(self, meta):
        self.meta = meta

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def execute(self, stmt, params=None):
        return _Result((self.meta,) if "FROM analysis_versions" in str(stmt) else None)


def _patch_db(monkeypatch, meta):
    monkeypatch.setattr(orchestrator, "get_sync_engine", lambda: object())
    monkeypatch.setattr(orchestrator, "Session", lambda engine: _Session(meta))


def test_run_mining_dispatches_house_rules_for_an_upload(monkeypatch):
    _patch_db(monkeypatch, {"modules": ["mm_purchasing"], "parquet_path": "staging/t/f.parquet"})
    sent = []

    class _Sig:
        def __init__(self, args):
            self.args = args

        def apply_async(self):
            sent.append(self.args)

    monkeypatch.setattr(orchestrator.run_house_rules, "s", lambda *a: _Sig(a))
    out = orchestrator.run_mining_for_version.run(str(TID), str(VID), modules=["mm_purchasing"], include=["house_rules"])
    assert out["dispatched"] == 1 and out["modules"] == 1 and "reason" not in out
    assert sent == [(str(VID), str(TID), "mm_purchasing", "staging/t/f.parquet")]


def test_run_mining_reports_no_modules_when_the_version_lacks_them(monkeypatch):
    _patch_db(monkeypatch, {"modules": ["mm_purchasing"], "parquet_path": "staging/t/f.parquet"})
    monkeypatch.setattr(orchestrator.run_house_rules, "s", lambda *a: pytest.fail("dispatched"))
    out = orchestrator.run_mining_for_version.run(str(TID), str(VID), modules=["fi_gl"], include=["house_rules"])
    assert out == {"dispatched": 0, "skipped": 0, "errors": 0, "reason": "no_modules"}
    _patch_db(monkeypatch, {"modules": ["mm_purchasing"]})
    out = orchestrator.run_mining_for_version.run(str(TID), str(VID), include=["house_rules"])
    assert out["reason"] == "no_modules" and out["dispatched"] == 0
