"""Governance at entry: ageing on open requests, the per-field history and tenant entry defaults. The first block
needs no database; the second runs the API on Postgres (MERIDIAN_TEST_DB_URL)."""
from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone

import pytest

from api.routes.change_requests import RequestOut
from api.services import change_requests as crs
from tests.test_change_requests_pg import MAT, call, q, world  # noqa: F401 - world is a fixture


class Rec:
    def __init__(self):
        self.rows = []

    def execute(self, _sql, params):
        self.rows.append(params)


def test_record_changes_names_each_action_and_skips_equal_values():
    s = Rec()
    n = crs.record_changes(s, "t", "r", {"A.B": "1", "C.D": "2", "E.F": "3"}, {"A.B": "1", "C.D": "9", "G.H": "x"},
                           "u", "U", defaulted=["G.H"])
    got = {r["f"]: (r["a"], r["o"], r["n"]) for r in s.rows}
    assert n == 3 and got == {"C.D": ("changed", "2", "9"), "E.F": ("removed", "3", None),
                              "G.H": ("defaulted", None, "x")}
    assert crs.record_changes(Rec(), "t", "r", {}, {"A.B": "1"}, None, None) == 1  # set


def _out(status, **kw):
    now = datetime.now(timezone.utc)
    base = dict(id="1", kind="create", object="material", payload={}, status=status, created_at=now - timedelta(hours=5),
                updated_at=now)
    return RequestOut(**{**base, **kw})


def test_ageing_only_for_open_requests_and_overdue_only_while_in_approval():
    now = datetime.now(timezone.utc)
    late = _out("in_approval", submitted_at=now - timedelta(hours=3), due_at=now - timedelta(hours=1))
    assert late.overdue and late.age_hours == 3.0
    assert not _out("in_approval", due_at=now + timedelta(hours=1)).overdue
    done = _out("created", due_at=now - timedelta(hours=1))
    assert done.age_hours is None and not done.overdue
    assert _out("draft").age_hours == 5.0


pg = pytest.mark.skipif(not os.getenv("MERIDIAN_TEST_DB_URL"), reason="requires MERIDIAN_TEST_DB_URL")


@pg
@pytest.mark.anyio
async def test_defaults_fill_empty_fields_and_the_history_shows_who_and_what(world, monkeypatch):  # noqa: F811
    eng, w = world
    r = await call(monkeypatch, w, "requester", "PUT", "/change-requests/defaults",
                   {"object": "material", "field": "mara.meins", "value": "EA"})
    assert r.status_code == 403  # a requester does not set defaults
    r = await call(monkeypatch, w, "admin", "PUT", "/change-requests/defaults",
                   {"object": "material", "field": "mara.meins", "value": "EA"})
    assert r.status_code == 200 and r.json()["field"] == "MARA.MEINS"
    bad = await call(monkeypatch, w, "admin", "PUT", "/change-requests/defaults",
                     {"object": "material", "field": "MARA.NOPE", "value": "1"})
    assert bad.status_code == 422
    listed = (await call(monkeypatch, w, "requester", "GET", "/change-requests/defaults")).json()["items"]
    assert [(d["object"], d["field"], d["value"]) for d in listed] == [("material", "MARA.MEINS", "EA")]

    pay = {k: v for k, v in MAT.items() if k != "MARA.MEINS"}
    made = await call(monkeypatch, w, "requester", "POST", "/change-requests",
                      {"kind": "create", "object": "material", "payload": pay})
    cid = made.json()["id"]
    assert made.json()["payload"]["MARA.MEINS"] == "EA" and made.json()["age_hours"] is not None
    # a change is never defaulted
    ch = await call(monkeypatch, w, "requester", "POST", "/change-requests",
                    {"kind": "change", "object": "material", "object_key": "MATNR=1", "payload": {"MAKT.MAKTX": "x"}})
    assert "MARA.MEINS" not in ch.json()["payload"]

    up = await call(monkeypatch, w, "requester", "PATCH", f"/change-requests/{cid}",
                    {"payload": {**pay, "MAKT.MAKTX": "Hex bolt M10"}})
    assert up.status_code == 200
    hist = (await call(monkeypatch, w, "requester", "GET", f"/change-requests/{cid}/field-history")).json()["items"]
    by = {(h["field"], h["action"]): h for h in hist}
    assert ("MARA.MEINS", "defaulted") in by and ("MAKT.MAKTX", "changed") in by
    assert by[("MAKT.MAKTX", "changed")]["old_value"] == "Hex bolt M8"
    assert by[("MAKT.MAKTX", "changed")]["new_value"] == "Hex bolt M10"
    assert by[("MAKT.MAKTX", "changed")]["actor_label"]
    # the workflow trail still carries no value
    detail = (await call(monkeypatch, w, "requester", "GET", f"/change-requests/{cid}")).json()
    assert "Hex bolt" not in str(detail["history"])

    gone = await call(monkeypatch, w, "admin", "DELETE", f"/change-requests/defaults/{listed[0]['id']}")
    assert gone.status_code == 200
    again = await call(monkeypatch, w, "admin", "DELETE", f"/change-requests/defaults/{listed[0]['id']}")
    assert again.status_code == 404


@pg
@pytest.mark.anyio
async def test_a_waiting_step_gives_the_request_a_due_time(world, monkeypatch):  # noqa: F811
    eng, w = world
    r = await call(monkeypatch, w, "requester", "POST", "/change-requests",
                   {"kind": "create", "object": "material", "target_system_id": w["sys"], "payload": MAT})
    cid = r.json()["id"]
    s = await call(monkeypatch, w, "requester", "POST", f"/change-requests/{cid}/submit")
    req = s.json()["request"]
    assert req["status"] == "in_approval" and req["waiting_step"] and req["age_hours"] is not None
    due = q(eng, w, "SELECT due_at FROM workflow_tasks WHERE tenant_id = CAST(:t AS uuid) AND status = 'pending'")
    assert (req["due_at"] is not None) == (due[0][0] is not None)
