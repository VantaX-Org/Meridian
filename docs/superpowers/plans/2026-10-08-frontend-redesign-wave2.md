# Frontend Redesign Wave 2 — Insights Suite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the five `/insights` pages (readiness, impact, owners, duplicates, exec) plus their backing endpoints, retire the legacy `/executive-report` route, and cover the new deterministic computations with tests.

**Architecture:** Each page is a thin Next.js route under `frontend/app/(app)/insights/*` built only from `@/design` primitives (delivered by Wave 1a) and a typed client in `frontend/lib/api/insights.ts`. Each backend endpoint lives in a new `api/routes/insights.py`, is a thin FastAPI wrapper around a pure, deterministic computation function in a new `api/services/insights_*.py` module, and reuses existing persisted data (`config_impact_results`, `record_issues`, `match_scores`/`merge_explain.cluster_graph`, migration engine `ModuleResult`, `s4_readiness` rollup) rather than new tables. No LLM is used anywhere in this wave — every number is a pure Python/TS function with a unit test.

**Tech Stack:** FastAPI + SQLAlchemy (async) + Postgres RLS, Celery beat, Next.js 15 App Router + TypeScript strict + `@/design`, pytest, vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-08-frontend-redesign-design.md` sections 8 (8.1–8.5), 9.4, 10, 13.

## Global Constraints

- TypeScript strict, no `any`.
- Typed API wrappers live in `frontend/lib/api/`.
- Pages import only from `@/design`.
- Run all frontend commands from `frontend/`.
- `npm run typecheck && npm run lint && npm run lint:tokens && npm test` must pass before each commit.
- Python tests via `python3 -m pytest -q -p no:cacheprovider` (set `MERIDIAN_TEST_DB_URL` for Postgres tests).
- Every query includes `tenant_id`; RLS enforced; always `SET app.tenant_id` before a session runs.
- All numbers are deterministic — no LLM anywhere in this wave.
- Commit messages are normal prose, ending with exactly these two lines:
  ```
  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01NfZiWjz1L8g8HN5DaEsNW6
  ```
- Never touch PRs #390 or #184.
- Do not edit `sap/dictionaries/ecc6/tables/COMPINFO.json`.

## Interfaces assumed delivered by Wave 1a/1b (do not reinvent)

- `@/design`: primitives, `DataTable`, charts `Line/Bar/Waterfall/Radar/Heatmap/Sparkline` each with `onPointClick(point)`, `ReportPage` template taking `{narrative, children, exportAction}`.
- `DrillLink({object, dimension?, ruleId?, filters?})`.
- `RunSelector` reading `?run=` and `?baseline=`.
- `lib/query-keys.ts`.
- `vitest` via `npm test`.
- The `(app)` route group.
- Routes `/objects/[object]` and `/runs/[a]/vs/[b]`.
- Endpoints `GET /api/v1/objects` and `GET /api/v1/objects/{object}`.

## Known gap, stated up front (not invented)

Spec 8.1's "wave" column has **no existing concept anywhere in the codebase** (confirmed by exhaustive grep for `wave` across `.py`/`.yaml`/`.ts` — only unrelated matches in warehouse-module code). Task 1 introduces the minimum new setting required: a tenant-scoped JSON mapping of wave name → list of migration-engine `module` names, stored in the existing settings mechanism (see Task 1). This is new configuration, not new schema, and is called out explicitly rather than silently assumed.

Spec 8.4's node-size metric ("open POs/SOs/BOMs") can only be sourced today from BOM usage (`STPO`/`MAST`, already loaded by `api/services/material_360.py`'s `OPTIONAL_TABLES`). Open PO (`EKPO`) and open SO (`VBAP`) line counts exist in `sap/extraction_registry.py` for the `mm_purchasing`/`sd_sales_orders` modules but are **not** wired into the material-master extract (`CORE_TABLES`/`OPTIONAL_TABLES` in `api/services/material_360.py`), and cross-module joins are out of scope for this wave. Task 14 implements node size from BOM usage count only and documents the PO/SO extension point (`api/services/material_360.py` `CORE_TABLES`/`OPTIONAL_TABLES`, `sap/extraction_registry.py` lines ~275 and ~607) as a follow-up, rather than inventing a join.

---

## Task 1: Settings — readiness threshold, wave grouping, and feature value-at-risk

**Files:**
- Modify: `api/routes/settings.py`
- Modify: `frontend/types/api.ts`
- Modify: `frontend/lib/api/settings.ts`
- Create: `api/routes/tests/test_settings_insights.py`

**Interfaces:**
```python
# api/routes/settings.py — extend the existing AlertThresholds model
class AlertThresholds(BaseModel):
    critical_threshold: int
    high_threshold: int
    dqs_drop_threshold: int
    module_floors: dict[str, int] = {}
    readiness_dqs_threshold: int = 70          # NEW — Go/At-risk/No-go cutoff for 8.1
    readiness_waves: dict[str, list[str]] = {} # NEW — wave name -> [migration module names]

# CostModel — extend with a parallel "features" section for 8.2's value-at-risk
class CostModel(BaseModel):
    currency: str
    severity: dict
    modules: dict
    rules: dict
    features: dict[str, float] = {}  # NEW — feature name (e.g. "MIGO") -> value per blocked record
```

- [ ] **Step 1:** Open `api/routes/settings.py`, find the current `AlertThresholds` and `CostModel` class definitions (exact lines via `grep -n "class AlertThresholds\|class CostModel" api/routes/settings.py`). Add the two new fields to each exactly as shown in the Interfaces block above, preserving every existing field, decorator, and the existing `GET/PUT /settings/cost-model` and `GET/PUT`-equivalent alert-thresholds handlers unchanged except for picking up the new fields through the existing nested-JSONB-merge (`alert_thresholds`) and full-replace (`cost_model`) code paths already in this file — do not add new routes.
- [ ] **Step 2:** In `checks/cost.py`, find `SEVERITY_FACTOR` and `validate_spec` (via `grep -n "SEVERITY_FACTOR\|def validate_spec\|def defaults\|def effective\|def resolve" checks/cost.py`). Add `features` to whatever dict `defaults()` returns (default `{}`) and to `validate_spec`'s accepted top-level keys, following the exact pattern already used for `modules`/`rules` in that function — read the existing branch for `rules` before writing the `features` branch so the validation (type checks, key format) matches exactly.
- [ ] **Step 3:** Create `api/routes/tests/test_settings_insights.py`:
```python
import pytest
from httpx import AsyncClient

@pytest.mark.anyio
async def test_cost_model_round_trips_features(client: AsyncClient, tenant_headers):
    payload = {
        "currency": "USD",
        "severity": {},
        "modules": {},
        "rules": {},
        "features": {"MIGO": 150.0, "VA01": 90.0},
    }
    r = await client.put("/api/v1/settings/cost-model", json=payload, headers=tenant_headers)
    assert r.status_code == 200
    r = await client.get("/api/v1/settings/cost-model", headers=tenant_headers)
    assert r.json()["features"] == {"MIGO": 150.0, "VA01": 90.0}

@pytest.mark.anyio
async def test_alert_thresholds_readiness_fields_round_trip(client: AsyncClient, tenant_headers):
    r = await client.patch(
        "/api/v1/settings/alert-thresholds",
        json={
            "critical_threshold": 5, "high_threshold": 10, "dqs_drop_threshold": 10,
            "module_floors": {}, "readiness_dqs_threshold": 80,
            "readiness_waves": {"Wave 1": ["material_master"], "Wave 2": ["business_partner"]},
        },
        headers=tenant_headers,
    )
    assert r.status_code == 200
    r = await client.get("/api/v1/settings", headers=tenant_headers)
    body = r.json()["alert_thresholds"]
    assert body["readiness_dqs_threshold"] == 80
    assert body["readiness_waves"]["Wave 1"] == ["material_master"]

@pytest.mark.anyio
async def test_cost_model_is_tenant_isolated(client: AsyncClient, tenant_headers, other_tenant_headers):
    await client.put("/api/v1/settings/cost-model", json={
        "currency": "USD", "severity": {}, "modules": {}, "rules": {}, "features": {"MIGO": 999.0},
    }, headers=tenant_headers)
    r = await client.get("/api/v1/settings/cost-model", headers=other_tenant_headers)
    assert r.json().get("features", {}).get("MIGO") != 999.0
```
Adapt the fixture names (`client`, `tenant_headers`, `other_tenant_headers`) to whatever this test package's existing `conftest.py` actually defines — run `grep -n "^def \|^async def " api/routes/tests/conftest.py` first and use the real fixture names verbatim.
- [ ] **Step 4:** In `frontend/types/api.ts`, find the `AlertThresholds` interface (`grep -n "interface AlertThresholds" frontend/types/api.ts`) and add `readiness_dqs_threshold: number; readiness_waves: Record<string, string[]>;`. Add a new `CostModel` interface (it does not exist yet) matching the Python shape: `{ currency: string; severity: Record<string, number>; modules: Record<string, number>; rules: Record<string, number>; features: Record<string, number>; }`.
- [ ] **Step 5:** In `frontend/lib/api/settings.ts`, add:
```ts
import type { CostModel } from "@/types/api";

export async function getCostModel(): Promise<CostModel> {
  const { data } = await apiClient.get<CostModel>("/api/v1/settings/cost-model");
  return data;
}

export async function updateCostModel(model: CostModel): Promise<void> {
  await apiClient.put("/api/v1/settings/cost-model", model);
}
```
- [ ] **Step 6:** Run `python3 -m pytest -q -p no:cacheprovider api/routes/tests/test_settings_insights.py`. Expected: `3 passed`.
- [ ] **Step 7:** From `frontend/`, run `npm run typecheck`. Expected: no errors.
- [ ] **Step 8:** Commit:
```
git add api/routes/settings.py checks/cost.py api/routes/tests/test_settings_insights.py frontend/types/api.ts frontend/lib/api/settings.ts
git commit -m "Add readiness threshold, wave grouping, and feature value-at-risk settings

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NfZiWjz1L8g8HN5DaEsNW6"
```

---

## Task 2: Readiness grid computation — `api/services/insights_readiness.py`

**Files:**
- Create: `api/services/insights_readiness.py`
- Create: `api/services/tests/test_insights_readiness.py`

**Interfaces:**
```python
from dataclasses import dataclass

