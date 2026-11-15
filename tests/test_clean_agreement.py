"""Agreement of a later extraction with an uploaded cleaned file (synthetic data only, no database or bucket)."""
import uuid
from datetime import datetime

import pandas as pd
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.deps import Tenant, get_db, get_tenant
from api.routes import upload
from api.services import clean_agreement as ca

KEYS = {"MARA": ["MATNR"]}


def test_values_in_reads_by_record_key_and_marks_absent_records():
    df = pd.DataFrame({"MARA.MATNR": ["M1", "M2"], "MARA.MATKL": ["A", None]})
    cells = [("MARA", "MATNR=M1", "MATKL"), ("MARA", "MATNR=M2", "MATKL"), ("MARA", "MATNR=M9", "MATKL"),
             ("MARA", "MATNR=M1", "NOPE")]
    got = ca.values_in(df, "MARA", cells, lambda t: KEYS.get(t, []))
    assert got == {cells[0]: "A", cells[1]: "", cells[2]: None, cells[3]: None}


def test_agreement_counts_score_and_field_breakdown():
    cells = {("MARA", "MATNR=M1", "MATKL"), ("MARA", "MATNR=M2", "MATKL"), ("MARA", "MATNR=M3", "MEINS"),
             ("MARA", "MATNR=M4", "MATKL")}
    cleaned = {c: "X" for c in cells}
    later = {("MARA", "MATNR=M1", "MATKL"): "X", ("MARA", "MATNR=M2", "MATKL"): "Y",
             ("MARA", "MATNR=M3", "MEINS"): None, ("MARA", "MATNR=M4", "MATKL"): "X"}
    out = ca.agreement(cells, cleaned, later, lambda t, f: f"{f} text")
    assert (out["total"], out["matched"], out["different"], out["missing"], out["score"]) == (4, 2, 1, 1, 50.0)
    assert [r["status"] for r in out["rows"]] == ["different", "missing", "matched", "matched"]
    by = {f["field"]: f for f in out["fields"]}
    assert (by["MATKL"]["matched"], by["MATKL"]["different"], by["MATKL"]["description"]) == (2, 1, "MATKL text")
    assert by["MEINS"]["missing"] == 1


def test_agreement_cleared_value_matches_empty_and_empty_set_has_no_score():
    c = ("MARA", "MATNR=M1", "MATKL")
    assert ca.agreement({c}, {c: None}, {c: ""}, lambda t, f: "")["matched"] == 1
    assert ca.agreement(set(), {}, {}, lambda t, f: "")["score"] is None


TID, CLEAN, BASE, LATER = uuid.uuid4(), uuid.uuid4(), uuid.uuid4(), uuid.uuid4()


class _R:
    def __init__(self, row=None, rows=()):
        self._row, self._rows = row, list(rows)

    def fetchone(self):
        return self._row

    def fetchall(self):
        return self._rows


class _DB:
    def __init__(self, newer=True):
        self.calls, self.newer = [], newer

    async def execute(self, stmt, params=None):
        sql = " ".join(str(stmt).split())
        self.calls.append((sql, params))
        if "run_at > (SELECT run_at" in sql:
            return _R((LATER, datetime(2026, 11, 1)) if self.newer else None)
        if sql.startswith("SELECT grain, record_key, field FROM roundtrip_edits"):
            return _R(rows=[("MARA", "MATNR=M1", "MATKL")])
        if sql.startswith("SELECT run_at, metadata"):
            return _R((datetime(2026, 11, 1), {"dataset_path": "staging/t/later/"}))
        if sql.startswith("SELECT metadata FROM analysis_versions"):
            return _R(({"source": "roundtrip", "dataset_path": "staging/t/clean/", "modules": ["material_master"],
                        "cleaned_overlay": {"base_version_id": str(BASE)},
                        "roundtrip": {"base_version_id": str(BASE)}},))
        return _R()


def _client(monkeypatch, db):
    monkeypatch.setenv("MERIDIAN_DEV_ROLE_HEADER", "1")
    monkeypatch.setattr(upload, "_dictionary", lambda t, s: None)
    reads = {"staging/t/clean/": "Z1", "staging/t/later/": "Z1"}
    monkeypatch.setattr(ca, "read_cells", lambda prefix, cells, keys_of: {c: reads[prefix] for c in cells})
    app = FastAPI()
    app.include_router(upload.router)

    async def _db():
        yield db

    app.dependency_overrides[get_db] = _db
    app.dependency_overrides[get_tenant] = lambda: Tenant(TID, "T", [])
    return TestClient(app)


def test_route_defaults_to_newest_later_run_and_scopes_every_query_to_the_tenant(monkeypatch):
    db = _DB()
    r = _client(monkeypatch, db).get(f"/api/v1/upload/roundtrip/{CLEAN}/agreement", headers={"X-User-Role": "viewer"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert (body["run_id"], body["matched"], body["score"]) == (str(LATER), 1, 100.0)
    assert db.calls[0][0].startswith("SELECT set_config('app.tenant_id'")
    assert all(p.get("t") in (TID, str(TID)) for _, p in db.calls if p)


def test_route_without_a_later_run_says_so(monkeypatch):
    r = _client(monkeypatch, _DB(newer=False)).get(f"/api/v1/upload/roundtrip/{CLEAN}/agreement",
                                                   headers={"X-User-Role": "viewer"})
    assert r.status_code == 404 and r.json()["detail"]["error"] == "no_later_run"
