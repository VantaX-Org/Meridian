"""The shared DDIC value check, the DQ firewall's live check tables and the cleansing queue's auto-fix safety proof."""
import runpy
import uuid

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.deps import Tenant, get_db, get_tenant
from api.routes import cleaning as route
from api.services import ddic_value_check as dvc
from api.services import dq_firewall as fw
from sap.ddic import get_dictionary

D = get_dictionary("ecc6")


def test_self_check():
    runpy.run_module("api.services.ddic_value_check", run_name="__main__")


def test_evidence_names_the_dictionary_and_the_source():
    r = dvc.check_value(D, "MARA.MTART", "FERX", {}, dvc.baseline_values("ecc"))
    assert r["verdict"] == "reject" and r["check_table"] == "T134" and r["source"] == "baseline"
    assert r["data_element"] and r["domain"] and r["type"] == "CHAR" and r["length"] == 4
    assert {"check": "check_table", "verdict": "fail", "reason": "not in check table T134 (baseline)"} in r["checks"]
    assert r["nearest"][0]["code"] == "FERT"
    # live configuration is read before the baseline, and an empty value is never checked against it
    assert dvc.check_value(D, "MARA.MTART", "ZFRT", {"T134.MTART": {"ZFRT": None}}, {})["verdict"] == "safe"
    assert dvc.check_value(D, "MARA.MTART", "", {"T134.MTART": {"ZFRT": None}}, {})["verdict"] == "safe"


def test_nearest_is_deterministic():
    codes = {c: None for c in ("FERT", "HALB", "ROH", "HAWA", "FERX2", "VERP")}
    assert dvc._nearest("FERX", codes) == dvc._nearest("FERX", dict(reversed(list(codes.items()))))


def test_firewall_judges_check_tables_against_live_configuration():
    live = {"T134.MTART": {"FERT": "Finished product", "ZFRT": "Own type"}}
    bad = fw.validate("t", "material_master", [{"MARA.MATNR": "ABC", "MARA.MTART": "FERX"}], overrides={},
                      extra_rules=[], live=live)["records"][0]["failures"]
    f = next(x for x in bad if x["rule_id"] == "MM140")
    assert f["ddic"]["source"] == "live" and f["ddic"]["verdict"] == "reject"
    assert [n["code"] for n in f["ddic"]["nearest"]][:1] == ["FERT"]
    ok = fw.validate("t", "material_master", [{"MARA.MATNR": "ABC", "MARA.MTART": "ZFRT"}], overrides={},
                     extra_rules=[], live=live)["records"][0]["failures"]
    assert not [x for x in ok if x["field"] == "MARA.MTART"]


def test_resolve_field_from_bare_keys():
    assert route.resolve_field("MARA.MEINS", None, None, None) == "MARA.MEINS"
    assert route.resolve_field("meins", "MARA.MEINS", None, "material_master") == "MARA.MEINS"
    assert route.resolve_field("GEWEI", None, None, "material_master") == "MARA.GEWEI"


class _Result:
    def __init__(self, rows):
        self.rows = rows

    def mappings(self):
        return self

    def all(self):
        return self.rows

    def first(self):
        return self.rows[0] if self.rows else None


class _DB:
    def __init__(self, queue):
        self.queue, self.sql = queue, []

    async def execute(self, stmt, params=None):
        s = str(stmt)
        self.sql.append((s, params))
        if "FROM cleaning_queue" in s:
            return _Result(self.queue)
        return _Result([])  # no SAP system: baseline only


@pytest.fixture(autouse=True)
def _dev_roles(monkeypatch):
    monkeypatch.setenv("MERIDIAN_DEV_ROLE_HEADER", "1")


def test_safety_route_marks_each_after_value():
    queue = [
        {"id": "a", "record_key": "M-1", "object_type": "material_master", "field": "MARA.MEINS", "check_id": None,
         "record_data_after": {"MEINS": "EA"}, "version_id": None},
        {"id": "b", "record_key": "M-2", "object_type": "material_master", "field": None, "check_id": None,
         "record_data_after": {"MARA.MATKL": "X" * 10, "suggested_action": "trim"}, "version_id": None},
        {"id": "c", "record_key": "M-3", "object_type": "material_master", "field": None, "check_id": None,
         "record_data_after": {"MARA.MTART": "FERX"}, "version_id": None},
    ]
    api = FastAPI()
    api.include_router(route.router)
    db = _DB(queue)

    async def _db():
        yield db

    api.dependency_overrides[get_db] = _db
    api.dependency_overrides[get_tenant] = lambda: Tenant(uuid.uuid4(), "T", ["*"])
    r = TestClient(api).get("/api/v1/cleaning/queue/safety", headers={"X-User-Role": "viewer"})
    assert r.status_code == 200, r.text
    body = r.json()
    by = {i["id"]: i for i in body["items"]}
    assert by["a"]["verdict"] == "safe" and by["a"]["field"] == "MARA.MEINS"
    assert by["b"]["verdict"] == "reject" and by["b"]["reasons"][0].startswith("too long for CHAR 9")
    assert by["c"]["evidence"]["source"] == "baseline" and by["c"]["evidence"]["nearest"][0]["code"] == "FERT"
    assert body["totals"] == {"checked": 3, "safe": 1, "reject": 2, "unknown": 0} and not body["truncated"]
    assert all("tenant_id = :tid" in s for s, _ in db.sql if "FROM" in s)
