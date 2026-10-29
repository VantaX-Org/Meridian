"""Status page, health samples and the diagnostics bundle against a real Postgres (MERIDIAN_TEST_DB_URL).

The status page is public (no Authorization header) and names the tenant with ?tenant=. Component probes are
replaced by fixed results where a test needs exact figures; one test runs the real probes (Redis, workers and
object storage are not running here, so they report down, within their timeouts).
"""
from __future__ import annotations

import io
import json
import os
import uuid
import zipfile
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import create_engine, text

from tests.m2_client import headers, make_client

pytestmark = pytest.mark.skipif(not os.environ.get("MERIDIAN_TEST_DB_URL"), reason="MERIDIAN_TEST_DB_URL not set")

RECORD_PATH = "/api/v1/work/records/material_master/MATNR=000000000000000101|WERKS=3000"


@pytest.fixture(scope="module")
def owner():
    eng = create_engine(os.environ["MERIDIAN_TEST_DB_URL"])
    yield eng
    eng.dispose()


async def start(monkeypatch, tid, sub):
    deps, client = make_client(monkeypatch, tid, sub)
    await deps.engine.dispose()
    return client


def fixed_components(monkeypatch, workers_status: str = "up"):
    from api.routes import status_page
    from api.services.health_probe import LABELS, Component

    comps = [Component("api", LABELS["api"], "up", 0), Component("db", LABELS["db"], "up", 2),
             Component("redis", LABELS["redis"], "up", 1),
             Component("workers", LABELS["workers"], workers_status, 900, None,
                       {"online": 2, "queues": [{"name": "celery", "depth": 3}]}),
             Component("garage", LABELS["garage"], "up", 5)]
    monkeypatch.setattr(status_page, "_components_now", lambda: comps)
    from api.routes import diagnostics
    monkeypatch.setattr(diagnostics, "_components_now", lambda: comps)
    return comps


def server_error(c, tid, ref, path, at):
    c.execute(text("INSERT INTO audit_log (tenant_id, actor_email, action, entity_type, entity_id, method, path, "
                   "status_code, ip, after_json, created_at) VALUES (:t, 'ann@example.com', 'server_error', 'request', "
                   ":r, 'GET', :p, 500, '10.1.2.3', CAST(:a AS jsonb), :at)"),
              {"t": tid, "r": ref, "p": path, "a": json.dumps({"reference": ref}), "at": at})


