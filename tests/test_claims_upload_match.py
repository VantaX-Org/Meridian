"""Claim: uploading a file detects the SAP module and maps its columns (deterministic path, no LLM, no network).

Real-shaped headers for material master, customer master and SuccessFactors run through detect_module_and_match
and POST /api/v1/upload/match against the real rule and column_map yaml. The LLM is replaced by a function that
fails the test if reached, except in the one test that proves a dead LLM leaves columns unmatched, not broken.
"""
import uuid

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.deps import Tenant, get_tenant
from api.routes import upload_match
from api.services import ai_column_matcher as acm

CASES = [
    ("material_master", ["Material Number", "MARA.MTART", "MARA.MATKL", "MEINS", "Material Type"],
     {"Material Number": "MARA.MATNR", "MARA.MTART": "MARA.MTART", "MARA.MATKL": "MARA.MATKL",
      "MEINS": "MARA.MEINS", "Material Type": "MARA.MTART"}),
    ("sd_customer_master", ["Customer Number", "KNA1.NAME1", "KNA1.LAND1", "KNA1.KTOKD"],
     {"Customer Number": "KNA1.KUNNR", "KNA1.NAME1": "KNA1.NAME1", "KNA1.LAND1": "KNA1.LAND1",
      "KNA1.KTOKD": "KNA1.KTOKD"}),
    ("employee_central", ["User ID", "EMPEMPLOYMENT.START_DATE", "Hire Date"],
     {"User ID": "EMPEMPLOYMENT.USERID", "EMPEMPLOYMENT.START_DATE": "EMPEMPLOYMENT.START_DATE",
      "Hire Date": "EMPEMPLOYMENT.START_DATE"}),
]


@pytest.fixture(autouse=True)
def _no_llm(monkeypatch):
    def boom(*a, **k):
        raise AssertionError("LLM reached on the deterministic path")
    monkeypatch.setattr(acm, "_llm_match_columns", boom)
    monkeypatch.setenv("MERIDIAN_DEV_ROLE_HEADER", "1")


def _rows(headers):
    return [["ABC1"] * len(headers)]


@pytest.mark.parametrize("module,headers,expected", CASES)
def test_detects_module_and_maps_columns(module, headers, expected):
    r = acm.detect_module_and_match(headers, _rows(headers), "upload.csv")
    assert r["detected_module"] == module
    assert r["module_confidence"] > 0.5 and r["headerless"] is False
    assert {m["source_column"]: m["target_field"] for m in r["mappings"]} == expected
    assert {m["value"] for m in r["available_modules"]} >= {c[0] for c in CASES}
    assert all(t not in r["unmapped_required"] for t in expected.values())


def test_match_types_and_hint(monkeypatch):
    h = ["Material Number", "MARA.MTART", "MEINS"]
    r = acm.detect_module_and_match(h, _rows(h), "f.csv")
    assert {m["source_column"]: m["match_type"] for m in r["mappings"]} == {
        "Material Number": "alias", "MARA.MTART": "exact", "MEINS": "alias"}
    # a valid hint overrides detection; an unknown hint is ignored
    monkeypatch.setattr(acm, "_llm_match_columns", lambda un, *a, **k: acm._fallback_unmatched(un))
    assert acm.detect_module_and_match(h, _rows(h), "f.csv", module_hint="hcm")["detected_module"] == "hcm"
    assert acm.detect_module_and_match(h, _rows(h), "f.csv", module_hint="nope")["detected_module"] == "material_master"


def test_dead_llm_leaves_column_unmatched(monkeypatch):
    monkeypatch.undo()  # drop the guard; make the real LLM path fail
    monkeypatch.setattr(acm, "get_llm", lambda: (_ for _ in ()).throw(RuntimeError("offline")))
    h = ["MARA.MTART", "Zzz Mystery Column"]
    r = acm.detect_module_and_match(h, [["FERT", "q1"]], "f.csv", module_hint="material_master")
    m = {x["source_column"]: x for x in r["mappings"]}
    assert m["MARA.MTART"]["target_field"] == "MARA.MTART"
    assert m["Zzz Mystery Column"]["target_field"] is None and m["Zzz Mystery Column"]["match_type"] == "unmatched"


def _client() -> TestClient:
    api = FastAPI()
    api.include_router(upload_match.router)
    api.dependency_overrides[get_tenant] = lambda: Tenant(uuid.uuid4(), "D", [])
    return TestClient(api)


@pytest.mark.parametrize("module,headers,expected", CASES)
def test_route_matches(module, headers, expected):
    body = {"headers": headers, "sample_rows": _rows(headers), "filename": "upload.csv"}
    r = _client().post("/api/v1/upload/match", json=body, headers={"X-User-Role": "admin"})
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["detected_module"] == module
    assert {m["source_column"]: m["target_field"] for m in j["mappings"]} == expected


def test_route_rejects_bad_body_and_viewer():
    c = _client()
    assert c.post("/api/v1/upload/match", json={"headers": ["a"]}, headers={"X-User-Role": "admin"}).status_code == 422
    body = {"headers": ["MEINS"], "sample_rows": [["EA"]], "filename": "f.csv"}
    assert c.post("/api/v1/upload/match", json=body, headers={"X-User-Role": "viewer"}).status_code == 403
