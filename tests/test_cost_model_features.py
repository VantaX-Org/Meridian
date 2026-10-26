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
             "features": {"MIGO": 150}}
    r = c.put("/api/v1/settings/cost-model", json=model, headers=H)
    assert r.status_code == 200, r.text
    assert db.stored is not None and db.stored["features"] == {"MIGO": 150}
    assert r.json()["effective"]["features"]["MIGO"] == 150
    bad = c.put("/api/v1/settings/cost-model", json={**model, "features": {"MIGO": -1}}, headers=H)
    assert bad.status_code == 422