@pytest.mark.anyio
async def test_status_page_shape(owner, monkeypatch):
    from tests.landscape_seed import seed

    s = seed(owner, with_run=False)
    tid = s["tid"]
    now = datetime.now(timezone.utc)
    slot = now.replace(minute=now.minute - now.minute % 5, second=0, microsecond=0)
    with owner.begin() as c:
        server_error(c, tid, "aa11bb22", RECORD_PATH, now - timedelta(hours=2))
        server_error(c, tid, "aa11bb22", "/api/v1/landscape", now - timedelta(hours=1))
        server_error(c, tid, "cc33dd44", "/api/v1/objects/material_master/receipt", now - timedelta(minutes=5))
        server_error(c, tid, "old00000", "/api/v1/landscape", now - timedelta(hours=30))
        # four slots: one with the database down, one with only object storage down (not core)
        for n, (db, garage) in enumerate((("up", "up"), ("down", "up"), ("up", "down"), ("up", "up"))):
            at = slot - timedelta(minutes=5 * (n + 1))
            for comp, st in (("api", "up"), ("db", db), ("redis", "up"), ("workers", "up"), ("garage", garage)):
                c.execute(text("INSERT INTO health_samples (tenant_id, sampled_at, component, status) "
                               "VALUES (:t, :at, :c, :s)"), {"t": tid, "at": at, "c": comp, "s": st})
    fixed_components(monkeypatch)
    client = await start(monkeypatch, tid, s["user"])
    async with client:
        past = {"title": "Past", "starts_at": (now - timedelta(days=2)).isoformat(),
                "ends_at": (now - timedelta(days=1)).isoformat()}
        live = {"title": "Database upgrade", "starts_at": (now - timedelta(minutes=10)).isoformat(),
                "ends_at": (now + timedelta(hours=1)).isoformat(), "detail": "Read-only for an hour"}
        later = {"title": "OS patching", "starts_at": (now + timedelta(days=3)).isoformat(),
                 "ends_at": (now + timedelta(days=3, hours=2)).isoformat()}
        r = await client.put("/api/v1/settings/maintenance", headers=headers(), json={"windows": [later, past, live]})
        assert r.status_code == 200, r.text
        assert [w["title"] for w in r.json()["windows"]] == ["Past", "Database upgrade", "OS patching"]
        bad = {"title": "x", "starts_at": now.isoformat(), "ends_at": (now - timedelta(hours=1)).isoformat()}
        assert (await client.put("/api/v1/settings/maintenance", headers=headers(),
                                 json={"windows": [bad]})).status_code == 422
        assert (await client.put("/api/v1/settings/maintenance", headers=headers("viewer"),
                                 json={"windows": []})).status_code == 403

        r = await client.get("/api/v1/status/page", params={"tenant": tid})  # no Authorization header
        assert r.status_code == 200, r.text
        page = r.json()
        assert set(page) == {"status", "generated_at", "components", "incidents", "maintenance", "uptime"}
        assert page["status"] == "operational"
        assert [c["id"] for c in page["components"]] == ["api", "db", "redis", "workers", "garage"]
        workers = page["components"][3]
        assert workers["data"] == {"online": 2, "queues": [{"name": "celery", "depth": 3}]}
        assert [(i["reference"], i["count"]) for i in page["incidents"]] == [("cc33dd44", 1), ("aa11bb22", 2)]
        assert page["incidents"][1]["areas"] == ["GET /api/v1/landscape", "GET /api/v1/work"]
        assert "MATNR" not in r.text and "10.1.2.3" not in r.text and "ann@example.com" not in r.text
        assert [(m["title"], m["in_progress"]) for m in page["maintenance"]] == [("Database upgrade", True),
                                                                                 ("OS patching", False)]
        up = page["uptime"]
        assert up["days"] == 30 and up["sample_minutes"] == 5 and up["slots"] == 4
        assert up["overall_pct"] == 75.0  # only the slot with the database down counts against it
        by = {c["id"]: c for c in up["components"]}
        assert by["db"]["uptime_pct"] == 75.0 and by["garage"]["uptime_pct"] == 75.0 and by["api"]["uptime_pct"] == 100.0
        assert sum(d["slots"] for d in up["by_day"]) == 4

        # unknown tenant: 404, never another tenant's page
        assert (await client.get("/api/v1/status/page", params={"tenant": str(uuid.uuid4())})).status_code == 404
        assert (await client.get("/api/v1/status/page", params={"tenant": "nope"})).status_code == 404
        # a degraded worker pool makes the page degraded; GET /health is unchanged
        fixed_components(monkeypatch, "down")
        assert (await client.get("/api/v1/status/page", params={"tenant": tid})).json()["status"] == "outage"
        h = (await client.get("/health")).json()
        assert {"status", "version", "llm_provider", "licence", "timestamp"} <= set(h)


@pytest.mark.anyio
async def test_status_page_live_probes_are_bounded(owner, monkeypatch):
    """Real probes with nothing listening: still an answer, with the dead components down."""
    from api.routes import status_page
    from tests.landscape_seed import seed

    monkeypatch.setenv("REDIS_URL", "redis://127.0.0.1:1/0")
    monkeypatch.setattr("api.config.settings.minio_endpoint", "127.0.0.1:1")
    monkeypatch.setattr("api.config.settings.llm_provider", "anthropic")
    monkeypatch.setitem(status_page._cache, "components", None)
    s = seed(owner, with_run=False)
    client = await start(monkeypatch, s["tid"], s["user"])
    async with client:
        started = datetime.now(timezone.utc)
        r = await client.get("/api/v1/status/page", params={"tenant": s["tid"]})
        assert (datetime.now(timezone.utc) - started).total_seconds() < 20
    page = r.json()
    by = {c["id"]: c for c in page["components"]}
    assert by["api"]["status"] == "up" and by["db"]["status"] == "up"
    assert by["redis"]["status"] == "down" and by["workers"]["status"] == "down" and by["garage"]["status"] == "down"
    assert "ollama" not in by  # only when the bundled model is the provider
    assert page["status"] == "outage"
    assert "127.0.0.1:1" not in r.text  # class names only, never a connection string


