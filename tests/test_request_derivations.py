"""Derivation rules and critical fields on change requests. The first block needs no database; the second runs the API
on Postgres (MERIDIAN_TEST_DB_URL)."""
from __future__ import annotations

import os

import pytest

from api.services import change_requests as crs
from tests.test_change_requests_pg import MAT, call, q, world  # noqa: F401 - world is a fixture


class Rec:
    def __init__(self):
        self.rows = []

    def execute(self, _sql, params):
        self.rows.append(params)


class Rows:
    """A fake session returning fixed rows for any query."""

    def __init__(self, rows):
        self.rows = rows

    def execute(self, _sql, _params=None):
        return self

    def all(self):
        return self.rows


def test_derivations_set_the_target_when_the_condition_holds_in_order_and_mark_only_real_changes():
    rules = [("MARA.MTART", ["ROH"], "MARC.BESKZ", "F", None), ("MARC.BESKZ", ["F"], "MARC.DISMM", "PD", None),
             ("MARA.MBRSH", ["M"], "MARA.MEINS", "EA", None)]
    out, derived = crs.apply_derivations(Rows(rules), "t", "material",
                                         {"MARA.MTART": "ROH", "MARA.MBRSH": "M", "MARA.MEINS": "EA"})
    assert out["MARC.BESKZ"] == "F" and out["MARC.DISMM"] == "PD"  # chained: the second sees the first
    assert derived == ["MARC.BESKZ", "MARC.DISMM"]  # MEINS already held EA: not a derivation
    same, none = crs.apply_derivations(Rows(rules), "t", "material", {"MARA.MTART": "ZZZ"})
    assert same == {"MARA.MTART": "ZZZ"} and none == []


def test_copy_from_field_copies_the_current_value_and_skips_an_empty_source():
    rules = [("MARA.MTART", ["ROH"], "MARA.MEINS", None, "MARA.BISMT"), ("MARA.MTART", ["ROH"], "MARA.NORMT", None, "MARA.MATKL")]
    out, derived = crs.apply_derivations(Rows(rules), "t", "material",
                                         {"MARA.MTART": "ROH", "MARA.BISMT": " KG", "MARA.MATKL": "  "})
    assert out["MARA.MEINS"] == " KG" and derived == ["MARA.MEINS"]
    assert "MARA.NORMT" not in out  # blank source: skipped
    out, derived = crs.apply_derivations(Rows(rules[:1]), "t", "material", {"MARA.MTART": "ROH", "MARA.MEINS": "KG", "MARA.BISMT": "KG"})
    assert derived == []  # target already holds the value


def test_derivation_body_needs_exactly_one_of_value_and_source_field():
    from pydantic import ValidationError

    from api.routes.change_requests import DerivationBody

    base = {"object": "material", "when_field": "MARA.MTART", "when_values": ["ROH"], "target_field": "MARA.MEINS"}
    assert DerivationBody(**base, value="PC").source_field is None
    assert DerivationBody(**base, source_field="MARA.BISMT").value is None
    for extra in ({}, {"value": "PC", "source_field": "MARA.BISMT"}):
        with pytest.raises(ValidationError):
            DerivationBody(**base, **extra)


def test_critical_hits_are_the_touched_fields_of_the_requests_object_only():
    crit = {"material": {"MARA.MTART", "MARA.MATKL"}, "customer": {"KNA1.NAME1"}}
    cr = {"object": "material", "payload": {"mara.mtart": "FERT", "MAKT.MAKTX": "x", "KNA1.NAME1": "y"}}
    assert crs.critical_hits(cr, crit) == ["MARA.MTART"]
    assert crs.critical_hits({"object": "material", "payload": {}}, crit) == []


def test_record_changes_names_a_derived_field():
    s = Rec()
    crs.record_changes(s, "t", "r", {}, {"A.B": "1"}, None, None, derived=["A.B"])
    assert s.rows[0]["a"] == "derived"


pg = pytest.mark.skipif(not os.getenv("MERIDIAN_TEST_DB_URL"), reason="requires MERIDIAN_TEST_DB_URL")


