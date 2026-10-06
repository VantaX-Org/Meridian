"""Config load areas, per-system configuration status, rule applicability per system, where config lives."""

import asyncio
import uuid

import pandas as pd
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from api.deps import Tenant, get_db, get_tenant
from api.services import config_areas as ca
from api.services.config_applicability import judge, score
from sap.config_loader import load_cloud, planned_objects

TID = uuid.uuid4()


# ---- areas ------------------------------------------------------------------------------------------


def test_every_planned_object_is_in_an_area_and_every_listed_object_is_read():
    for st in ("ecc", "s4hana_onprem", "ewm", "ewms", "successfactors", "concur"):
        listed = {o for d in ca.area_defs(st) for o in d["objects"]}
        planned = set(planned_objects(st))
        assert planned <= listed, (st, planned - listed)
    abap = {o for st in ("ecc", "s4hana_onprem") for o in planned_objects(st)}
    assert {o for d in ca.area_defs("ecc") for o in d["objects"]} <= abap


class _FakeSF:
    def read_entity_set(self, name, select=None, top=None):
        return pd.DataFrame({"externalCode": ["A"], "PickListV2_id": ["P"]})

    def metadata(self):
        return '<EntityType Name="FOCompany">'


class _FakeConcur:
    def _read_endpoint(self, path, top=None):
        return pd.DataFrame({"id": [1]})


def test_planned_objects_match_what_cloud_loads_report():
    assert set(load_cloud(_FakeSF(), "successfactors").objects) == set(planned_objects("successfactors"))
    assert set(load_cloud(_FakeConcur(), "concur").objects) == set(planned_objects("concur"))


def test_running_areas_count_tables_done_and_mark_current():
    areas = {a["area"]: a for a in ca.build_areas("ecc", done={"TVAK", "TVAP"}, current="TVEP")}
    assert areas["sales"]["status"] == "running" and areas["sales"]["tables_done"] == 2
    assert areas["purchasing"]["status"] == "waiting" and areas["purchasing"]["tables_done"] == 0
    done = set(planned_objects("ecc"))
    assert all(a["status"] in ("loaded", "not_available") for a in ca.build_areas("ecc", done=done))


def _objects(st, **overrides):
    out = [{"object": o, "state": "loaded", "rows": 3, "detail": ""} for o in planned_objects(st)]
    for o in out:
        o.update(overrides.get(o["object"], {}))
    return out


def test_finished_areas_status_found_counts_and_causes():
    objs = _objects("ecc", TQ30={"state": "failed", "rows": 0, "detail": "NOT_AUTHORIZED for S_TABU_DIS"},
                    TQ80={"state": "not_available", "rows": 0, "detail": "table does not exist in this system"})
    areas = {a["area"]: a for a in ca.build_areas("ecc", objs)}
    q = areas["quality"]
    assert q["status"] == "failed"
    by = {o["object"]: o for o in q["objects"]}
    assert by["TQ30"]["cause"] == "auth" and by["TQ80"]["cause"] == "not_in_release"
    assert by["TQ30"]["label"]  # DDIC description
    sales = areas["sales"]
    assert sales["status"] == "loaded" and sales["tables_done"] == sales["tables_total"]
    assert sum(o["rows"] for o in sales["objects"]) == 3 * sales["tables_total"]


def test_system_status_variants():
    assert ca.system_status("btp", None)["status"] == "not_available"
    na = ca.system_status("ariba", None)
    assert na["status"] == "not_available" and na["areas_total"] == 0
    assert ca.system_status("ecc", None)["status"] == "not_loaded"
    assert ca.system_status("ecc", {"status": "failed", "objects": []})["status"] == "failed"
    ok = ca.system_status("ecc", {"status": "completed", "objects": _objects("ecc")})
    assert ok["status"] == "loaded" and ok["areas_loaded"] == ok["areas_total"] > 0
    gap = ca.system_status("ecc", {"status": "completed",
                                   "objects": _objects("ecc", T161={"state": "failed", "detail": "timed out"})})
    assert gap["status"] == "with_gaps" and gap["areas_loaded"] == gap["areas_total"] - 1
    run = ca.system_status("ecc", {"status": "running"},
                           ca.build_areas("ecc", done={"TVAK"}, current="TVAP"))
    assert run["status"] == "loading" and run["current_area"] == "Sales"


def test_configured_in_img_for_abap_admin_for_cloud_nothing_when_unknown():
    img = ca.configured_in("ecc", ["TVAK", "TVAK", "TQ30"])
    assert img == [{"object": "TVAK", "kind": "img", "path": img[0]["path"], "tcode": "VOV8"}]
    sf = {c["path"] for c in ca.configured_in("successfactors", ["PickListValueV2", "FOJobCode"])}
    assert sf == {"Admin Center > Picklist Center", "Admin Center > Manage Business Configuration"}
    assert ca.configured_in("btp", ["X"]) == [] and ca.configured_in("ewm", ["/SCWM/T300"]) == []


