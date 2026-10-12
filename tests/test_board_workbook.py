"""Board PDF, analyst workbook, report catalogue and export audit against a real Postgres with RLS.

Runs with MERIDIAN_TEST_DB_URL (see tests/test_pdf_reports_pg.py); skipped otherwise. One tenant owns a
29-module run priced across two L1s; a second tenant owns nothing and must see 404 everywhere.
"""

from __future__ import annotations

import asyncio
import io
import json
import re
import subprocess
import time
import uuid

import pytest

from tests.test_pdf_reports_pg import app_engine  # noqa: F401  (module-scoped fixture)
from tests.test_pdf_reports_pg import pytestmark  # noqa: F401

MODULES = (
    "business_partner material_master fi_gl accounts_payable accounts_receivable asset_accounting controlling hcm "
    "mm_purchasing plant_maintenance production_planning project_system quality_management sd_customer_master "
    "sd_sales_orders employee_central compensation benefits payroll_integration performance_goals "
    "succession_planning recruiting_onboarding learning_management time_attendance ewms_stock "
    "ewms_transfer_orders batch_management mdg_master_data grc_compliance"
).split()
P2P, HCM = "Vendor Master Management", "All SuccessFactors Modules"
P2P_RECORDS, HCM_RECORDS, P2P_PRICE, HCM_PRICE = 100, 10, 1234.5, 777.25
CROSS_L1_TOTAL = "1312225"  # P2P + HCM at 1,234.50 x 100 + 777.25 x 10 = 131,222.50, separators stripped
SEV = ("critical", "high", "medium")
DIMS = ("completeness", "accuracy", "validity")


def _seed_big(owner, app) -> tuple[str, str, str, str]:
    from sqlalchemy import text

    a, b, vid, prev = (str(uuid.uuid4()) for _ in range(4))
    with owner.begin() as c:
        c.execute(text("INSERT INTO tenants (id, name, cost_model) VALUES (:a, 'Tenant A', CAST(:cm AS jsonb)), "
                       "(:b, 'Tenant B', NULL)"),
                  {"a": a, "b": b, "cm": json.dumps({"currency": "EUR", "features": {P2P: P2P_PRICE, HCM: HCM_PRICE}})})
    with app.begin() as c:
        c.execute(text("SET LOCAL app.tenant_id = :t"), {"t": a})
        for v, days, shift in ((prev, 30, -6.0), (vid, 1, 0.0)):
            summary = {m: {"composite_score": round(70 + i % 20 + shift, 1), "total_checks": 3, "passing_checks": 1,
                           "critical_count": 1 if i % 4 == 0 else 0,
                           "dimension_scores": {d: round(60 + (i * 3) % 35 + shift, 1) for d in DIMS},
                           "dimension_coverage": {d: 1 for d in DIMS}} for i, m in enumerate(MODULES)}
            c.execute(text("INSERT INTO analysis_versions (id, tenant_id, label, status, run_at, metadata, dqs_summary) "
                           "VALUES (:v, :t, :l, 'complete', now() - make_interval(days => :d), '{}'::jsonb, "
                           "CAST(:q AS jsonb))"),
                      {"v": v, "t": a, "l": f"Run {days}d", "d": days, "q": json.dumps(summary)})
            for i, m in enumerate(MODULES):
                for k, sev in enumerate(SEV):
                    check = f"{m[:2].upper()}{i:02d}{k}"
                    affected = 40 - 10 * k + (0 if v == vid else 5)
                    # rule 0 carries rule_context, rule 1 only details.field_checked, rule 2 neither
                    rc = {"field": f"T{i}.F{k}"} if k == 0 else None
                    det = {"field_checked": f"T{i}.G{k}"} if k == 1 else {}
                    c.execute(text("INSERT INTO findings (version_id, tenant_id, module, check_id, severity, dimension, "
                                   "affected_count, total_count, pass_rate, details, rule_context) VALUES (:v, :t, :m, "
                                   ":c, :s, :d, :a, 100, :p, CAST(:det AS jsonb), CAST(:rc AS jsonb))"),
                              {"v": v, "t": a, "m": m, "c": check, "s": sev, "d": DIMS[k], "a": affected,
                               "p": 100 - affected, "det": json.dumps(det), "rc": json.dumps(rc) if rc else None})
                    if v != vid:
                        continue
                    for r in range(3):
                        c.execute(text("INSERT INTO finding_records (tenant_id, version_id, check_id, module, grain, "
                                       "record_key, field_values) VALUES (:t, :v, :c, :m, 'row', :k, CAST(:fv AS jsonb))"),
                                  {"t": a, "v": v, "c": check, "m": m, "k": f"KEY{i}-{r}",
                                   "fv": json.dumps({"F": ""})})
                    if k == 0:
                        c.execute(text("INSERT INTO record_fixes (tenant_id, version_id, check_id, module, record_id, "
                                       "field, invalid_value, suggested_value, status) VALUES (:t, :v, :c, :m, :k, 'F', "
                                       "'', 'X', 'open')"), {"t": a, "v": v, "c": check, "m": m, "k": f"KEY{i}-0"})
        for feature, n in ((P2P, P2P_RECORDS), (HCM, HCM_RECORDS)):
            c.execute(text("INSERT INTO config_impact_results (version_id, tenant_id, feature, system, status, "
                           "total_affected_records) VALUES (:v, :t, :f, 'ecc', 'blocked', :n)"),
                      {"v": vid, "t": a, "f": feature, "n": n})
    return a, b, vid, prev


