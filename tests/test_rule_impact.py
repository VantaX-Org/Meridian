"""Rule impact dry run (api/routes/rule_impact.py, api/services/rule_impact.py): synthetic, non-personal vendor ids."""

import uuid

import pandas as pd
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.deps import Tenant, get_db, get_tenant
from api.routes import rule_impact
from api.services import simulate_fix as sf
from checks.frames import TableFrames
from sap.ddic import get_dictionary

DDIC = get_dictionary("ecc6")
MODULE = "accounts_payable"
ADMIN = {"X-User-Role": "admin"}
# AP002 (LFA1.LIFNR, regex ^[A-Z0-9]{1,10}$) is the shipped rule under test.
# "bad!", "abc" and the 11-character id fail it; the other five pass.
IDS = ["100001", "100002", "ABC", "X9", "bad!", "abc", "12345678901", "200001"]


class _Result:
    def __init__(self, v):
        self.v = v

    def scalar(self):
        return self.v


class _DB:
    def __init__(self):
        self.statements: list[str] = []
        self.committed = False

    async def execute(self, stmt, _params=None):
        self.statements.append(str(stmt))
        return _Result({"dataset_path": "s3://x/y"})

    async def commit(self):
        self.committed = True


def _frames(ids=IDS):
    return TableFrames({"LFA1": pd.DataFrame({"LFA1.LIFNR": ids})}, DDIC, module=MODULE)


def _run():
    # One stored finding for another rule so the object has a measured score to move.
    finding = {"check_id": "AP003", "finding_type": "rule", "severity": "critical", "dimension": "completeness",
               "affected_count": 1, "total_count": 8, "pass_rate": 87.5, "details": {"field_checked": "LFA1.NAME1"}}
    return sf.ObjectRun(module=MODULE, run_id=str(uuid.uuid4()), run_at=None, system_id=None,
                        summary={}, findings=[finding], raw_cfg={})


@pytest.fixture(autouse=True)
def _dev_roles(monkeypatch):
    monkeypatch.setenv("MERIDIAN_DEV_ROLE_HEADER", "1")


@pytest.fixture
def setup(monkeypatch):
    state = {"frames": _frames(), "run": _run()}

    async def _load_run(*_a, **_k):
        return state["run"]

    async def _dict(*_a):
        return DDIC

    async def _rls(*_a):
        return None

    monkeypatch.setattr(sf, "load_object_run", _load_run)
    monkeypatch.setattr(rule_impact, "_dictionary", _dict)
    monkeypatch.setattr(rule_impact, "_rls", _rls)
    monkeypatch.setattr(rule_impact, "_load_frames", lambda meta, d, rule: state["frames"])
    api = FastAPI()
    api.include_router(rule_impact.router)
    db = _DB()

    async def _db():
        yield db

    api.dependency_overrides[get_db] = _db
    api.dependency_overrides[get_tenant] = lambda: Tenant(uuid.uuid4(), "D", [])
    return TestClient(api), db, state


def _post(client, **body):
    return client.post("/api/v1/rules/impact-dry-run", json={"module": MODULE, **body}, headers=ADMIN)


def test_existing_rule_counts_and_score(setup):
    client, _, _ = setup
    r = _post(client, rule_id="AP002")
    assert r.status_code == 200, r.text
    b = r.json()
    assert b["mode"] == "edit" and b["evaluated"]
    assert (b["records_evaluated"], b["records_failing"]) == (8, 3)
    assert b["failure_rate"] == 37.5
    assert b["dqs"]["after"] < b["dqs"]["before"] and b["dqs"]["delta"] < 0
    assert sum(s["count"] for s in b["failing_shapes"]) == 3
    assert not any(v in str(b["failing_shapes"]) for v in ("bad!", "abc"))  # shapes, never raw values
    assert b["delta"]["newly_failing"] == 0 and b["delta"]["newly_passing"] == 0


def test_edit_reports_delta_against_current_rule(setup):
    client, _, _ = setup
    stricter = _post(client, rule_id="AP002", rule={"pattern": "^[0-9]{1,10}$"}).json()
    assert stricter["delta"]["current_failing"] == 3
    assert stricter["delta"]["newly_failing"] == 2  # ABC and X9 now fail; the digits-only ids still pass
    assert stricter["delta"]["newly_passing"] == 0
    looser = _post(client, rule_id="AP002", rule={"pattern": "^[A-Za-z0-9]{1,10}$"}).json()
    assert looser["delta"]["newly_passing"] == 1  # "abc" now passes
    assert looser["delta"]["newly_failing"] == 0
    assert looser["records_failing"] < 3 < stricter["records_failing"]


def test_nothing_is_written(setup):
    client, db, _ = setup
    assert _post(client, rule_id="AP002").status_code == 200
    assert db.statements and not db.committed
    assert all(s.lstrip().upper().startswith("SELECT") for s in db.statements)


def test_row_cap_is_honoured_and_stated(setup):
    client, _, state = setup
    ids = [f"V{n:06d}" for n in range(2500)] + ["bad!"] * 100  # the 100 bad ids sit after the cap
    state["frames"] = _frames(ids)
    b = _post(client, rule_id="AP002", row_cap=1000).json()
    assert b["row_cap"]["cap"] == 1000 and b["row_cap"]["sampled"]
    assert b["row_cap"]["tables_cut"] == {"LFA1": 2600}
    assert b["sample"]["records_evaluated"] == 1000 and b["sample"]["records_failing"] == 0
    assert b["records_evaluated"] == 2600  # counts scaled to the full table
    uncut = _post(client, rule_id="AP002", row_cap=200000).json()
    assert not uncut["row_cap"]["sampled"] and uncut["records_failing"] == 100


def test_new_draft_rule(setup):
    client, _, _ = setup
    draft = {"id": "ZZ001", "field": "LFA1.LIFNR", "check_class": "regex_check", "pattern": "^[0-9]+$",
             "severity": "high", "dimension": "validity", "message": "Vendor number must be numeric"}
    b = _post(client, rule=draft).json()
    assert b["mode"] == "new" and "delta" not in b and b["records_failing"] == 4


def test_errors(setup):
    client, _, state = setup
    assert _post(client, rule_id="NOPE").status_code == 404
    assert _post(client).status_code == 422
    assert _post(client, rule={"field": "LFA1.LIFNR"}).status_code == 422  # no id
    bad = _post(client, rule_id="AP002", rule={"field": "LFA1.NOT_A_FIELD"})
    assert bad.status_code == 422 and bad.json()["detail"]["errors"]
    state["run"] = None
    assert _post(client, rule_id="AP002").status_code == 404


def test_needs_manage_rules(setup):
    client, _, _ = setup
    r = client.post("/api/v1/rules/impact-dry-run", json={"module": MODULE, "rule_id": "AP002"},
                    headers={"X-User-Role": "viewer"})
    assert r.status_code == 403
