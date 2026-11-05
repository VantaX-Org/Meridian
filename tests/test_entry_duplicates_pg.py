"""Duplicate search at entry through POST /api/v1/dq-firewall/validate against a real Postgres (RLS enforced).

Runs with MERIDIAN_TEST_DB_URL; skipped otherwise.
"""
from __future__ import annotations

import asyncio
import json
import os
import uuid

import pytest

from tests.test_record_issues_pg import app_engine  # noqa: F401  (module fixture)

pytestmark = pytest.mark.skipif(not os.environ.get("MERIDIAN_TEST_DB_URL"),
                                reason="MERIDIAN_TEST_DB_URL not set")

M = "material_master"
POP = {  # key -> golden fields; the values below must never appear in a response or an audit row
    "10001": {"MARA.MFRPN": "XQ-7731-ZK", "MAKT.MAKTX": "Hydraulic seal kit heavy duty"},
    "10002": {"MARA.MFRPN": "ZZ-0001", "MAKT.MAKTX": "Gasket flange steel"},
}
SECRET = ("XQ-7731-ZK", "Hydraulic seal kit", "Gasket flange")


def _setup(app_engine, rules=True, population=True, extra=0):  # noqa: F811
    from sqlalchemy import text

    owner, app_eng = app_engine
    tid, other = str(uuid.uuid4()), str(uuid.uuid4())
    with owner.begin() as c:
        c.execute(text("INSERT INTO tenants (id, name) VALUES (:a, 'D1'), (:b, 'D2')"), {"a": tid, "b": other})
    with app_eng.begin() as c:
        for t in (tid, other):
            c.execute(text("SELECT set_config('app.tenant_id', :t, true)"), {"t": t})
            if rules and t == tid:
                for f, mt, w, th in (("MARA.MFRPN", "part_number", 60, 0.9), ("MAKT.MAKTX", "desc_tokens", 40, 0.6)):
                    c.execute(text("INSERT INTO match_rules (tenant_id, domain, field, match_type, weight, threshold) "
                                   "VALUES (:t, :d, :f, :m, :w, :th)"), {"t": t, "d": M, "f": f, "m": mt, "w": w, "th": th})
            if population or t == other:
                for k, f in POP.items():
                    c.execute(text("INSERT INTO master_records (tenant_id, domain, sap_object_key, golden_fields, status) "
                                   "VALUES (:t, :d, :k, CAST(:f AS jsonb), 'golden')"),
                              {"t": t, "d": M, "k": k if t == tid else "OTHER" + k, "f": json.dumps(f)})
            if t == tid and population:
                for i in range(extra):
                    c.execute(text("INSERT INTO master_records (tenant_id, domain, sap_object_key, golden_fields, status)"
                                   " VALUES (:t, :d, :k, CAST(:f AS jsonb), 'golden')"),
                              {"t": t, "d": M, "k": f"BULK{i:03d}",
                               "f": json.dumps({"MARA.MFRPN": "BULK-1", "MAKT.MAKTX": f"Bulk part {i}"})})
    return tid


def _call(app_engine, tid, body):  # noqa: F811
    from fastapi import FastAPI
    from httpx import ASGITransport, AsyncClient
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    from api.deps import Tenant, get_db, get_tenant
    from api.routes.dq_firewall import router

    aeng = create_async_engine(app_engine[1].url.set(drivername="postgresql+asyncpg"))
    factory = async_sessionmaker(aeng, expire_on_commit=False)

    async def _db():
        async with factory() as s:
            yield s

    api = FastAPI()
    api.include_router(router)
    api.dependency_overrides[get_db] = _db
    api.dependency_overrides[get_tenant] = lambda: Tenant(uuid.UUID(tid), "D1", [])

    async def go():
        async with AsyncClient(transport=ASGITransport(app=api), base_url="http://t") as c:
            return await c.post("/api/v1/dq-firewall/validate", json=body, headers={"X-User-Role": "steward"})

    try:
        return asyncio.run(go())
    finally:
        asyncio.run(aeng.dispose())


def _audit(app_engine, tid):  # noqa: F811
    from sqlalchemy import text

    with app_engine[1].begin() as c:
        c.execute(text("SELECT set_config('app.tenant_id', :t, true)"), {"t": tid})
        return [r[0] for r in c.execute(text("SELECT after_json FROM audit_log WHERE action = 'dq_firewall.validate'"))]


@pytest.fixture(autouse=True)
def _dev_role(monkeypatch):
    monkeypatch.setenv("MERIDIAN_DEV_ROLE_HEADER", "1")