def _pdf_text(data: bytes) -> str:
    return subprocess.run(["pdftotext", "-layout", "-", "-"], input=data, capture_output=True).stdout.decode()


@pytest.fixture(scope="module")
def seeded(app_engine):  # noqa: F811
    owner, app_eng = app_engine
    return _seed_big(owner, app_eng)


def _client_app(app_eng, who):
    from fastapi import FastAPI
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

    from api.deps import Tenant, get_db, get_tenant
    from api.routes.reports import router

    aeng = create_async_engine(app_eng.url.set(drivername="postgresql+asyncpg"))
    factory = async_sessionmaker(aeng, expire_on_commit=False)

    async def _db():
        async with factory() as s:
            yield s

    api = FastAPI()
    api.include_router(router)
    api.dependency_overrides[get_db] = _db
    api.dependency_overrides[get_tenant] = lambda: Tenant(uuid.UUID(who["tenant"]), "T", [])
    return api, aeng


def test_board_pdf_29_modules_fast_currency_and_no_cross_l1_total(app_engine, seeded):
    from api.services.pdf_reports import build
    from workers.db import tenant_session

    _, app_eng = app_engine
    a, _, vid, prev = seeded
    with tenant_session(app_eng, a) as s:
        t0 = time.perf_counter()
        pdf = build(s, a, "board", vid, None)
        elapsed = time.perf_counter() - t0
        with_prev = build(s, a, "board", vid, prev)
        executive = build(s, a, "executive", vid, None)
    assert pdf.startswith(b"%PDF") and len(pdf) > 5_000
    assert elapsed < 8, elapsed
    text = _pdf_text(pdf)
    assert "no earlier run" in text.lower()
    assert "no earlier run" not in _pdf_text(with_prev).lower()
    for t in (text, _pdf_text(with_prev), _pdf_text(executive)):
        assert CROSS_L1_TOTAL not in re.sub(r"[\s,.]", "", t)
    assert "EUR" in text and "ZAR" not in text
    assert "ZAR" not in _pdf_text(executive)
    with open("templates/executive_report.html") as f:
        assert "ZAR" not in f.read()  # the currency comes from the context, never a template literal


