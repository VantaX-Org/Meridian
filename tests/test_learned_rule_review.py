"""DDIC-anchored review of mined house rules: lift, anchors, out-of-dictionary values, redundancy."""
import json
import uuid

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.deps import Tenant, get_db, get_tenant
from api.routes import learned_rules as route
from api.services import learned_rule_review as lrr
from sap.ddic import get_dictionary

D = get_dictionary("s4hana")


def _stats(values, rows=None, blank=0, distinct=None, **kw):
    tv = [{"value": v, "count": c} for v, c in values.items()]
    return {"rows": rows if rows is not None else sum(values.values()) + blank, "blank": blank,
            "distinct": distinct if distinct is not None else len(tv), "masked": False, "top_values": tv, **kw}


def test_lift_single_group_is_confidence_over_base_rate():
    body = {"allowed": {"1000": ["001"]}}
    dep = _stats({"001": 250, "002": 750})
    out = lrr.lift("dependency", body, 0.95, None, dep, False)
    assert out["expected"] == 0.25 and out["lift"] == 3.8 and out["reason"] is None


def test_lift_weights_groups_by_determinant_counts():
    body = {"allowed": {"A": ["x"], "B": ["y"]}}
    det = _stats({"A": 300, "B": 100})
    dep = _stats({"x": 200, "y": 200})          # base(A)=0.5, base(B)=0.5
    out = lrr.lift("value_set", body, 1.0, det, dep, True)
    assert out["expected"] == 0.5 and out["lift"] == 2.0


def test_lift_not_derivable_when_value_hidden_past_top_values():
    body = {"allowed": {"A": ["z"]}}
    dep = _stats({"x": 900}, distinct=40)       # truncated: z may sit past the listed values
    out = lrr.lift("dependency", body, 0.9, None, dep, True)
    assert out["lift"] is None and "top values" in out["reason"]


def test_lift_not_derivable_for_masked_profile_or_other_kinds():
    assert lrr.lift("dependency", {"allowed": {"A": ["x"]}}, 0.9, None,
                    {"masked": True, "mask_reason": "privacy", "top_values": None}, True)["lift"] is None
    assert "only" in lrr.lift("format", {}, 0.9, None, None, True)["reason"]


def test_anchor_reads_ddic_of_real_field():
    a = lrr.anchor(D, "MARC.DISPO")
    assert a["known"] and a["check_table"] == "T024D" and a["check_field"] == "DISPO" and a["data_element"]
    assert not lrr.anchor(D, "MARC.NOT_A_FIELD")["known"]


def test_redundant_when_check_table_is_keyed_by_the_determinant():
    red, why = lrr.redundant("dependency", D, "MARC.WERKS", "MARC.DISPO")
    assert red and "T024D" in why
    red, _ = lrr.redundant("dependency", D, "MARA.MTART", "MARA.MATKL")
    assert not red


def test_out_of_dictionary_prefers_live_then_baseline():
    fld = D.field("MARA", "MATKL")
    live = {"T023": [{"MATKL": "001"}, {"MATKL": "002"}]}
    base = {"T023": [{"MATKL": "001"}]}
    assert lrr.out_of_dictionary(["001", "002", "910"], fld, live, base) == \
        {"values": ["910"], "source": "live", "checked": 2}
    assert lrr.out_of_dictionary(["001", "002"], fld, {}, base)["source"] == "baseline"
    assert lrr.out_of_dictionary(["001"], fld, {}, {})["source"] == "unverified"


def test_out_of_dictionary_uses_domain_fixed_values():
    fld = D.field("MARA", "KZKFG")
    out = lrr.out_of_dictionary(["X", "Q"], fld, {}, {})
    assert out == {"values": ["Q"], "source": "domain", "checked": 2}


class _Result:
    def __init__(self, rows):
        self.rows = rows

    def mappings(self):
        return self

    def all(self):
        return self.rows


VID = str(uuid.uuid4())


class _DB:
    def __init__(self):
        self.sql = []

    async def execute(self, stmt, params=None):
        q = str(stmt)
        self.sql.append((q, params))
        if "FROM learned_rule_proposals" in q:
            return _Result([{
                "id": uuid.uuid4(), "version_id": VID, "module": "material_master", "kind": "dependency",
                "source": "data", "status": "pending", "table_name": "MARC", "determinant": "MARC.WERKS",
                "field": "MARC.DISPO", "body": json.dumps({"allowed": {"1000": ["001"]}}), "confidence": 0.9,
                "support_rows": 500, "violations": 50, "sample_keys": json.dumps([{"MATNR": "M1", "WERKS": "1000"}])}])
        if "FROM field_profiles" in q:
            return _Result([{"version_id": VID, "table_name": "MARC", "field": "DISPO",
                             "stats": _stats({"001": 300, "002": 300})}])
        return _Result([])


@pytest.fixture(autouse=True)
def _dev_roles(monkeypatch):
    monkeypatch.setenv("MERIDIAN_DEV_ROLE_HEADER", "1")


def test_route_returns_review_with_lift_anchor_and_redundancy():
    api = FastAPI()
    api.include_router(route.router)
    db = _DB()

    async def _db():
        yield db

    api.dependency_overrides[get_db] = _db
    api.dependency_overrides[get_tenant] = lambda: Tenant(uuid.uuid4(), "T", ["*"])
    r = TestClient(api).get("/api/v1/learned-rules/review", params={"module": "material_master"},
                            headers={"X-User-Role": "viewer"})
    assert r.status_code == 200, r.text
    item = r.json()["items"][0]
    assert item["lift"]["expected"] == 0.5 and item["lift"]["lift"] == 1.8
    assert item["field_anchor"]["check_table"] == "T024D" and item["redundant"] is True
    assert item["sample_keys"] == [{"MATNR": "M1", "WERKS": "1000"}]
    assert all("tenant_id = :t" in q for q, _ in db.sql if "SELECT" in q and "set_config" not in q)


def test_value_set_without_determinant_is_not_redundant_and_says_why():
    red, why = lrr.redundant("value_set", D, None, "MARA.SPART")
    assert not red and "TSPA" in why and "narrower" in why
