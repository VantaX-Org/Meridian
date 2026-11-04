"""Reference data: code lists, coverage, verified AI suggestion, and maker-checker mappings. No Postgres."""
import uuid
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.deps import Tenant, get_db, get_tenant
from api.middleware import audit as audit_mw
from api.routes import reference_data as route
from api.services import reference_data as rd
from sap.data_dictionary import DATA_DICTIONARY

SRC = [{"code": "EA", "text": "Each"}, {"code": "KG", "text": "Kilogram"}, {"code": "ZZ", "text": "Legacy"}]
TGT = [{"code": "EA", "text": "Each"}, {"code": "KG", "text": "Kilogram"}, {"code": "PC", "text": "Piece"}]
MAKER, CHECKER = str(uuid.uuid4()), str(uuid.uuid4())


def item(obj, key, **v):
    return SimpleNamespace(object=obj, key=key, values=v)


def test_codes_of_sorted_with_text_and_other_tables_ignored():
    lst = rd.by_id("material_group")
    items = [item("T023", "MANDT=100,MATKL=B", WGBEZ="Bolts"), item("T023", "MANDT=100,MATKL=A", WGBEZ=""),
             item("T006", "MSEHI=KG", MSEHL="Kilogram")]
    assert rd.codes_of(lst, items) == [{"code": "A", "text": None}, {"code": "B", "text": "Bolts"}]


def test_country_text_from_t005t_prefers_language_then_english():
    lst = rd.by_id("country")
    items = [item("T005", "MANDT=100,LAND1=DE"), item("T005", "MANDT=100,LAND1=ZA"), item("T005", "MANDT=100,LAND1=JP"),
             item("T005T", "SPRAS=E,LAND1=DE", LANDX="Germany"), item("T005T", "SPRAS=D,LAND1=DE", LANDX="Deutschland"),
             item("T005T", "SPRAS=E,LAND1=ZA", LANDX="South Africa"), item("T005T", "SPRAS=J,LAND1=JP", LANDX="Japan-ja")]
    en = {c["code"]: c["text"] for c in rd.codes_of(lst, items)}
    assert en == {"DE": "Germany", "JP": "Japan-ja", "ZA": "South Africa"}  # no English for JP: any language
    de = {c["code"]: c["text"] for c in rd.codes_of(lst, items, "d")}
    assert de["DE"] == "Deutschland" and de["ZA"] == "South Africa"


def test_country_without_text_table_has_no_text():
    assert rd.codes_of(rd.by_id("country"), [item("T005", "LAND1=DE")]) == [{"code": "DE", "text": None}]


def test_country_text_table_is_registered_for_licensed_modules():
    from sap.extraction_registry import SYSTEM_EXTRACTIONS
    for m in ("material_master", "sd_customer_master", "business_partner"):
        src = {t.source: t for t in SYSTEM_EXTRACTIONS["ecc"][m]}
        assert src["T005"].is_config and src["T005T"].is_config
        assert set(src["T005T"].fields) == {"SPRAS", "LAND1", "LANDX", "NATIO"}


def test_lists_name_only_fields_in_data_dictionary():
    text = str(DATA_DICTIONARY)
    for lst in rd.LISTS:
        for tf in lst.target_fields:
            if tf.split(".")[0] in ("KNA1", "KNB1", "MARA"):
                assert tf.split(".")[1] in text, tf


def test_coverage_states():
    maps = [{"source_value": "ZZ", "status": "confirmed"}]
    assert rd.coverage(SRC, maps, TGT) == {"same": 2, "approved": 1, "proposed": 0, "rejected": 0, "open": 0}
    assert rd.coverage(SRC, [], TGT)["open"] == 1


def test_verify_checks():
    assert rd.verify(SRC, TGT, "ZZ", {"target_code": "PC", "confidence": 0.8})["verified"]
    assert not rd.verify(SRC, TGT, "ZZ", {"target_code": "XX", "confidence": 0.8})["verified"]
    assert not rd.verify(SRC, TGT, "NOPE", {"target_code": "PC", "confidence": 0.8})["verified"]
    assert not rd.verify(SRC, TGT, "ZZ", {"target_code": "PC", "confidence": 7})["verified"]
    assert not rd.verify(SRC, TGT, "ZZ", "garbage")["verified"]