@pg
@pytest.mark.anyio
async def test_derivation_rules_are_checked_applied_and_recorded(world, monkeypatch):  # noqa: F811
    eng, w = world
    body = {"object": "material", "when_field": "mara.mtart", "when_values": ["FERT"],
            "target_field": "mara.meins", "value": "PC"}
    assert (await call(monkeypatch, w, "requester", "PUT", "/change-requests/derivations", body)).status_code == 403
    bad = await call(monkeypatch, w, "admin", "PUT", "/change-requests/derivations", {**body, "target_field": "MARA.NOPE"})
    assert bad.status_code == 422
    for extra in ({"value": None}, {"source_field": "MARA.BISMT"}):
        assert (await call(monkeypatch, w, "admin", "PUT", "/change-requests/derivations", {**body, **extra})).status_code == 422
    ok = await call(monkeypatch, w, "admin", "PUT", "/change-requests/derivations", body)
    assert ok.status_code == 200 and ok.json()["target_field"] == "MARA.MEINS"
    listed = (await call(monkeypatch, w, "requester", "GET", "/change-requests/derivations")).json()["items"]
    assert [(d["when_field"], d["when_values"], d["value"]) for d in listed] == [("MARA.MTART", ["FERT"], "PC")]

    made = await call(monkeypatch, w, "requester", "POST", "/change-requests",
                      {"kind": "create", "object": "material", "payload": MAT})
    cid = made.json()["id"]
    assert made.json()["payload"]["MARA.MEINS"] == "PC"
    up = await call(monkeypatch, w, "requester", "PATCH", f"/change-requests/{cid}", {"payload": MAT})
    assert up.json()["payload"]["MARA.MEINS"] == "PC"
    hist = (await call(monkeypatch, w, "requester", "GET", f"/change-requests/{cid}/field-history")).json()["items"]
    assert ("MARA.MEINS", "derived") in {(h["field"], h["action"]) for h in hist}

    gone = await call(monkeypatch, w, "admin", "DELETE", f"/change-requests/derivations/{listed[0]['id']}")
    assert gone.status_code == 200
    again = await call(monkeypatch, w, "admin", "DELETE", f"/change-requests/derivations/{listed[0]['id']}")
    assert again.status_code == 404


@pg
@pytest.mark.anyio
async def test_a_critical_field_flags_the_request_and_adds_an_approval_step(world, monkeypatch):  # noqa: F811
    eng, w = world
    put = "/change-requests/critical-fields"
    assert (await call(monkeypatch, w, "requester", "PUT", put,
                       {"object": "material", "field": "MARA.MTART"})).status_code == 403
    assert (await call(monkeypatch, w, "admin", "PUT", put,
                       {"object": "material", "field": "MARA.NOPE"})).status_code == 422
    ok = await call(monkeypatch, w, "admin", "PUT", put, {"object": "material", "field": "mara.mtart"})
    assert ok.status_code == 200 and ok.json()["field"] == "MARA.MTART"
    r = await call(monkeypatch, w, "requester", "POST", "/change-requests",
                   {"kind": "create", "object": "material", "target_system_id": w["sys"], "payload": MAT})
    cid = r.json()["id"]
    assert r.json()["critical_fields"] == ["MARA.MTART"]
    listed = (await call(monkeypatch, w, "requester", "GET", "/change-requests")).json()["items"]
    assert [x["critical_fields"] for x in listed if x["id"] == cid] == [["MARA.MTART"]]
    s = await call(monkeypatch, w, "requester", "POST", f"/change-requests/{cid}/submit")
    assert s.status_code == 200
    steps = q(eng, w, "SELECT step_name FROM workflow_tasks WHERE tenant_id = CAST(:t AS uuid) ORDER BY step_index")
    assert steps[-1][0] == "Critical field approval"
    other = await call(monkeypatch, w, "requester", "POST", "/change-requests",
                       {"kind": "change", "object": "material", "object_key": "MATNR=1", "payload": {"MAKT.MAKTX": "x"}})
    assert other.json()["critical_fields"] == []
