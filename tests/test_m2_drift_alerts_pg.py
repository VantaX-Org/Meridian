"""Config drift alerts against a real Postgres (MERIDIAN_TEST_DB_URL): a config sync (connector stubbed) diffs the
replaced snapshot into config_drift_log, the rules that depend on the changed tables are found, their objects' owners
are notified without config values, the objects are re-scored, the alert is listed, and the tenant can turn it off."""
from __future__ import annotations

import json
import os
from types import SimpleNamespace

import pandas as pd
import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from api.services import drift_alerts
from tests.m2_client import headers, make_client
from tests.m2_step9_seed import seed_step9

pytestmark = pytest.mark.skipif(not os.environ.get("MERIDIAN_TEST_DB_URL"), reason="MERIDIAN_TEST_DB_URL not set")


@pytest.fixture(scope="module")
def owner():
    eng = create_engine(os.environ["MERIDIAN_TEST_DB_URL"])
    yield eng
    eng.dispose()


def test_dependency_rules():
    assert drift_alerts.depends("T006", {"details": {"field_checked": "MARA.MEINS"}}, None)  # DDIC config table
    assert drift_alerts.depends("T134", {"details": {"reference_table": "T134.MTART"}}, None)
    assert drift_alerts.depends("T052", {"details": {}}, {"reference_table": "T052", "field": "BSIK.ZTERM"})
    assert drift_alerts.depends("T001W", {"details": {"field_checked": "T001W.WERKS"}}, None)
    assert drift_alerts.depends("T134", {"details": {}, "rule_context": {"why_it_matters": "Types live in T134."}}, None)
    assert not drift_alerts.depends("T13", {"details": {}, "rule_context": {"why_it_matters": "T134 only"}}, None)
    assert not drift_alerts.depends("T006", {"details": {"field_checked": "MARA.MATKL"}}, None)
    rows = drift_alerts.snapshot_drift([{"MSEHI": "KGM", "DIM": "MASS"}], [{"MSEHI": "KGM", "DIM": "MAS2"}, {"MSEHI": "G"}])
    assert sorted(r[0] for r in rows) == ["added", "added", "removed"]


class Stub:
    def close(self):
        pass


def _manager(owner, tid, ecc, frames: dict, monkeypatch):
    from api.services import connectivity_manager as cm

    targets = [SimpleNamespace(source=t, is_config=True) for t in frames]
    monkeypatch.setattr(cm, "get_extraction_targets", lambda *a, **k: targets)
    monkeypatch.setattr(cm.ConnectivityManager, "_load_system", lambda self, sid: {"id": sid})
    monkeypatch.setattr(cm.ConnectivityManager, "_build_connection_params", lambda self, row: {"system_type": "ecc"})
    monkeypatch.setattr(cm.ConnectivityManager, "_get_connector", lambda self, st, p: Stub())
    monkeypatch.setattr(cm.ConnectivityManager, "_extract_target",
                        lambda self, conn, st, target, max_rows=0: pd.DataFrame(frames[target.source]))
    s = Session(owner)
    return s, cm.ConnectivityManager(s, tid)


