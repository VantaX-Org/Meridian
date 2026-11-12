"""Learned monitor routes: list, steward actions (RBAC, tenant scope, audit) and explain. The database is a scripted fake."""

import uuid
from datetime import datetime, timezone

from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.deps import Tenant, get_db, get_tenant
from api.routes import learned_monitors as route

NOW = datetime(2026, 3, 1, tzinfo=timezone.utc)
BID, VID, RID = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())


def brk(status="open"):
    return (BID, VID, 7, "material_master", "fail_rate_jump", "fail_rate", "MM014", "high", 3.0, 7.0, 5.0, 30.0, 6,
            [RID], "mad", status, None, None, None, None, None, None, NOW, NOW, "run")


class _Res:
    def __init__(self, rows):
        self.rows = rows

    def fetchone(self):
        return self.rows[0] if self.rows else None

    def fetchall(self):
        return self.rows

    def scalar(self):
        return self.rows[0][0] if self.rows else None


class _DB:
    def __init__(self, rows=(), missing=False):
        self.rows, self.missing, self.sql, self.committed = list(rows), missing, [], False

    async def execute(self, stmt, params=None):
        q = str(stmt)
        self.sql.append((q, params or {}))
        if "FROM learned_monitor_breaks b" in q:
            return _Res([] if self.missing else self.rows)
        if "SELECT id::text, run_number, run_at FROM analysis_versions" in q:
            return _Res([(RID, 3, NOW)])
        return _Res([])

    async def commit(self):
        self.committed = True


def _client(monkeypatch, db, tenant=None):
    monkeypatch.setenv("MERIDIAN_DEV_ROLE_HEADER", "1")
    audits = []

    async def names(*_a):
        return {"MM014": "Base unit not valid"}

    async def audit(*a, **_k):
        audits.append(a[3:])

    monkeypatch.setattr(route, "rule_names", names)
    monkeypatch.setattr(route, "write_audit", audit)
    api = FastAPI()
    api.include_router(route.router)

    async def _db():
        yield db

    api.dependency_overrides[get_db] = _db
    api.dependency_overrides[get_tenant] = lambda: tenant or Tenant(uuid.uuid4(), "D", [])
    c = TestClient(api)
    c.audits = audits
    return c


ADMIN, VIEWER = {"X-User-Role": "admin"}, {"X-User-Role": "viewer"}
URL = f"/api/v1/aletheia/monitors/{BID}"


def test_acknowledge_is_scoped_audited_and_committed(monkeypatch):
    db, tenant = _DB([brk()]), Tenant(uuid.uuid4(), "D", [])
    c = _client(monkeypatch, db, tenant)
    r = c.post(f"{URL}/acknowledge", json={"note": "seen"}, headers=ADMIN)
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["subject_description"] == "Base unit not valid" and j["explanation"]["source"] == "template"
    assert [x["role"] for x in j["citations"]] == ["baseline", "current"] and j["citations"][0]["run_number"] == 3
    upd = [p for q, p in db.sql if q.lstrip().startswith("UPDATE learned_monitor_breaks")][0]
    assert upd["t"] == str(tenant.id) and upd["s"] == "acknowledged" and db.committed
    assert c.audits[0][0] == "learned_monitor.acknowledge" and c.audits[0][2] == BID
    assert all(p.get("t") == str(tenant.id) for q, p in db.sql if "learned_monitor_breaks" in q and "t" in p)


def test_expected_and_snooze_carry_their_effect(monkeypatch):
    db = _DB([brk()])
    c = _client(monkeypatch, db)
    assert c.post(f"{URL}/expected", json={"effect": "accept"}, headers=ADMIN).status_code == 200
    assert c.post(f"{URL}/snooze", json={"days": 14}, headers=ADMIN).status_code == 200
    ups = [p for q, p in db.sql if q.lstrip().startswith("UPDATE learned_monitor_breaks")]
    assert (ups[0]["s"], ups[0]["e"]) == ("expected", "accept") and ups[1]["s"] == "snoozed" and ups[1]["u"] > NOW
    assert [a[0] for a in c.audits] == ["learned_monitor.expected", "learned_monitor.snooze"]