def test_true_duplicate_found_and_no_values_leave(app_engine):  # noqa: F811
    tid = _setup(app_engine)
    rec = {"MARA.MFRPN": "xq 7731 zk", "MAKT.MAKTX": "Hydraulic seal kit, heavy duty"}
    r = _call(app_engine, tid, {"module": M, "records": [rec], "duplicates": True})
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["duplicate_search"]["searched"] is True
    d = out["records"][0]["duplicates"]
    assert d["verdict"] == "warn" and d["searched"] is True
    top = d["matches"][0]
    assert top["key"] == "10001" and top["score"] >= top["threshold"] == 0.95 and top["band"] == "auto_merge"
    assert {f["field"] for f in top["fields"]} == {"MARA.MFRPN", "MAKT.MAKTX"}
    assert [m["key"] for m in d["matches"]] == ["10001"]  # the gasket is no duplicate
    for needle in SECRET:
        assert needle not in r.text
    rows = _audit(app_engine, tid)
    assert rows and rows[-1]["duplicate_matches"] == 1 and rows[-1]["duplicate_warned_records"] == 1
    assert not any(n in json.dumps(x) for x in rows for n in SECRET + ("7731", "xq"))


def test_non_duplicate_not_found(app_engine):  # noqa: F811
    tid = _setup(app_engine)
    rec = {"MARA.MFRPN": "NEWPART-9", "MAKT.MAKTX": "Bearing roller"}
    out = _call(app_engine, tid, {"module": M, "records": [rec], "duplicates": True}).json()
    assert out["duplicate_search"]["searched"] is True
    assert out["records"][0]["duplicates"] == {"verdict": "pass", "searched": True, "scored": 0,
                                                 "truncated": False, "matches": [],
                                                 "fuzzy": {"ran": True, "reason": None}}


def test_opt_out_unchanged(app_engine):  # noqa: F811
    tid = _setup(app_engine)
    out = _call(app_engine, tid, {"module": M, "records": [{"MARA.MFRPN": "XQ-7731-ZK"}]}).json()
    assert "duplicate_search" not in out or out["duplicate_search"] is None
    assert out["records"][0].get("duplicates") is None
    assert "duplicates_searched" not in _audit(app_engine, tid)[-1]


def test_not_searched_without_population_or_rules(app_engine):  # noqa: F811
    body = {"module": M, "records": [{"MARA.MFRPN": "XQ-7731-ZK"}], "duplicates": True}
    s = _call(app_engine, _setup(app_engine, population=False), body).json()
    assert s["duplicate_search"]["searched"] is False and s["duplicate_search"]["reason"] == "no_population"
    assert s["records"][0]["duplicates"]["matches"] == [] and s["records"][0]["duplicates"]["verdict"] == "pass"
    s = _call(app_engine, _setup(app_engine, rules=False), body).json()
    assert s["duplicate_search"]["searched"] is False and s["duplicate_search"]["reason"] == "no_match_rules"


def test_cap_truncation_reported(app_engine, monkeypatch):  # noqa: F811
    from api.services import entry_duplicates as ed

    monkeypatch.setattr(ed, "CANDIDATE_CAP", 5)
    tid = _setup(app_engine, extra=12)
    out = _call(app_engine, tid, {"module": M, "records": [{"MARA.MFRPN": "BULK 1"}], "duplicates": True}).json()
    d = out["records"][0]["duplicates"]
    assert d["truncated"] is True and d["scored"] == 5
    assert _audit(app_engine, tid)[-1]["duplicate_truncated_records"] == 1


def test_tenant_isolation(app_engine):  # noqa: F811
    tid = _setup(app_engine)
    out = _call(app_engine, tid, {"module": M, "records": [{"MARA.MFRPN": "ZZ-0001", "MAKT.MAKTX": "Gasket flange steel"}],
                                  "duplicates": True}).json()
    keys = [m["key"] for m in out["records"][0]["duplicates"]["matches"]]
    assert keys == ["10002"] and not any(k.startswith("OTHER") for k in keys)


def test_record_with_no_usable_value_says_not_searched(app_engine):  # noqa: F811
    tid = _setup(app_engine)
    recs = [{"MARA.MFRPN": "N/A"}, {"MAKT.MAKTX": "油圧シール"}, {"MARA.MFRPN": "ZZ-0001", "MAKT.MAKTX": "Gasket flange steel"}]
    out = _call(app_engine, tid, {"module": M, "records": recs, "duplicates": True}).json()
    assert out["duplicate_search"]["searched"] is True
    assert [r["duplicates"]["searched"] for r in out["records"]] == [False, False, True]
    assert _audit(app_engine, tid)[-1]["duplicate_unsearched_records"] == 2


