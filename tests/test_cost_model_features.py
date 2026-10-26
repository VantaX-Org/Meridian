"""The cost model's per-feature values: the features a value can be set for come from the config
impact rules, and PUT /settings/cost-model stores ``features`` (Rules, Scoring and alerts)."""

import json
import uuid

import pytest
import yaml
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.deps import Tenant, get_db, get_tenant
from api.routes import settings
from api.services.insights_impact import impact_features


class _Db:
    def __init__(self) -> None:
        self.stored: dict | None = None

    async def execute(self, stmt, params=None):
        if "UPDATE tenants SET cost_model" in str(stmt):
            self.stored = json.loads(params["m"])
        return None

    async def commit(self) -> None:
        return None


@pytest.fixture(autouse=True)
def _dev_roles(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("MERIDIAN_DEV_ROLE_HEADER", "1")


def _client(db: _Db) -> TestClient:
    app = FastAPI()
    app.include_router(settings.router)

    async def _get_db():
        yield db

    app.dependency_overrides[get_db] = _get_db
    app.dependency_overrides[get_tenant] = lambda: Tenant(uuid.uuid4(), "T", [])
    return TestClient(app)


H = {"X-User-Role": "admin"}
FEATURE = "Account Determination"  # a target_feature of db/seeds/config_impact_rules.yaml


def test_features_are_every_target_feature_of_the_impact_rules_once() -> None:
    with open("db/seeds/config_impact_rules.yaml") as f:
        expected = {r["target_feature"] for r in yaml.safe_load(f)["rules"] if r.get("target_feature")}
    feats = impact_features()
    assert [x["feature"] for x in feats] == sorted(expected)
    body = _client(_Db()).get("/api/v1/settings/cost-model/features", headers=H).json()
    assert body["features"] == feats


def test_put_stores_feature_values_and_rejects_a_negative_one() -> None:
    db = _Db()
    c = _client(db)
    model = {"currency": "ZAR", "severity": {"critical": {"per_record": 500}}, "modules": {}, "rules": {},
             "features": {FEATURE: 150}}
    r = c.put("/api/v1/settings/cost-model", json=model, headers=H)
    assert r.status_code == 200, r.text
    assert db.stored is not None and db.stored["features"] == {FEATURE: 150}
    assert r.json()["effective"]["features"][FEATURE] == 150
    bad = c.put("/api/v1/settings/cost-model", json={**model, "features": {FEATURE: -1}}, headers=H)
    assert bad.status_code == 422


def test_put_rejects_unknown_features_non_finite_and_huge_numbers_and_oversized_sections() -> None:
    db = _Db()
    c = _client(db)
    base = {"currency": "ZAR", "severity": {}, "modules": {}, "rules": {}}

    def put(raw: str):
        return c.put("/api/v1/settings/cost-model", content=raw, headers={**H, "Content-Type": "application/json"})

    def body(**kw) -> str:
        return json.dumps({**base, **kw})

    assert put(body(features={"NOT_A_FEATURE": 1})).status_code == 422
    # NaN / Infinity are JSON extensions Python's parser accepts: refused in typed and nested fields alike
    for raw in ('{"features": {"%s": Infinity}}' % FEATURE, '{"features": {"%s": NaN}}' % FEATURE,
                '{"subscription_monthly": Infinity}', '{"config_alignment": {"x": NaN}}',
                '{"severity": {"critical": {"per_record": Infinity}}}',
                '{"impact": {"duplicate": {"unit_cost": NaN}}}',
                '{"rules": {"r1": {"per_record": 1, "factor": 1e300}}}'):
        r = put(raw)
        assert r.status_code == 422, (raw, r.text)
    assert put(body(features={FEATURE: 1e13})).status_code == 422
    assert put(body(subscription_monthly=1e13)).status_code == 422
    big = {f"m{i}": {"per_record": 1} for i in range(501)}
    assert put(body(modules=big)).status_code == 422
    assert db.stored is None
    assert put(body(features={FEATURE: 1e9}, subscription_monthly=50000)).status_code == 200
