"""Quality thresholds per dimension and module (GET/PUT/DELETE /api/v1/settings/quality-thresholds), banding, and
the change request data collection form (GET /api/v1/change-requests/form/{object}). No database: a fake session
records the SQL and answers with canned rows."""

import uuid

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.deps import Tenant, get_db, get_tenant
from api.routes.change_requests import router as cr_router
from api.routes.settings import router as settings_router
from api.services import change_requests as crs
from api.services.scoring import THRESHOLD_DIMENSIONS, band, resolve_thresholds
from sap.ddic import get_dictionary

TENANT = Tenant(uuid.uuid4(), "D", [])


class _Result:
    def __init__(self, rows):
        self._rows = rows

    def mappings(self):
        return self

    def all(self):
        return self._rows

    def first(self):
        return self._rows[0] if self._rows else None

    def fetchone(self):
        return self.first()

    def fetchall(self):
        return self._rows

    def scalar(self):
        return None


class _DB:
    def __init__(self, rows=()):
        self.rows, self.sql, self.committed = list(rows), [], False

    async def execute(self, stmt, params=None):
        self.sql.append((str(stmt), params or {}))
        return _Result(self.rows if "FROM quality_thresholds" in str(stmt) else [])

    async def commit(self):
        self.committed = True


def _client(db, router):
    api = FastAPI()
    api.include_router(router)

    async def _db():
        yield db

    api.dependency_overrides[get_db] = _db
    api.dependency_overrides[get_tenant] = lambda: TENANT
    return TestClient(api)


@pytest.fixture(autouse=True)
def _dev_roles(monkeypatch):
    monkeypatch.setenv("MERIDIAN_DEV_ROLE_HEADER", "1")


BODY = {"module": "material_master", "dimension": "completeness", "target": 95, "warning": 85, "critical": 70}


def test_band_edges():
    t = {"target": 90, "warning": 75, "critical": 60}
    assert [band(s, t) for s in (90, 89.9, 75, 60, 59.9)] == ["pass", "warn", "warn", "fail", "critical"]
    assert band(None, t) is None


def test_resolution_module_then_tenant_then_fallback():
    rows = [{"module": "*", "dimension": "accuracy", "target": 80, "warning": 70, "critical": 50},
            {"module": "material_master", "dimension": "accuracy", "target": 97, "warning": 90, "critical": 80}]
    fb = {"target": 88, "warning": 77, "critical": 66}
    mm = resolve_thresholds(rows, "material_master", fb)
    other = resolve_thresholds(rows, "sd_customer_master", fb)
    assert set(mm) == set(THRESHOLD_DIMENSIONS)
    assert mm["accuracy"]["target"] == 97 and other["accuracy"]["target"] == 80
    assert mm["validity"] == {"target": 88.0, "warning": 77.0, "critical": 66.0}


def test_viewer_cannot_change_thresholds():
    db = _DB()
    c = _client(db, settings_router)
    assert c.put("/api/v1/settings/quality-thresholds", json=BODY, headers={"X-User-Role": "viewer"}).status_code == 403
    assert c.delete("/api/v1/settings/quality-thresholds", params={"module": "*", "dimension": "overall"},
                    headers={"X-User-Role": "viewer"}).status_code == 403
    assert not any("INSERT INTO quality_thresholds" in s for s, _ in db.sql)


def test_viewer_reads_thresholds_with_tenant_filter():
    db = _DB([{"module": "material_master", "dimension": "overall", "target": 92, "warning": 80, "critical": 65}])
    r = _client(db, settings_router).get("/api/v1/settings/quality-thresholds", headers={"X-User-Role": "viewer"})
    assert r.status_code == 200
    body = r.json()
    assert body["modules"]["material_master"]["overall"]["target"] == 92
    assert body["tenant"]["overall"] == body["fallback"]
    q = next(p for s, p in db.sql if "FROM quality_thresholds" in s)
    assert q["tid"] == str(TENANT.id)


@pytest.mark.parametrize("bad", [
    {**BODY, "warning": 96},              # warning above target
    {**BODY, "critical": 90},             # critical above warning
    {**BODY, "target": 101},              # out of range
    {**BODY, "dimension": "beauty"},      # not a DQS dimension
    {**BODY, "module": "Material Master"},
])
def test_invalid_thresholds_rejected(bad):
    db = _DB()
    r = _client(db, settings_router).put("/api/v1/settings/quality-thresholds", json=bad,
                                         headers={"X-User-Role": "admin"})
    assert r.status_code == 422
    assert not db.committed


def test_admin_sets_threshold_and_it_is_audited():
    db = _DB()
    r = _client(db, settings_router).put("/api/v1/settings/quality-thresholds", json=BODY,
                                         headers={"X-User-Role": "admin"})
    assert r.status_code == 200 and db.committed
    ins = next(p for s, p in db.sql if "INSERT INTO quality_thresholds" in s)
    assert ins["tid"] == str(TENANT.id) and ins["d"] == "completeness" and ins["t"] == 95
    assert any("INSERT INTO audit_log" in s for s, _ in db.sql)


def test_form_fields_are_dictionary_fields_of_the_object():
    d = get_dictionary("ecc")
    for obj in crs.OBJECT_TABLES:
        fields = crs.form_fields(obj)
        assert fields, obj
        for f in fields:
            assert f["table"] in crs.OBJECT_TABLES[obj]
            assert d.field(f["table"], f["name"]) is not None, f["field"]  # never invented
    material = {f["field"]: f for f in crs.form_fields("material")}
    assert {"MARA.MTART", "MARA.MBRSH", "MARA.MEINS", "MAKT.MAKTX"} <= {k for k, f in material.items() if f["required"]}
    assert material["MARA.ATTYP"]["values_source"] == "domain" and material["MARA.ATTYP"]["values"]
    assert material["MARA.MBRSH"]["values_source"] == "rule" and material["MARA.MBRSH"]["values"]


def test_form_uses_live_check_table_values():
    plant = next(f for f in crs.form_fields("material") if f["field"] == "MARC.WERKS")
    ref = get_dictionary("ecc").field("MARC", "WERKS").check_ref
    live = crs.form_fields("material", {ref: {"P100", "P200"}})
    werks = next(f for f in live if f["field"] == "MARC.WERKS")
    assert werks["values_source"] == "check_table" and [v["value"] for v in werks["values"]] == ["P100", "P200"]
    assert plant["check_table"] == "T001W"


def test_form_route_reads_config_for_the_tenant_and_system():
    db = _DB()
    sid = uuid.uuid4()
    r = _client(db, cr_router).get(f"/api/v1/change-requests/form/material?system_id={sid}",
                                   headers={"X-User-Role": "viewer"})
    assert r.status_code == 200 and r.json()["key_field"] == "MARA.MATNR"
    q = next(p for s, p in db.sql if "FROM config_snapshots" in s)
    assert q["t"] == str(TENANT.id) and q["s"] == str(sid)


def test_form_route_rejects_unknown_object():
    assert _client(_DB(), cr_router).get("/api/v1/change-requests/form/spaceship",
                                         headers={"X-User-Role": "viewer"}).status_code == 422


def test_creating_a_request_needs_mdm_write():
    r = _client(_DB(), cr_router).post("/api/v1/change-requests", json={"kind": "create", "object": "material"},
                                       headers={"X-User-Role": "viewer"})
    assert r.status_code == 403
