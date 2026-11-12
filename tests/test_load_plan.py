"""Migration load plan: DDIC-derived load order, cycles, prerequisites and the route's readiness merge."""

import uuid

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.deps import Tenant, get_db, get_tenant
from api.routes import load_plan as route
from api.services.migration import load_plan as lp
from sap.ddic import Dictionary, Field, Table, get_dictionary


def _cols(module):
    return route._columns(module)


def test_gl_accounts_load_before_customers_and_vendors():
    plan = lp.build_plan(["sd_customer_master", "accounts_payable", "fi_gl"], get_dictionary("s4hana"), _cols)
    step = {o.module: o.step for o in plan.objects}
    assert step["fi_gl"] < step["sd_customer_master"]
    assert step["fi_gl"] < step["accounts_payable"]
    edge = next(e for e in plan.edges if e.before == "fi_gl" and e.after == "sd_customer_master")
    assert edge.kind == "required"
    ev = next(x for x in edge.evidence if x.field == "KNB1.AKONT")
    assert ev.check_table == "SKB1" and ev.reason


def test_every_evidence_field_is_a_real_ddic_field():
    d = get_dictionary("s4hana")
    plan = lp.build_plan(list(lp.OWNED_TABLES), d, _cols)
    assert not plan.unknown
    for e in plan.edges:
        for x in e.evidence:
            f = d.resolve(x.field)
            assert f is not None and f.check_table == x.check_table and not f.key


def test_unknown_module_is_reported_not_planned():
    plan = lp.build_plan(["fi_gl", "no_such_object"], get_dictionary("s4hana"), _cols)
    assert plan.unknown == ["no_such_object"]
    assert [o.module for o in plan.objects] == ["fi_gl"]


def _f(t, n, ct=None, key=False):
    return Field(table=t, name=n, key=key, type="CHAR", length=10, check_table=ct, description=f"{t} {n}")


def _toy(cycle_required=False):
    # Customer (KNA1) references a vendor (LFA1) and back; customising table TX is a prerequisite.
    kna1 = Table("KNA1", "Customer", {"KUNNR": _f("KNA1", "KUNNR", key=True), "LIFNR": _f("KNA1", "LIFNR", "LFA1"),
                                       "LAND1": _f("KNA1", "LAND1", "TX")}, ("KUNNR",))
    lfa1 = Table("LFA1", "Vendor", {"LIFNR": _f("LFA1", "LIFNR", key=True), "KUNNR": _f("LFA1", "KUNNR", "KNA1")},
                 ("LIFNR",))
    tx = Table("TX", "Countries", {"LAND1": _f("TX", "LAND1", key=True)}, ("LAND1",), delivery_class="C")
    return Dictionary(release="toy", tables={"KNA1": kna1, "LFA1": lfa1, "TX": tx})


def test_reference_cycle_is_deferred_and_prerequisite_classified():
    cols = {"sd_customer_master": {"KNA1.KUNNR", "KNA1.LIFNR", "KNA1.LAND1"},
            "accounts_payable": {"LFA1.LIFNR", "LFA1.KUNNR"}}
    plan = lp.build_plan(["sd_customer_master", "accounts_payable"], _toy(), lambda m: cols[m])
    assert len(plan.edges) == 2 and all(e.deferred for e in plan.edges)
    assert {o.step for o in plan.objects} == {1}
    cust = next(o for o in plan.objects if o.module == "sd_customer_master")
    assert [(p.table, p.kind, p.fields) for p in cust.prerequisites] == [("TX", "configuration", ["KNA1.LAND1"])]


def test_required_cycle_loads_together(monkeypatch):
    monkeypatch.setattr(lp, "mandatory_fields", lambda: {"KNA1.LIFNR": "a", "LFA1.KUNNR": "b"})
    cols = {"sd_customer_master": {"KNA1.LIFNR"}, "accounts_payable": {"LFA1.KUNNR"}}
    plan = lp.build_plan(["sd_customer_master", "accounts_payable"], _toy(), lambda m: cols[m])
    assert not any(e.deferred for e in plan.edges)
    groups = {o.module: o.group for o in plan.objects}
    assert groups == {"sd_customer_master": ["accounts_payable"], "accounts_payable": ["sd_customer_master"]}


class _Result:
    def __init__(self, rows):
        self.rows = rows

    def mappings(self):
        return self

    def all(self):
        return self.rows


class _DB:
    def __init__(self, rows):
        self.rows, self.calls = rows, []

    async def execute(self, stmt, params=None):
        self.calls.append(params)
        return _Result(self.rows if params and "mods" in params else [])


def _client(rows, licensed=("*",)):
    api = FastAPI()
    api.include_router(route.router)
    db = _DB(rows)

    async def _db():
        yield db

    api.dependency_overrides[get_db] = _db
    api.dependency_overrides[get_tenant] = lambda: Tenant(uuid.uuid4(), "T", list(licensed))
    return TestClient(api), db


@pytest.fixture(autouse=True)
def _dev_roles(monkeypatch):
    monkeypatch.setenv("MERIDIAN_DEV_ROLE_HEADER", "1")


def test_route_blocks_dependants_of_a_no_go_object():
    client, db = _client([{"module": "fi_gl", "run_id": "r1", "blocking": 3},
                          {"module": "sd_customer_master", "run_id": "r1", "blocking": 0}])
    r = client.get("/api/v1/migration/load-plan", params={"modules": "fi_gl,sd_customer_master,accounts_payable"},
                   headers={"X-User-Role": "viewer"})
    assert r.status_code == 200, r.text
    body = r.json()
    by = {o["module"]: o for o in body["objects"]}
    assert by["fi_gl"]["status"] == "no_go" and by["fi_gl"]["blocking"] == 3
    assert by["sd_customer_master"]["status"] == "go"
    assert by["sd_customer_master"]["blocked_by"] == ["fi_gl"]
    assert by["accounts_payable"]["status"] == "not_run"
    assert by["accounts_payable"]["blocked_by"] == ["fi_gl"]
    assert body["steps"] == max(o["step"] for o in body["objects"]) and body["release"]


def test_route_defaults_to_licensed_objects_and_refuses_unlicensed():
    client, _ = _client([], licensed=("material_master", "sd_customer_master"))
    r = client.get("/api/v1/migration/load-plan", headers={"X-User-Role": "viewer"})
    assert r.status_code == 200
    assert sorted(o["module"] for o in r.json()["objects"]) == ["material_master", "sd_customer_master"]
    r = client.get("/api/v1/migration/load-plan", params={"modules": "fi_gl"}, headers={"X-User-Role": "viewer"})
    assert r.status_code == 403