def test_prompt_has_codes_only():
    p = rd._build_prompt("unit_of_measure", rd.facts(SRC[2], TGT))
    assert "ZZ" in p and "Piece" in p


class FakeDB:
    def __init__(self):
        self.rows, self.commits, self.sql, self.tenant = {}, 0, [], ""

    async def execute(self, stmt, params=None):
        sql, p = str(stmt), params or {}
        self.sql.append(sql)
        if "FROM sap_systems WHERE id" in sql:
            return SimpleNamespace(scalar=lambda: 1)
        if "SELECT target_system_id" in sql:
            return SimpleNamespace(scalar=lambda: None)
        if "INSERT INTO transfer_value_mappings" in sql:
            r = [str(uuid.uuid4()), "MARA.MEINS", p["sv"], p["tv"], "proposed", p["note"], p["u"], None, None, None]
            self.rows[r[0]] = r
            return SimpleNamespace(fetchone=lambda: r)
        if "FOR UPDATE" in sql:
            r = self.rows.get(p["id"])
            ok = r is not None and p["t"] == self.tenant
            return SimpleNamespace(fetchone=lambda: tuple(r) + ("material_master", "sys") if ok else None)
        if "UPDATE transfer_value_mappings" in sql:
            r = self.rows[p["id"]]
            r[4], r[7] = p["s"], p["u"]
            return SimpleNamespace()
        if "FROM transfer_value_mappings" in sql:
            return SimpleNamespace(fetchone=lambda: None, fetchall=lambda: [tuple(r) for r in self.rows.values()])
        return SimpleNamespace()

    async def run_sync(self, fn):
        return fn(None)

    async def commit(self):
        self.commits += 1

    async def rollback(self):
        pass


@pytest.fixture
def env(monkeypatch):
    monkeypatch.setenv("MERIDIAN_DEV_ROLE_HEADER", "1")
    st = SimpleNamespace(db=FakeDB(), audits=[], user=MAKER, tid=uuid.uuid4())
    st.db.tenant = str(st.tid)

    async def _codes(db, sid, lst, load_id):
        return {"source": SRC, "target": TGT, "version_id": "L1", "label": "S/4 baseline", "versions": []}

    async def _audit(db, tenant_id, request, action, et, eid, before, after):
        st.audits.append((action, before, after))

    monkeypatch.setattr(route, "_codes", _codes)
    monkeypatch.setattr(route, "write_audit", _audit)
    monkeypatch.setattr(route, "current_user_id", lambda request=None: st.user)
    monkeypatch.setattr(audit_mw, "_insert_audit_row", lambda r: None)
    app = FastAPI()
    app.add_middleware(audit_mw.AuditMiddleware)
    app.include_router(route.router)

    async def _db():
        yield st.db

    app.dependency_overrides[get_db] = _db
    app.dependency_overrides[get_tenant] = lambda: Tenant(st.tid, "T", ["*"])
    st.app = app
    st.client = lambda role: TestClient(app, headers={"X-User-Role": role})
    return st


def body(**k):
    return {"system_id": str(uuid.uuid4()), "list_id": "unit_of_measure", "target_field": "MARA.MEINS",
            "source_code": "ZZ", "target_code": "PC", **k}


def propose(env):
    return env.client("steward").post("/api/v1/reference-data/mappings", json=body())


def decide(env, role, mid, d):
    return env.client(role).post(f"/api/v1/reference-data/mappings/{mid}/decision", json={"decision": d})


def test_propose_audited_and_proposed(env):
    r = propose(env)
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["status"] == "proposed" and j["target_text"] == "Piece" and j["source_text"] == "Legacy"
    assert env.audits[0][0] == "reference_mapping.propose" and env.db.commits == 1