@dataclass
class ReadinessCell:
    module: str
    wave: str
    verdict: str          # "go" | "at_risk" | "no_go"
    blocker_count: int
    dqs: float | None

def build_readiness_grid(
    module_results: dict[str, "ModuleResult"],  # api.services.migration.engine.ModuleResult, keyed by module
    dqs_by_module: dict[str, float],
    waves: dict[str, list[str]],                # from AlertThresholds.readiness_waves
    dqs_threshold: float,
) -> list[ReadinessCell]: ...
```

- [ ] **Step 1:** Read `api/services/migration/engine.py` lines 180-230 in full (`grep -n "verdict" api/services/migration/engine.py` to find every branch) to capture the exact set of verdict strings `ModuleResult.verdict` can hold. Do not guess; copy them verbatim into this file's module docstring as a comment, e.g. `# ModuleResult.verdict values: "go", <exact other strings found>`.
- [ ] **Step 2:** Create `api/services/insights_readiness.py`:
```python
"""Deterministic readiness-grid computation for /insights/readiness (spec 8.1).

Rows = S/4 objects (api.services.migration.engine.ModuleResult.module).
Columns = waves (tenant setting AlertThresholds.readiness_waves: wave name -> [module names]).
Cell verdict: "no_go" if the migration engine's own verdict for that module is not "go"
(i.e. there are blocking structural/critical gaps); else "at_risk" if the module's DQS is
below the tenant's readiness_dqs_threshold; else "go".

ModuleResult.verdict values confirmed in api/services/migration/engine.py (read in full
before editing this file): "go", <fill in from Step 1 of the plan task>.
"""
from dataclasses import dataclass


@dataclass
class ReadinessCell:
    module: str
    wave: str
    verdict: str
    blocker_count: int
    dqs: float | None


def build_readiness_grid(
    module_results: dict,
    dqs_by_module: dict,
    waves: dict,
    dqs_threshold: float,
) -> list[ReadinessCell]:
    cells: list[ReadinessCell] = []
    for wave, modules in waves.items():
        for module in modules:
            mr = module_results.get(module)
            if mr is None:
                cells.append(ReadinessCell(module, wave, "no_go", 0, None))
                continue
            dqs = dqs_by_module.get(module)
            if mr.verdict != "go":
                verdict = "no_go"
            elif dqs is not None and dqs < dqs_threshold:
                verdict = "at_risk"
            else:
                verdict = "go"
            cells.append(ReadinessCell(module, wave, verdict, mr.blocked_records, dqs))
    return cells
```
- [ ] **Step 3:** Create `api/services/tests/test_insights_readiness.py`:
```python
from dataclasses import dataclass
from api.services.insights_readiness import build_readiness_grid


@dataclass
class _MR:
    module: str
    blocked_records: int
    verdict: str


def test_no_go_when_engine_verdict_is_not_go():
    cells = build_readiness_grid(
        {"material_master": _MR("material_master", 12, "no_go")},
        {"material_master": 95.0},
        {"Wave 1": ["material_master"]},
        dqs_threshold=70,
    )
    assert cells == [__import__("api.services.insights_readiness", fromlist=["ReadinessCell"]).ReadinessCell(
        "material_master", "Wave 1", "no_go", 12, 95.0,
    )]


def test_at_risk_when_dqs_below_threshold_but_engine_says_go():
    cells = build_readiness_grid(
        {"business_partner": _MR("business_partner", 0, "go")},
        {"business_partner": 60.0},
        {"Wave 1": ["business_partner"]},
        dqs_threshold=70,
    )
    assert cells[0].verdict == "at_risk"


def test_go_when_engine_go_and_dqs_at_or_above_threshold():
    cells = build_readiness_grid(
        {"business_partner": _MR("business_partner", 0, "go")},
        {"business_partner": 70.0},
        {"Wave 1": ["business_partner"]},
        dqs_threshold=70,
    )
    assert cells[0].verdict == "go"


def test_missing_module_result_is_no_go():
    cells = build_readiness_grid({}, {}, {"Wave 1": ["asset_accounting"]}, dqs_threshold=70)
    assert cells[0].verdict == "no_go"
    assert cells[0].dqs is None
```
- [ ] **Step 4:** Run `python3 -m pytest -q -p no:cacheprovider api/services/tests/test_insights_readiness.py`. Expected: `4 passed`.
- [ ] **Step 5:** Commit:
```
git add api/services/insights_readiness.py api/services/tests/test_insights_readiness.py
git commit -m "Add deterministic readiness-grid computation for the insights readiness page

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NfZiWjz1L8g8HN5DaEsNW6"
```

---

## Task 3: `GET /api/v1/insights/readiness` route

**Files:**
- Create: `api/routes/insights.py`
- Modify: `api/main.py` (register the new router)
- Create: `api/routes/tests/test_insights_readiness_route.py`

**Interfaces:**
```python
GET /api/v1/insights/readiness?version_id=<uuid>
-> {
  "version_id": "<uuid>",
  "threshold": 70,
  "cells": [{"module": "material_master", "wave": "Wave 1", "verdict": "go", "blocker_count": 0, "dqs": 92.1}, ...],
  "owners_by_module": {"material_master": [{"owner": "...", "days_to_gate": 12}]},
  "trend": {"material_master": [{"run_at": "...", "blocker_count": 3}, ...]},
}
```

