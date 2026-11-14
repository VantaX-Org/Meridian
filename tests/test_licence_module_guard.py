"""Per-router licence gating: every route keyed on a module checks that the licence entitles it."""

from fastapi import Depends, FastAPI, Request
from fastapi.testclient import TestClient

from api.middleware.licence import licensed_module
from tests.test_all_routes_guarded import _routes as _walk

GUARD = "licensed_module_guard"


def _names(dependant, out):
    for d in dependant.dependencies:
        out.append(getattr(d.call, "__qualname__", repr(d.call)))
        _names(d, out)
    return out


def _routes():
    """(full path, dependency names); the walker sees through FastAPI >=0.140 included-router wrappers."""
    routes = [(path, _names(r.dependant, extra)) for path, r, extra in _walk()]
    assert len(routes) > 100
    return routes


def test_every_module_path_route_is_licence_gated():
    missing = [path for path, names in _routes() if "{module}" in path and not any(GUARD in n for n in names)]
    assert not missing, "module routes without licensed_module():\n" + "\n".join(missing)


def test_material_360_is_gated_on_material_master():
    routes = [(path, names) for path, names in _routes() if path.startswith("/api/v1/materials")]
    assert routes
    for path, names in routes:
        assert any(GUARD in n for n in names), path


def _client(licensed):
    api = FastAPI()

    @api.middleware("http")
    async def _licence(request: Request, call_next):
        request.state.licensed_modules = licensed
        return await call_next(request)

    @api.get("/m/{module}", dependencies=[Depends(licensed_module())])
    def by_path(module: str):
        return {"ok": module}

    @api.get("/fixed", dependencies=[Depends(licensed_module("material_master"))])
    def fixed():
        return {"ok": True}

    return TestClient(api)


def test_unlicensed_module_is_402():
    c = _client(["employee_central"])
    r = c.get("/m/material_master")
    assert r.status_code == 402
    assert r.json()["detail"]["error"] == "module_not_licenced"
    assert c.get("/fixed").status_code == 402


def test_licensed_module_passes():
    c = _client(["material_master"])
    assert c.get("/m/material_master").status_code == 200
    assert c.get("/fixed").status_code == 200


def test_wildcard_and_no_licence_state_pass():
    assert _client(["*"]).get("/m/material_master").status_code == 200
    assert _client(None).get("/m/material_master").status_code == 200


def test_a_path_value_outside_the_catalogue_falls_to_the_route():
    # not a module id: the route's own validation answers, not a licence refusal
    assert _client(["employee_central"]).get("/m/not_a_module").status_code == 200
