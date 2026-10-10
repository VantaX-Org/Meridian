"""Lineage model, path queries, roll-ups, guards and blast-radius counting."""

import copy

import pandas as pd
import pytest
import yaml

from api.services import lineage as svc


@pytest.fixture(scope="module")
def g() -> svc.Graph:
    return svc.graph()


@pytest.fixture(scope="module")
def model() -> dict:
    return yaml.safe_load(svc.MODEL_PATH.read_text())


def _zterm_check(g: svc.Graph) -> str:
    return sorted(s for s, rel, _ in g.inn["field:LFB1.ZTERM"] if rel == "reads")[0].split(":", 1)[1]


def test_model_loads_and_covers_all_areas(g: svc.Graph):
    s = svc.model_summary(g)
    assert s["model_version"] >= 1
    for t in ("config", "object", "table", "field", "check", "step", "process", "feature", "kpi"):
        assert s["node_counts"].get(t), t
    kpis = {k["id"] for k in s["kpis"]}
    assert {"kpi:dpo", "kpi:dso", "kpi:otif", "kpi:inventory_turns", "kpi:ftr_invoice",
            "kpi:mtbf", "kpi:mttr", "kpi:asset_nbv_accuracy"} <= kpis
    procs = {p["id"] for p in s["processes"]}
    assert {"process:PTP", "process:OTC", "process:R2R", "process:P2PR", "process:MAINT"} <= procs


@pytest.mark.parametrize("mutate, msg", [
    (lambda m: m["processes"][0]["l2"][0]["steps"][0]["fields"].append("MARA.NOT_A_FIELD"), "MARA.NOT_A_FIELD"),
    (lambda m: m["objects"]["vendor"]["tables"].append("ZZNOPE"), "ZZNOPE"),
    (lambda m: m["objects"]["vendor"]["configs"].append("T999X"), "T999X"),
    (lambda m: m["kpis"]["dpo"]["steps"].append("NO-SUCH-STEP"), "NO-SUCH-STEP"),
    (lambda m: m["blast_radius"]["vendor"][0]["join"].update({"NOPE": "LIFNR"}), "NOPE"),
])
def test_invalid_model_rejected(model: dict, mutate, msg: str):
    bad = copy.deepcopy(model)
    mutate(bad)
    with pytest.raises(svc.LineageModelError, match=msg):
        svc.build_graph(bad)


def test_table_in_two_objects_rejected(model: dict):
    bad = copy.deepcopy(model)
    bad["objects"]["customer"]["tables"].append("LFA1")
    with pytest.raises(svc.LineageModelError):
        svc.build_graph(bad)


def test_field_downstream_reaches_kpi(g: svc.Graph):
    r = svc.lineage(g, svc.resolve_node(g, "LFB1.ZTERM"), "down", 8)
    ids = {n["id"] for n in r["nodes"]}
    assert "kpi:dpo" in ids
    assert all(n["depth"] >= 0 for n in r["nodes"])
    path = next(p for p in r["paths_to_kpis"] if p[-1] == "kpi:dpo")
    assert path[0] == "field:LFB1.ZTERM"
    for s, t in zip(path, path[1:]):  # every hop is a real edge
        assert (s, t) in g.edge_meta


def test_depth_limit(g: svc.Graph):
    r = svc.lineage(g, "field:LFB1.ZTERM", "down", 1)
    assert max(n["depth"] for n in r["nodes"]) == 1
    assert not r["paths_to_kpis"]


def test_kpi_upstream_includes_checks_and_fields(g: svc.Graph):
    r = svc.lineage(g, "kpi:dso", "up", 8)
    types = {n["type"] for n in r["nodes"]}
    assert {"check", "field", "step"} <= types
    assert all(n["depth"] <= 0 for n in r["nodes"])


def test_resolve_node(g: svc.Graph):
    assert svc.resolve_node(g, "lfb1.zterm") == "field:LFB1.ZTERM"
    assert svc.resolve_node(g, "LFA1") == "table:LFA1"
    assert svc.resolve_node(g, _zterm_check(g)).startswith("check:")
    with pytest.raises(KeyError):
        svc.resolve_node(g, "ZZ.NOPE")