def test_health_sample_task(owner, monkeypatch):
    from api.services import health_probe
    from api.services.health_probe import LABELS, Component
    from tests.landscape_seed import seed
    from workers import scheduler
    from workers.tasks import health_samples

    beat = scheduler.celery_app.conf.beat_schedule["health-samples-every-5min"]
    assert beat["task"] == "workers.tasks.health_samples.sample_health"
    assert health_samples.sample_health.soft_time_limit == 60 and health_samples.sample_health.time_limit == 90

    s = seed(owner, with_run=False)
    old = datetime.now(timezone.utc) - timedelta(days=40)
    with owner.begin() as c:
        c.execute(text("INSERT INTO health_samples (tenant_id, sampled_at, component, status) VALUES (:t, :at, 'db', 'up')"),
                  {"t": s["tid"], "at": old})
    comps = [Component("api", LABELS["api"], "up", 3), Component("db", LABELS["db"], "up", 1),
             Component("redis", LABELS["redis"], "down", None, "ConnectionError"),
             Component("workers", LABELS["workers"], "down", None, "the queue broker is unreachable",
                       {"online": 0, "queues": [{"name": "celery", "depth": None}]}),
             Component("garage", LABELS["garage"], "up", 4)]
    monkeypatch.setattr(health_samples, "collect", lambda engine: comps)
    monkeypatch.setattr(health_samples, "get_sync_engine", lambda: owner)
    first = health_samples.sample_health()
    with owner.connect() as c:
        rows = c.execute(text("SELECT component, status, sampled_at, detail FROM health_samples WHERE tenant_id = :t "
                              "ORDER BY component"), {"t": s["tid"]}).fetchall()
    assert [(r[0], r[1]) for r in rows] == [("api", "up"), ("db", "up"), ("garage", "up"), ("redis", "down"),
                                           ("workers", "down")]  # and the 40-day-old sample was pruned
    assert len({r[2] for r in rows}) == 1 and rows[0][2].minute % 5 == 0 and rows[0][2].second == 0
    assert rows[4][3]["queues"] == [{"name": "celery", "depth": None}]
    assert first["written"] >= 5 and first["components"]["redis"] == "down"
    # the same slot again writes nothing for this tenant (ON CONFLICT DO NOTHING)
    health_samples.sample_health()
    with owner.connect() as c:
        assert c.execute(text("SELECT count(*) FROM health_samples WHERE tenant_id = :t"), {"t": s["tid"]}).scalar() == 5
    assert health_probe.slot(datetime(2026, 10, 29, 17, 13, 59, tzinfo=timezone.utc)).minute == 10