def test_workbook_structure_and_no_cross_l1_total(app_engine, seeded):
    from openpyxl import load_workbook

    from api.services.workbook_report import build
    from workers.db import tenant_session

    _, app_eng = app_engine
    a, _, vid, prev = seeded
    with tenant_session(app_eng, a) as s:
        data, name = build(s, a, vid, prev, None)
    assert name.endswith(".xlsx")
    wb = load_workbook(io.BytesIO(data))
    assert wb["_meta"].sheet_state == "hidden"
    for title in ("Summary", "Modules", "Rules", "Findings"):
        assert title in wb.sheetnames, wb.sheetnames
    assert wb["Modules"].max_row > len(MODULES)
    for title in ("Modules", "Rules", "Findings"):
        ws = wb[title]
        assert ws.auto_filter.ref, title
        assert ws.freeze_panes, title
    assert len(wb["Rules"].conditional_formatting) > 0
    cells = " ".join(str(c.value) for ws in wb.worksheets for row in ws.iter_rows() for c in row
                     if c.value is not None)
    assert CROSS_L1_TOTAL not in re.sub(r"[\s,.]", "", cells)
    assert "EUR" in cells and "ZAR" not in cells
    with tenant_session(app_eng, a) as s:
        _, name_mod = build(s, a, vid, None, "material_master")
    assert name_mod.endswith(".xlsx")


def test_routes_catalogue_audit_and_tenant_isolation(app_engine, seeded, monkeypatch):
    import workers.db
    from sqlalchemy import text

    owner, app_eng = app_engine
    a, b, vid, prev = seeded
    monkeypatch.setattr(workers.db, "get_sync_engine", lambda: app_eng)
    monkeypatch.setenv("MERIDIAN_DEV_ROLE_HEADER", "1")
    who = {"tenant": a}
    api, aeng = _client_app(app_eng, who)
    from httpx import ASGITransport, AsyncClient

    async def scenario():
        async with AsyncClient(transport=ASGITransport(app=api), base_url="http://t") as c:
            analyst, viewer = {"X-User-Role": "analyst"}, {"X-User-Role": "viewer"}
            r = await c.get(f"/api/v1/reports/board/{vid}.pdf?compare={prev}", headers=analyst)
            assert r.status_code == 200 and r.content.startswith(b"%PDF"), r.text
            r = await c.get(f"/api/v1/reports/{vid}/workbook.xlsx?module=material_master", headers=analyst)
            assert r.status_code == 200 and r.content[:2] == b"PK", r.text
            assert (await c.get(f"/api/v1/reports/board/{vid}.pdf", headers=viewer)).status_code == 403
            assert (await c.get(f"/api/v1/reports/{vid}/workbook.xlsx", headers=viewer)).status_code == 403

            r = await c.get(f"/api/v1/reports/catalogue?version_id={vid}&module=material_master&compare={prev}",
                            headers=analyst)
            assert r.status_code == 200
            cat = {e["id"]: e for e in r.json()}
            assert {"board", "workbook", "executive", "analysis", "extraction", "cleaning", "compare", "full", "json",
                    "object", "record"} <= set(cat)
            for e in cat.values():
                assert set(e) == {"id", "name", "format", "about", "sections", "page_estimate", "requires", "url",
                                  "last_built_at", "size_bytes"}
            assert cat["board"]["url"] == f"/api/v1/reports/board/{vid}.pdf?compare={prev}"
            assert "module=material_master" in cat["workbook"]["url"]
            assert cat["record"]["url"] is None
            no_module = {e["id"]: e for e in (await c.get(f"/api/v1/reports/catalogue?version_id={vid}",
                                                          headers=analyst)).json()}
            assert no_module["object"]["url"] is None
            none = {e["id"]: e for e in (await c.get("/api/v1/reports/catalogue", headers=analyst)).json()}
            assert all(e["url"] is None for e in none.values())

            who["tenant"] = b
            for url in (f"/api/v1/reports/board/{vid}.pdf", f"/api/v1/reports/{vid}/workbook.xlsx",
                        f"/api/v1/reports/catalogue?version_id={vid}"):
                assert (await c.get(url, headers=analyst)).status_code == 404, url
        await aeng.dispose()

    asyncio.run(scenario())
    with owner.begin() as c:
        rows = c.execute(text("SELECT after_json->>'kind' AS kind, tenant_id::text AS tid FROM audit_log "
                              "WHERE action = 'report.export' AND entity_id = :v ORDER BY created_at"),
                         {"v": vid}).all()
    assert [(r.kind, r.tid) for r in rows] == [("board", a), ("workbook", a)]  # nothing audited for the 404s
