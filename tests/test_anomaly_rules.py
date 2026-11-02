"""Aletheia anomaly-to-rule: template mapping and the propose endpoint."""

import uuid

import pytest
import yaml
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.deps import Tenant, get_db, get_tenant
from api.routes import aletheia_anomaly_rules as route
from api.services import anomaly_rules as ar
from api.services import rule_authoring as ra
from sap.ddic import get_dictionary

FIELD = "LFA1.LAND1"
D = get_dictionary("s4hana")


def _rule(**a):
    return ar.template_rule({"field": FIELD, **a})


def test_outlier_maps_to_cross_field_bound():
    r = _rule(kind="outlier", lower=0.0, upper=100.5, severity="high")
    assert r["check_class"] == "cross_field_check" and r["severity"] == "high"
    assert r["fail_when"] == f"(`{FIELD}` < 0) | (`{FIELD}` > 100.5)"
    assert _rule(kind="outlier", upper=5)["fail_when"] == f"(`{FIELD}` > 5)"


def test_null_spike_and_unexpected_code():
    assert _rule(kind="null_spike")["check_class"] == "null_check"
    r = _rule(kind="unexpected_code", known_values=["2", "1", "1"])
    assert r["check_class"] == "domain_value_check" and r["allowed_values"] == ["1", "2"]


def test_missing_data_yields_no_template():
    assert _rule(kind="outlier") is None
    assert _rule(kind="unexpected_code", known_values=[]) is None
    assert _rule(kind="unexpected_code", known_values=[str(i) for i in range(60)]) is None
    assert ar.template_rule({"kind": "null_spike", "field": "BU_TYPE"}) is None  # unqualified
    assert _rule(kind="bogus") is None


@pytest.mark.parametrize("a", [{"kind": "outlier", "upper": 9}, {"kind": "null_spike"},
                               {"kind": "unexpected_code", "known_values": ["1"]}])
def test_templates_pass_ddic_validation(a):
    rule, errors = ra.validate_rule_yaml(ar.to_yaml(_rule(**a)), "accounts_payable", D)
    assert not errors and rule


def test_describe_carries_aggregates_only():
    s = ar.describe({"kind": "outlier", "field": FIELD, "module": "accounts_payable", "z_score": 4.2, "count": 7,
                     "known_values": ["SECRET-A"], "record_key": "PARTNER=123"})
    assert "SECRET-A" not in s and "PARTNER=123" not in s and "4.2" in s and "7" in s


def test_confidence():
    assert ar.confidence("template", True, {"evaluated": True, "hits": 3})["level"] == "high"
    assert ar.confidence("llm", True, {"evaluated": True, "hits": 3})["level"] == "medium"
    assert ar.confidence("template", True, {"evaluated": True, "hits": 0})["level"] == "low"
    assert ar.confidence("template", False, {})["level"] == "low"


class _DB:
    async def execute(self, *_a, **_k):
        class R:
            def fetchone(self):
                return None
        return R()


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("MERIDIAN_DEV_ROLE_HEADER", "1")
    seen = {}

    async def latest(*_a):
        return (uuid.uuid4(), {"dataset_path": "x"})

    async def dictionary(*_a):
        return D

    async def dry(body, *_a):
        seen["yaml"] = body.rule_yaml
        return {"version_id": "v1", "evaluated": True, "hits": 4, "population": 100, "pass_rate": 96.0, "sample": []}

    monkeypatch.setattr(route.route, "_latest", latest)
    monkeypatch.setattr(route.route, "_dictionary", dictionary)
    monkeypatch.setattr(route.route, "dry_run", dry)
    api = FastAPI()
    api.include_router(route.router)

    async def _db():
        yield _DB()

    api.dependency_overrides[get_db] = _db
    api.dependency_overrides[get_tenant] = lambda: Tenant(uuid.uuid4(), "D", [])
    c = TestClient(api)
    c.seen = seen
    return c


URL = "/api/v1/aletheia/anomaly-rules/propose"
ADMIN = {"X-User-Role": "admin"}
PAYLOAD = {"payload": {"kind": "outlier", "module": "accounts_payable", "field": FIELD, "upper": 9, "count": 5}}


def test_propose_template_with_dry_run(client):
    r = client.post(URL, json=PAYLOAD, headers=ADMIN)
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["source"] == "template" and j["valid"] and j["dry_run"]["hits"] == 4
    assert yaml.safe_load(j["rule_yaml"])["check_class"] == "cross_field_check"
    assert j["grounding"]["anomaly_count"] == 5 and j["grounding"]["rule_hits"] == 4
    assert j["grounding"]["ai_sent"] == [] and j["confidence"]["level"] == "high"
    assert client.seen["yaml"] == j["rule_yaml"]


def test_propose_without_template_and_no_llm_is_graceful(client, monkeypatch):
    monkeypatch.setattr("llm.provider.is_llm_disabled", lambda: True)
    p = {"payload": {"kind": "outlier", "module": "accounts_payable", "field": FIELD}}
    j = client.post(URL, json=p, headers=ADMIN).json()
    assert j["rule_yaml"] is None and not j["valid"] and j["source"] == "llm"


def test_llm_fallback_is_validated(client, monkeypatch):
    monkeypatch.setattr("llm.provider.is_llm_disabled", lambda: False)
    sent = {}

    def gen(tid, desc, ctx):
        sent["desc"] = desc
        return "id: X\nfield: NOPE.NOPE\ncheck_class: null_check\n"

    monkeypatch.setattr(ra, "generate", gen)
    p = {"payload": {"kind": "outlier", "module": "accounts_payable", "field": FIELD}}
    j = client.post(URL, json=p, headers=ADMIN).json()
    assert j["source"] == "llm" and not j["valid"] and j["errors"] and not j["dry_run"]["evaluated"]
    assert FIELD in sent["desc"]


def test_needs_exactly_one_input_and_permission(client):
    assert client.post(URL, json={}, headers=ADMIN).status_code == 422
    assert client.post(URL, json=PAYLOAD, headers={"X-User-Role": "viewer"}).status_code == 403
    r = client.post(URL, json={"anomaly_id": str(uuid.uuid4())}, headers=ADMIN)
    assert r.status_code == 404  # unknown anomaly
