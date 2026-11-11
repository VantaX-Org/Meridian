"""Survivorship what-if: diff of golden values plus DDIC checks of the new values."""

import uuid
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.deps import Tenant, get_db, get_tenant
from api.routes import survivorship_rules as route
from api.services import survivorship_preview as sp
from sap.ddic import dictionary_for_system

D = dictionary_for_system("ecc")
TABLES = sp.domain_tables("business_partner", "ecc")
OLD = datetime(2026, 1, 1, tzinfo=timezone.utc)
NEW = datetime(2026, 6, 1, tzinfo=timezone.utc)


def _cluster(head_fields, member_fields, golden=None, overrides=None):
    return {"golden_id": "g1", "key": "BP1", "golden": golden if golden is not None else dict(head_fields),
            "overrides": overrides or {},
            "members": [{"key": "BP1", "fields": head_fields, "extracted_at": OLD, "systems": {}},
                        {"key": "BP2", "fields": member_fields, "extracted_at": NEW, "systems": {}}]}


def test_resolve_attribute_names():
    assert sp.resolve_attribute("NAME_ORG1", TABLES, D)[0] == "BUT000"
    assert sp.resolve_attribute("ADRC.COUNTRY", TABLES, D)[1].check_table == "T005"
    assert sp.resolve_attribute("BUT000_TYPE", TABLES, D)[1].length == 1
    assert sp.resolve_attribute("NOT_A_FIELD_XYZ", TABLES, D) is None
    assert sp.resolve_attribute("MARA-MEINS", [], D)[1].check_table == "T006"  # golden attributes use TABLE-FIELD


def test_no_rule_change_means_no_diff():
    out = sp.preview([_cluster({"NAME_ORG1": "Acme"}, {"NAME_ORG1": "Acme Ltd"})], {}, D, TABLES, {})
    assert out["records_changed"] == 0 and out["attributes"] == [] and out["clusters_scanned"] == 1


def test_most_recent_rule_changes_golden_and_checks_ddic():
    head = {"NAME_ORG1": "Acme", "TYPE": "2", "BPKIND": "0001"}
    member = {"NAME_ORG1": "Acme Holdings", "TYPE": "9", "BPKIND": "ZZZZ"}
    rules = {f: {"rule_type": "most_recent"} for f in head}
    sets = sp.value_sets([("TB004", [{"BPKIND": "0001"}, {"BPKIND": "0002"}])])
    out = sp.preview([_cluster(head, member)], rules, D, TABLES, sets)
    assert out["records_changed"] == 1 and out["values_changed"] == 3
    by = {a["field"]: a for a in out["attributes"]}
    assert by["NAME_ORG1"]["invalid"] == 0 and by["NAME_ORG1"]["text"] == "Name 1 of organization"
    assert by["TYPE"]["invalid_reasons"] == {"fixed_values": 1}  # 9 is not a business partner category
    assert by["BPKIND"]["check_table"] == "TB004" and by["BPKIND"]["invalid_reasons"] == {"check_table": 1}
    assert by["BPKIND"]["check_status"] == "checked"
    s = next(x for x in out["samples"] if x["field"] == "NAME_ORG1")
    assert (s["before"], s["winner_key"]) == ("A\u2022\u2022\u2022", "BP2")  # a name is masked in samples
    s = next(x for x in out["samples"] if x["field"] == "TYPE")
    assert (s["before"], s["after"], s["rule"]) == ("2", "9", "most_recent")
    assert out["invalid_values"] == 2


def test_length_and_unknown_value_set():
    long_name = "X" * 41
    rules = {"NAME_ORG1": {"rule_type": "most_recent"}, "COUNTRY": {"rule_type": "most_recent"}}
    out = sp.preview([_cluster({"NAME_ORG1": "A", "COUNTRY": "DE"}, {"NAME_ORG1": long_name, "COUNTRY": "QQ"})],
                     rules, D, TABLES, {})
    by = {a["field"]: a for a in out["attributes"]}
    assert by["NAME_ORG1"]["invalid_reasons"] == {"length": 1}
    assert by["COUNTRY"]["check_status"] == "unknown" and by["COUNTRY"]["invalid"] == 0  # never guessed


def test_steward_override_is_kept():
    c = _cluster({"NAME_ORG1": "Acme"}, {"NAME_ORG1": "Acme Holdings"}, overrides={"NAME_ORG1": "Acme"})
    out = sp.preview([c], {"NAME_ORG1": {"rule_type": "most_recent"}}, D, TABLES, {})
    assert out["records_changed"] == 0


def _row(id_, key, fields, merged_into=None, created=OLD):
    return SimpleNamespace(id=id_, domain="business_partner", sap_object_key=key, golden_fields=dict(fields),
                           source_contributions={}, own_fields=dict(fields), steward_overrides={},
                           merged_into=merged_into, status="active", created_at=created, own_contributions={})


class _Res:
    def __init__(self, rows=(), scalar=None):
        self.rows, self._scalar = list(rows), scalar

    def fetchall(self):
        return self.rows

    def scalar(self):
        return self._scalar


class _DB:
    def __init__(self):
        self.calls = []
        self.head_id = uuid.uuid4()

    async def execute(self, stmt, params=None):
        sql = str(stmt)
        self.calls.append((sql, params or {}))
        if "set_config" in sql:
            return _Res()
        if "FROM sap_systems" in sql:
            return _Res([])
        if "count(*)" in sql:
            return _Res(scalar=1)
        if "FROM master_records h" in sql:
            return _Res([_row(self.head_id, "BP1", {"NAME_ORG1": "Acme", "TYPE": "2"})])
        if "FROM master_records" in sql:
            return _Res([_row(uuid.uuid4(), "BP2", {"NAME_ORG1": "Acme Holdings", "TYPE": "7"},
                              merged_into=self.head_id, created=NEW)])
        if "FROM config_snapshots" in sql:
            return _Res([])
        raise AssertionError(sql)


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("MERIDIAN_DEV_ROLE_HEADER", "1")
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


def test_preview_route(client):
    body = {"domain": "business_partner",
            "rules": [{"field": "NAME_ORG1", "rule_type": "most_recent"},
                      {"field": "TYPE", "rule_type": "most_recent"},
                      {"field": "BU_SORT1", "rule_type": "most_recent", "active": False}]}
    r = client.post("/api/v1/survivorship-rules/preview", json=body, headers={"X-User-Role": "viewer"})
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["clusters_total"] == 1 and out["clusters_scanned"] == 1 and out["capped"] is False
    assert out["cap"] == route.PREVIEW_CAP and out["records_changed"] == 1
    assert out["value_set_source"] == "baseline"
    by = {a["field"]: a for a in out["attributes"]}
    assert by["TYPE"]["invalid"] == 1 and by["NAME_ORG1"]["invalid"] == 0
    for sql, params in client.db.calls:
        if "set_config" not in sql:
            assert "tenant_id = :tid" in sql and params["tid"]
    assert all("FOR UPDATE" not in sql for sql, _ in client.db.calls)  # read only, no row locks


def test_preview_route_validates(client):
    r = client.post("/api/v1/survivorship-rules/preview", json={"domain": "", "rules": []},
                    headers={"X-User-Role": "viewer"})
    assert r.status_code == 422