def test_propose_rejects_unknown_codes_and_field(env):
    c = env.client("steward")
    assert c.post("/api/v1/reference-data/mappings", json=body(target_code="XX")).status_code == 422
    assert c.post("/api/v1/reference-data/mappings", json=body(source_code="NOPE")).status_code == 422
    assert c.post("/api/v1/reference-data/mappings", json=body(target_field="MARA.XXXX")).status_code == 422
    assert c.post("/api/v1/reference-data/mappings", json=body(list_id="nope")).status_code == 404


def test_viewer_cannot_propose_or_decide(env):
    assert env.client("viewer").post("/api/v1/reference-data/mappings", json=body()).status_code == 403
    mid = propose(env).json()["id"]
    assert decide(env, "viewer", mid, "approve").status_code == 403


def test_maker_cannot_approve_own_mapping(env):
    mid = propose(env).json()["id"]
    assert decide(env, "approver", mid, "approve").status_code == 403
    assert env.db.rows[mid][4] == "proposed"


def test_unknown_user_cannot_approve(env):
    mid = propose(env).json()["id"]
    env.user = None
    assert decide(env, "approver", mid, "approve").status_code == 403


def test_second_user_approves_audited_and_confirmed(env):
    mid = propose(env).json()["id"]
    env.user = CHECKER
    r = decide(env, "approver", mid, "approve")
    assert r.status_code == 200 and r.json()["status"] == "confirmed"
    assert env.db.rows[mid][4] == "confirmed"
    act, before, after = env.audits[-1]
    assert act == "reference_mapping.approve" and before["status"] == "proposed" and after["status"] == "confirmed"
    assert decide(env, "approver", mid, "reject").status_code == 409


def test_reject(env):
    mid = propose(env).json()["id"]
    env.user = CHECKER
    assert decide(env, "approver", mid, "reject").json()["status"] == "rejected"


def test_tenant_isolation_on_decision(env):
    mid = propose(env).json()["id"]
    env.user = CHECKER
    env.app.dependency_overrides[get_tenant] = lambda: Tenant(uuid.uuid4(), "Other", ["*"])
    assert decide(env, "approver", mid, "approve").status_code == 404
    assert all("tenant_id" in s for s in env.db.sql if "transfer_value_mappings" in s)


def test_suggest_dropped_when_unverified_and_shown_when_verified(env, monkeypatch):
    monkeypatch.setattr(rd, "suggest", lambda *a: None)
    c = env.client("steward")
    sb = {"system_id": str(uuid.uuid4()), "list_id": "unit_of_measure", "source_code": "ZZ"}
    assert c.post("/api/v1/reference-data/suggest", json=sb).json() == {"suggestion": None}
    good = {"source_code": "ZZ", "target_code": "PC", "target_text": "Piece", "confidence": 0.8,
            "reasoning": "PC is in the target list as Piece.", "checks": [{"code": "SOURCE_KNOWN", "passed": True}]}
    monkeypatch.setattr(rd, "suggest", lambda *a: good)
    assert c.post("/api/v1/reference-data/suggest", json=sb).json()["suggestion"]["target_code"] == "PC"
    assert env.client("viewer").post("/api/v1/reference-data/suggest", json=sb).status_code == 403


def test_suggest_service_drops_hallucinated_code(monkeypatch):
    import llm.provider as lp
    monkeypatch.setattr(lp, "llm_is_noop", lambda: False)
    monkeypatch.setattr(lp, "get_llm", lambda: object())
    monkeypatch.setattr(lp, "safe_invoke", lambda *a, **k: '{"target_code": "QQ", "confidence": 0.9}')
    monkeypatch.setattr(rd, "log_llm_call", lambda **k: None)
    assert rd.suggest("t", "unit_of_measure", SRC, TGT, "ZZ") is None
    monkeypatch.setattr(lp, "safe_invoke", lambda *a, **k: '{"target_code": "PC", "confidence": 0.9}')
    assert rd.suggest("t", "unit_of_measure", SRC, TGT, "ZZ")["target_code"] == "PC"