def test_rollup(g: svc.Graph):
    cid = _zterm_check(g)
    findings = [
        {"check_id": cid, "severity": "high", "affected_count": 10},
        {"check_id": cid, "severity": "critical", "affected_count": 5},
        {"check_id": "NOT_A_RULE", "severity": "low", "affected_count": 3},
        {"check_id": cid, "severity": "low", "affected_count": 0},  # passing: ignored
    ]
    r = svc.rollup(g, findings)
    dpo = next(k for k in r["kpis"] if k["id"] == "kpi:dpo")
    assert dpo["findings"] == 2
    assert dpo["records_affected"] == 15 and dpo["max_records"] == 10
    assert dpo["worst_severity"] == "critical"
    assert "cost_at_risk" not in dpo
    assert "NOT_A_RULE" in r["unmapped_checks"]
    assert any(p["id"] == "process:PTP" for p in r["processes"])


def test_rollup_cost_only_when_present(g: svc.Graph):
    cid = _zterm_check(g)
    r = svc.rollup(g, [{"check_id": cid, "severity": "high", "affected_count": 4, "cost_at_risk": 12.5}])
    assert next(k for k in r["kpis"] if k["id"] == "kpi:dpo")["cost_at_risk"] == 12.5


def test_guards_and_coverage_gaps(g: svc.Graph):
    cid = _zterm_check(g)
    r = svc.guards(g, "kpi:dpo", {cid: {"pass_rate": 0.9, "affected_count": 1, "severity": "high"}})
    assert r["steps"]
    assert r["coverage_gaps"] == [s["id"] for s in r["steps"] if s["guard_count"] == 0]
    guarded = [s for s in r["steps"] if any(c["check_id"] == cid for f in s["fields"] for c in f["checks"])]
    assert guarded and guarded[0]["min_pass_rate"] == 0.9
    for s in r["steps"]:
        assert set(s["unguarded_fields"]) == {f["field"] for f in s["fields"] if not f["checks"]}


def test_parse_record_key():
    assert svc.parse_record_key("BUKRS=1000|LIFNR=0000100001") == {"BUKRS": "1000", "LIFNR": "0000100001"}
    assert svc.parse_record_key("row:17") is None


def test_count_blast():
    spec = {"table": "EKKO", "join": {"LIFNR": "LIFNR", "BUKRS": "BUKRS", "EKORG": "EKORG"},
            "where": {"LOEKZ": ""}, "doc_key": ["EBELN"]}
    doc = pd.DataFrame({
        "EBELN": ["1", "2", "3", "4", "4"],
        "LIFNR": ["V1", "V1", "V2", "V3", "V3"],
        "BUKRS": ["1000", "1000", "1000", "1000", "1000"],
        "LOEKZ": ["", "L", "", None, None],
    })
    # record grain LFB1 = LIFNR+BUKRS; EKORG not in key so join narrows to the usable fields
    keys = [{"LIFNR": "V1", "BUKRS": "1000"}, {"LIFNR": "V3", "BUKRS": "1000"}, {"LIFNR": "V9", "BUKRS": "1000"}]
    r = svc.count_blast(keys, doc, spec)
    assert r == {"rows": 3, "documents": 2, "objects_touched": 2,
                 "joined_on": ["EKKO.LIFNR=LIFNR", "EKKO.BUKRS=BUKRS"]}


def test_count_blast_needs_leading_join_field():
    spec = {"table": "EKKO", "join": {"LIFNR": "LIFNR", "BUKRS": "BUKRS"}}
    doc = pd.DataFrame({"LIFNR": ["V1"], "BUKRS": ["1000"]})
    assert svc.count_blast([{"BUKRS": "1000"}], doc, spec)["documents"] == 0