@pytest.mark.anyio
async def test_sync_drift_alert(owner, monkeypatch):
    s = seed_step9(owner)
    tid, ecc, run = s["tid"], s["ecc"], s["run"]
    with owner.begin() as c:
        c.execute(text("UPDATE analysis_versions SET status = 'agents_complete' WHERE id = :v"), {"v": run})
        for chk, details, ctx in (("MM001", {"field_checked": "MARA.MEINS"}, None),
                                  ("MM005", {"field_checked": "MARA.MATKL"}, None),
                                  ("MM015", {"field_checked": "MARA.ZZ1"}, {"why_it_matters": "Material types come from T134."}),
                                  ("MM200", {"field_checked": "MARA.ZZ2"}, None)):
            c.execute(text("UPDATE findings SET details = CAST(:d AS jsonb), rule_context = CAST(:c AS jsonb) "
                           "WHERE version_id = :v AND check_id = :k"),
                      {"d": json.dumps(details), "c": json.dumps(ctx) if ctx else None, "v": run, "k": chk})
        c.execute(text("INSERT INTO rules (tenant_id, name, module, category, severity) VALUES (:t, 'MM001: Base unit not valid', "
                       "'material_master', 'validity', 'critical')"), {"t": tid})
        c.execute(text("SELECT set_config('app.tenant_id', :t, true)"), {"t": tid})
        c.execute(text("INSERT INTO webhooks (tenant_id, url, secret, events) VALUES (:t, 'https://h.example/d', "
                       "'whsec_test_secret_123', ARRAY['config.drift'])"), {"t": tid})
    queued = []
    monkeypatch.setattr("workers.tasks.run_checks.run_checks.delay",
                        lambda *a, **k: queued.append((a, k)) or SimpleNamespace(id="task-1"))

    first = {"T006": [{"MSEHI": "KGM", "DIMID": "MASS"}], "T134": [{"MTART": "FERT"}]}
    sess, mgr = _manager(owner, tid, ecc, first, monkeypatch)
    with sess:
        assert mgr.sync_config(ecc, ["material_master"])["status"] == "synced"  # first live read: nothing to diff
    second = {"T006": [{"MSEHI": "KGM", "DIMID": "MAS2"}], "T134": [{"MTART": "FERT"}, {"MTART": "ZFRT"}]}
    sess, mgr = _manager(owner, tid, ecc, second, monkeypatch)
    with sess:
        mgr.sync_config(ecc, ["material_master"])

    with owner.connect() as c:
        c.execute(text("SELECT set_config('app.tenant_id', :t, false)"), {"t": tid})
        alert = c.execute(text("SELECT * FROM config_drift_alerts WHERE tenant_id = :t"), {"t": tid}).mappings().one()
        notes = c.execute(text("SELECT user_id::text, type, title, body FROM notifications WHERE tenant_id = :t "
                               "AND type = 'config_drift' ORDER BY user_id"), {"t": tid}).fetchall()
        version = c.execute(text("SELECT status, metadata->'analysis_options' FROM analysis_versions WHERE id = :v"),
                            {"v": run}).fetchone()
        hook = c.execute(text("SELECT payload FROM webhook_deliveries WHERE tenant_id = :t AND event = 'config.drift'"),
                         {"t": tid}).scalar()
    assert alert["source"] == "config_sync" and alert["areas"] == [
        {"area": "T006", "added": 1, "removed": 1, "changed": 0}, {"area": "T134", "added": 1, "removed": 0, "changed": 0}]
    assert list(alert["rules"]) == ["MM001", "MM015"] and list(alert["objects"]) == ["material_master"]
    assert alert["notified"] == 2 and alert["rescore_queued"] is True and str(alert["version_id"]) == run
    assert sorted(n[0] for n in notes) == sorted([s["cara"], s["bob"]])
    assert "T006" in notes[0][3] and "2 rule(s)" in notes[0][3]
    for value in ("KGM", "MAS2", "ZFRT", "FERT"):
        assert all(value not in (n[2] + n[3]) for n in notes) and value not in json.dumps(hook)
    assert version[0] == "pending" and version[1] == {"modules": ["material_master"], "reason": "config_drift"}
    assert queued and queued[0][1] == {"reanalyse": True} and queued[0][0][0] == run
    assert hook["data"]["rules"] == ["MM001", "MM015"] and hook["data"]["system_name"] == "ECC production"

    deps, client = make_client(monkeypatch, tid, s["ann"])
    await deps.engine.dispose()
    async with client:
        r = await client.get("/api/v1/config/drift/alerts", headers=headers("viewer"))
        assert r.status_code == 200
        [a] = r.json()["alerts"]
        assert a["rules"] == [{"check_id": "MM001", "name": "Base unit not valid"}, {"check_id": "MM015", "name": None}]
        assert a["system_name"] == "ECC production" and a["objects"] == ["material_master"]
        # turned off: the next change raises no alert
        r = await client.put("/api/v1/settings/automation", json={"drift_alerts": {"enabled": False}}, headers=headers())
        assert r.json()["drift_alerts"] == {"enabled": False}
    with owner.begin() as c:
        c.execute(text("UPDATE analysis_versions SET status = 'complete' WHERE id = :v"), {"v": run})
    third = {"T006": [{"MSEHI": "KGM", "DIMID": "MASS"}], "T134": [{"MTART": "FERT"}]}
    sess, mgr = _manager(owner, tid, ecc, third, monkeypatch)
    with sess:
        mgr.sync_config(ecc, ["material_master"])
    with owner.connect() as c:
        c.execute(text("SELECT set_config('app.tenant_id', :t, false)"), {"t": tid})
        assert c.execute(text("SELECT count(*) FROM config_drift_alerts WHERE tenant_id = :t"), {"t": tid}).scalar() == 1
        assert c.execute(text("SELECT count(*) FROM config_drift_log WHERE tenant_id = :t"), {"t": tid}).scalar() == 6


def test_config_load_drift_is_processed_once(owner, monkeypatch):
    """A config load's drift (written by config_pairing.write_drift) goes through the same path, once per load."""
    import uuid
    s = seed_step9(owner)
    tid, load = s["tid"], str(uuid.uuid4())
    monkeypatch.setattr("workers.tasks.run_checks.run_checks.delay", lambda *a, **k: SimpleNamespace(id="t"))
    with Session(owner) as x:
        x.execute(text("SELECT set_config('app.tenant_id', :t, false)"), {"t": tid})
        x.execute(text("INSERT INTO config_drift_log (tenant_id, run_id, module, element_type, element_value, change_type) "
                       "VALUES (:t, :r, 'config', 'T006', 'KGM', 'changed')"), {"t": tid, "r": load})
        x.commit()
        out = drift_alerts.process(x, tid, s["ecc"], load, "config_load")
        assert out["rules"] == ["MM001", "MM005", "MM015", "MM200"]  # the seed's findings all check MARA.MEINS
        assert out["areas"] == [{"area": "T006", "added": 0, "removed": 0, "changed": 1}]
        assert drift_alerts.process(x, tid, s["ecc"], load, "config_load") is None
