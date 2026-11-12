"""Field lineage: table -> field -> check table -> owning object, with rules and glossary terms."""

import uuid

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.deps import Tenant, get_db, get_tenant
from api.routes import lineage as route
from api.services import field_lineage as fl
from sap.ddic import dictionary_for_system

D = dictionary_for_system("ecc")
RULES = {"KNA1.LAND1": (("SDC-001", "sd_customer_master"), ("SDC-002", "sd_customer_master")),
         "KNVV.KUNNR": (("SDC-010", "sd_customer_master"),)}


def _field(out, table, name):
    t = next(x for x in out["tables"] if x["table"] == table)
    return next(f for f in t["fields"] if f["field"] == name)


def test_check_table_owner_and_rules():
    glossary = [{"sap_table": "KNA1", "sap_field": "LAND1", "business_name": "Customer country"}]
    out = fl.field_lineage("sd_customer_master", "ecc", D, RULES, glossary)
    land = _field(out, "KNA1", "LAND1")
    assert land["in_dictionary"] and land["check_table"] == "T005"
    assert land["owner"] == fl.CONFIGURATION  # the country table is customizing, not master data
    assert land["rule_count"] == 2 and land["rule_ids"] == ["SDC-001", "SDC-002"]
    assert land["glossary_terms"] == ["Customer country"] and land["text"]
    kunnr = _field(out, "KNVV", "KUNNR")
    assert kunnr["check_table"] == "KNA1" and kunnr["owner"] == "sd_customer_master"
    tot = out["totals"]
    assert tot["tables"] == len(out["tables"]) and tot["fields_with_rules"] == 2
    assert tot["fields"] == sum(len(t["fields"]) for t in out["tables"])
    assert tot["foreign_keys"] >= 2 and out["release"] == D.release


def test_unknown_module_is_empty():
    out = fl.field_lineage("not_a_module", "ecc", D, {})
    assert out["tables"] == [] and out["totals"]["fields"] == 0


class _Res:
    def __init__(self, rows=()):
        self.rows = list(rows)

    def mappings(self):
        return self

    def all(self):
        return self.rows


class _DB:
    def __init__(self):
        self.calls = []

    async def execute(self, stmt, params=None):
        sql = str(stmt)
        self.calls.append((sql, params or {}))
        if "glossary_terms" in sql:
            return _Res([{"sap_table": "KNA1", "sap_field": "LAND1", "business_name": "Customer country"}])
        return _Res()


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("MERIDIAN_DEV_ROLE_HEADER", "1")
    monkeypatch.setattr(fl, "_rule_index", lambda: RULES)
    api = FastAPI()
    api.include_router(route.router)
    db = _DB()

    async def _db():
        yield db

    api.dependency_overrides[get_db] = _db
    api.dependency_overrides[get_tenant] = lambda: Tenant(uuid.uuid4(), "T", ["*"])
    c = TestClient(api)
    c.db = db
    return c


def test_field_lineage_route(client):
    r = client.get("/api/v1/lineage/fields", params={"module": "sd_customer_master"},
                   headers={"X-User-Role": "viewer"})
    assert r.status_code == 200, r.text
    land = _field(r.json(), "KNA1", "LAND1")
    assert land["glossary_terms"] == ["Customer country"] and land["rule_count"] == 2
    for sql, params in client.db.calls:
        if "set_config" not in sql:
            assert "tenant_id = :tid" in sql and params["tid"]


def test_field_lineage_route_validates(client):
    r = client.get("/api/v1/lineage/fields", params={"module": ""}, headers={"X-User-Role": "viewer"})
    assert r.status_code == 422
