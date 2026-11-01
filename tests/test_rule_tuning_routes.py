"""GET /rule-tuning and POST /rule-tuning/{id}/draft (api/routes/rules.py, checks/self_tune.py)."""

import json
import uuid

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.deps import Tenant, get_db, get_tenant
from api.routes import rules
from checks import lifecycle

RULE = {"id": "MM142", "module": "material_master", "check_class": "null_check", "field": "MARC.DISMM",
        "grain": "MARC", "severity": "high", "message": "MRP type missing"}
ISSUES = ([("MM142", f"MATNR={i}|WERKS=1000", "false_positive") for i in range(8)]
          + [("MM142", f"MATNR={i}|WERKS=2000", "real") for i in range(20)])


class _Result:
    def __init__(self, rows):
        self.rows = rows

    def all(self):
        return self.rows

    def mappings(self):
        return self

    def one(self):
        return self.rows[0]


class _DB:
    def __init__(self, versions):
        self.versions = versions
        self.statements: list[tuple[str, dict]] = []
        self.committed = False

    async def execute(self, stmt, params=None):
        sql = str(stmt)
        self.statements.append((sql, params or {}))
        if "FROM record_issues" in sql:
            return _Result(ISSUES)
        if "INSERT INTO rule_versions" in sql:
            return _Result([{"rule_id": params["r"], "version": 1, "state": "draft", "created_by": params["u"],
                             "body": json.loads(params["b"]), "note": params["n"]}])
        if "FROM rule_versions" in sql:
            return _Result(self.versions)
        return _Result([])

    async def commit(self):
        self.committed = True


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    monkeypatch.setenv("MERIDIAN_DEV_ROLE_HEADER", "1")
    monkeypatch.setattr(lifecycle, "shipped_rules", lambda: {"MM142": (RULE, "ecc/material_master.yaml")})


def _client(versions=()) -> tuple[TestClient, _DB]:
    api = FastAPI()
    api.include_router(rules.router)
    db = _DB(list(versions))

    async def _db():
        yield db

    api.dependency_overrides[get_db] = _db
    api.dependency_overrides[get_tenant] = lambda: Tenant(uuid.uuid4(), "D", [])
    return TestClient(api), db


ADMIN = {"X-User-Role": "admin"}


def test_lists_proposals_under_rls():
    client, db = _client([("MM142", 1, "active", {"applies_when": {"MARC.WERKS": {"populated": True}}})])
    r = client.get("/api/v1/rule-tuning", headers={"X-User-Role": "viewer"})
    assert r.status_code == 200
    [p] = r.json()["proposals"]
    assert p["rule_id"] == "MM142" and p["message"] == "MRP type missing" and p["pending"] is None
    assert p["exclusions"][0]["column"] == "MARC.WERKS" and p["exclusions"][0]["value"] == "1000"
    assert "+    not_in:" in p["diff"] and "-  severity" not in p["diff"]
    assert db.statements[0][0].startswith("SET app.tenant_id")


def test_draft_inserts_a_self_tune_version():
    client, db = _client([("MM142", 1, "active", {"applies_when": {"MARC.WERKS": {"populated": True}}})])
    r = client.post("/api/v1/rule-tuning/MM142/draft", headers=ADMIN)
    assert r.status_code == 201 and r.json()["created_by"] == "self-tune"
    assert r.json()["body"]["applies_when"]["MARC.WERKS"] == {"populated": True, "not_in": ["1000"]}
    assert "8 false positives removed" in r.json()["note"] and db.committed


def test_pending_version_is_shown_and_blocks_a_second_draft():
    versions = [("MM142", 1, "active", {"applies_when": {"MARC.WERKS": {"populated": True}}}),
                ("MM142", 2, "in_review", {})]
    client, db = _client(versions)
    assert client.get("/api/v1/rule-tuning", headers=ADMIN).json()["proposals"][0]["pending"] == {
        "version": 2, "state": "in_review"}
    r = client.post("/api/v1/rule-tuning/MM142/draft", headers=ADMIN)
    assert r.status_code == 409 and not db.committed


def test_no_proposal_is_404_and_viewer_cannot_draft():
    client, _ = _client()  # the shipped rule names no WERKS column and precision is above the downgrade floor
    assert client.post("/api/v1/rule-tuning/MM142/draft", headers=ADMIN).status_code == 404
    assert client.post("/api/v1/rule-tuning/MM142/draft", headers={"X-User-Role": "viewer"}).status_code == 403