- [ ] **Step 1:** Confirmed: `migration_runs.gap_summary` (JSONB) is the real per-module `ModuleResult`-shaped store. `workers/tasks/run_migration.py`'s `_finish()` persists it via `UPDATE migration_runs SET ... gap_summary = CAST(:gs AS jsonb) ...`, built per-module a few lines above as `summary[module] = {"records": res.records, "blocked_records": res.blocked_records, "score": res.score, "verdict": res.verdict, "gaps": res.counts, "source_tables": tables}`. `migration_runs.source_version_id` links the run to the `analysis_versions` row it analysed. `api/routes/migration.py`'s `get_run`/`run_findings` only expose `migration_gap_findings`-derived `gap_breakdown` (grouped by module/gap_type/severity/grounded, no per-module verdict) — `gap_summary` on the run itself is the correct source, not a new table.
- [ ] **Step 2:** Confirmed: `analysis_versions.dqs_summary` (JSONB, keyed by module, each value a serialized `DQSResult`) is the DQS-by-module source, already read this exact way in `api/routes/system_objects.py`'s `system_versions`/`trends` handlers: `{m: (d or {}).get("composite_score") for m, d in dqs.items()}`. `api/services/s4_readiness.py`'s `rollup()` is simplification-area grain, not migration-engine `module` grain, so it is not used here.
- [ ] **Step 3:** Create `api/routes/insights.py`:
```python
"""GET endpoints backing the /insights/* pages (spec 8). All computation is
deterministic — no LLM calls anywhere in this module."""
import uuid
from types import SimpleNamespace
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from api.dependencies import get_db, get_tenant, Tenant, require_permission
from api.services.insights_readiness import build_readiness_grid

router = APIRouter(prefix="/api/v1/insights", tags=["insights"])


async def _rls(db: AsyncSession, tenant: Tenant) -> None:
    await db.execute(text("SET app.tenant_id = :t"), {"t": str(tenant.id)})


@router.get("/readiness", dependencies=[Depends(require_permission("view"))])
async def get_readiness(
    version_id: Optional[uuid.UUID] = None,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    await _rls(db, tenant)
    row = (await db.execute(
        text("SELECT value FROM tenant_settings WHERE tenant_id = :t AND key = 'alert_thresholds'"),
        {"t": str(tenant.id)},
    )).fetchone()
    thresholds = (row[0] if row else {}) or {}
    waves = thresholds.get("readiness_waves") or {}
    dqs_threshold = thresholds.get("readiness_dqs_threshold", 70)
    if not waves:
        raise HTTPException(409, "No readiness_waves configured — set them under Settings > Alert Thresholds")

    # module_results: migration_runs.gap_summary, JSONB keyed by module (Step 1).
    # Explicit version_id picks the run whose source_version_id matches it; otherwise
    # take this tenant's latest analysed run — same "default to latest" pattern as
    # api/routes/materials.py's _latest() helper, just scoped to migration_runs here.
    run_row = (await db.execute(
        text("""
            SELECT gap_summary, source_version_id FROM migration_runs
            WHERE tenant_id = :t AND status = 'analysed'
              AND (:vid::uuid IS NULL OR source_version_id = :vid)
            ORDER BY completed_at DESC LIMIT 1
        """),
        {"t": str(tenant.id), "vid": str(version_id) if version_id else None},
    )).fetchone()
    gap_summary = (run_row[0] if run_row else {}) or {}
    resolved_version_id = run_row[1] if run_row else version_id
    module_results = {
        module: SimpleNamespace(verdict=data.get("verdict"), blocked_records=data.get("blocked_records", 0))
        for module, data in gap_summary.items()
    }

    # dqs_by_module: analysis_versions.dqs_summary, JSONB keyed by module (Step 2),
    # scoped to the same resolved_version_id so both lookups agree on "which run".
    dqs_summary = {}
    if resolved_version_id:
        dqs_row = (await db.execute(
            text("SELECT dqs_summary FROM analysis_versions WHERE id = :vid AND tenant_id = :t"),
            {"vid": str(resolved_version_id), "t": str(tenant.id)},
        )).fetchone()
        dqs_summary = (dqs_row[0] if dqs_row else {}) or {}
    dqs_by_module = {m: (d or {}).get("composite_score") for m, d in dqs_summary.items()}

    cells = build_readiness_grid(module_results, dqs_by_module, waves, dqs_threshold)
    return {
        "version_id": str(resolved_version_id) if resolved_version_id else None,
        "threshold": dqs_threshold,
        "cells": [c.__dict__ for c in cells],
    }
```
Note: the `tenant_settings` table/column names above (`key = 'alert_thresholds'`) must be verified against how `api/routes/settings.py` actually persists `AlertThresholds` (run `grep -n "alert_thresholds\|UPDATE tenant\|INSERT INTO tenant_settings" api/routes/settings.py` first) — correct the SQL in this step to match exactly what Task 1 found, rather than the table name shown here if it differs.
- [ ] **Step 4:** In `api/main.py`, find where other routers are registered (`grep -n "include_router" api/main.py`) and add `from api.routes import insights as insights_routes` plus `app.include_router(insights_routes.router)` next to a similarly-scoped router (e.g. next to `config_impact`'s registration).
- [ ] **Step 5:** Create `api/routes/tests/test_insights_readiness_route.py`:
```python
import pytest


@pytest.mark.anyio
async def test_readiness_requires_waves_configured(client, tenant_headers):
    r = await client.get("/api/v1/insights/readiness", headers=tenant_headers)
    assert r.status_code == 409


@pytest.mark.anyio
async def test_readiness_is_tenant_isolated(client, tenant_headers, other_tenant_headers):
    await client.patch("/api/v1/settings/alert-thresholds", json={
        "critical_threshold": 5, "high_threshold": 10, "dqs_drop_threshold": 10,
        "module_floors": {}, "readiness_dqs_threshold": 70,
        "readiness_waves": {"Wave 1": ["material_master"]},
    }, headers=tenant_headers)
    r = await client.get("/api/v1/insights/readiness", headers=tenant_headers)
    assert r.status_code == 200
    r2 = await client.get("/api/v1/insights/readiness", headers=other_tenant_headers)
    assert r2.status_code == 409  # other tenant has no waves configured — proves no cross-tenant leak
```
(Adapt fixture names to the real `conftest.py`, per Task 1 Step 3.)
- [ ] **Step 6:** Run `python3 -m pytest -q -p no:cacheprovider api/routes/tests/test_insights_readiness_route.py`. Expected: `2 passed`.
- [ ] **Step 7:** Commit:
```
git add api/routes/insights.py api/main.py api/routes/tests/test_insights_readiness_route.py
git commit -m "Add GET /api/v1/insights/readiness backed by the migration engine and DQS rollup

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NfZiWjz1L8g8HN5DaEsNW6"
```

---

## Task 4: Frontend insights API client + `/insights/readiness` page

**Files:**
- Create: `frontend/lib/api/insights.ts`
- Create: `frontend/app/(app)/insights/readiness/page.tsx`
- Create: `frontend/app/(app)/insights/readiness/page.test.tsx`

**Interfaces:**
```ts
// frontend/lib/api/insights.ts
export interface ReadinessCell {
  module: string; wave: string; verdict: "go" | "at_risk" | "no_go";
  blocker_count: number; dqs: number | null;
}
export interface ReadinessResponse { version_id: string | null; threshold: number; cells: ReadinessCell[]; }
export async function getReadiness(params?: { version_id?: string }): Promise<ReadinessResponse>;
```

- [ ] **Step 1:** Create `frontend/lib/api/insights.ts`:
```ts
import apiClient from "./client";

export interface ReadinessCell {
  module: string;
  wave: string;
  verdict: "go" | "at_risk" | "no_go";
  blocker_count: number;
  dqs: number | null;
}

export interface ReadinessResponse {
  version_id: string | null;
  threshold: number;
  cells: ReadinessCell[];
}

export async function getReadiness(params?: { version_id?: string }): Promise<ReadinessResponse> {
  const { data } = await apiClient.get<ReadinessResponse>("/api/v1/insights/readiness", { params });
  return data;
}
```
- [ ] **Step 2:** Create `frontend/app/(app)/insights/readiness/page.tsx`:
```tsx
"use client";

import { useQuery } from "@tanstack/react-query";
import { getReadiness, type ReadinessCell } from "@/lib/api/insights";
import { DataTable, Badge } from "@/design";
import { DrillLink } from "@/design";
import { RunSelector } from "@/design";
import { useSearchParams } from "next/navigation";

const VERDICT_TONE: Record<ReadinessCell["verdict"], "success" | "warning" | "danger"> = {
  go: "success",
  at_risk: "warning",
  no_go: "danger",
};

export default function ReadinessPage() {
  const params = useSearchParams();
  const versionId = params.get("run") ?? undefined;
  const { data, isLoading } = useQuery({
    queryKey: ["insights", "readiness", versionId],
    queryFn: () => getReadiness({ version_id: versionId }),
  });

  if (isLoading || !data) return null;

  const modules = Array.from(new Set(data.cells.map((c) => c.module)));
  const waves = Array.from(new Set(data.cells.map((c) => c.wave)));

  return (
    <div>
      <RunSelector />
      <table>
        <thead>
          <tr>
            <th>Object</th>
            {waves.map((w) => (
              <th key={w}>{w}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {modules.map((module) => (
            <tr key={module}>
              <td>{module}</td>
              {waves.map((wave) => {
                const cell = data.cells.find((c) => c.module === module && c.wave === wave);
                if (!cell) return <td key={wave}>—</td>;
                return (
                  <td key={wave}>
                    <DrillLink object={module} ruleId={undefined} filters={{ blocking: true }}>
                      <Badge tone={VERDICT_TONE[cell.verdict]}>{cell.verdict}</Badge>
                    </DrillLink>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```
Adjust `Badge`/`DataTable` import names and props to whatever `@/design` actually exports (per Wave 1a) — run `grep -n "^export" frontend/design/index.ts` first and correct names before committing.
- [ ] **Step 3:** Create `frontend/app/(app)/insights/readiness/page.test.tsx`:
```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import ReadinessPage from "./page";
import * as insightsApi from "@/lib/api/insights";

vi.mock("@/lib/api/insights");

describe("ReadinessPage", () => {
  it("renders a verdict badge per module/wave cell", async () => {
    vi.spyOn(insightsApi, "getReadiness").mockResolvedValue({
      version_id: "v1",
      threshold: 70,
      cells: [{ module: "material_master", wave: "Wave 1", verdict: "go", blocker_count: 0, dqs: 92 }],
    });
    render(<ReadinessPage />);
    expect(await screen.findByText("go")).toBeInTheDocument();
  });
});
```
- [ ] **Step 4:** From `frontend/`, run `npm run typecheck && npm run lint && npm run lint:tokens && npm test -- readiness`. Expected: all pass.
- [ ] **Step 5:** Commit:
```
git add frontend/lib/api/insights.ts frontend/app/\(app\)/insights/readiness
git commit -m "Add the insights readiness grid page

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NfZiWjz1L8g8HN5DaEsNW6"
```

---

## Task 5: Value-at-risk computation — `api/services/insights_impact.py`

**Files:**
- Create: `api/services/insights_impact.py`
- Create: `api/services/tests/test_insights_impact.py`

**Interfaces:**
```python
def value_at_risk(blocked_records: int, value_per_record: float) -> float: ...
```

- [ ] **Step 1:** Read `api/routes/config_impact.py` in full (already done during planning — confirm field names with `grep -n "class.*Impact\|feature\|blocked\|record_count" api/routes/config_impact.py`) to get the exact response field name for per-feature blocked record count (do not guess it).
- [ ] **Step 2:** Create `api/services/insights_impact.py`:
```python
"""Deterministic value-at-risk computation for /insights/impact (spec 8.2).

value_at_risk = value_per_record_per_feature (tenant setting, CostModel.features,
default from db/seeds/config_impact_rules.yaml if the tenant has not set one) x
blocked_records for that feature (api/routes/config_impact.py's existing
GET /api/v1/config-impact/{version_id} result rows).
"""


def value_at_risk(blocked_records: int, value_per_record: float) -> float:
    return round(blocked_records * value_per_record, 2)
```
- [ ] **Step 3:** Create `api/services/tests/test_insights_impact.py`:
```python
from api.services.insights_impact import value_at_risk


def test_value_at_risk_multiplies_blocked_records_by_value_per_record():
    assert value_at_risk(10, 150.0) == 1500.0


def test_value_at_risk_rounds_to_two_decimals():
    assert value_at_risk(3, 33.333) == 100.0


def test_value_at_risk_zero_blocked_is_zero():
    assert value_at_risk(0, 999.0) == 0.0
```
- [ ] **Step 4:** Run `python3 -m pytest -q -p no:cacheprovider api/services/tests/test_insights_impact.py`. Expected: `3 passed`.
- [ ] **Step 5:** Commit:
```
git add api/services/insights_impact.py api/services/tests/test_insights_impact.py
git commit -m "Add deterministic value-at-risk computation for the insights impact page

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NfZiWjz1L8g8HN5DaEsNW6"
```

---

## Task 6: `GET /api/v1/insights/impact` route + `/insights/impact` page

**Files:**
- Modify: `api/routes/insights.py`
- Modify: `frontend/lib/api/insights.ts`
- Create: `frontend/app/(app)/insights/impact/page.tsx`
- Create: `api/routes/tests/test_insights_impact_route.py`

**Interfaces:**
```python
GET /api/v1/insights/impact?version_id=<uuid>
-> {"version_id": "...", "rows": [{"feature": "MIGO", "status": "blocked", "record_count": 42,
     "value_per_record": 150.0, "value_at_risk": 6300.0, "causing_rules": ["MM-003", ...]}]}
```

- [ ] **Step 1:** Read the existing `GET /api/v1/config-impact/{version_id}` handler body in `api/routes/config_impact.py` end to end and identify the exact function it calls to load rows (e.g. a query against `config_impact_results`). Import and call that same function from the new route — do not re-query `config_impact_results` with new SQL.
- [ ] **Step 2:** In `api/routes/insights.py`, add:
```python
from api.services.insights_impact import value_at_risk
from api.routes.config_impact import _load_impact_rows  # exact helper name confirmed in Step 1 — correct if different


@router.get("/impact", dependencies=[Depends(require_permission("view"))])
async def get_impact(
    version_id: Optional[uuid.UUID] = None,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    await _rls(db, tenant)
    row = (await db.execute(
        text("SELECT value FROM tenant_settings WHERE tenant_id = :t AND key = 'cost_model'"),
        {"t": str(tenant.id)},
    )).fetchone()
    features_value = ((row[0] if row else {}) or {}).get("features", {})
    impact_rows = await _load_impact_rows(db, tenant, version_id)  # confirm real signature in Step 1
    out = []
    for r in impact_rows:
        v = features_value.get(r["feature"])
        if v is None:
            continue  # no seed default read here on purpose — see Step 3
        out.append({**r, "value_per_record": v, "value_at_risk": value_at_risk(r["record_count"], v)})
    return {"version_id": str(version_id) if version_id else None, "rows": out}
```
Correct the SQL table/column names for `cost_model` storage against what Task 1's `checks/cost.py`/`api/routes/settings.py` reading actually found.
- [ ] **Step 3:** Read `db/seeds/config_impact_rules.yaml` for each rule's default opportunity-cost/value field (`grep -n "cost\|value" db/seeds/config_impact_rules.yaml` — confirm the exact key name) and use it as the fallback when a tenant has not set `features[feature]`, replacing the `if v is None: continue` line in Step 2 with `v = features_value.get(r["feature"], seed_defaults.get(r["feature"], 0.0))`, where `seed_defaults` is loaded once at module import time the same way `agents/config_impact.py` already loads this YAML (`grep -n "yaml.safe_load\|open(" agents/config_impact.py` — reuse that exact loader, do not write a second YAML loader).
- [ ] **Step 4:** Create `api/routes/tests/test_insights_impact_route.py` mirroring Task 3 Step 6's tenant-isolation pattern: one test that a tenant with `cost_model.features` set gets non-zero `value_at_risk`, and one that a second tenant's `cost-model` PUT does not leak into the first tenant's `GET /api/v1/insights/impact` response.
- [ ] **Step 5:** In `frontend/lib/api/insights.ts`, add `ImpactRow`/`ImpactResponse` types and a `getImpact` function mirroring `getReadiness`.
- [ ] **Step 6:** Create `frontend/app/(app)/insights/impact/page.tsx` — a `DataTable` of `rows` (feature, status, record_count, value_at_risk formula shown as a caption `value_at_risk = record_count × value_per_record`), each row's feature name wrapped in `<DrillLink object={row.feature} filters={{ causing_rules: row.causing_rules }}>`.
- [ ] **Step 7:** Run `python3 -m pytest -q -p no:cacheprovider api/routes/tests/test_insights_impact_route.py` and, from `frontend/`, `npm run typecheck && npm run lint && npm run lint:tokens`. Expected: all pass.
- [ ] **Step 8:** Commit:
```
git add api/routes/insights.py frontend/lib/api/insights.ts frontend/app/\(app\)/insights/impact api/routes/tests/test_insights_impact_route.py
git commit -m "Add GET /api/v1/insights/impact and the insights impact page with value-at-risk

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NfZiWjz1L8g8HN5DaEsNW6"
```

---

## Task 7: Owner digest + scorecard computation — `api/services/insights_owners.py`

**Files:**
- Create: `api/services/insights_owners.py`
- Create: `api/services/tests/test_insights_owners.py`

**Interfaces:**
```python
@dataclass
class OwnerCard:
    owner: str
    score: float
    delta: float
    open_by_severity: dict[str, int]
    fixed_since_baseline: int
    oldest_item_age_days: int
    digest: str

def build_owner_card(owner, score, delta, open_by_severity, fixed_since_baseline, oldest_item_age_days) -> OwnerCard: ...
def render_digest(card: OwnerCard) -> str: ...  # exactly three sentences, deterministic
```

- [ ] **Step 1:** Create `api/services/insights_owners.py`:
```python
"""Deterministic owner scorecard + digest for /insights/owners (spec 8.3).

Owner grain = record_issues.assigned_to (db/schema.py's RecordIssue: assigned_to,
severity, status, first_seen_at, resolved_at). OWNER_ISSUE_SQL below is the single
raw-SQL query both the async route (Task 8, via AsyncSession) and the sync weekly
digest task (Task 9, via the sync Session) run before calling load_owner_aggregates —
the aggregation itself is plain Python so it works unchanged from either caller.
"""
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

OWNER_ISSUE_SQL = """
    SELECT ri.assigned_to AS user_id, u.name AS owner, ri.severity, ri.status,
           ri.first_seen_at, ri.resolved_at
    FROM record_issues ri JOIN users u ON u.id = ri.assigned_to
    WHERE ri.tenant_id = :tid AND ri.assigned_to IS NOT NULL
"""

_SEVERITY_WEIGHT = {"critical": 10, "high": 5, "medium": 2, "low": 1}
_BASELINE_WINDOW = timedelta(days=7)  # matches the weekly digest cadence (Task 9)


@dataclass
class OwnerCard:
    owner: str
    score: float
    delta: float
    open_by_severity: dict
    fixed_since_baseline: int
    oldest_item_age_days: int
    digest: str = ""


def render_digest(owner: str, score: float, delta: float, open_by_severity: dict,
                   fixed_since_baseline: int, oldest_item_age_days: int) -> str:
    trend = "improved" if delta > 0 else "declined" if delta < 0 else "held steady"
    total_open = sum(open_by_severity.values())
    worst = max(open_by_severity, key=open_by_severity.get) if open_by_severity else None
    s1 = f"{owner}'s score is {score:.1f}, which has {trend} by {abs(delta):.1f} points since the baseline run."
    s2 = (
        f"{total_open} items are open" + (f", most of them {worst}" if worst else "") + "."
    )
    s3 = f"{fixed_since_baseline} items were fixed since the baseline; the oldest open item is {oldest_item_age_days} days old."
    return f"{s1} {s2} {s3}"


def build_owner_card(owner: str, score: float, delta: float, open_by_severity: dict,
                      fixed_since_baseline: int, oldest_item_age_days: int) -> OwnerCard:
    digest = render_digest(owner, score, delta, open_by_severity, fixed_since_baseline, oldest_item_age_days)
    return OwnerCard(owner, score, delta, open_by_severity, fixed_since_baseline, oldest_item_age_days, digest)


def load_owner_aggregates(rows: list[dict]) -> dict[str, dict]:
    """rows: the result of OWNER_ISSUE_SQL (one row per owned record_issue), already
    fetched by the caller — async (Task 8's route) or sync (Task 9's Celery task).
    Each row needs keys: user_id, owner, severity, status, first_seen_at, resolved_at.

    Returns {owner_name: {"user_id", "score", "delta", "open_by_severity",
    "fixed_since_baseline", "oldest_item_age_days"}} — pass straight into
    build_owner_card(owner, **{k: v for k, v in agg.items() if k != "user_id"}).
    """
    now = datetime.now(timezone.utc)
    cutoff = now - _BASELINE_WINDOW

    by_owner: dict[str, list[dict]] = defaultdict(list)
    for r in rows:
        by_owner[r["owner"]].append(r)

    out: dict[str, dict] = {}
    for owner, issues in by_owner.items():
        open_issues = [i for i in issues if i["status"] not in ("resolved", "accepted")]
        open_by_severity: dict[str, int] = defaultdict(int)
        for i in open_issues:
            open_by_severity[i["severity"]] += 1
        score = max(0.0, 100.0 - sum(_SEVERITY_WEIGHT.get(sev, 1) * n for sev, n in open_by_severity.items()))

        # baseline = state as of `cutoff`: still open, or resolved after the cutoff (i.e. was open then).
        baseline_open = [
            i for i in issues
            if i["status"] not in ("resolved", "accepted") or (i["resolved_at"] and i["resolved_at"] >= cutoff)
        ]
        baseline_score = max(0.0, 100.0 - sum(_SEVERITY_WEIGHT.get(i["severity"], 1) for i in baseline_open))

        fixed_since_baseline = sum(
            1 for i in issues
            if i["status"] in ("resolved", "accepted") and i["resolved_at"] and i["resolved_at"] >= cutoff
        )
        oldest_item_age_days = max((now - i["first_seen_at"]).days for i in open_issues) if open_issues else 0

        out[owner] = {
            "user_id": issues[0]["user_id"],
            "score": round(score, 1),
            "delta": round(score - baseline_score, 1),
            "open_by_severity": dict(open_by_severity),
            "fixed_since_baseline": fixed_since_baseline,
            "oldest_item_age_days": oldest_item_age_days,
        }
    return out
```
- [ ] **Step 2:** Create `api/services/tests/test_insights_owners.py`:
```python
from api.services.insights_owners import build_owner_card, render_digest


def test_digest_is_exactly_three_sentences():
    digest = render_digest("J. Smith", 82.5, 3.2, {"critical": 2, "high": 5}, 11, 40)
    assert digest.count(".") == 3
    assert "J. Smith" in digest and "82.5" in digest


def test_digest_is_deterministic_for_same_inputs():
    a = render_digest("J. Smith", 82.5, 3.2, {"critical": 2}, 11, 40)
    b = render_digest("J. Smith", 82.5, 3.2, {"critical": 2}, 11, 40)
    assert a == b


def test_build_owner_card_embeds_matching_digest():
    card = build_owner_card("A. Jones", 60.0, -1.5, {"high": 1}, 0, 5)
    assert card.digest == render_digest("A. Jones", 60.0, -1.5, {"high": 1}, 0, 5)
    assert "declined" in card.digest
```
- [ ] **Step 3:** Run `python3 -m pytest -q -p no:cacheprovider api/services/tests/test_insights_owners.py`. Expected: `3 passed`.
- [ ] **Step 4:** Commit:
```
git add api/services/insights_owners.py api/services/tests/test_insights_owners.py
git commit -m "Add deterministic owner scorecard and three-sentence digest generator

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NfZiWjz1L8g8HN5DaEsNW6"
```

---

## Task 8: `GET /api/v1/insights/owners` route + `/insights/owners` page

**Files:**
- Modify: `api/routes/insights.py`
- Modify: `frontend/lib/api/insights.ts`
- Create: `frontend/app/(app)/insights/owners/page.tsx`
- Create: `api/routes/tests/test_insights_owners_route.py`

**Interfaces:**
```python
GET /api/v1/insights/owners -> {"owners": [{"owner": "...", "score": 82.5, "delta": 3.2,
  "open_by_severity": {...}, "fixed_since_baseline": 11, "oldest_item_age_days": 40,
  "digest": "...", "schedule": "weekly", "last_sent": "2026-10-01T06:00:00Z" | null}]}
```

- [ ] **Step 1:** `load_owner_aggregates` (Task 7 Step 1) does the grouping/scoring; this route only needs to run `OWNER_ISSUE_SQL` and hand it the rows as dicts.
- [ ] **Step 2:** Add:
```python
from api.services.insights_owners import OWNER_ISSUE_SQL, build_owner_card, load_owner_aggregates


@router.get("/owners", dependencies=[Depends(require_permission("view"))])
async def get_owners(db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant)):
    await _rls(db, tenant)
    result = await db.execute(text(OWNER_ISSUE_SQL), {"tid": str(tenant.id)})
    issue_rows = [dict(r._mapping) for r in result.fetchall()]
    aggregates = load_owner_aggregates(issue_rows)

    rows = []
    for owner, agg in aggregates.items():
        card = build_owner_card(owner, agg["score"], agg["delta"], agg["open_by_severity"],
                                 agg["fixed_since_baseline"], agg["oldest_item_age_days"])
        last_sent = (await db.execute(
            text("SELECT MAX(created_at) FROM notifications WHERE tenant_id = :t AND user_id = :u AND type = 'digest'"),
            {"t": str(tenant.id), "u": agg["user_id"]},
        )).scalar()
        rows.append({**card.__dict__, "schedule": "weekly", "last_sent": last_sent.isoformat() if last_sent else None})
    return {"owners": rows}
```
- [ ] **Step 3:** Create `api/routes/tests/test_insights_owners_route.py` with a tenant-isolation test: seed a `record_issues` row + a `notifications` row (`type='digest'`) for tenant A, assert tenant B's `GET /api/v1/insights/owners` does not see tenant A's owner or `last_sent`.
- [ ] **Step 4:** Add `OwnerCardResponse`/`getOwners` to `frontend/lib/api/insights.ts`.
- [ ] **Step 5:** Create `frontend/app/(app)/insights/owners/page.tsx` — one card per owner (score, delta, `open_by_severity` as a small `Badge` row, `fixed_since_baseline`, `oldest_item_age_days`, the `digest` string, and `schedule`/`last_sent`).
- [ ] **Step 6:** Run `python3 -m pytest -q -p no:cacheprovider api/routes/tests/test_insights_owners_route.py` and `npm run typecheck && npm run lint && npm run lint:tokens` from `frontend/`. Expected: all pass.
- [ ] **Step 7:** Commit:
```
git add api/routes/insights.py frontend/lib/api/insights.ts frontend/app/\(app\)/insights/owners api/routes/tests/test_insights_owners_route.py
git commit -m "Add GET /api/v1/insights/owners and the insights owners page

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NfZiWjz1L8g8HN5DaEsNW6"
```

---

## Task 9: Weekly owner-digest email task

**Files:**
- Create: `workers/tasks/send_owner_digests.py`
- Modify: `workers/scheduler.py`
- Create: `workers/tasks/tests/test_send_owner_digests.py`

**Interfaces:**
```python
@celery_app.task(soft_time_limit=..., time_limit=...)
def send_owner_digests(): ...  # one Notification(type='digest') row per owner, per tenant
```

- [ ] **Step 1:** Read `workers/tasks/send_notifications.py`'s existing `scheduled_weekly` branch in full (the mapping at line ~192-193) to copy its exact tenant-iteration and `Notification` row-insert pattern.
- [ ] **Step 2:** Create `workers/tasks/send_owner_digests.py`. `load_owner_aggregates` and `OWNER_ISSUE_SQL` already exist in `api/services/insights_owners.py` (Task 7 Step 1) — this task only runs that query per tenant on a sync `Session` and inserts the `Notification` rows:
```python
"""Weekly per-owner digest email, spec 8.3. Reuses the existing Notification
table's type='digest' convention (db/schema.py) for both delivery and the
"last sent" timestamp read back by GET /api/v1/insights/owners."""
import uuid

from sqlalchemy import text
from sqlalchemy.orm import Session

from workers.celery_app import celery_app
from workers.db import get_sync_engine
from api.services.insights_owners import OWNER_ISSUE_SQL, build_owner_card, load_owner_aggregates

logger = __import__("logging").getLogger("meridian.workers.owner_digests")


@celery_app.task(soft_time_limit=300, time_limit=360)
def send_owner_digests():
    engine = get_sync_engine()
    with Session(engine) as session:
        tenant_ids = [r[0] for r in session.execute(text("SELECT id FROM tenants")).fetchall()]
        for tenant_id in tenant_ids:
            session.execute(text("SET app.tenant_id = :t"), {"t": str(tenant_id)})
            rows = session.execute(OWNER_ISSUE_SQL, {"t": str(tenant_id)}).fetchall()
            issue_rows = [dict(r._mapping) for r in rows]
            aggregates = load_owner_aggregates(issue_rows)
            for owner, agg in aggregates.items():
                card = build_owner_card(owner, agg["score"], agg["delta"], agg["open_by_severity"],
                                         agg["fixed_since_baseline"], agg["oldest_item_age_days"])
                session.execute(
                    text("""
                        INSERT INTO notifications (id, tenant_id, user_id, type, title, body, link, is_read, created_at)
                        VALUES (:id, :tid, :uid, 'digest', :title, :body, :link, false, now())
                    """),
                    {"id": str(uuid.uuid4()), "tid": str(tenant_id), "uid": agg["user_id"],
                     "title": "Your weekly data quality digest", "body": card.digest, "link": "/insights/owners"},
                )
            session.commit()
        logger.info(f"owner digests sent for {len(tenant_ids)} tenants")
```
- [ ] **Step 3:** In `workers/scheduler.py`, find the `celery_app.conf.beat_schedule` dict (line ~941) and the existing `weekly_cleaning`/`weekly_cleaning_batch` entry's exact `crontab(...)` arguments. Add:
```python
"weekly_owner_digest": {
    "task": "workers.tasks.send_owner_digests.send_owner_digests",
    "schedule": crontab(hour=3, minute=30, day_of_week=1),  # Mon 03:30 UTC = 05:30 SAST, after weekly_cleaning
},
```
matching the exact `crontab` import already present at the top of this file.
- [ ] **Step 4:** Create `workers/tasks/tests/test_send_owner_digests.py` — a unit test (using the shared `load_owner_aggregates`/`build_owner_card` functions directly, not the Celery task wrapper) asserting that for a seeded set of open `record_issues` rows, the resulting digest text matches `render_digest`'s output exactly (determinism check, no DB needed beyond a fixture).
- [ ] **Step 5:** Run `python3 -m pytest -q -p no:cacheprovider workers/tasks/tests/test_send_owner_digests.py`. Expected: pass.
- [ ] **Step 6:** Commit:
```
git add workers/tasks/send_owner_digests.py workers/scheduler.py api/services/insights_owners.py workers/tasks/tests/test_send_owner_digests.py
git commit -m "Add weekly per-owner digest email task and beat schedule entry

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NfZiWjz1L8g8HN5DaEsNW6"
```

---

## Task 10: Force-directed graph primitive — `frontend/design/charts/Graph.tsx`

**Files:**
- Create: `frontend/design/charts/Graph.tsx`
- Create: `frontend/design/charts/Graph.test.ts`

**Interfaces:**
```ts
export interface GraphNode { id: string; size: number; label?: string; }
export interface GraphEdge { source: string; target: string; label?: string; weight?: number; }
export function layoutGraph(nodes: GraphNode[], edges: GraphEdge[], opts?: { width?: number; height?: number; iterations?: number }): { id: string; x: number; y: number }[];
export function Graph(props: { nodes: GraphNode[]; edges: GraphEdge[]; onNodeClick?(id: string): void }): JSX.Element;
```

- [ ] **Step 1:** Create `frontend/design/charts/Graph.tsx`:
```tsx
"use client";

import { useMemo } from "react";

export interface GraphNode {
  id: string;
  size: number;
  label?: string;
}

export interface GraphEdge {
  source: string;
  target: string;
  label?: string;
  weight?: number;
}

interface Point {
  id: string;
  x: number;
  y: number;
}

/**
 * Fruchterman-Reingold force-directed layout: nodes repel each other
 * (inverse-square), connected nodes attract (spring toward an ideal edge
 * length), positions are clamped to [0, width] x [0, height]. Deterministic:
 * node order fixes the initial circular placement, so the same input always
 * produces the same output (needed for the vitest determinism check below
 * and so screenshots in Playwright don't flake).
 */
export function layoutGraph(
  nodes: GraphNode[],
  edges: GraphEdge[],
  opts?: { width?: number; height?: number; iterations?: number },
): Point[] {
  const width = opts?.width ?? 600;
  const height = opts?.height ?? 400;
  const iterations = opts?.iterations ?? 200;
  const k = Math.sqrt((width * height) / Math.max(nodes.length, 1));

  const pos = new Map<string, { x: number; y: number }>();
  nodes.forEach((n, i) => {
    const angle = (2 * Math.PI * i) / Math.max(nodes.length, 1);
    pos.set(n.id, {
      x: width / 2 + (width / 3) * Math.cos(angle),
      y: height / 2 + (height / 3) * Math.sin(angle),
    });
  });

  for (let iter = 0; iter < iterations; iter++) {
    const disp = new Map<string, { x: number; y: number }>(nodes.map((n) => [n.id, { x: 0, y: 0 }]));

    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i].id;
        const b = nodes[j].id;
        const pa = pos.get(a)!;
        const pb = pos.get(b)!;
        let dx = pa.x - pb.x;
        let dy = pa.y - pb.y;
        let dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
        const force = (k * k) / dist;
        dx = (dx / dist) * force;
        dy = (dy / dist) * force;
        disp.get(a)!.x += dx;
        disp.get(a)!.y += dy;
        disp.get(b)!.x -= dx;
        disp.get(b)!.y -= dy;
      }
    }

    for (const e of edges) {
      const pa = pos.get(e.source);
      const pb = pos.get(e.target);
      if (!pa || !pb) continue;
      let dx = pa.x - pb.x;
      let dy = pa.y - pb.y;
      let dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
      const force = (dist * dist) / k;
      dx = (dx / dist) * force;
      dy = (dy / dist) * force;
      disp.get(e.source)!.x -= dx;
      disp.get(e.source)!.y -= dy;
      disp.get(e.target)!.x += dx;
      disp.get(e.target)!.y += dy;
    }

    const temp = width * (1 - iter / iterations) * 0.1;
    for (const n of nodes) {
      const d = disp.get(n.id)!;
      const dist = Math.sqrt(d.x * d.x + d.y * d.y) || 0.01;
      const p = pos.get(n.id)!;
      p.x = Math.min(width, Math.max(0, p.x + (d.x / dist) * Math.min(dist, temp)));
      p.y = Math.min(height, Math.max(0, p.y + (d.y / dist) * Math.min(dist, temp)));
    }
  }

  return nodes.map((n) => ({ id: n.id, x: pos.get(n.id)!.x, y: pos.get(n.id)!.y }));
}

export function Graph(props: {
  nodes: GraphNode[];
  edges: GraphEdge[];
  onNodeClick?: (id: string) => void;
  width?: number;
  height?: number;
}) {
  const { nodes, edges, onNodeClick, width = 600, height = 400 } = props;
  const points = useMemo(() => layoutGraph(nodes, edges, { width, height }), [nodes, edges, width, height]);
  const byId = useMemo(() => new Map(points.map((p) => [p.id, p])), [points]);
  const sizeById = useMemo(() => new Map(nodes.map((n) => [n.id, n.size])), [nodes]);

  return (
    <svg width={width} height={height} role="img" aria-label="Duplicate cluster graph">
      {edges.map((e, i) => {
        const a = byId.get(e.source);
        const b = byId.get(e.target);
        if (!a || !b) return null;
        return (
          <g key={`${e.source}-${e.target}-${i}`}>
            <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--aurora-border)" />
            {e.label && (
              <text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2} fontSize={10}>
                {e.label}
              </text>
            )}
          </g>
        );
      })}
      {points.map((p) => (
        <g key={p.id} onClick={() => onNodeClick?.(p.id)} style={{ cursor: onNodeClick ? "pointer" : "default" }}>
          <circle cx={p.x} cy={p.y} r={4 + Math.sqrt(sizeById.get(p.id) ?? 1)} fill="var(--aurora-accent-500)" />
          <text x={p.x} y={p.y - 8} fontSize={10} textAnchor="middle">
            {p.id}
          </text>
        </g>
      ))}
    </svg>
  );
}
```
- [ ] **Step 2:** Create `frontend/design/charts/Graph.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { layoutGraph } from "./Graph";

describe("layoutGraph", () => {
  it("is deterministic for the same input", () => {
    const nodes = [{ id: "a", size: 1 }, { id: "b", size: 2 }, { id: "c", size: 1 }];
    const edges = [{ source: "a", target: "b" }];
    const p1 = layoutGraph(nodes, edges, { iterations: 50 });
    const p2 = layoutGraph(nodes, edges, { iterations: 50 });
    expect(p1).toEqual(p2);
  });

  it("keeps all points within bounds", () => {
    const nodes = [{ id: "a", size: 1 }, { id: "b", size: 1 }];
    const edges: { source: string; target: string }[] = [];
    const points = layoutGraph(nodes, edges, { width: 100, height: 80, iterations: 50 });
    for (const p of points) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(100);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(80);
    }
  });

  it("returns one point per node", () => {
    const nodes = [{ id: "a", size: 1 }, { id: "b", size: 1 }, { id: "c", size: 1 }];
    const points = layoutGraph(nodes, [], { iterations: 10 });
    expect(points.map((p) => p.id).sort()).toEqual(["a", "b", "c"]);
  });
});
```
- [ ] **Step 3:** From `frontend/`, run `npm run typecheck && npm run lint && npm run lint:tokens && npm test -- Graph`. Expected: all pass.
- [ ] **Step 4:** Commit:
```
git add frontend/design/charts/Graph.tsx frontend/design/charts/Graph.test.ts
git commit -m "Add a hand-built Fruchterman-Reingold force-directed graph primitive

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NfZiWjz1L8g8HN5DaEsNW6"
```

---

## Task 11: `GET /api/v1/insights/duplicates/{object}` route

**Files:**
- Modify: `api/routes/insights.py`
- Create: `api/routes/tests/test_insights_duplicates_route.py`

**Interfaces:**
```python
GET /api/v1/insights/duplicates/{object}?key=<matnr>
-> {"nodes": [{"id": "...", "size": 3, "label": "..."}],
    "edges": [{"source": "...", "target": "...", "label": "0.92"}],
    "thresholds": {"auto_merge": 0.95, "review_floor": 0.80}}
```

- [ ] **Step 1:** Read `api/routes/merge_explain.py`'s `get_cluster_graph` handler and the `cluster_graph(keys, pairs, constraints, AUTO_MERGE)` function it calls, end to end, to get the exact node/edge field names `cluster_graph` already returns.
- [ ] **Step 2:** In `api/routes/insights.py`, add a thin wrapper:
```python
from api.routes.merge_explain import get_cluster_graph as _merge_explain_cluster_graph


@router.get("/duplicates/{object}/{record_id}", dependencies=[Depends(require_permission("view"))])
async def get_duplicate_cluster(
    object: str, record_id: str,
    db: AsyncSession = Depends(get_db), tenant: Tenant = Depends(get_tenant),
):
    # Reuses merge_explain.py's existing cluster_graph builder verbatim — this endpoint
    # only adds node sizing from BOM usage (see Task 10/known-gap note at top of this plan).
    base = await _merge_explain_cluster_graph(record_id, db=db, tenant=tenant)  # confirm exact call signature in Step 1
    # Node size = BOM usage count from api/services/material_360.py's STPO/MAST tables,
    # when object == "material_master"; 1 otherwise, pending a real reference-count source
    # for other objects (left as 1 deliberately, not invented).
    return base
```
Correct the import path, function signature, and response reshaping against what Step 1 actually found — `get_cluster_graph` may already take `(db, tenant, record_id)` as a FastAPI dependency-injected handler rather than a plain importable function; if so, extract its body into a shared helper `build_cluster_graph(db, tenant, record_id)` in `merge_explain.py` and call that from both routes, rather than calling one FastAPI route handler from another.
- [ ] **Step 3:** Create `api/routes/tests/test_insights_duplicates_route.py` — one tenant-isolation test: seed `match_scores` rows for tenant A's master record, assert tenant B gets 404/empty for the same `record_id`.
- [ ] **Step 4:** Run `python3 -m pytest -q -p no:cacheprovider api/routes/tests/test_insights_duplicates_route.py`. Expected: pass.
- [ ] **Step 5:** Commit:
```
git add api/routes/insights.py api/routes/merge_explain.py api/routes/tests/test_insights_duplicates_route.py
git commit -m "Add GET /api/v1/insights/duplicates/{object}/{record_id} reusing merge_explain's cluster_graph

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NfZiWjz1L8g8HN5DaEsNW6"
```

---

## Task 12: Merge-proposal-batch creation endpoint

**Files:**
- Modify: `api/routes/insights.py`
- Create: `api/routes/tests/test_insights_merge_proposals.py`

**Interfaces:**
```python
POST /api/v1/insights/duplicates/merge-proposals
body: {"pairs": [{"match_score_id": "<uuid>", "priority": 3, "due_at": null}]}
-> {"created": ["<stewardship_queue.id>", ...]}
```

- [ ] **Step 1:** Read `db/schema.py`'s `StewardshipQueueItem` columns again (`id, tenant_id, item_type, source_id, domain, priority, due_at, assigned_to, status, sla_hours, created_at, updated_at, ai_recommendation, ai_confidence`) and `api/routes/stewardship.py`'s existing automated-population code (wherever it inserts `item_type='merge_decision'` rows today — `grep -n "merge_decision" api/routes/stewardship.py` and the populate job referenced there) to copy the exact default values used for `domain`, `sla_hours`, `ai_recommendation`, `ai_confidence` on a `merge_decision` row.
- [ ] **Step 2:** In `api/routes/insights.py`, add:
```python
import uuid as _uuid
from pydantic import BaseModel


class MergeProposalPair(BaseModel):
    match_score_id: _uuid.UUID
    priority: int = 3
    due_at: Optional[str] = None


class MergeProposalsBody(BaseModel):
    pairs: list[MergeProposalPair]


@router.post("/duplicates/merge-proposals", dependencies=[Depends(require_permission("edit"))])
async def create_merge_proposals(
    body: MergeProposalsBody,
    db: AsyncSession = Depends(get_db),
    tenant: Tenant = Depends(get_tenant),
):
    await _rls(db, tenant)
    created = []
    for pair in body.pairs:
        row = (await db.execute(
            text("SELECT domain FROM match_scores WHERE id = :id AND tenant_id = :t"),
            {"id": str(pair.match_score_id), "t": str(tenant.id)},
        )).fetchone()
        if not row:
            raise HTTPException(404, f"match_scores {pair.match_score_id} not found")
        new_id = _uuid.uuid4()
        await db.execute(text("""
            INSERT INTO stewardship_queue
              (id, tenant_id, item_type, source_id, domain, priority, due_at, status, sla_hours)
            VALUES (:id, :t, 'merge_decision', :source_id, :domain, :priority, :due_at, 'open', :sla_hours)
        """), {
            "id": str(new_id), "t": str(tenant.id), "source_id": str(pair.match_score_id),
            "domain": row[0], "priority": pair.priority, "due_at": pair.due_at,
            "sla_hours": 72,  # confirmed default from Step 1 — correct if the real default differs
        })
        created.append(str(new_id))
    await db.commit()
    return {"created": created}
```
Correct `sla_hours`'s default and any other default column values against what Step 1 actually found in the existing automated-population code.
- [ ] **Step 3:** Create `api/routes/tests/test_insights_merge_proposals.py`:
```python
import pytest


@pytest.mark.anyio
async def test_create_merge_proposal_inserts_stewardship_queue_row(client, tenant_headers, seeded_match_score_id):
    r = await client.post("/api/v1/insights/duplicates/merge-proposals", json={
        "pairs": [{"match_score_id": seeded_match_score_id}]
    }, headers=tenant_headers)
    assert r.status_code == 200
    assert len(r.json()["created"]) == 1


@pytest.mark.anyio
async def test_merge_proposal_rejects_other_tenants_match_score(client, other_tenant_headers, seeded_match_score_id):
    r = await client.post("/api/v1/insights/duplicates/merge-proposals", json={
        "pairs": [{"match_score_id": seeded_match_score_id}]
    }, headers=other_tenant_headers)
    assert r.status_code == 404
```
Replace `seeded_match_score_id` with however this test package already seeds a `match_scores` row for tests (check `grep -rn "match_scores" api/routes/tests/conftest.py api/routes/tests/test_stewardship*.py` for an existing fixture to reuse).
- [ ] **Step 4:** Run `python3 -m pytest -q -p no:cacheprovider api/routes/tests/test_insights_merge_proposals.py`. Expected: pass.
- [ ] **Step 5:** Commit:
```
git add api/routes/insights.py api/routes/tests/test_insights_merge_proposals.py
git commit -m "Add merge-proposal-batch creation endpoint for the duplicates page

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NfZiWjz1L8g8HN5DaEsNW6"
```

---

## Task 13: `/insights/duplicates` page

**Files:**
- Modify: `frontend/lib/api/insights.ts`
- Create: `frontend/app/(app)/insights/duplicates/page.tsx`
- Create: `frontend/app/(app)/insights/duplicates/page.test.tsx`

**Interfaces:**
```ts
export async function getDuplicateCluster(object: string, recordId: string): Promise<{ nodes: GraphNode[]; edges: GraphEdge[]; thresholds: { auto_merge: number; review_floor: number } }>;
export async function createMergeProposals(pairs: { match_score_id: string; priority?: number }[]): Promise<{ created: string[] }>;
```

- [ ] **Step 1:** Add `getDuplicateCluster` and `createMergeProposals` to `frontend/lib/api/insights.ts`, wrapping `GET /api/v1/insights/duplicates/{object}/{record_id}` and `POST /api/v1/insights/duplicates/merge-proposals` from Tasks 11-12.
- [ ] **Step 2:** Create `frontend/app/(app)/insights/duplicates/page.tsx` — an object/record picker (reuse `/objects/[object]` route's object list via `GET /api/v1/objects`), a `Graph` (from Task 10) rendering `nodes`/`edges`, and a cluster panel: per-field pick-from-master radio group, a "merge impact" count (documents that would move — read from whichever field `merge_explain.py`'s `explain_record` already returns for this, per the research summary's `ExplainResponse`), and a "Create merge proposal" button calling `createMergeProposals` with the selected pair's `match_score_id`, followed by a toast/link to the existing stewardship bulk-approve UI (do not build a new approval UI here — the batch is executed through the existing `POST /api/v1/stewardship/bulk-approve`, out of this page's scope per the plan's architecture).
- [ ] **Step 3:** Create `frontend/app/(app)/insights/duplicates/page.test.tsx` mocking `getDuplicateCluster`/`createMergeProposals`, asserting the graph renders and the button calls `createMergeProposals` with the selected `match_score_id`.
- [ ] **Step 4:** From `frontend/`, run `npm run typecheck && npm run lint && npm run lint:tokens && npm test -- duplicates`. Expected: all pass.
- [ ] **Step 5:** Commit:
```
git add frontend/lib/api/insights.ts frontend/app/\(app\)/insights/duplicates
git commit -m "Add the insights duplicates page with force-directed cluster graph

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NfZiWjz1L8g8HN5DaEsNW6"
```

---

## Task 14: Executive report — `pdf_reports.py` `kind="executive"` wiring

**Files:**
- Modify: `api/services/pdf_reports.py`
- Create: `api/services/templates/executive_report.html` (confirm the real templates directory first)
- Create: `api/services/tests/test_pdf_reports_executive.py`

- [ ] **Step 1:** Read `api/services/pdf_reports.py`'s `load_analysis` and `load_comparison` functions in full (`grep -n "def load_analysis\|def load_comparison" api/services/pdf_reports.py`) to get their exact signatures and what they fetch, plus confirm the real template directory path used by `render(template, ctx)` (`grep -n "def render\|templates_dir\|Environment(" api/services/pdf_reports.py`).
- [ ] **Step 2:** Write `load_executive(s, tid, vid)` in `api/services/pdf_reports.py`, modeled exactly on `load_analysis`'s shape (same session/tenant/version_id parameter pattern), fetching: the version's readiness cells (call `api.services.insights_readiness.build_readiness_grid` with the same inputs Task 3 assembled), the run-diff waterfall data (reuse whatever `/runs/[a]/vs/[b]`'s backing endpoint already returns — find it via `grep -rn "vs\b" api/routes/*.py` — do not recompute a diff here), the impact rows (reuse `api/routes/config_impact.py`'s loader from Task 6), the owner rows (reuse `insights_owners.py`'s aggregation from Task 8/9), and `executive_context(...)` (already implemented per the research — confirm its exact parameter names with `grep -n "def executive_context" api/services/pdf_reports.py` and pass through, do not reimplement it).
- [ ] **Step 3:** In `build()`'s dispatcher (the exact body captured during research, ending `raise ValueError(kind)`), add an `elif kind == "executive": ctx = executive_context(**load_executive(s, tid, vid)); return render("executive_report.html", ctx)` branch, following the exact structure of the existing `analysis`/`comparison` branches immediately above it.
- [ ] **Step 4:** Create `api/services/templates/executive_report.html` (correct the directory if Step 1 found a different real path) reusing the existing report template's base layout/includes (`grep -n "{% extends\|{% include" api/services/templates/*.html` to find the shared base template) with sections for: the readiness grid, the run-diff waterfall, the impact table, the owner table, and the narrative — each rendered from `ctx` fields that `executive_context` already provides (per the research summary, its signature is `executive_context(report_json, supplementary, version, findings, *, tenant_name, system=None, generated_at=None)` — map the new readiness/impact/owner data into whichever of these existing parameters fits without changing `executive_context`'s signature, since Task 14 commits to NOT touching that function; if nothing fits, state this explicitly as a follow-up rather than changing an already-stable, working builder mid-task).
- [ ] **Step 5:** Create `api/services/tests/test_pdf_reports_executive.py` — calls `build(s, tid, "executive", vid=<seeded version>)` and asserts it returns non-empty `bytes` (mirroring however the existing `analysis`/`comparison` kinds are already tested — `grep -rn "kind=\"analysis\"\|kind='analysis'" api/services/tests/*.py` to copy that test's exact fixture setup).
- [ ] **Step 6:** Run `python3 -m pytest -q -p no:cacheprovider api/services/tests/test_pdf_reports_executive.py`. Expected: pass.
- [ ] **Step 7:** Commit:
```
git add api/services/pdf_reports.py api/services/templates/executive_report.html api/services/tests/test_pdf_reports_executive.py
git commit -m "Add kind=executive to the PDF report builder for the rebuilt executive report

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NfZiWjz1L8g8HN5DaEsNW6"
```

---

## Task 15: `GET /api/v1/insights/exec` route + PDF export route

**Files:**
- Modify: `api/routes/insights.py`
- Modify: `api/routes/reports.py`
- Create: `api/routes/tests/test_insights_exec_route.py`

- [ ] **Step 1:** Read `api/routes/reports.py`'s existing PDF-serving route for one of `analysis`/`comparison` (`grep -n "async def.*report\|StreamingResponse\|Response(" api/routes/reports.py`) to copy its exact response-building pattern (content type, filename header, `build(...)` call).
- [ ] **Step 2:** In `api/routes/insights.py`, add `GET /exec` returning the same JSON shape the frontend `/insights/exec` page needs for its on-screen `ReportPage` rendering (readiness cells, waterfall, impact rows, owner rows, narrative) by calling the same `load_executive`-adjacent aggregation functions from Task 14 Step 2 directly (not through the PDF builder) — extract the data-gathering part of `load_executive` into a plain function `gather_executive_data(s, tid, vid)` reusable by both the JSON route and `load_executive`, to avoid duplicating the five data-fetch calls.
- [ ] **Step 3:** In `api/routes/reports.py`, add a new route (following the exact pattern from Step 1) `GET /api/v1/reports/executive/{version_id}.pdf` calling `pdf_reports.build(s, tid, "executive", vid=version_id)`.
- [ ] **Step 4:** Create `api/routes/tests/test_insights_exec_route.py` with a tenant-isolation test on `GET /api/v1/insights/exec`.
- [ ] **Step 5:** Run `python3 -m pytest -q -p no:cacheprovider api/routes/tests/test_insights_exec_route.py`. Expected: pass.
- [ ] **Step 6:** Commit:
```
git add api/routes/insights.py api/routes/reports.py api/services/pdf_reports.py api/routes/tests/test_insights_exec_route.py
git commit -m "Add GET /api/v1/insights/exec and the executive report PDF export route

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NfZiWjz1L8g8HN5DaEsNW6"
```

---

## Task 16: `/insights/exec` page on `ReportPage`

**Files:**
- Modify: `frontend/lib/api/insights.ts`
- Create: `frontend/app/(app)/insights/exec/page.tsx`
- Create: `frontend/app/(app)/insights/exec/page.test.tsx`

- [ ] **Step 1:** Add `getExec` to `frontend/lib/api/insights.ts` wrapping `GET /api/v1/insights/exec`.
- [ ] **Step 2:** Create `frontend/app/(app)/insights/exec/page.tsx`:
```tsx
"use client";

import { useQuery } from "@tanstack/react-query";
import { getExec } from "@/lib/api/insights";
import { ReportPage, Waterfall, DataTable } from "@/design";

export default function ExecPage() {
  const { data, isLoading } = useQuery({ queryKey: ["insights", "exec"], queryFn: getExec });
  if (isLoading || !data) return null;

  return (
    <ReportPage
      narrative={data.narrative}
      exportAction={{ label: "Export PDF", href: `/api/v1/reports/executive/${data.version_id}.pdf` }}
    >
      <DataTable rows={data.readiness_cells} />
      <Waterfall data={data.waterfall} onPointClick={() => {}} />
      <DataTable rows={data.impact_rows} />
      <DataTable rows={data.owner_rows} />
    </ReportPage>
  );
}
```
Correct `ReportPage`/`Waterfall`/`DataTable` prop names against `@/design`'s real exports (per Wave 1a) before committing.
- [ ] **Step 3:** Create `frontend/app/(app)/insights/exec/page.test.tsx` mocking `getExec`, asserting the narrative text renders and the export link's `href` points at the PDF route.
- [ ] **Step 4:** From `frontend/`, run `npm run typecheck && npm run lint && npm run lint:tokens && npm test -- exec`. Expected: all pass.
- [ ] **Step 5:** Commit:
```
git add frontend/lib/api/insights.ts frontend/app/\(app\)/insights/exec
git commit -m "Add the insights executive report page on the shared ReportPage template

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NfZiWjz1L8g8HN5DaEsNW6"
```

---

## Task 17: `/insights` index page

**Files:**
- Create: `frontend/app/(app)/insights/page.tsx`
- Create: `frontend/app/(app)/insights/page.test.tsx`

- [ ] **Step 1:** Create `frontend/app/(app)/insights/page.tsx` — a simple `@/design` card grid linking to `/insights/readiness`, `/insights/impact`, `/insights/owners`, `/insights/duplicates`, `/insights/exec`, each card showing one headline metric already available from the respective `GET /api/v1/insights/*` endpoint's summary fields (e.g. readiness: count of `no_go` cells; impact: total `value_at_risk`; owners: count of owners below score threshold; exec: `last_sent`).
- [ ] **Step 2:** Create `frontend/app/(app)/insights/page.test.tsx` asserting all five links render.
- [ ] **Step 3:** From `frontend/`, run `npm run typecheck && npm run lint && npm run lint:tokens && npm test -- insights/page`. Expected: all pass.
- [ ] **Step 4:** Commit:
```
git add frontend/app/\(app\)/insights/page.tsx frontend/app/\(app\)/insights/page.test.tsx
git commit -m "Add the insights index page linking to the five insight views

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NfZiWjz1L8g8HN5DaEsNW6"
```

---

## Task 18: Retire legacy `/executive-report`

**Files:**
- Modify: `frontend/next.config.ts`
- Delete: the legacy executive-report route file(s) and `frontend/components/command-centre/executive-report.tsx`

- [ ] **Step 1:** Find the legacy route's exact path: `find frontend/app -path "*executive-report*"`. Confirm it is a page under `frontend/app/(dashboard)/.../executive-report` (or wherever it actually is) and that `frontend/components/command-centre/executive-report.tsx` is the component it renders (per the research summary).
- [ ] **Step 2:** In `frontend/next.config.ts`, find the existing `redirects()` function (or add one if none exists — check `grep -n "redirects" frontend/next.config.ts` first) and add:
```ts
{
  source: "/executive-report",
  destination: "/insights/exec",
  permanent: true,
},
```
alongside any existing redirect entries, matching their exact object shape.
- [ ] **Step 3:** Delete the legacy page file(s) found in Step 1 and `frontend/components/command-centre/executive-report.tsx`, and remove any now-dangling imports of that component (`grep -rn "command-centre/executive-report" frontend/` to find and fix every import site).
- [ ] **Step 4:** From `frontend/`, run `npm run typecheck && npm run lint && npm run lint:tokens && npm test`. Expected: all pass, confirming nothing still imports the deleted component.
- [ ] **Step 5:** Commit:
```
git add frontend/next.config.ts
git rm frontend/components/command-centre/executive-report.tsx
git commit -m "Retire the legacy executive-report route in favour of /insights/exec

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NfZiWjz1L8g8HN5DaEsNW6"
```

---

## Task 19: Playwright journey — readiness cell to failing rows

**Files:**
- Create: `frontend/e2e/insights-readiness-drill.spec.ts`

- [ ] **Step 1:** Read an existing Playwright spec in this repo (`find frontend/e2e -name "*.spec.ts" | head -1` then read it) to copy its exact fixture/setup pattern (auth, base URL, seeded test data).
- [ ] **Step 2:** Create `frontend/e2e/insights-readiness-drill.spec.ts`:
```ts
import { test, expect } from "@playwright/test";

test("clicking a no-go readiness cell drills into the failing rows", async ({ page }) => {
  await page.goto("/insights/readiness");
  const cell = page.getByText("no_go").first();
  await expect(cell).toBeVisible();
  await cell.click();
  await expect(page).toHaveURL(/\/objects\//);
  await expect(page.getByRole("table")).toBeVisible();
});
```
Adapt the auth/setup boilerplate from Step 1's reference spec (login, seeded tenant with a `no_go` cell present) — do not leave it running against an empty/unauthenticated page.
- [ ] **Step 3:** Run this spec with whatever command the existing Playwright specs use (`grep -n "\"test:e2e\"\|playwright test" frontend/package.json` to find it), e.g. `npx playwright test e2e/insights-readiness-drill.spec.ts`. Expected: `1 passed`.
- [ ] **Step 4:** Commit:
```
git add frontend/e2e/insights-readiness-drill.spec.ts
git commit -m "Add a Playwright journey test for the readiness-cell-to-failing-rows drill

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NfZiWjz1L8g8HN5DaEsNW6"
```

---

## Self-Review

Performed against this plan before handoff:

- **Spec coverage:** 8.1 (readiness grid, drill, side panel, PDF export) → Tasks 2-4, 14-16 (PDF export is executive report's export action, reused for the readiness grid's own export per 8.1 — if a dedicated readiness-only PDF is required rather than only the executive report's grid section, that is a gap, called out below). 8.2 (impact table, value-at-risk, drill) → Tasks 5-6. 8.3 (owner cards, digest, weekly schedule) → Tasks 7-9. 8.4 (graph, cluster panel, merge-impact, merge-proposal batch) → Tasks 10-13. 8.5 (exec report rebuild, PDF, schedule) → Tasks 14-16. Legacy retirement → Task 18. Tests (readiness computation, value-at-risk, digest, Playwright journey, tenant-isolation pytest per endpoint) → Tasks 2, 5, 7, 19, and one isolation test embedded in each route task (3, 6, 8, 11, 12, 15).
- **Placeholder scan:** every task's code steps contain runnable code, not TBD/TODO prose. There are no exceptions to the no-placeholders rule.
- **Type consistency:** `ReadinessCell`, `ImpactRow`, `OwnerCard` field names are used identically between their Python dataclass/service, FastAPI response, and TypeScript interface in every task that touches them.
- **Gaps not mapped to a task, stated explicitly (not silently dropped):**
  1. Spec 8.1's dedicated "PDF export (grid + blockers list)" for the readiness page specifically — this plan reuses the Task 14 executive-report PDF's readiness section. If product requires a *standalone* readiness PDF (not the full executive report), that is one additional task: a `kind="readiness"` branch in `pdf_reports.py` mirroring Task 14's pattern, deliberately left out here to keep this plan at 19 tasks and because the spec's own wording ("PDF export") did not specify it must be separate from the exec report.
  2. Spec 8.4's node-size metric "open POs/SOs/BOMs" — only BOM usage is wired into the material extract today; open PO/SO counts require adding `EKPO`/`VBAP` to `api/services/material_360.py`'s extract tables and a cross-module join, explicitly deferred (see "Known gap" section at top of this plan).
  3. Spec 8.1's wave grouping is new tenant configuration (Task 1), not a pre-existing concept — flagged per the plan's own instruction not to invent schema silently.
  4. A weekly *exec-report* email schedule (distinct from the weekly owner digest in Task 9) is implied by spec 8.5 ("schedulable weekly") but this plan only wires the PDF export route (Task 15) and the existing `notification_config.weekly_summary` toggle (already present in `frontend/lib/api/settings.ts`'s `saveNotificationSettings`) — no new Celery task was added for it because `workers/tasks/send_notifications.py`'s existing `scheduled_weekly` trigger already fires a `weekly_summary` notification; wiring that existing trigger to also attach/link the new executive PDF is a small follow-up left to the implementer of Task 15, noted here rather than silently assumed done.

## Execution Handoff

Once this plan is approved, pick one:
1. **Subagent-Driven Development** (recommended) — use `superpowers:subagent-driven-development` to execute tasks one at a time with a fresh subagent per task, each self-reviewing before moving on.
2. **Inline Execution** — use `superpowers:executing-plans` to execute all tasks in the current session, task by task, checking off steps as you go.
