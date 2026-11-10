"""Full stack without SAP: a synthetic material-master CSV goes in through POST /api/v1/upload, the real
check engine runs and scores it, and the result and ledger endpoints read it back through TestClient.

Object storage and the Celery broker are faked; the database, the routes, the dataset loader, the rule
engine and the scoring are the real ones. Runs with MERIDIAN_TEST_DB_URL; skipped otherwise.
"""

from __future__ import annotations

import io
import os
import uuid
from contextlib import ExitStack
from unittest.mock import MagicMock, patch

from tests.test_rbac_escalation_pg import owner, pytestmark  # noqa: F401  (fixture and skip marker)


class _Obj:
    def __init__(self, data: bytes) -> None:
        self._data = data

    def read(self) -> bytes:
        return self._data

    def close(self) -> None:
        pass

    def release_conn(self) -> None:
        pass


class _Store:
    """Stands in for MinIO on both sides: the upload route writes, the worker's dataset loader reads."""

    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}

    def put(self, bucket: str, name: str, data: bytes, content_type: str) -> None:
        self.objects[name] = data

    def get_object(self, bucket: str, name: str) -> _Obj:
        return _Obj(self.objects[name])

    def stat_object(self, bucket: str, name: str) -> object:
        if name not in self.objects:
            raise FileNotFoundError(name)
        return MagicMock(size=len(self.objects[name]))


def test_upload_check_score_and_read_back(owner, monkeypatch) -> None:  # noqa: F811
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    from sqlalchemy import text
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
    from sqlalchemy.pool import NullPool

    from api.deps import Tenant, get_db, get_tenant
    from api.routes import findings, upload, versions, work
    from tests.fixtures.realistic_sap_data import generate_realistic_material_master
    from workers.tasks import run_checks as mod

    tid = uuid.uuid4()
    with owner.begin() as c:
        c.execute(text("INSERT INTO tenants (id, name) VALUES (:t, 'Fullstack')"), {"t": str(tid)})

    store = _Store()
    queued: list[tuple[str, str, str]] = []
    monkeypatch.setenv("MERIDIAN_DEV_ROLE_HEADER", "1")
    monkeypatch.setattr(upload, "minio_upload", store.put)
    monkeypatch.setattr("api.middleware.licence.enforce_licensed_modules", lambda request, modules: None)
    monkeypatch.setattr(upload.jobs, "start_job", lambda *a, **k: None)
    monkeypatch.setattr(upload.jobs, "set_task_ids", lambda *a, **k: None)
    monkeypatch.setattr(upload, "update_task_progress", lambda *a, **k: None)
    monkeypatch.setattr(mod.run_checks, "delay", lambda *a: queued.append(a) or MagicMock(id="job-1"))

    aeng = create_async_engine(owner.url.set(drivername="postgresql+asyncpg"), poolclass=NullPool)
    factory = async_sessionmaker(aeng, expire_on_commit=False)

    async def _db():  # type: ignore[no-untyped-def]
        async with factory() as s:
            yield s

    app = FastAPI()
    for r in (upload.router, versions.router, findings.router, work.router):
        app.include_router(r)
    app.dependency_overrides[get_db] = _db
    app.dependency_overrides[get_tenant] = lambda: Tenant(tid, "Fullstack", ["material_master"])
    client = TestClient(app)
    client.headers.update({"X-User-Role": "admin"})

    # 1. upload
    buf = io.StringIO()
    generate_realistic_material_master(n=200, seed=7).to_csv(buf, index=False)
    r = client.post("/api/v1/upload", data={"module": "material_master"},
                    files={"file": ("materials.csv", buf.getvalue().encode(), "text/csv")})
    assert r.status_code == 200, r.text
    vid = r.json()["version_id"]
    assert r.json()["status"] == "pending"
    assert len(queued) == 1 and queued[0][0] == vid and queued[0][1] == str(tid)
    parquet_path = queued[0][2]
    assert parquet_path in store.objects  # the staged parquet the worker will read

    # 2. check engine and score, the worker task run in-process against the same database
    with ExitStack() as st:
        st.enter_context(patch("workers.dataset._client", return_value=store))
        st.enter_context(patch.object(mod, "get_sync_engine", return_value=owner))
        st.enter_context(patch.object(mod, "record_step"))
        st.enter_context(patch.object(mod, "update_task_progress"))
        st.enter_context(patch.object(mod, "_redis_client", return_value=None))
        st.enter_context(patch.object(mod.run_checks, "update_state", MagicMock()))
        st.enter_context(patch("checks.outliers.find", return_value={}))
        st.enter_context(patch("api.services.field_profiles.profile_and_store", return_value={}))
        st.enter_context(patch("checks.ztables.discover_ztable_rules", return_value=[]))
        st.enter_context(patch("checks.ddic_conformance.run_conformance", return_value=[]))
        st.enter_context(patch("celery.app.task.Task.apply_async", MagicMock()))
        st.enter_context(patch.dict(os.environ, {"SKIP_AGENTS": "1", "SKIP_AI_ENRICHMENT": "1"}))
        mod.run_checks.run(vid, str(tid), parquet_path)

    # 3. result: the version is complete and carries a material-master score
    r = client.get(f"/api/v1/versions/{vid}")
    assert r.status_code == 200, r.text
    v = r.json()
    assert v["status"] == "complete", v
    score = v["dqs_summary"]["material_master"]["composite_score"]
    assert score is not None and 0 <= score <= 100

    # 4. findings the engine raised for the upload
    r = client.get("/api/v1/findings", params={"version_id": vid})
    assert r.status_code == 200, r.text
    body = r.json()
    rows = body if isinstance(body, list) else body.get("findings") or body.get("items") or []
    assert rows and {f["module"] for f in rows} == {"material_master"}

    # 5. ledger: the failing records are open work for the run
    r = client.get("/api/v1/work/records", params={"version_id": vid, "module": "material_master"})
    assert r.status_code == 200, r.text
    led = r.json()
    items = led if isinstance(led, list) else led.get("records") or led.get("items") or []
    assert items, led
    r = client.get("/api/v1/work/summary", params={"version_id": vid, "module": "material_master"})
    assert r.status_code == 200, r.text
