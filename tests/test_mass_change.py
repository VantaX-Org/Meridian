"""Mass change requests (migration 125): one request, the same fields on many records. check_payload needs no
database; the rest runs over the API on Postgres (skipped without MERIDIAN_TEST_DB_URL)."""
from __future__ import annotations

import os
import uuid

import pytest
from sqlalchemy import text

from api.services import change_requests as crs
from tests import workflow_seed as seed
from tests.test_change_requests_pg import approve, call, q, world  # noqa: F401 - world is a fixture

KEYS = ["MATNR=000000000000000777", "MATNR=000000000000000888", "MATNR=999"]
FIELD = {"MARC.DISPO": "N01"}


def test_check_payload_validates_fields_keys_values_and_the_cap():
    assert crs.check_payload("material", "mass_change", FIELD, None, KEYS) == []
    assert crs.check_payload("material", "mass_change", FIELD, None, None) == [
        "A mass change names the records it changes (record_keys)."]
    assert crs.check_payload("material", "mass_change", FIELD, None, ["WERKS=1000"]) == [
        "1 record key(s) lack MATNR, e.g. WERKS=1000."]
    assert crs.check_payload("material", "mass_change", FIELD, None, ["MATNR=1"] * (crs.MAX_MASS_RECORDS + 1)) == [
        f"At most {crs.MAX_MASS_RECORDS} records in one mass change."]
    assert crs.check_payload("material", "mass_change", {"MARC.NOPE": "x"}, None, KEYS) == [
        "MARC.NOPE: SAP has no such field."]
    assert "Give every field a new value" in crs.check_payload("material", "mass_change", {"MARC.DISPO": " "}, None,
                                                               KEYS)[0]
    assert crs.check_payload("material", "mass_change", {"KNA1.NAME1": "x"}, None, KEYS)[0].startswith(
        "KNA1.NAME1: not a field of a material")


def test_a_mass_change_is_titled_by_its_size_and_tested_by_record_count():
    cr = {"kind": "mass_change", "object": "material", "record_count": 3, "payload": FIELD, "title": None}
    assert crs.title_of(cr) == "Mass change of 3 material records"
    assert crs.facts(cr, None, [])["records"] == 3


pg = pytest.mark.skipif(not os.getenv("MERIDIAN_TEST_DB_URL"), reason="requires MERIDIAN_TEST_DB_URL")


async def make(monkeypatch, w, keys=KEYS, payload=None):
    return await call(monkeypatch, w, "requester", "POST", "/change-requests",
                      {"kind": "mass_change", "object": "material", "payload": payload or FIELD, "record_keys": keys})