def test_population_without_block_fields_is_not_a_clean_answer(app_engine):  # noqa: F811
    from sqlalchemy import text

    tid = _setup(app_engine, population=False)
    with app_engine[1].begin() as c:  # a flat upload keeps its own column names
        c.execute(text("SELECT set_config('app.tenant_id', :t, true)"), {"t": tid})
        c.execute(text("INSERT INTO master_records (tenant_id, domain, sap_object_key, golden_fields, status) "
                       "VALUES (:t, :d, '1', CAST(:f AS jsonb), 'golden')"),
                  {"t": tid, "d": M, "f": json.dumps({"MFRPN": "XQ-7731-ZK", "MAKTX": "Hydraulic seal kit"})})
    out = _call(app_engine, tid, {"module": M, "records": [{"MARA.MFRPN": "XQ-7731-ZK"}], "duplicates": True}).json()
    assert out["duplicate_search"] == {**out["duplicate_search"], "searched": False,
                                       "reason": "no_block_field_in_population"}
    assert out["records"][0]["duplicates"]["searched"] is False


def test_saved_record_is_not_its_own_duplicate_under_a_qualified_key(app_engine):  # noqa: F811
    from sqlalchemy import text

    tid = _setup(app_engine)
    with app_engine[1].begin() as c:
        c.execute(text("SELECT set_config('app.tenant_id', :t, true)"), {"t": tid})
        c.execute(text("INSERT INTO master_records (tenant_id, domain, sap_object_key, golden_fields, status) "
                       "VALUES (:t, :d, '20001@@sys-b', CAST(:f AS jsonb), 'golden')"),
                  {"t": tid, "d": M, "f": json.dumps({"MARA.MFRPN": "QQ-5", "MAKT.MAKTX": "Valve body"})})
    rec = {"MARA.MATNR": "20001", "MARA.MFRPN": "QQ-5", "MAKT.MAKTX": "Valve body"}
    d = _call(app_engine, tid, {"module": M, "records": [rec], "duplicates": True}).json()["records"][0]["duplicates"]
    assert d["matches"] == []


# ---- typo-tolerant pass (migration 135, pg_trgm) ----


def _insert(app_engine, tid, key, fields, domain=M, merged_into_key=None):  # noqa: F811
    from sqlalchemy import text

    with app_engine[1].begin() as c:
        c.execute(text("SELECT set_config('app.tenant_id', :t, true)"), {"t": tid})
        c.execute(text("INSERT INTO master_records (tenant_id, domain, sap_object_key, golden_fields, status, merged_into) "
                       "VALUES (:t, :d, :k, CAST(:f AS jsonb), 'golden', "
                       "(SELECT id FROM master_records WHERE tenant_id = :t AND domain = :d AND sap_object_key = :m))"),
                  {"t": tid, "d": domain, "k": key, "f": json.dumps(fields), "m": merged_into_key})


def _dups(app_engine, tid, rec, module=M):  # noqa: F811
    r = _call(app_engine, tid, {"module": module, "records": [rec], "duplicates": True})
    assert r.status_code == 200, r.text
    return r.json()["records"][0]["duplicates"]


def test_typo_in_description_finds_the_record_as_similar(app_engine):  # noqa: F811
    tid = _setup(app_engine)
    d = _dups(app_engine, tid, {"MAKT.MAKTX": "Hydralic seal kit heavy duty"})
    assert [(m["key"], m["found_by"]) for m in d["matches"]] == [("10001", "similar")]
    assert d["fuzzy"] == {"ran": True, "reason": None}
    exact = _dups(app_engine, tid, {"MAKT.MAKTX": "Hydraulic seal kit, heavy duty"})
    assert [(m["key"], m["found_by"]) for m in exact["matches"]] == [("10001", "exact")]


