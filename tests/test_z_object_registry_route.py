"""GET /z-objects/registry on rows the real worker wrote: JSONB comes back from asyncpg
already decoded, and optional columns may be null. Neither may turn into a 500."""

import uuid

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.deps import Tenant, get_db, get_tenant
from api.routes import z_object_intelligence
from api.services.z_object_intelligence.persistence import _jsonb


class _Res:
    def __init__(self, rows):
        self.rows = rows

    def fetchall(self):
        return self.rows

    def first(self):
        return self.rows[0] if self.rows else None


class _Db:
    def __init__(self, rows):
        self.rows, self.sql = rows, []

    async def execute(self, stmt, params=None):
        self.sql.append(str(stmt))
        return _Res(self.rows if "FROM z_object_registry" in str(stmt) else [])


def _client(rows) -> TestClient:
    app = FastAPI()
    app.include_router(z_object_intelligence.router)
    db = _Db(rows)

    async def _db():
        yield db

    app.dependency_overrides[get_db] = _db
    app.dependency_overrides[get_tenant] = lambda: Tenant(uuid.uuid4(), "T", [])
    return TestClient(app)


@pytest.fixture(autouse=True)
def _dev_roles(monkeypatch):
    monkeypatch.setenv("MERIDIAN_DEV_ROLE_HEADER", "1")


H = {"X-User-Role": "admin"}

# id, category, module, object_name, standard_equivalent, description, owner, created_date,
# last_active_date, status, transaction_count_total, profile_snapshot, baseline_snapshot, rules_applied, notes
DECODED = (uuid.uuid4(), "z_table", "mm", "ZMM_PRICES", None, None, None, None, None, None, None,
           {"data_type": "numeric", "cardinality": 12}, None, [], None)
TEXT = (uuid.uuid4(), "z_field", "sd", "ZZ_REGION", "REGIO", "Sales region", "steward", "2026-01-01",
        "2026-02-01", "approved", 40, '{"data_type": "text"}', '{"a": 1}', '["R1"]', "n")
BLANK = (uuid.uuid4(), None, None, "ZZ_UNKNOWN", None, None, None, None, None, None, None, None, None, None, None)


def test_jsonb_accepts_decoded_text_and_null():
    assert _jsonb({"a": 1}, None) == {"a": 1}
    assert _jsonb('{"a": 1}', None) == {"a": 1}
    assert _jsonb(None, []) == []
    assert _jsonb("not json", []) == []


def test_registry_lists_rows_with_decoded_jsonb_and_nulls():
    r = _client([DECODED, TEXT, BLANK]).get("/api/v1/z-objects/registry", headers=H)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["total"] == 3 and len(body["entries"]) == 3
    by = {e["object_name"]: e for e in body["entries"]}
    assert by["ZMM_PRICES"]["profile_snapshot"] == {"data_type": "numeric", "cardinality": 12}
    assert by["ZMM_PRICES"]["status"] == "under_review" and by["ZMM_PRICES"]["transaction_count_total"] == 0
    assert by["ZZ_REGION"]["rules_applied"] == ["R1"] and by["ZZ_REGION"]["baseline_snapshot"] == {"a": 1}
    assert by["ZZ_UNKNOWN"]["category"] is None and by["ZZ_UNKNOWN"]["rules_applied"] == []


def test_registry_entry_detail_tolerates_decoded_jsonb():
    r = _client([DECODED]).get(f"/api/v1/z-objects/registry/{DECODED[0]}", headers=H)
    assert r.status_code == 200, r.text
    assert r.json()["profile_snapshot"]["cardinality"] == 12
