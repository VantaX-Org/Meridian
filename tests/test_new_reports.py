"""Trend report, rule catalogue, data dictionary and owner workload: context builders from fixtures,
the HTML they render, and the PDF. No database needed."""

from __future__ import annotations

import asyncio
import copy
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from api.services import pdf_reports as pr
from tests import pdf_fixtures as fx

pytest.importorskip("weasyprint")

KW = {"tenant_name": fx.TENANT, "generated_at": fx.GENERATED}


def _html(template: str, ctx: dict) -> str:
    import html
    import re

    out = pr._env().get_template(template).render(**ctx)
    out = re.sub(r"(?is)<(style|script)\b.*?</\1>", " ", out)
    return html.unescape(re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", out)))


def _pdf(template: str, ctx: dict) -> bytes:
    pdf = pr.render(template, ctx)
    assert pdf.startswith(b"%PDF")
    return pdf


# ── trend ────────────────────────────────────────────────────────────────────


def _trend() -> tuple[dict, list[dict], list[dict]]:
    from api.services import insights_aggregate as agg

    third = copy.deepcopy(fx.V2)
    third.update(id="6f1c2a10-0000-4000-8000-000000000003", label="November re-run",
                 run_at=fx.V2["run_at"] + timedelta(days=30))
    third["dqs_summary"]["fi_gl"]["composite_score"] = 91.0
    versions = [fx.V1, fx.V2, third]
    by_run = {fx.V1["id"]: fx.FINDINGS1, fx.V2["id"]: fx.FINDINGS2, third["id"]: fx.FINDINGS2}
    runs = agg.trend_runs(versions, by_run, {}, {})
    return {"runs": runs, "annotations": [{"version_id": fx.V2["id"], "kind": "event", "label": "Baseline pinned"}]}, \
        fx.FINDINGS1, fx.FINDINGS2


def test_trend_report():
    trend, first, last = _trend()
    ctx = pr.trend_context(fx.V2, trend, first, last, scoring={}, system=fx.SYSTEM, **KW)
    assert ctx["run_count"] == 3
    # scores are re-weighted under the tenant's config, so compare with the runs' own module scores
    m0 = ctx["movers"][0]
    runs = trend["runs"]
    assert m0["module"] == "accounts_payable"
    assert m0["change"] == round(runs[-1]["modules"]["accounts_payable"] - runs[0]["modules"]["accounts_payable"], 1)
    assert [m["change"] for m in ctx["movers"]] == sorted((m["change"] for m in ctx["movers"]), key=abs, reverse=True)
    assert {m["module"] for m in ctx["movers"]} == {"business_partner", "material_master", "accounts_payable"}
    assert [r["check_id"] for r in ctx["new_rules"]] == ["AP014"]
    assert sorted(r["check_id"] for r in ctx["fixed_rules"]) == ["AP005", "BP009"]
    assert ctx["headline"].startswith("Across 3 runs the score rose by")
    assert "2 rules stopped failing and 1 started failing" in ctx["headline"]
    text = _html("trend_report.html", ctx)
    for s in ("Score over time", "Scores by dimension", "Objects that moved most", "Rules that started failing",
              "Rules that were fixed", "Accounts payable", "AP014", "BP009", "Methodology", "September baseline",
              "Baseline pinned"):
        assert s in text, s
    assert "!" not in ctx["headline"]
    _pdf("trend_report.html", ctx)


def test_trend_report_single_run_renders_with_reason():
    from api.services import insights_aggregate as agg

    runs = agg.trend_runs([fx.V2], {fx.V2["id"]: fx.FINDINGS2}, {}, {})
    ctx = pr.trend_context(fx.V2, {"runs": runs}, [], [], scoring={}, **KW)
    text = _html("trend_report.html", ctx)
    assert "needs at least two finished runs" in text and "no movement to report" in ctx["headline"]
    # the one run's own results still print: the run-by-run table needs one run, the trend needs two
    assert "Run by run" in text and "first run" in text and "October re-run" in text
    _pdf("trend_report.html", ctx)
    empty = pr.trend_context(fx.V2, {"runs": []}, [], [], scoring={}, **KW)
    assert "no trend to report" in empty["headline"]
    _pdf("trend_report.html", empty)


# ── rule catalogue ───────────────────────────────────────────────────────────


def _rules() -> list[dict]:
    mk = pr._rule_row
    return [
        mk("BP001", "BP001: Partner number must be set", "business_partner", "ecc", "critical",
           "A partner without a number cannot be referenced. " + "Long text " * 60,
           '[{"field": "BUT000.PARTNER", "dimension": "completeness"}]', True, "yaml"),
        mk("BP004", "BP004: Partner type is valid", "business_partner", "ecc", "high", "", '[{"field": "BUT000.BU_TYPE", "dimension": "validity"}]',
           False, "yaml"),
        mk("MM003", "MM003: Material type must be set", "material_master", "ecc", "medium", "Material type controls valuation.",
           '[{"field": "MARA.MTART", "dimension": "completeness"}]', True, "yaml"),
        mk("EC001", "EC001: Employee has a start date", "employee_central", "successfactors", "info", "Start date drives tenure.",
           '[{"field": null, "dimension": "timeliness"}]', True, "custom"),
    ]


def test_rule_catalogue_groups_and_filters():
    ctx = pr.rules_context(_rules(), **KW)
    assert [g["module"] for g in ctx["groups"]] == ["business_partner", "material_master", "employee_central"]
    assert ctx["total"] == 4 and ctx["switched_off"] == 1
    bp = ctx["groups"][0]["rules"]
    assert [r["id"] for r in bp] == ["BP001", "BP004"] and len(bp[0]["description"]) < 300
    text = _html("rule_catalogue.html", ctx)
    for s in ("Rule catalogue", "Contents", "Business partner", "BP001", "BUT000.PARTNER", "Completeness",
              "Partner number must be set", "(off)", "not tied to one field", "4 rules across 3 objects"):
        assert s in text, s
    only = pr.rules_context(_rules(), module="material_master", **KW)
    assert only["total"] == 1 and "MM003" in _html("rule_catalogue.html", only)
    assert "BP001" not in _html("rule_catalogue.html", only)
    _pdf("rule_catalogue.html", ctx)
    none = pr.rules_context([], module="x", **KW)
    assert "No rule matches" in none["headline"]
    _pdf("rule_catalogue.html", none)


def test_rule_catalogue_reads_the_shipped_yaml():
    """The real catalogue: every rule gets an id, a module and a severity."""
    from api.services.tenant_seed import rule_catalogue

    rows = [pr._rule_row(r["rid"], r["name"], r["module"], r["category"], r["severity"], r["description"],
                         r["conditions"], r["enabled"], "yaml") for r in rule_catalogue()
            if r["module"] == "material_master"]
    assert rows and all(r["id"] and r["severity"] for r in rows)
    ctx = pr.rules_context(rows, module="material_master", **KW)
    assert ctx["total"] == len(rows)
    _pdf("rule_catalogue.html", ctx)


# ── data dictionary ──────────────────────────────────────────────────────────


def test_data_dictionary_all_and_one_module():
    from sap.data_dictionary import get_all_table_names

    ctx = pr.dictionary_context(**KW)
    assert {t["name"] for t in ctx["tables"]} == set(get_all_table_names())
    lfa1 = next(t for t in ctx["tables"] if t["name"] == "LFA1")
    assert "accounts_payable" in lfa1["modules"] and lfa1["key_fields"]
    assert any(f["key"] for f in lfa1["fields"]) and any(f["mandatory"] for f in lfa1["fields"])
    text = _html("data_dictionary.html", ctx)
    for s in ("Data dictionary", "Contents", "LFA1", "Accounts payable", "Mandatory", "Key", "Allowed values"):
        assert s in text, s
    assert "built-in method" not in text and "any value" in text
    one = pr.dictionary_context(module="accounts_payable", **KW)
    assert 0 < len(one["tables"]) < len(ctx["tables"])
    assert all("accounts_payable" in t["modules"] for t in one["tables"])
    _pdf("data_dictionary.html", one)
    _pdf("data_dictionary.html", ctx)


def test_data_dictionary_short_values_only():
    assert pr._short_values({"valid_values": ["A", "B"]}) == "A, B"
    assert pr._short_values({"valid_values": [f"V{i}" for i in range(30)]}) == "30 allowed values"
    assert pr._short_values({"valid_values": None}) is None
    empty = pr.dictionary_context(module="no_such_module", **KW)
    assert empty["tables"] == [] and "No table" in empty["headline"]
    _pdf("data_dictionary.html", empty)


# ── owner workload ───────────────────────────────────────────────────────────


def _owner_inputs() -> tuple[list[dict], list[dict]]:
    owners = [
        {"user_id": "u1", "owner": "Thandi Mokoena", "score": 82.0, "delta": 3.0,
         "open_by_severity": {"high": 2, "low": 8}, "fixed_since_baseline": 5, "oldest_item_age_days": 40},
        {"user_id": "u2", "owner": "Pieter Naidoo", "score": 41.0, "delta": -6.0,
         "open_by_severity": {"critical": 4, "high": 3}, "fixed_since_baseline": 0, "oldest_item_age_days": 90},
        {"user_id": "u3", "owner": "Aisha Khan", "score": None, "delta": None, "open_by_severity": {},
         "fixed_since_baseline": 0, "oldest_item_age_days": 0},
    ]
    blocking = {"check_id": "BP001", "severity": "critical", "affected": 1_045, "name": "Partner number must be set"}
    objects = [
        {"module": "business_partner", "score": 83.9, "owner_id": "u2", "blocking": blocking},
        {"module": "material_master", "score": 84.1, "owner_id": "u1", "blocking": None},
        {"module": "accounts_payable", "score": 79.0, "owner_id": None,
         "blocking": {"check_id": "AP002", "severity": "critical", "affected": 120, "name": "Vendor name must be set"}},
        {"module": "fi_gl", "score": 93.4, "owner_id": None, "blocking": None},
    ]
    return owners, objects


def test_owner_report():
    owners, objects = _owner_inputs()
    ctx = pr.owners_context(fx.V2, owners, objects, scoring={}, system=fx.SYSTEM, **KW)
    assert [o["owner"] for o in ctx["owners"]] == ["Pieter Naidoo", "Thandi Mokoena", "Aisha Khan"]
    assert ctx["owners"][0]["open"] == 7 and ctx["owners"][0]["trend"] == "slipped"
    assert ctx["owners"][1]["trend"] == "improved"
    assert [x["module"] for x in ctx["unassigned"]] == ["accounts_payable", "fi_gl"]
    assert "Pieter Naidoo has the lowest owner score, 41.0 out of 100" in ctx["headline"]
    text = _html("owner_report.html", ctx)
    for s in ("Owner workload", "Pieter Naidoo", "BP001", "Partner number must be set", "Objects with no owner",
              "Accounts payable", "AP002", "Slipped 6.0", "Improved 3.0", "No blocking rule",
              "No object is assigned to Aisha Khan", "Methodology", "loses 10 for each open critical"):
        assert s in text, s
    assert text.index("Pieter Naidoo") < text.index("Thandi Mokoena")
    _pdf("owner_report.html", ctx)


def test_owner_report_empty_and_blocking_pick():
    ctx = pr.owners_context(fx.V2, [], [], scoring={}, **KW)
    assert "No owner and no object" in ctx["headline"]
    assert "No item is assigned" in _html("owner_report.html", ctx)
    _pdf("owner_report.html", ctx)
    b = pr._blocking_rule_of(fx.FINDINGS2)
    assert b["business_partner"]["check_id"] == "BP001"  # critical before high
    assert b["accounts_payable"]["check_id"] == "AP002"
    assert "fi_gl" not in b  # medium only: not blocking


# ── catalogue ────────────────────────────────────────────────────────────────


def test_catalogue_lists_the_new_reports():
    from api.routes.reports import report_catalogue

    tenant = SimpleNamespace(id=uuid.uuid4())
    no_run = asyncio.run(report_catalogue(version_id=None, module=None, compare=None, db=AsyncMock(), tenant=tenant))
    by_id = {e["id"]: e for e in no_run}
    for rid, name in (("trend", "Trend report"), ("rules", "Rule catalogue"), ("dictionary", "Data dictionary"),
                      ("owners", "Owner workload")):
        assert by_id[rid]["name"] == name and by_id[rid]["format"] == "PDF" and by_id[rid]["sections"]
    # rules and dictionary need no run; the run-bound ones stay null until a run is chosen
    assert by_id["rules"]["url"] is None  # the catalogue needs an object: the whole set is hundreds of pages
    assert by_id["dictionary"]["url"] == "/api/v1/reports/dictionary.pdf"
    assert by_id["trend"]["url"] is None and by_id["owners"]["url"] is None


def test_catalogue_urls_for_a_run_and_module():
    from api.routes import reports as routes

    class Result:
        def first(self): return (1,)
        def scalar_one_or_none(self): return datetime.now(timezone.utc)

    db = AsyncMock()
    db.execute.return_value = Result()
    vid = uuid.uuid4()
    tenant = SimpleNamespace(id=uuid.uuid4())
    out = asyncio.run(routes.report_catalogue(version_id=vid, module="material_master", compare=None, db=db, tenant=tenant))
    by_id = {e["id"]: e for e in out}
    assert by_id["trend"]["url"] == f"/api/v1/reports/trend.pdf?version_id={vid}&runs=12"
    assert by_id["owners"]["url"] == f"/api/v1/reports/owners/{vid}.pdf"
    assert by_id["rules"]["url"] == "/api/v1/reports/rules.pdf?module=material_master"
    assert by_id["dictionary"]["url"] == "/api/v1/reports/dictionary.pdf?module=material_master"
    ids = [e["id"] for e in out]
    assert len(ids) == len(set(ids))


def test_routes_are_registered_and_do_not_shadow_each_other():
    from fastapi import FastAPI
    from fastapi.routing import APIRoute

    from api.routes.reports import router

    app = FastAPI()
    app.include_router(router)
    paths = {r.path for r in router.routes if isinstance(r, APIRoute)}
    for p in ("/api/v1/reports/trend.pdf", "/api/v1/reports/rules.pdf", "/api/v1/reports/dictionary.pdf",
              "/api/v1/reports/owners/{version_id}.pdf", "/api/v1/reports/catalogue"):
        assert p in paths, p


def test_trend_runs_carry_the_change_from_the_run_before():
    """Each run reads against the one before it: the composite delta and the rules that stopped or
    started failing, counting only rules that ran cleanly in both."""
    from api.services import insights_aggregate as agg

    runs = agg.trend_runs([fx.V1, fx.V2], {fx.V1["id"]: fx.FINDINGS1, fx.V2["id"]: fx.FINDINGS2}, {}, {})
    first, last = runs
    assert first["change"] is None and first["rules_fixed"] is None and first["rules_new"] is None
    assert last["change"] == round(last["composite"] - first["composite"], 1)
    fails1 = {f["check_id"] for f in fx.FINDINGS1 if f["affected_count"] and not f["details"].get("error")}
    fails2 = {f["check_id"] for f in fx.FINDINGS2 if f["affected_count"] and not f["details"].get("error")}
    ran = {f["check_id"] for f in fx.FINDINGS1 if not f["details"].get("error")} & \
        {f["check_id"] for f in fx.FINDINGS2 if not f["details"].get("error")}
    assert last["rules_fixed"] == len(ran & fails1 - fails2) and last["rules_new"] == len(ran & fails2 - fails1)
    assert last["failing_rules"] == len(fails2) and last["high"] == sum(
        1 for f in fx.FINDINGS2 if f["check_id"] in fails2 and f["severity"] == "high")
    assert last["affected_records"] == agg.failing_records(fx.FINDINGS2)
    # the trend report prints the run-by-run table with those columns
    ctx = pr.trend_context(fx.V2, {"runs": runs, "annotations": []}, fx.FINDINGS1, fx.FINDINGS2, scoring={}, **KW)
    text = _html("trend_report.html", ctx)
    assert "Run by run" in text and "first run" in text and f"{last['change']:+.1f}" in text