@pg
@pytest.mark.anyio
async def test_create_validate_preview_submit_approve_records_each_record(world, monkeypatch):  # noqa: F811
    eng, w = world
    with seed.tenant_conn(eng, w["tid"]) as c:
        c.execute(text("INSERT INTO master_records (tenant_id, domain, sap_object_key, golden_fields, status) VALUES "
                       "(:t, 'material_master', 'MATNR=000000000000000888', CAST(:g AS jsonb), 'golden')"),
                  {"t": w["tid"], "g": '{"MARC.DISPO": "N01", "MAKT.MAKTX": "Washer"}'})
        c.execute(text("UPDATE master_records SET golden_fields = CAST(:g AS jsonb) WHERE tenant_id = :t "
                       "AND sap_object_key = 'MATNR=000000000000000777'"),
                  {"t": w["tid"], "g": '{"MARC.DISPO": "M02", "MAKT.MAKTX": "Hex bolt M8"}'})

    bad = await make(monkeypatch, w, keys=["WERKS=1"])
    assert bad.status_code == 422 and bad.json()["detail"]["problems"] == ["1 record key(s) lack MATNR, e.g. WERKS=1."]
    assert (await call(monkeypatch, w, "dave", "POST", "/change-requests",
                       {"kind": "mass_change", "object": "material", "payload": FIELD,
                        "record_keys": KEYS})).status_code == 403

    made = await make(monkeypatch, w)
    assert made.status_code == 200, made.text
    cr = made.json()
    assert cr["kind"] == "mass_change" and cr["record_count"] == 3 and cr["status"] == "draft"
    assert cr["title"] is None
    cid = cr["id"]

    pv = (await call(monkeypatch, w, "requester", "GET", f"/change-requests/{cid}/preview")).json()
    assert pv["counts"] == {"records": 3, "found": 2, "missing": 1, "changing": 2, "unchanged": 1, "fields": 1}
    by = {r["record_key"]: r for r in pv["rows"]}
    assert (by[KEYS[0]]["before"], by[KEYS[0]]["after"], by[KEYS[0]]["text"]) == ("M02", "N01", "Hex bolt M8")
    assert by[KEYS[1]]["unchanged"] is True and by[KEYS[1]]["text"] == "Washer"
    assert by[KEYS[2]]["known"] is False and by[KEYS[2]]["before"] is None

    v = await call(monkeypatch, w, "requester", "POST", f"/change-requests/{cid}/validate")
    assert v.status_code == 200 and v.json()["problems"] == [] and v.json()["failures"] == []
    s = await call(monkeypatch, w, "requester", "POST", f"/change-requests/{cid}/submit")
    assert s.status_code == 200, s.text
    assert s.json()["workflow"]["facts"]["records"] == 3 and s.json()["workflow"]["facts"]["kind"] == "mass_change"

    # the same approval steps as a single change request; approval is by the export load file, never SAP
    done = await approve(monkeypatch, w, cid)
    assert done["status"] == "approved" and done["delivery"] == "export" and done["has_export"] is True
    assert w["queued"] == []
    exp = (await call(monkeypatch, w, "requester", "GET", f"/change-requests/{cid}/export")).json()
    assert exp["kind"] == "mass_change" and exp["record_keys"] == KEYS
    assert exp["fields"] == [{"field": "MARC.DISPO", "value": "N01"}]

    rows = q(eng, w, "SELECT record_key, field, action, old_value, new_value FROM change_request_field_changes "
                     "WHERE tenant_id = :t AND request_id = :r AND record_key IS NOT NULL ORDER BY record_key",
             r=cid)
    assert [tuple(r) for r in rows] == [(KEYS[0], "MARC.DISPO", "changed", "M02", "N01"),
                                        (KEYS[2], "MARC.DISPO", "set", None, "N01")]
    hist = (await call(monkeypatch, w, "requester", "GET", f"/change-requests/{cid}/field-history")).json()["items"]
    assert {h["record_key"] for h in hist} == {None, KEYS[0], KEYS[2]}


@pg
@pytest.mark.anyio
async def test_a_mass_change_is_private_to_its_tenant(world, monkeypatch):  # noqa: F811
    eng, w = world
    w2 = seed.seed_tenant(eng)
    try:
        with seed.tenant_conn(eng, w2["tid"]) as c:
            c.execute(text("INSERT INTO master_records (tenant_id, domain, sap_object_key, golden_fields, status) "
                           "VALUES (:t, 'material_master', 'MATNR=000000000000000555', CAST(:g AS jsonb), 'golden')"),
                      {"t": w2["tid"], "g": '{"MARC.DISPO": "Z99"}'})
        made = await make(monkeypatch, w, keys=["MATNR=000000000000000555"])
        cid = made.json()["id"]
        pv = (await call(monkeypatch, w, "requester", "GET", f"/change-requests/{cid}/preview")).json()
        assert pv["counts"]["found"] == 0 and pv["rows"][0]["before"] is None  # tenant 2's record is not seen
        for path in (f"/change-requests/{cid}", f"/change-requests/{cid}/preview"):
            assert (await call(monkeypatch, w2, "requester", "GET", path)).status_code == 404
        listed = (await call(monkeypatch, w2, "requester", "GET", "/change-requests?view=all")).json()["items"]
        assert listed == []
    finally:
        seed.drop_tenant(eng, w2["tid"])


@pg
@pytest.mark.anyio
async def test_preview_refuses_a_single_change(world, monkeypatch):  # noqa: F811
    _, w = world
    r = await call(monkeypatch, w, "requester", "POST", "/change-requests",
                   {"kind": "change", "object": "material", "object_key": "MATNR=1", "payload": FIELD})
    p = await call(monkeypatch, w, "requester", "GET", f"/change-requests/{r.json()['id']}/preview")
    assert p.status_code == 409
    assert uuid.UUID(r.json()["id"])