# ---- applicability -----------------------------------------------------------------------------------


def test_judge_statuses_and_found_reason():
    tvak = {"TVAK": {"state": "loaded", "rows": [{"AUART": "OR"}, {"AUART": "RE"}]}}
    assert judge("sd_sales_orders", "X", tvak) == {
        "status": "applies", "reason": "2 sales document types in TVAK", "object": "TVAK"}
    assert judge("quality_management", "X", {"TQ30": {"state": "empty", "rows": []}})["status"] == "does_not_apply"
    assert judge("quality_management", "X", {"TQ30": {"state": "failed"}})["status"] == "applies_by_default"
    assert judge("quality_management", "X", {"TQ30": {"state": "not_available"}})["status"] == "not_available"
    assert judge("quality_management", "X", None, "ecc")["reason"] == "Configuration not loaded"
    assert judge("quality_management", "X", None, "btp")["status"] == "not_available"
    assert judge("business_partner", "X", {})["status"] == "applies"


def test_score_rules_modules_and_by_default():
    rows = [{"module": "business_partner", "check_id": "A", "severity": "high", "affected_count": 0},
            {"module": "quality_management", "check_id": "Q", "severity": "high", "affected_count": 4}]
    out = score(rows, {"TQ30": {"state": "empty", "rows": []}}, "ecc")
    mods = {m["module"]: m for m in out["modules"]}
    assert mods["quality_management"]["not_applicable"] == 1 and mods["business_partner"]["applicable"] == 1
    assert out["config_aware"]["not_applicable_rules"][0]["check_id"] == "Q"
    assert {r["check_id"]: r["applicability"] for r in out["rules"]} == {"A": "applies", "Q": "does_not_apply"}
    unloaded = score(rows, None, "ecc")["config_aware"]
    assert unloaded["applicable"] == 2 and unloaded["by_default"] == 2


def test_l2_carries_where_it_is_configured():
    from api.services.config_applicability import process_index

    l2 = next(x for l1 in process_index() for x in l1["l2"] if "TVAK" in x["objects"] and x["checks"])
    out = score([{"module": "business_partner", "check_id": sorted(l2["checks"])[0], "severity": "low",
                  "affected_count": 0}], {}, "ecc")
    got = next(x for p in out["processes"] for x in p["l2"] if x["l2"] == l2["l2"])
    assert any(c["tcode"] == "VOV8" for c in got["configured_in"])


# ---- routes ------------------------------------------------------------------------------------------


class _Res:
    def __init__(self, rows):
        self.rows = rows

    def fetchall(self):
        return self.rows

    def fetchone(self):
        return self.rows[0] if self.rows else None

    def scalar(self):
        return self.rows[0][0] if self.rows else None


class _Db:
    def __init__(self, answers):
        self.answers, self.calls = answers, []

    async def execute(self, stmt, params=None):
        sql = str(stmt)
        self.calls.append((sql, params or {}))
        for key, rows in self.answers:
            if key in sql:
                return _Res(rows)
        return _Res([])


def _get(router, db, url):
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_tenant] = lambda: Tenant(TID, "T", [])

    async def go():
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
            return await c.get(url)
    return asyncio.run(go())


def test_landscape_config_status_route(monkeypatch):
    from api.routes import connectivity

    monkeypatch.setattr(connectivity.jobs, "get_job", lambda t, j: None)
    db = _Db([("FROM sap_systems s", [
        ("s1", "A ECC", "ecc", "l1", "completed", _objects("ecc"), None, "2026-01-01"),
        ("s2", "B SF", "successfactors", None, None, None, None, None),
        ("s3", "C BTP", "btp", None, None, None, None, None)])])
    r = _get(connectivity.router, db, "/api/v1/connectivity/config-load")
    assert r.status_code == 200
    body = r.json()
    assert [s["status"] for s in body["systems"]] == ["loaded", "not_loaded", "not_available"]
    assert (body["loaded"], body["total"]) == (1, 2)
    assert all(p.get("tid") == str(TID) for s, p in db.calls if "sap_systems" in s)


def test_rule_applicability_route():
    from api.routes import findings

    db = _Db([("FROM sap_systems", [("s1", "A ECC", "ecc"), ("s2", "C BTP", "btp")]),
              ("FROM config_loads", [("l1", "s1", "ecc", [{"object": "TVAK", "state": "empty"}], "2026-01-01")])])
    r = _get(findings.router, db, "/api/v1/findings/rules/SD-X/applicability?module=sd_sales_orders")
    assert r.status_code == 200
    rows = r.json()["systems"]
    assert rows[0]["applicability"] == "does_not_apply" and rows[0]["configured_in"]
    assert rows[0]["configured_in"][0]["kind"] == "img"
