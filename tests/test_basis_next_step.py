"""F20: a refused sign-in comes before extracting: the classification of a failure and Basis's next step."""
from __future__ import annotations

import os

import pytest
from sqlalchemy import create_engine, text

from api.services.sign_in import basis_next_step, failed_sign_ins, failure_status, is_auth_failure


@pytest.mark.parametrize("msg", ["OData refused credentials (HTTP 401)", "HTTP 403 Forbidden", "RFC_LOGON_FAILURE",
                                 "Name or password is incorrect (repeat logon)", "OAuth token request failed: invalid_client",
                                 "Unauthorized"])
def test_refused_credentials_are_a_sign_in_failure(msg):
    assert is_auth_failure(msg) and failure_status(msg) == "auth_failed"


@pytest.mark.parametrize("msg", ["Connection refused", "timed out after 30 s", "Name or service not known", None, ""])
def test_anything_else_is_unreachable(msg):
    assert not is_auth_failure(msg) and failure_status(msg) == "unreachable"


SYSTEMS = [{"id": "a", "name": "ECC production", "state": "analysed", "sign_in_failed": False},
           {"id": "b", "name": "SuccessFactors", "state": "not_extracted", "sign_in_failed": True},
           {"id": "c", "name": "Sandbox", "state": "extracted", "sign_in_failed": False}]


def test_fix_the_sign_in_comes_before_extracting():
    step = basis_next_step(SYSTEMS)
    assert step == {"kind": "fix_sign_in", "system_id": "b", "system_name": "SuccessFactors",
                    "label": "Fix the sign-in for SuccessFactors", "href": "/s/b?open=connection:b"}
    ok = [{**s, "sign_in_failed": False} for s in SYSTEMS]
    assert basis_next_step(ok)["label"] == "Extract SuccessFactors"
    assert basis_next_step([ok[0], ok[2]])["label"] == "Run analysis on Sandbox"
    assert basis_next_step([ok[0]])["kind"] == "open" and basis_next_step([]) is None


def test_only_the_latest_job_of_a_system_counts():
    jobs = [{"system_id": "b", "kind": "extraction", "status": "failed", "error": "OData refused credentials (HTTP 401)"},
            {"system_id": "a", "kind": "extraction", "status": "completed", "error": None},
            {"system_id": "a", "kind": "extraction", "status": "failed", "error": "HTTP 401"},
            {"system_id": "c", "kind": "extraction", "status": "failed", "error": "Connection refused"},
            {"system_id": "d", "kind": "analysis", "status": "failed", "error": "HTTP 401"}]
    assert failed_sign_ins(jobs) == {"b"}


@pytest.mark.skipif(not os.environ.get("MERIDIAN_TEST_DB_URL"), reason="MERIDIAN_TEST_DB_URL not set")
@pytest.mark.anyio
async def test_the_landscape_names_the_system_whose_sign_in_was_refused(monkeypatch):
    from tests.landscape_seed import seed
    from tests.m2_client import headers, make_client

    owner = create_engine(os.environ["MERIDIAN_TEST_DB_URL"])
    try:
        s = seed(owner)
        monkeypatch.setattr("api.services.jobs.list_jobs", lambda tid, **kw: [])
        deps, client = make_client(monkeypatch, s["tid"], s["user"])
        await deps.engine.dispose()
        async with client:
            body = (await client.get("/api/v1/landscape", headers=headers())).json()
            assert body["basis_next_step"]["kind"] == "extract"
            assert body["basis_next_step"]["system_id"] == s["spare"]
            from api.middleware.cache import mark_work_changed
            with owner.begin() as c:
                c.execute(text("UPDATE sap_systems SET health_status = 'auth_failed' WHERE id = :s"), {"s": s["ecc"]})
                mark_work_changed(c, s["tid"])  # the landscape is cached for 30 s
            body = (await client.get("/api/v1/landscape", headers=headers())).json()
            ecc = next(x for x in body["systems"] if x["id"] == s["ecc"])
            assert ecc["sign_in_failed"] is True
            assert body["basis_next_step"]["kind"] == "fix_sign_in" and body["basis_next_step"]["system_id"] == s["ecc"]
    finally:
        owner.dispose()
