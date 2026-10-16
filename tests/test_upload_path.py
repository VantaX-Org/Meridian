"""POST /api/v1/upload records both storage keys on the version so a purge can
remove the raw file as well as the parquet (api/services/purge.py)."""

from __future__ import annotations

import uuid

from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.deps import Tenant, get_db, get_tenant
from api.routes import upload as routes

TENANT = uuid.uuid4()


class _Version:
    def __init__(self, metadata):
        self.id = uuid.uuid4()
        self.metadata = metadata


def test_upload_persists_the_raw_key_next_to_the_parquet(monkeypatch):
    monkeypatch.setenv("MERIDIAN_DEV_ROLE_HEADER", "1")
    stored: list[str] = []
    created: list[dict] = []
    monkeypatch.setattr(routes, "minio_upload", lambda bucket, name, data, ct: stored.append(name))
    monkeypatch.setattr("api.middleware.licence.enforce_licensed_modules", lambda request, modules: None)

    async def create_version(db, tenant_id, metadata, label=None):
        created.append(metadata)
        return _Version(metadata)

    monkeypatch.setattr("db.queries.versions.create_version", create_version)
    monkeypatch.setattr(routes.jobs, "start_job", lambda *a, **k: None)
    monkeypatch.setattr(routes, "update_task_progress", lambda *a, **k: None)

    class _Job:
        id = "job-1"

    monkeypatch.setattr("workers.tasks.run_checks.run_checks.delay", lambda *a, **k: _Job())

    app = FastAPI()
    app.include_router(routes.router)

    async def _db():
        yield None

    app.dependency_overrides[get_db] = _db
    app.dependency_overrides[get_tenant] = lambda: Tenant(TENANT, "Acme", ["business_partner"])
    c = TestClient(app)
    c.headers.update({"X-User-Role": "admin"})

    r = c.post("/api/v1/upload", data={"module": "business_partner"},
               files={"file": ("partners.csv", b"PARTNER,NAME_ORG1\n1,Acme\n", "text/csv")})
    assert r.status_code == 200, r.text

    meta = created[0]
    raw, parquet = meta["upload_path"], meta["parquet_path"]
    file_id = parquet.rsplit("/", 1)[1][: -len(".parquet")]
    assert raw == f"uploads/{TENANT}/{file_id}.csv"
    assert parquet == f"staging/{TENANT}/{file_id}.parquet"
    assert sorted(stored) == sorted([raw, parquet])


def test_purge_targets_cover_an_upload_without_the_new_key():
    """Versions uploaded before upload_path existed are still cleaned up by prefix."""
    from api.services.purge import _storage_targets

    class _S:
        def execute(self, stmt, params=None):
            class _R:
                def fetchall(self):
                    return []
            return _R()

    file_id = str(uuid.uuid4())
    t = _storage_targets(_S(), str(TENANT), str(uuid.uuid4()),
                         {"dataset_path": f"staging/{TENANT}/{file_id}.parquet"})
    assert any(prefix == f"uploads/{TENANT}/{file_id}." for _, prefix in t["prefixes"])
