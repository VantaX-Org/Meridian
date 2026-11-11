"""Reference data usage: orphan values, unused codes and covered share from stored field profiles."""
import uuid

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.deps import Tenant, get_db, get_tenant
from api.routes import reference_data as route
from api.services import reference_data as rd

CODES = [{"code": "001", "text": "A"}, {"code": "002", "text": "B"}, {"code": "910", "text": "C"}]


def _st(values, blank=0, distinct=None, **kw):
    tv = [{"value": v, "count": c} for v, c in values.items()]
    return {"rows": sum(values.values()) + blank, "blank": blank,
            "distinct": distinct if distinct is not None else len(tv), "masked": False, "top_values": tv, **kw}


def test_usage_exhaustive_profile_is_exact():
    u = rd.usage(CODES, {"MARA.MATKL": _st({"001": 70, "002": 20, "ZZZ": 10}, blank=5)})
    assert u["orphans"] == [{"value": "ZZZ", "count": 10, "fields": ["MARA.MATKL"]}]
    assert u["unused"] == ["910"] and u["unused_certain"] and u["orphans_complete"]
    assert u["filled"] == 100 and u["covered"] == 90 and u["covered_share"] == 0.9 and not u["covered_at_least"]


def test_usage_truncated_profile_gives_lower_bounds():
    u = rd.usage(CODES, {"MARA.MATKL": _st({"001": 50, "ZZZ": 10}, blank=0, distinct=40)})
    f = u["fields"][0]
    assert f["truncated"] and u["covered_at_least"] and not u["unused_certain"] and not u["orphans_complete"]
    assert u["covered_share"] == round(50 / 60, 4)


def test_usage_merges_fields_and_handles_masked_and_missing():
    u = rd.usage([{"code": "EA", "text": None}, {"code": "KG", "text": None}],
                 {"MARA.MEINS": _st({"EA": 5, "PC": 2}), "MARA.GEWEI": _st({"KG": 3, "PC": 1}),
                  "MARC.X": {"masked": True, "mask_reason": "privacy", "top_values": None, "rows": 9, "blank": 0},
                  "MARC.Y": None})
    assert u["orphans"] == [{"value": "PC", "count": 3, "fields": ["MARA.MEINS", "MARA.GEWEI"]}]
    assert u["fields"][2]["masked"] and not u["fields"][3]["profiled"] and u["covered_at_least"]


def test_usage_matches_composite_code_on_last_part():
    u = rd.usage([{"code": "ecJobFunction/ADMIN", "text": None}], {"PickListValueV2.externalCode": _st({"ADMIN": 4})})
    assert u["used"] == 1 and u["unused"] == []


class _Result:
    def __init__(self, rows):
        self.rows = rows

    def mappings(self):
        return self

    def all(self):
        return self.rows


class _DB:
    def __init__(self):
        self.sql = []

    async def execute(self, stmt, params=None):
        q = str(stmt)
        self.sql.append(q)
        if "FROM analysis_versions" in q:
            return _Result([{"id": str(uuid.uuid4()), "run_at": "2026-11-01T00:00:00"}])
        if "FROM field_profiles" in q:
            return _Result([{"table_name": "MARA", "field": "MATKL", "stats": _st({"001": 8, "XX": 2})}])
        return _Result([])


@pytest.fixture(autouse=True)
def _dev_roles(monkeypatch):
    monkeypatch.setenv("MERIDIAN_DEV_ROLE_HEADER", "1")


def test_route_returns_usage(monkeypatch):
    async def _system(db, tenant, sid):
        return sid

    async def _codes(db, sid, lst, load_id, lang=None):
        return {"source": CODES}

    async def _lang(db, tenant, request):
        return None

    monkeypatch.setattr(route, "_system", _system)
    monkeypatch.setattr(route, "_codes", _codes)
    monkeypatch.setattr(route, "_lang", _lang)
    api = FastAPI()
    api.include_router(route.router)
    db = _DB()

    async def _db():
        yield db

    api.dependency_overrides[get_db] = _db
    api.dependency_overrides[get_tenant] = lambda: Tenant(uuid.uuid4(), "T", ["*"])
    r = TestClient(api).get("/api/v1/reference-data/lists/material_group/usage",
                            params={"system_id": str(uuid.uuid4())}, headers={"X-User-Role": "viewer"})
    assert r.status_code == 200, r.text
    b = r.json()
    assert b["orphans"] == [{"value": "XX", "count": 2, "fields": ["MARA.MATKL"]}]
    assert b["unused"] == ["002", "910"] and b["covered_share"] == 0.8
    assert all("tenant_id = :t" in q for q in db.sql if "FROM" in q and "set_config" not in q)
