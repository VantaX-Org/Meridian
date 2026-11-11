"""Load simulation: Migration-Cockpit-style messages from DDIC, check-table misses as failures, route totals."""

import uuid
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.deps import Tenant, get_db, get_tenant
from api.routes import migration as route
from api.services.migration import load_simulation as ls
from sap.ddic import get_dictionary

S4 = get_dictionary("s4hana")


def test_check_table_misses_of_any_severity_fail_the_load():
    assert ls.would_fail("check_table_value", "medium")
    assert ls.would_fail("check_table_value", "low")
    assert ls.would_fail("length_truncation", "high")
    assert not ls.would_fail("case_change", "low")
    assert not ls.would_fail("target_config_unverified", "medium")


def test_split_field_handles_engine_and_s4_load_shapes():
    assert ls.split_field("MARA", "MARA.MTART") == ("MARA", "MTART")
    assert ls.split_field("MARA", "matnr") == ("MARA", "MATNR")
    assert ls.split_field("KNA1", "KNA1.KUNNR") == ("KNA1", "KUNNR")


def test_messages_are_built_from_the_dictionary():
    mtart = S4.field("MARA", "MTART")
    assert ls.message("check_table_value", "MARA", "MTART", mtart, "ZROH", 2) == \
        "Value 'ZROH' not allowed for field MARA-MTART (check table T134) (+2 more values)"
    maktx = S4.field("MAKT", "MAKTX")
    assert ls.message("length_truncation", "MAKT", "MAKTX", maktx) == f"Field MAKT-MAKTX too long: CHAR {maktx.length}"
    assert ls.message("target_mandatory", "MARA", "MEINS", S4.field("MARA", "MEINS")) == \
        "Required entry missing for field MARA-MEINS"
    assert ls.message("s4_load", "MARA", "MATNR", None, detail="S4L-X reason") == "S4L-X reason"


def _groups():
    return [
        {"module": "material_master", "dest_table": "MARA", "gap_type": "check_table_value", "field": "MARA.MTART",
         "rule": "", "records": 3, "findings": 3, "sev_rank": 2, "all_baseline": True,
         "detail": "value not configured in the SAP standard baseline's T134", "samples": ["M1", "M2", "M3"]},
        {"module": "material_master", "dest_table": "MAKT", "gap_type": "length_truncation", "field": "MAKT.MAKTX",
         "rule": "", "records": 2, "findings": 2, "sev_rank": 1, "all_baseline": False, "detail": "", "samples": ["M4", None, "M5"]},
        {"module": "material_master", "dest_table": "MARA", "gap_type": "obsolete_target", "field": "MARA.ZZOLD",
         "rule": "", "records": 0, "findings": 1, "sev_rank": 0, "all_baseline": False, "detail": "", "samples": None},
    ]


def _values():
    return [{"module": "material_master", "dest_table": "MARA", "gap_type": "check_table_value", "field": "MARA.MTART",
             "value": "ZROH", "records": 2},
            {"module": "material_master", "dest_table": "MARA", "gap_type": "check_table_value", "field": "MARA.MTART",
             "value": "ZFRT", "records": 1}]


def test_build_groups_totals_and_config_to_transport():
    rep = ls.build(_groups(), _values(), [{"module": "material_master", "failing": 5, "provisional": 3}],
                   {"material_master": 100}, ["material_master", "business_partner"], S4,
                   {"material_master": "Material master"})
    mm, bp = rep["objects"]
    assert (mm["records"], mm["would_fail"], mm["would_load"], mm["provisional"]) == (100, 5, 95, 3)
    assert bp["would_fail"] == 0 and bp["records"] == 0
    ct = next(g for g in rep["groups"] if g["gap_type"] == "check_table_value")
    assert ct["provisional"] and ct["check_table"] == "T134" and ct["field_text"] == "Material type"
    assert ct["message"].startswith("Value 'ZROH' not allowed for field MARA-MTART (check table T134)")
    assert [v["value"] for v in ct["values"]] == ["ZROH", "ZFRT"]
    assert rep["groups"][0]["structural"] and rep["groups"][0]["gap_type"] == "obsolete_target"
    trunc = next(g for g in rep["groups"] if g["gap_type"] == "length_truncation")
    assert trunc["samples"] == ["M4", "M5"] and not trunc["provisional"]
    assert rep["transports"] == [{
        "module": "material_master", "check_table": "T134", "check_table_text": S4.table("T134").description,
        "field": "MARA-MTART", "field_text": "Material type", "provisional": True, "records": 3,
        "values": [{"value": "ZROH", "records": 2}, {"value": "ZFRT", "records": 1}]}]
    assert rep["totals"] == {"records": 100, "would_load": 95, "would_fail": 5, "provisional": 3}


class _Result:
    def __init__(self, rows):
        self.rows = rows

    def fetchone(self):
        return self.rows[0] if self.rows else None

    def fetchall(self):
        return self.rows


def _r(d):
    return SimpleNamespace(_mapping=d, **d)


class _DB:
    def __init__(self, run):
        self.run, self.sql = run, []

    async def execute(self, stmt, params=None):
        q = str(stmt)
        self.sql.append((q, params))
        if "FROM migration_runs" in q:
            return _Result([self.run] if self.run else [])
        if "split_part" in q:
            return _Result([_r(g) for g in _groups()])
        if "AS value" in q:
            return _Result([_r(v) for v in _values()])
        if "AS firm" in q:
            return _Result([_r({"module": "material_master", "failing": 5, "provisional": 3})])
        return _Result([])


def _client(run):
    api = FastAPI()
    api.include_router(route.router)
    db = _DB(run)

    async def _db():
        yield db

    api.dependency_overrides[get_db] = _db
    api.dependency_overrides[get_tenant] = lambda: Tenant(uuid.uuid4(), "T", ["*"])
    return TestClient(api), db


@pytest.fixture(autouse=True)
def _dev_roles(monkeypatch):
    monkeypatch.setenv("MERIDIAN_DEV_ROLE_HEADER", "1")


def test_route_reports_would_fail_and_scopes_every_query_to_the_tenant():
    rid = uuid.uuid4()
    run = SimpleNamespace(id=rid, modules=["material_master"], gap_summary={"material_master": {"records": 100}},
                          dest_system_id=None, target_release="s4hana")
    client, db = _client(run)
    r = client.get(f"/api/v1/migration/runs/{rid}/load-simulation", headers={"X-User-Role": "viewer"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["totals"]["would_fail"] == 5 and body["objects"][0]["would_load"] == 95
    assert body["transports"][0]["check_table"] == "T134" and not body["target_connected"]
    for q, params in db.sql:
        if "migration_" in q:
            assert "tenant_id = :t" in q and params["t"]


def test_route_404_for_unknown_run():
    client, _ = _client(None)
    r = client.get(f"/api/v1/migration/runs/{uuid.uuid4()}/load-simulation", headers={"X-User-Role": "viewer"})
    assert r.status_code == 404