def test_viewer_cannot_decide_and_nothing_is_written(monkeypatch):
    db = _DB([brk()])
    c = _client(monkeypatch, db)
    for path, body in (("acknowledge", {}), ("expected", {"effect": "exclude"}), ("snooze", {"days": 3})):
        assert c.post(f"{URL}/{path}", json=body, headers=VIEWER).status_code == 403
    assert not db.committed and not c.audits and not db.sql


def test_unknown_break_is_404_and_bad_input_422(monkeypatch):
    c = _client(monkeypatch, _DB(missing=True))
    assert c.post(f"{URL}/acknowledge", json={}, headers=ADMIN).status_code == 404
    assert c.post(f"{URL}/snooze", json={"days": 0}, headers=ADMIN).status_code == 422
    assert c.post(f"{URL}/expected", json={"effect": "nope"}, headers=ADMIN).status_code == 422


def test_snooze_past_its_time_reads_as_open(monkeypatch):
    row = list(brk("snoozed"))
    row[17] = datetime(2026, 2, 1, tzinfo=timezone.utc)
    c = _client(monkeypatch, _DB([tuple(row)]))
    assert c.post(f"{URL}/acknowledge", json={}, headers=ADMIN).json()["status"] == "open"


def test_explain_falls_back_to_the_template_and_sends_no_values(monkeypatch):
    seen = []
    monkeypatch.setattr(route.lm, "ai_sentences", lambda f, label: seen.append(f) or None)
    db = _DB([brk()])
    r = _client(monkeypatch, db).post(f"{URL}/explain", headers=VIEWER)
    assert r.status_code == 200 and r.json()["explanation"]["source"] == "template"
    assert set(seen[0]) == {"kind", "metric", "subject", "description", "observed", "expected_low", "expected_high",
                            "median", "baseline_runs", "method"}
    assert any(q.lstrip().startswith("UPDATE learned_monitor_breaks SET explanation") for q, _ in db.sql) and db.committed


def test_list_with_no_run_is_empty(monkeypatch):
    r = _client(monkeypatch, _DB()).get("/api/v1/aletheia/monitors", headers=VIEWER)
    assert r.status_code == 200 and r.json()["breaks"] == [] and r.json()["min_runs"] == 5


def test_a_break_below_the_minimum_can_only_be_confirmed(monkeypatch):
    db = _DB([brk("below_minimum")])
    c = _client(monkeypatch, db)
    for path, body in (("expected", {"effect": "exclude"}), ("snooze", {"days": 3})):
        assert c.post(f"{URL}/{path}", json=body, headers=ADMIN).status_code == 409
    assert not db.committed and not c.audits
    r = c.post(f"{URL}/acknowledge", json={}, headers=ADMIN)
    assert r.status_code == 200 and db.committed and c.audits[0][0] == "learned_monitor.acknowledge"


# -- why this is a break ----------------------------------------------------------------------------------------------

from datetime import timedelta  # noqa: E402

from api.services import learned_monitors as lm  # noqa: E402

B_IDS = [str(uuid.uuid4()) for _ in range(5)]
PTS = [(i, NOW - timedelta(days=5 - n), v) for n, (i, v) in enumerate(zip(B_IDS, [10.0, 11.0, 12.0, 13.0, 14.0]))]


def test_break_evidence_robust_z_from_the_baseline_runs():
    extra = (str(uuid.uuid4()), NOW - timedelta(days=9), 500.0)  # not a baseline run: ignored
    e = lm.break_evidence({"observed": 30.0, "expected_low": 0.0, "expected_high": 40.0, "median": 12.0,
                           "baseline_run_ids": B_IDS}, [extra, *PTS])
    assert e["basis"] == "runs" and e["median"] == 12.0 and e["mad"] == 1.0
    assert e["z"] == round(18 / 1.4826, 2) and e["z_threshold"] == 3.5 and len(e["runs"]) == 5
    assert e["floored"]  # 40 wide > 2 * 3.5 * 1.4826: the minimum spread set the band


def test_break_evidence_falls_back_to_the_band_and_flat_runs_have_no_z():
    e = lm.break_evidence({"observed": 20.0, "expected_low": 3.0, "expected_high": 17.0, "median": 10.0,
                           "baseline_run_ids": B_IDS}, [])
    assert e["basis"] == "band" and e["scaled_mad"] == 2.0 and e["z"] == 5.0 and not e["floored"]
    flat = [(i, at, 7.0) for i, at, _ in PTS]
    assert lm.break_evidence({"observed": 9.0, "expected_low": 6.0, "expected_high": 8.0, "median": 7.0,
                              "baseline_run_ids": B_IDS}, flat)["z"] is None