def test_tax_number_near_miss_is_not_a_duplicate_but_a_name_typo_is(app_engine):  # noqa: F811
    from sqlalchemy import text

    owner, app_eng = app_engine
    tid = str(uuid.uuid4())
    with owner.begin() as c:
        c.execute(text("INSERT INTO tenants (id, name) VALUES (:a, 'D1')"), {"a": tid})
    with app_eng.begin() as c:
        c.execute(text("SELECT set_config('app.tenant_id', :t, true)"), {"t": tid})
        for f, mt, w, th in (("KNA1.STCEG", "tax_exact", 60, 1.0), ("KNA1.NAME1", "name_legal", 40, 0.6)):
            c.execute(text("INSERT INTO match_rules (tenant_id, domain, field, match_type, weight, threshold) "
                           "VALUES (:t, 'sd_customer_master', :f, :m, :w, :th)"), {"t": tid, "f": f, "m": mt, "w": w, "th": th})
    _insert(app_engine, tid, "C1", {"KNA1.STCEG": "XX123456789", "KNA1.NAME1": "Zeta Handel Gesellschaft"}, "sd_customer_master")
    cust = "sd_customer_master"
    assert _dups(app_engine, tid, {"KNA1.STCEG": "XX123456780"}, cust)["matches"] == []  # one digit off: another taxpayer
    d = _dups(app_engine, tid, {"KNA1.NAME1": "Zeta Handl Gesellschaft"}, cust)
    assert [(m["key"], m["found_by"]) for m in d["matches"]] == [("C1", "similar")]


def test_short_key_skips_the_similar_pass_and_says_so(app_engine):  # noqa: F811
    tid = _setup(app_engine)
    _insert(app_engine, tid, "30001", {"MAKT.MAKTX": "Seals"})
    d = _dups(app_engine, tid, {"MAKT.MAKTX": "Seal"})
    assert d["searched"] is True and d["matches"] == []
    assert d["fuzzy"] == {"ran": False, "reason": "key_too_short"}


def test_cap_holds_across_both_passes_and_exact_comes_first(app_engine, monkeypatch):  # noqa: F811
    from api.services import entry_duplicates as ed

    monkeypatch.setattr(ed, "CANDIDATE_CAP", 5)
    tid = _setup(app_engine)
    for i in range(3):
        _insert(app_engine, tid, f"4000{i}", {"MAKT.MAKTX": "Widget bracket zinc plated"})
    for i in range(10):
        _insert(app_engine, tid, f"4100{i}", {"MAKT.MAKTX": f"Widget bracket zinc plated {'abcdefghij'[i]}"})
    d = _dups(app_engine, tid, {"MAKT.MAKTX": "Widget bracket zinc plated"})
    assert d["scored"] == 5 and d["truncated"] is True
    by = {m["key"]: m["found_by"] for m in d["matches"]}
    assert [k for k, v in by.items() if v == "exact"] == ["40000", "40001", "40002"]
    assert sum(v == "similar" for v in by.values()) == 2


def test_other_tenants_near_match_and_merged_record_are_not_returned(app_engine):  # noqa: F811
    tid = _setup(app_engine)  # the other tenant holds the same descriptions under OTHER... keys
    _insert(app_engine, tid, "50001", {"MAKT.MAKTX": "Pressure relief valve body"})
    _insert(app_engine, tid, "50002", {"MAKT.MAKTX": "Pressure relief valve bodies"}, merged_into_key="50001")
    d = _dups(app_engine, tid, {"MAKT.MAKTX": "Pressure relief valve bodys"})
    assert [m["key"] for m in d["matches"]] == ["50001"]
    d = _dups(app_engine, tid, {"MAKT.MAKTX": "Hydralic seal kit heavy duty"})
    assert [m["key"] for m in d["matches"]] == ["10001"]


def test_missing_extension_reports_the_similar_pass_did_not_run(app_engine):  # noqa: F811
    from sqlalchemy import text
    from sqlalchemy.ext.asyncio import create_async_engine

    from api.services import entry_duplicates as ed

    tid = _setup(app_engine)
    rows = [{"MAKT.MAKTX": "Hydralic seal kit heavy duty"}, {"MARA.MFRPN": "XQ-7731-ZK"}]

    async def go():
        eng = create_async_engine(app_engine[0].url.set(drivername="postgresql+asyncpg"))
        try:
            async with eng.connect() as conn:
                tx = await conn.begin()  # DDL is transactional: the extension and its indexes come back on rollback
                await conn.execute(text("DROP EXTENSION pg_trgm CASCADE"))
                out = await ed.search(conn, tid, M, rows)
                await tx.rollback()
                return out
        finally:
            await eng.dispose()

    out = asyncio.run(go())
    assert out["search"]["searched"] is True
    assert out["search"]["fuzzy"] == {**out["search"]["fuzzy"], "available": False, "reason": "extension_missing"}
    assert [r["fuzzy"] for r in out["records"]] == [{"ran": False, "reason": "extension_missing"}] * 2
    assert out["records"][0]["matches"] == []  # the typo is missed, and the result says so
    assert [m["key"] for m in out["records"][1]["matches"]] == ["10001"]  # the exact pass still works