@pytest.mark.anyio
async def test_diagnostics_bundle(owner, monkeypatch):
    from tests.m2_seed import seed_m2

    s = seed_m2(owner)
    tid = s["tid"]
    secrets_ = {"pw": "Sup3rSecretRfcPassw0rd", "cs": "cl1ent-secret-value", "ak": "sk-live-abcdef123456",
                "jwt": "jwt-secret-should-never-leak", "sso": "sso-client-secret-enc", "llm": "llm-api-key-enc",
                "host": "sap-prod.internal.example", "user": "RFC_TECH_USER", "hook": "https://hooks.example/abc"}
    with owner.begin() as c:
        c.execute(text("INSERT INTO system_credentials (system_id, encrypted_password) VALUES (:s, :p)"),
                  {"s": s["ecc"], "p": secrets_["pw"]})
        c.execute(text("UPDATE sap_systems SET host = :h, username = :u, client_secret_encrypted = :cs, "
                       "api_key_encrypted = :ak, base_url = 'https://tenant.successfactors.example' WHERE id = :s"),
                  {"h": secrets_["host"], "u": secrets_["user"], "cs": secrets_["cs"], "ak": secrets_["ak"],
                   "s": s["ecc"]})
        c.execute(text("UPDATE tenants SET jwt_secret = :j, sso_config = CAST(:sso AS jsonb), "
                       "llm_config = CAST(:llm AS jsonb), dqs_weights = CAST(:w AS jsonb) WHERE id = :t"),
                  {"j": secrets_["jwt"], "t": tid,
                   "sso": json.dumps({"issuer": "https://login.example", "client_secret_encrypted": secrets_["sso"],
                                      "enforce": True}),
                   "llm": json.dumps({"provider": "anthropic", "api_key_encrypted": secrets_["llm"]}),
                   "w": json.dumps({"completeness": 25, "notification_config": {"email": "alerts@example.com",
                                                                                "teams_webhook": secrets_["hook"]}})})
        server_error(c, tid, "ee55ff66", RECORD_PATH, datetime.now(timezone.utc) - timedelta(minutes=3))
        emails = [r[0] for r in c.execute(text("SELECT email FROM users WHERE tenant_id = :t"), {"t": tid})]
    assert len(emails) >= 4
    fixed_components(monkeypatch)
    from api.services import jobs as jobs_service
    monkeypatch.setattr(jobs_service, "list_jobs", lambda t, active_only=False, limit=50: [
        {"id": "j1", "kind": "extraction", "status": "failed", "label": "ECC production", "stage": "read",
         "error": f"RFC login failed for {emails[0]} at rfc://{secrets_['user']}:{secrets_['pw']}@host",
         "tables": [{"table": "MARA", "rows": 10}], "retry": {"via": "x", "body": {"password": secrets_["pw"]}},
         "started_at": 1.0}])
    client = await start(monkeypatch, tid, s["user"])
    async with client:
        assert (await client.get("/api/v1/support/diagnostics.zip", headers=headers("viewer"))).status_code == 403
        assert (await client.get("/api/v1/support/diagnostics", headers=headers("data_steward"))).status_code == 403
        r = await client.get("/api/v1/support/diagnostics.zip", headers=headers())
        assert r.status_code == 200, r.text
        assert r.headers["content-type"] == "application/zip" and "attachment" in r.headers["content-disposition"]
        zf = zipfile.ZipFile(io.BytesIO(r.content))
        names = set(zf.namelist())
        assert names == {"summary.json", "versions.json", "licence.json", "tenant_settings.json", "systems.json",
                         "jobs.json", "server_errors.json", "health_samples.json", "workers.json", "environment.json",
                         "README.txt"}
        blob = b"".join(zf.read(n) for n in names).decode()
        for e in emails + ["alerts@example.com"]:
            assert e not in blob, e
        for name, value in secrets_.items():
            assert value not in blob, name
        assert "MATNR" not in blob and "MARA" not in blob  # no record keys, no SAP tables or data
        part = {n[:-5]: json.loads(zf.read(n)) for n in names if n.endswith(".json")}
        assert part["versions"]["api"] and part["versions"]["migrations_head"]
        assert part["versions"]["frontend"]  # read from frontend/package.json in a source checkout
        assert part["environment"]["llm_provider"] == "anthropic"
        assert {"valid", "seats_used", "seat_limit", "key_configured"} <= set(part["licence"])
        assert part["tenant_settings"]["sso"] == {"configured": True, "enforce": True}
        assert part["tenant_settings"]["dqs_weights"] == {"completeness": 25}
        assert {x["system_type"] for x in part["systems"]} == {"ecc"} and "name" not in part["systems"][0]
        assert part["server_errors"][0] == {"reference": "ee55ff66", "method": "GET", "area": "/api/v1/work",
                                            "at": part["server_errors"][0]["at"]}
        assert part["jobs"][0]["status"] == "failed" and "tables" not in part["jobs"][0]
        assert "[email]" in part["jobs"][0]["error"] and "[credentials]" in part["jobs"][0]["error"]
        assert part["workers"]["components"][3]["data"]["queues"] == [{"name": "celery", "depth": 3}]
        users = part["summary"]["users"]
        assert users["total"] == len(emails) and users["active_by_role"]["admin"] == 1

        r = await client.get("/api/v1/support/diagnostics", headers=headers())
        assert r.status_code == 200 and r.json()["server_errors"]["references_24h"] == 1
        assert not any(e in r.text for e in emails)
    with owner.connect() as c:
        assert c.execute(text("SELECT count(*) FROM audit_log WHERE tenant_id = :t AND action = 'diagnostics.download'"),
                         {"t": tid}).scalar() == 1