def test_value_shift_names_codes_that_came_and_went():
    base = [[{"value": "FERT", "count": 90}, {"value": "HALB", "count": 10}]] * 3 + [None]
    s = lm.value_shift([{"value": "FERT", "count": 80}, {"value": "ZXX1", "count": 20}], base,
                       {"FERT": "Finished product"}, {"FERT", "HALB"})
    assert s["baseline_runs"] == 3
    assert s["appeared"] == [{"value": "ZXX1", "text": None, "in_check_table": False, "count": 20}]
    assert s["vanished"] == [{"value": "HALB", "text": None, "in_check_table": True, "runs": 3}]
    assert lm.value_shift(None, base, {}, None) is None and lm.value_shift([{"value": "A"}], [None], {}, None) is None


class _IRes(_Res):
    def __iter__(self):
        return iter(self.rows)


class _Sync:
    """A scripted sync session for _gather: answers by the table the SQL reads."""
    def __init__(self, tops, snaps):
        self.tops, self.snaps, self.sql = tops, snaps, []

    def execute(self, stmt, params=None):
        q = str(stmt)
        self.sql.append((q, params or {}))
        if "run_number FROM analysis_versions" in q:
            return _IRes([(i, n + 1) for n, i in enumerate(B_IDS)])
        if "metadata->>'system_id'" in q:
            return _IRes([("SYS1",)])
        if "FROM field_profiles" in q:
            return _IRes(list(self.tops.items()))
        if "FROM config_snapshots" in q:
            return _IRes(self.snaps)
        return _IRes([])


def test_gather_reads_ddic_and_checks_new_codes_against_the_live_check_table(monkeypatch):
    from api.services import source_design
    from sap.ddic import get_dictionary
    monkeypatch.setattr(route.lm, "collect", lambda s, t, v, m: ({}, {"distinct_pct|MARA.MTART": PTS}, {}))
    monkeypatch.setattr(source_design, "dictionary_for", lambda s, sid: get_dictionary("s4hana"))
    tops = {i: [{"value": "FERT", "count": 9}, {"value": "HALB", "count": 1}] for i in B_IDS}
    tops[VID] = [{"value": "FERT", "count": 5}, {"value": "ZNEW", "count": 5}]
    s = _Sync(tops, [("T134", '[{"MTART": "FERT"}, {"MTART": "HALB"}]')])
    row = list(brk())
    row[4], row[5], row[6], row[13] = "cardinality_shift", "distinct_pct", "MARA.MTART", B_IDS
    g = route._gather(s, "T1", tuple(row))
    assert g["field"].check_table == "T134" and g["table_text"] == "General Material Data"
    assert g["values"]["appeared"][0] == {"value": "ZNEW", "text": None, "in_check_table": False, "count": 5}
    assert g["values"]["vanished"][0]["value"] == "HALB" and g["values"]["check_table_snapshot"]
    assert all(p.get("t") == "T1" for _, p in s.sql)


def test_evidence_route_returns_z_runs_and_field(monkeypatch):
    from sap.ddic import get_dictionary
    f = get_dictionary("s4hana").resolve("MARA.MTART")
    monkeypatch.setattr(route, "_gather", lambda s, t, r: {"points": PTS, "numbers": {B_IDS[0]: 1}, "field": f,
                                                          "table_text": "General Material Data", "values": None})
    row = list(brk())
    row[5], row[6], row[13] = "distinct_pct", "MARA.MTART", B_IDS
    db = _DB([tuple(row)])

    async def run_sync(fn):
        return fn(None)
    db.run_sync = run_sync
    r = _client(monkeypatch, db).get(f"{URL}/evidence", headers=VIEWER)
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["basis"] == "runs" and j["median"] == 12.0 and j["runs"][0]["run_number"] == 1
    assert j["field"]["check_table"] == "T134" and j["field"]["data_element"] == "MTART"
    assert _client(monkeypatch, _DB(missing=True)).get(f"{URL}/evidence", headers=VIEWER).status_code == 404
