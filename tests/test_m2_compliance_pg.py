"""Data residency and retention statement against a real Postgres (MERIDIAN_TEST_DB_URL): unknowns are null,
retention days come from the tenant's policy and are set with validation, the last backup is the newest manifest
that scripts/backup.sh wrote, and the statement is admin only and tenant-scoped."""
from __future__ import annotations

import json
import os

import pytest
from sqlalchemy import create_engine, text

from tests.m2_client import headers, make_client

pytestmark = pytest.mark.skipif(not os.environ.get("MERIDIAN_TEST_DB_URL"), reason="MERIDIAN_TEST_DB_URL not set")


@pytest.fixture(scope="module")
def owner():
    eng = create_engine(os.environ["MERIDIAN_TEST_DB_URL"])
    yield eng
    eng.dispose()


async def start(monkeypatch, tid, sub):
    deps, client = make_client(monkeypatch, tid, sub)
    await deps.engine.dispose()
    return client


@pytest.mark.anyio
async def test_compliance_statement(owner, monkeypatch, tmp_path):
    from tests.landscape_seed import seed

    for name in ("MERIDIAN_DB_ENCRYPTED_AT_REST", "MERIDIAN_OBJECT_STORAGE_ENCRYPTED_AT_REST", "LLM_KEK"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("MERIDIAN_BACKUP_DIR", str(tmp_path / "none"))
    monkeypatch.setattr("api.config.settings.llm_provider", "ollama")
    monkeypatch.setattr("api.config.settings.ollama_base_url", "http://ollama:11434")
    monkeypatch.setattr("api.config.settings.minio_endpoint", "garage:3900")
    monkeypatch.setattr("api.config.settings.credential_master_key", None)
    s, other = seed(owner, with_run=False), seed(owner, with_run=False)
    with owner.begin() as c:
        c.execute(text("UPDATE tenants SET retention = CAST(:r AS jsonb) WHERE id = :t"),
                  {"r": json.dumps({"versions_days": 400, "keep_latest_per_system": 2}), "t": s["tid"]})
    client = await start(monkeypatch, s["tid"], s["user"])
    async with client:
        assert (await client.get("/api/v1/settings/compliance", headers=headers("viewer"))).status_code == 403
        r = await client.get("/api/v1/settings/compliance", headers=headers())
        assert r.status_code == 200, r.text
        st = r.json()
        assert set(st) == {"generated_at", "data_residency", "retention", "encryption_at_rest", "backup"}
        res = st["data_residency"]
        assert res["deployment"] == "customer_hosted" and res["object_storage_host"] == "garage"
        assert res["database_host"] and res["llm_provider"] == "ollama" and res["llm_in_deployment"] is True
        fam = {f["family"]: f for f in st["retention"]["families"]}
        assert fam["analysis_versions"]["days"] == 400 and fam["reports"]["days"] is None
        assert fam["audit_log"]["days"] is None and fam["health_samples"] == {
            "family": "health_samples", "label": "Health samples", "days": 35, "configurable": False}
        assert st["retention"]["keep_latest_per_system"] == 2 and st["retention"]["keep_baseline"] is True
        assert st["encryption_at_rest"] == {"database_volume": None, "object_storage": None,
                                            "sap_credentials": False, "llm_api_keys": False}
        assert st["backup"] is None  # nothing recorded: null, not a guess

        # facts appear only once the environment or a backup states them
        monkeypatch.setenv("MERIDIAN_DB_ENCRYPTED_AT_REST", "true")
        monkeypatch.setenv("MERIDIAN_OBJECT_STORAGE_ENCRYPTED_AT_REST", "false")
        monkeypatch.setenv("MERIDIAN_BACKUP_DIR", str(tmp_path))
        for stamp, at in (("20261027_010000", "2026-10-27T01:00:00Z"), ("20261028_010000", "2026-10-28T01:00:00Z")):
            (tmp_path / stamp).mkdir()
            (tmp_path / stamp / "manifest.json").write_text(json.dumps({
                "backup_at_utc": at, "hostname": "h", "migration_head": "103", "database_only": False,
                "encrypted_env": True}))
        monkeypatch.setattr("api.config.settings.llm_provider", "anthropic")
        st = (await client.get("/api/v1/settings/compliance", headers=headers())).json()
        assert st["encryption_at_rest"]["database_volume"] is True and st["encryption_at_rest"]["object_storage"] is False
        assert st["backup"] == {"at": "2026-10-28T01:00:00Z", "migration_head": "103", "database_only": False,
                                "env_encrypted": True}
        assert st["data_residency"]["llm_in_deployment"] is False

        # retention days: validated, partial, null keeps for ever, the rest of the policy kept
        for bad in ({"retention": {"audit_days": 7}}, {"retention": {"versions_days": 0}},
                    {"retention": {"versions_days": 99999}}, {"retention": {"health_days": 3}}, {"versions_days": 30}):
            r = await client.put("/api/v1/settings/compliance", headers=headers(), json=bad)
            assert r.status_code == 422, (bad, r.text)
        r = await client.put("/api/v1/settings/compliance", headers=headers(),
                             json={"retention": {"reports_days": 90, "audit_days": 365}})
        assert r.status_code == 200, r.text
        fam = {f["family"]: f["days"] for f in r.json()["retention"]["families"]}
        assert (fam["analysis_versions"], fam["reports"], fam["audit_log"]) == (400, 90, 365)
        r = await client.put("/api/v1/settings/compliance", headers=headers(), json={"retention": {"versions_days": None}})
        assert {f["family"]: f["days"] for f in r.json()["retention"]["families"]}["analysis_versions"] is None
        assert (await client.put("/api/v1/settings/compliance", headers=headers("viewer"),
                                 json={"retention": {"reports_days": 1}})).status_code == 403
        # the same policy the retention endpoint serves
        pol = (await client.get("/api/v1/settings/retention", headers=headers())).json()["policy"]
        assert (pol["versions_days"], pol["reports_days"], pol["audit_days"], pol["keep_latest_per_system"]) == \
            (None, 90, 365, 2)
    with owner.connect() as c:
        stored = c.execute(text("SELECT retention FROM tenants WHERE id = :t"), {"t": s["tid"]}).scalar()
        assert stored["updated_at"]  # the nightly dry-run window restarts, as with PUT /settings/retention
        untouched = c.execute(text("SELECT retention FROM tenants WHERE id = :t"), {"t": other["tid"]}).scalar()
        assert untouched == {}
        n = c.execute(text("SELECT count(*) FROM audit_log WHERE tenant_id = :t AND entity_type = 'retention_policy'"),
                      {"t": s["tid"]}).scalar()
        assert n == 2