def test_lineage_routes_registered():
    from starlette.routing import Match

    from api.main import app
    paths = {getattr(r, "path", "") for r in app.routes}
    paths |= {x.path for r in app.routes if hasattr(r, "original_router") for x in r.original_router.routes}
    assert {"/api/v1/lineage/model", "/api/v1/lineage/graph", "/api/v1/lineage/impact/{version_id}",
            "/api/v1/lineage/blast-radius/{version_id}/{check_id}", "/api/v1/lineage/guards",
            "/api/v1/lineage/rule/{check_id}"} <= paths
    assert "/api/v1/lineage/{object_type}/{record_key}" not in paths  # legacy record lineage is gone

    # Nothing registered earlier shadows the lineage routes. Newer FastAPI keeps
    # each included router as one path-less _IncludedRouter entry, so descend into it.
    def first_match(routes, scope):
        for r in routes:
            if r.matches(scope)[0] == Match.FULL:
                hit = first_match(r.original_router.routes, scope) if hasattr(r, "original_router") else r
                if hit is not None:
                    return hit
        return None

    for path, want in (("/api/v1/lineage/rule/AP084", "/api/v1/lineage/rule/{check_id}"),
                       ("/api/v1/lineage/impact/x", "/api/v1/lineage/impact/{version_id}")):
        scope = {"type": "http", "path": path, "method": "GET", "root_path": ""}
        assert getattr(first_match(app.router.routes, scope), "path", "") == want


class _Res:
    def __init__(self, rows):
        self._rows = rows

    def first(self):
        return self._rows[0] if self._rows else None

    def all(self):
        return self._rows

    def mappings(self):
        return self


class _FakeDB:
    """Records SQL; answers findings queries with canned rows."""

    def __init__(self, findings):
        self.sql: list[tuple[str, dict]] = []
        self.findings = findings

    async def execute(self, stmt, params=None):
        s = str(stmt)
        self.sql.append((s, params or {}))
        if "information_schema" in s:
            return _Res([])
        if "FROM findings" in s:
            return _Res(self.findings)
        return _Res([])


def test_impact_route_scopes_by_tenant(g: svc.Graph):
    import asyncio
    import uuid

    from api.deps import Tenant
    from api.routes.lineage import ImpactResponse, get_impact

    tid = uuid.UUID("00000000-0000-0000-0000-0000000000aa")
    db = _FakeDB([{"check_id": _zterm_check(g), "severity": "high", "affected_count": 7}])
    body = asyncio.run(get_impact(str(uuid.uuid4()), db=db, tenant=Tenant(tid, "t", [])))
    ImpactResponse.model_validate(body)
    assert body["cost_available"] is False
    assert next(k for k in body["kpis"] if k["id"] == "kpi:dpo")["records_affected"] == 7
    assert any(str(tid) in s for s, _ in db.sql if s.startswith("SET app.tenant_id"))
    q = next((s, p) for s, p in db.sql if "FROM findings" in s)
    assert "tenant_id = :tid" in q[0] and q[1]["tid"] == str(tid)


def test_rule_lineage_route():
    import asyncio
    import uuid

    from fastapi import HTTPException

    from api.deps import Tenant
    from api.routes.lineage import get_rule_lineage

    tid = uuid.UUID("00000000-0000-0000-0000-0000000000ab")
    db = _FakeDB([])
    out = asyncio.run(get_rule_lineage("AP084", db=db, tenant=Tenant(tid, "t", [])))
    assert out["module"] == "accounts_payable"
    assert out["fields"] == ["LFB1.LNRZE"]
    assert out["targets"] == ["LFA1.LIFNR", "LFA1.LOEVM"]
    assert out["tables"] == ["LFB1", "LFA1"]
    assert out["joins"] == [{"parent": "LFA1", "child": "LFB1", "on": [["LIFNR", "LIFNR"]], "cardinality": "many"}]
    assert out["glossary_terms"] == [] and out["owners"] == []
    assert any(s.startswith(f"SET app.tenant_id = '{tid}'") for s, _ in db.sql)
    assert any("gtr.tenant_id = :tid" in s and p.get("cid") == "AP084" for s, p in db.sql)
    assert any("FROM data_owners d" in s and p.get("module") == "accounts_payable" for s, p in db.sql)

    try:
        asyncio.run(get_rule_lineage("NOPE999", db=_FakeDB([]), tenant=Tenant(tid, "t", [])))
        raise AssertionError("expected 404")
    except HTTPException as e:
        assert e.status_code == 404
