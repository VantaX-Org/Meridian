# Frontend Redesign Wave 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the Meridian frontend redesign — rebuild the remaining pages (fix batches, inbox, systems, import, rules, admin, search, the new MDM section, and the insights/rules/admin folds for glossary, golden records, match rules, process, lineage, mining, forecast, contracts, scoring and billing), add the business-partner record fix sheet, and retire the entire legacy shell (`app/(dashboard)`, Aurora, ui-core, the old lint allowlist).

**Architecture:** Every new page lives under `frontend/app/(app)/` and is built only from `@/design` (templates `ExplorerPage`/`RecordPage`/`ReportPage`, `DataTable`, primitives) and `@/design/shell`. Pages keep calling the existing typed `lib/api/*` wrappers — no wrapper is rewritten unless a type is missing. Legacy pages are deleted once their new counterpart ships; routes with no new counterpart become `next.config.ts` redirects. The business-partner record fix sheet extends the existing generalised record endpoint (Wave 1) rather than adding a new one.

**Tech Stack:** Next.js 15 App Router, TypeScript strict, TanStack Query + TanStack Table, `@/design` (Wave 1a/1b/2 deliverable), Playwright, Vitest, FastAPI + SQLAlchemy + pytest.

**Spec:** `docs/superpowers/specs/2026-10-08-frontend-redesign-design.md` (sections 3.1, 3.4, 7, 9.3, 9.4, 10, 12 Wave 3, 13 drive this plan; read the whole document before starting).

## Global Constraints

- TypeScript strict, no `any`.
- API calls only through typed wrappers in `frontend/lib/api/`.
- Pages import UI only from `@/design` (never `@/components/aurora`, `@/components/ui-core`, `@/components/shell`).
- Run all frontend commands from `frontend/`.
- Before every commit: `npm run typecheck && npm run lint && npm run lint:tokens && npm test` must pass.
- `npm run build` must pass at the end of the retirement task (Task 31).
- Python tests: `python3 -m pytest -q -p no:cacheprovider` from the repo root.
- Every backend query includes `tenant_id`; Postgres RLS stays enforced (`_rls` / `get_tenant` pattern already in `api/routes/materials.py`).
- Commit messages are normal prose, one commit per task, ending with:
  ```
  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01NfZiWjz1L8g8HN5DaEsNW6
  ```
- Never touch PRs #390 or #184.
- Never edit `sap/dictionaries/ecc6/tables/COMPINFO.json`.
- This plan assumes Waves 1a, 1b and 2 have already merged and deliver (consumed by name below, do not re-derive): the `@/design` package (primitives, `DataTable` with `mode: "client" | "server"`, `Drawer`, `BulkBar`, `charts/*`, `templates/{HomePage,ExplorerPage,RecordPage,ReportPage}`, `shell/{Rail,TopBar,Breadcrumb,RunSelector,JobTray,CommandPalette}`), `DrillLink`, `useDrill()`, `frontend/lib/query-keys.ts`, `vitest` wired to `npm test`, the `frontend/app/(app)/` route group, the adapter `frontend/app/(dashboard)/layout.tsx`, routes `/home/*`, `/objects/*`, `/runs/*`, `/insights/*`, the material-master record fix sheet at `/objects/[object]/records/[key]` backed by `GET /api/v1/objects/{object}/records/{key}`, and `GET /api/v1/shell/counts`. Because none of this exists yet in the current worktree (it is built by separate, earlier-running plans), tasks below that depend on its exact shape tell the implementer which file to open and confirm before writing code — never guess a prop name or response field.

---

## File Structure

```
api/routes/objects.py                           # Wave 1 file — Task 1 extends it for business_partner
tests/test_object_records_business_partner.py    # new pytest (Task 1)

frontend/app/(app)/
  fix/page.tsx                                    # Task 3
  fix/[batchId]/page.tsx                           # Task 4
  inbox/page.tsx                                   # Task 5
  systems/page.tsx                                 # Task 7
  systems/[systemId]/page.tsx                      # Task 8
  systems/[systemId]/extractions/[runId]/page.tsx  # Task 9
  import/page.tsx                                  # Task 10
  rules/page.tsx                                   # Task 11
  rules/[ruleId]/page.tsx                          # Task 12
  admin/users/page.tsx                             # Task 13
  admin/mappings/page.tsx                          # Task 14
  admin/ai/page.tsx                                # Task 15
  admin/licence/page.tsx                            # Task 15
  admin/triage/page.tsx                             # Task 16
  admin/settings/page.tsx                           # Task 16
  search/page.tsx                                   # Task 18
  mdm/glossary/page.tsx                              # Task 19
  mdm/glossary/[id]/page.tsx                         # Task 19
  mdm/golden/page.tsx                                # Task 20
  mdm/golden/[id]/page.tsx                           # Task 20
  mdm/golden/merge/page.tsx                          # Task 20
  mdm/match-rules/page.tsx                           # Task 21
  insights/process/page.tsx                          # Task 22
  insights/process/designer/page.tsx                 # Task 22
  insights/lineage/page.tsx                          # Task 23
  insights/mining/page.tsx                           # Task 24
  insights/forecast/page.tsx                         # Task 25
  rules/contracts/page.tsx                           # Task 26
  rules/scoring/page.tsx                             # Task 27
  admin/billing/page.tsx                             # Task 28

frontend/lib/
  search.ts                                         # Task 17: rankResults(), typed cross-entity search
  api/cleaning.ts                                    # existing — reused by Tasks 3/4, extended with batch grouping helper
  api/stewardship.ts, api/triage.ts                  # existing — reused by Tasks 5, 29
  nav.ts                                             # existing — Task 30 adds the MDM NavGroup

frontend/e2e/
  steward-accept-proposal.spec.ts                    # Task 32
  basis-failed-extraction.spec.ts                    # Task 32

frontend/__tests__/
  search.test.ts                                     # Task 17
  inbox-keyboard.test.ts                              # Task 5

next.config.ts                                       # Task 31 — redirect map for every orphaned legacy route
frontend/DESIGN.md                                    # Task 31 — rewritten from spec section 4
CLAUDE.md                                             # Task 31 — "Frontend design system" section rewritten
```

---

### Task 1: Business-partner record fix sheet (backend)

**Files:**
- Modify: `api/routes/objects.py` (the Wave 1 route module behind `GET /api/v1/objects/{object}/records/{key}` — confirm the exact file and function name with `grep -rn "records/{key}\|/records/" api/routes/*.py` before editing; Wave 1 is expected to have created it alongside `GET /api/v1/objects/{object}` and `GET /api/v1/objects`)
- Modify: whichever `api/services/*.py` module `objects.py` calls to build the per-object payload (follow the import in `objects.py`; the material-master equivalent is `api/services/material_360.py`, read it for the `{header, failing_rules, fields[], history[], related}` shape referenced in spec section 7)
- Test: `tests/test_object_records_business_partner.py`

**Interfaces:**
- Consumes: `GET /api/v1/objects/{object}/records/{key}` → `{header, failing_rules, fields[], history[], related}` (spec section 7) already implemented for `object=material_master`; `sap/dictionaries/ecc6/tables/BUT000.json` (key field `PARTNER`, fields `TYPE`, `BPKIND`, `BU_GROUP`, …) for field metadata.
- Produces: the same endpoint now also resolves for `object="business_partner"`, reading from `BUT000` (and whichever related BUT0ID/BUT020/BUT100 tables the dictionary and existing BP checks reference — `grep -rln "BUT000" api/ checks/ sap/` to find what's already joined for business-partner checks) keyed by `PARTNER`.

- [ ] **Step 1: Read the generalised record endpoint and its material-master implementation**

  Run:
  ```bash
  grep -rn "records/{key}" api/routes/*.py
  ```
  Open the matched file. Read the function end to end: how it dispatches on `object`, what it calls for `material_master`, and the exact Pydantic response model field names (they must match spec section 7's `{header, failing_rules, fields[], history[], related}` — if the real names differ, use the real names, not the spec's).

- [ ] **Step 2: Write the failing pytest for business_partner**

  Model this on `tests/test_material_360_routes.py` (a `_Db` fake that records calls, a monkeypatched table-fetch function, `ASGITransport` + `AsyncClient`). Write:

  ```python
  import asyncio
  import uuid

  from fastapi import FastAPI
  from httpx import ASGITransport, AsyncClient

  from api.deps import Tenant, get_db, get_tenant
  from api.routes import objects  # adjust to the real module name found in Step 1

  TID, VID = uuid.uuid4(), uuid.uuid4()


  class _Res:
      def __init__(self, rows):
          self.rows = rows

      def fetchall(self):
          return self.rows


  class _Db:
      def __init__(self, but000_rows):
          self.but000_rows = but000_rows

      async def execute(self, stmt, params=None):
          # Return BUT000 rows when the statement touches BUT000, else empty.
          if "but000" in str(stmt).lower():
              return _Res(self.but000_rows)
          return _Res([])


  def _app(db, monkeypatch):
      monkeypatch.setenv("MERIDIAN_DEV_ROLE_HEADER", "1")
      app = FastAPI()
      app.include_router(objects.router)
      app.dependency_overrides[get_db] = lambda: db
      app.dependency_overrides[get_tenant] = lambda: Tenant(TID, "T", [])
      return app


  def _get(app, url):
      async def go():
          async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
              return await c.get(url, headers={"X-User-Role": "steward"})
      return asyncio.run(go())


  def test_business_partner_record_fix_sheet(monkeypatch):
      rows = [{"PARTNER": "0000100001", "TYPE": "2", "BU_GROUP": "BP01"}]
      db = _Db(rows)
      app = _app(db, monkeypatch)
      resp = _get(app, "/api/v1/objects/business_partner/records/0000100001")
      assert resp.status_code == 200
      body = resp.json()
      assert body["header"]["key"] == "0000100001"
      assert "fields" in body and isinstance(body["fields"], list)


  def test_business_partner_record_not_found(monkeypatch):
      db = _Db([])
      app = _app(db, monkeypatch)
      resp = _get(app, "/api/v1/objects/business_partner/records/9999999999")
      assert resp.status_code == 404


  def test_business_partner_record_tenant_scoped(monkeypatch):
      # Every query the route issues for this object must carry tenant_id.
      db = _Db([{"PARTNER": "0000100001", "TYPE": "2", "BU_GROUP": "BP01"}])
      app = _app(db, monkeypatch)
      _get(app, "/api/v1/objects/business_partner/records/0000100001")
      assert any("tenant_id" in str(call) for call in getattr(db, "calls", []) or [str(db.but000_rows)])
  ```

  Adjust field names in the assertions to whatever Step 1 found in the real response model — do not invent a field name the model does not have.

- [ ] **Step 2b: Run it to confirm it fails for the right reason**

  Run: `python3 -m pytest -q -p no:cacheprovider tests/test_object_records_business_partner.py`
  Expected: FAIL — either `404` for an unhandled `object` value, or an `AttributeError`/`KeyError` from the dispatch, not an import error.

- [ ] **Step 3: Add the `business_partner` branch**

  In the file found in Step 1, add an `object == "business_partner"` branch beside the `material_master` one: look up the record by `PARTNER` in `BUT000` (RLS session already set by the time the handler runs — follow the same `_rls`/tenant pattern the `material_master` branch uses), map `TYPE`/`BPKIND`/`BU_GROUP` and any already-existing BP fields from `checks/` rules into the `fields[]` rows (reuse whatever field-label and view-grouping helper the material branch uses — do not write a second one), and return `failing_rules`, `history`, `related` the same way the material branch does (empty lists are fine if no BP-specific checks exist yet; do not fabricate check ids).

- [ ] **Step 4: Run the test**

  Run: `python3 -m pytest -q -p no:cacheprovider tests/test_object_records_business_partner.py`
  Expected: `3 passed`

- [ ] **Step 5: Commit**

  ```bash
  git add api/routes tests/test_object_records_business_partner.py
  git commit -m "$(cat <<'EOF'
  Extend the record fix sheet endpoint to business partner (BUT000)

  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01NfZiWjz1L8g8HN5DaEsNW6
  EOF
  )"
  ```

---

### Task 2: Confirm `@/design` surface before building pages

Guards every later task against building on a guessed API.

**Files:** none changed — read only.

- [ ] **Step 1: Read the design package's public exports**

  Run:
  ```bash
  cd frontend
  cat design/index.ts
  cat design/templates/ExplorerPage.tsx design/templates/RecordPage.tsx design/templates/ReportPage.tsx
  cat design/table/DataTable.tsx
  cat lib/query-keys.ts
  cat components/drill/DrillLink.tsx components/drill/use-drill.ts 2>/dev/null || grep -rl "export function useDrill\|export.*DrillLink" .
  ```
  Note the exact prop names for `ExplorerPage` (filter bar slot, table slot, drawer slot), `DataTable`'s `mode` prop and column type, and `DrillLink`'s prop shape (`{object, dimension?, ruleId?, filters?}` per spec section 5 — confirm the real prop names match before Task 3 onward uses them).

- [ ] **Step 2: Note any mismatch**

  If a prop name differs from what a later task below assumes, fix that task's code block before starting it — do not silently rename in the component and leave the task text wrong. No commit for this task (read-only); proceed to Task 3 with the confirmed names in hand.

---

### Task 3: `/fix` — fix batches list

**Files:**
- Create: `frontend/app/(app)/fix/page.tsx`
- Delete: `frontend/app/(dashboard)/cleaning/page.tsx` (the current redirect shim to `/workbench?tab=cleaning`)
- Test: `frontend/app/(app)/fix/__tests__/page.test.tsx` (component test, row click opens batch)

**Interfaces:**
- Consumes: `getCleaningQueue(params)`, `CleaningQueueItem` (`frontend/lib/api/cleaning.ts`, already exists — has `batch_id`, `status`, `confidence`, `object_type`), `ExplorerPage`/`DataTable` from `@/design` (Task 2).
- Produces: `/fix` lists one row per distinct `batch_id` present in the cleaning queue, with aggregate `items`, average `confidence`, and `status`; row click navigates to `/fix/[batchId]`.

- [ ] **Step 1: Write the batch-grouping helper and its test**

  `frontend/lib/api/cleaning.ts` has no batch-grouping call — the queue endpoint returns individual items. Add a pure grouping function to the same file (do not create a second file for one function):

  ```ts
  export interface CleaningBatchSummary {
    batch_id: string;
    object_type: string;
    items: number;
    avg_confidence: number;
    status: string; // the status shared by every item in the batch, or "mixed"
  }

  export function groupIntoBatches(items: CleaningQueueItem[]): CleaningBatchSummary[] {
    const byBatch = new Map<string, CleaningQueueItem[]>();
    for (const item of items) {
      if (!item.batch_id) continue;
      byBatch.get(item.batch_id)?.push(item) ?? byBatch.set(item.batch_id, [item]);
    }
    return [...byBatch.entries()].map(([batch_id, rows]) => ({
      batch_id,
      object_type: rows[0].object_type,
      items: rows.length,
      avg_confidence: rows.reduce((s, r) => s + r.confidence, 0) / rows.length,
      status: rows.every((r) => r.status === rows[0].status) ? rows[0].status : "mixed",
    }));
  }
  ```

  Test file `frontend/lib/api/__tests__/cleaning.test.ts`:
  ```ts
  import { describe, expect, it } from "vitest";
  import { groupIntoBatches, type CleaningQueueItem } from "../cleaning";

  const item = (over: Partial<CleaningQueueItem>): CleaningQueueItem => ({
    id: "1", object_type: "material_master", status: "recommended", confidence: 0.9,
    record_key: "100001", priority: 1, detected_at: "", applied_at: null,
    rollback_deadline: null, rule_id: null, batch_id: "B1", version_id: null,
    merge_preview: null, record_data_before: null, record_data_after: null,
    golden_record_id: null, golden_field_value: null, golden_record_exists: false,
    ...over,
  });

  describe("groupIntoBatches", () => {
    it("groups by batch_id and averages confidence", () => {
      const rows = groupIntoBatches([item({ confidence: 0.8 }), item({ confidence: 1.0 })]);
      expect(rows).toEqual([{ batch_id: "B1", object_type: "material_master", items: 2, avg_confidence: 0.9, status: "recommended" }]);
    });
    it("marks status mixed when items disagree", () => {
      const rows = groupIntoBatches([item({ status: "approved" }), item({ status: "recommended" })]);
      expect(rows[0].status).toBe("mixed");
    });
    it("drops items with no batch_id", () => {
      expect(groupIntoBatches([item({ batch_id: null })])).toEqual([]);
    });
  });
  ```

- [ ] **Step 2: Run the test, confirm it fails**

  Run: `npm test -- cleaning.test.ts` (from `frontend/`)
  Expected: FAIL — `groupIntoBatches is not a function` (not yet added).

- [ ] **Step 3: Add `groupIntoBatches` to `cleaning.ts` and build the page**

  Add the function from Step 1 to `frontend/lib/api/cleaning.ts`. Then write `frontend/app/(app)/fix/page.tsx` using the confirmed `ExplorerPage`/`DataTable` props from Task 2:

  ```tsx
  "use client";

  import { useMemo } from "react";
  import { useRouter } from "next/navigation";
  import { useQuery } from "@tanstack/react-query";
  import type { ColumnDef } from "@tanstack/react-table";
  import { DataTable, ExplorerPage, Mono, Pill } from "@/design";
  import { getCleaningQueue, groupIntoBatches, type CleaningBatchSummary } from "@/lib/api/cleaning";
  import { queryKeys } from "@/lib/query-keys";

  const columns: ColumnDef<CleaningBatchSummary>[] = [
    { accessorKey: "batch_id", header: "Batch", cell: ({ row }) => <Mono>{row.original.batch_id}</Mono> },
    { accessorKey: "object_type", header: "Object" },
    { accessorKey: "items", header: "Items" },
    { accessorKey: "avg_confidence", header: "Confidence", cell: ({ row }) => `${Math.round(row.original.avg_confidence * 100)}%` },
    { accessorKey: "status", header: "Status", cell: ({ row }) => <Pill tone={row.original.status === "mixed" ? "warning" : "default"}>{row.original.status}</Pill> },
  ];

  export default function FixPage() {
    const router = useRouter();
    const { data, isLoading, isError, refetch } = useQuery({
      queryKey: queryKeys.batch("list"),
      queryFn: () => getCleaningQueue({ per_page: 500 }),
    });
    const batches = useMemo(() => groupIntoBatches(data?.items ?? []), [data]);

    return (
      <ExplorerPage
        title="Fix batches"
        loading={isLoading}
        error={isError ? { message: "Could not load the fix queue.", onRetry: refetch } : undefined}
        empty={batches.length === 0 ? { title: "No batches yet", description: "Approve records in a record's fix sheet to start a batch.", actionLabel: "Go to objects", actionHref: "/objects" } : undefined}
      >
        <DataTable
          mode="client"
          columns={columns}
          data={batches}
          getRowId={(row) => row.batch_id}
          onRowClick={(row) => router.push(`/fix/${row.batch_id}`)}
        />
      </ExplorerPage>
    );
  }
  ```

  Reconcile the `ExplorerPage`/`DataTable` prop names against what Task 2 actually found; the names above (`loading`, `error`, `empty`, `mode`, `onRowClick`) are the spec's intent, not guaranteed literal — if Task 2 found different names, use those instead.

  Delete `frontend/app/(dashboard)/cleaning/page.tsx`.

- [ ] **Step 4: Run tests**

  Run: `npm test -- cleaning.test.ts && npm run typecheck && npm run lint`
  Expected: all pass, no `any`, no import from `@/components/aurora` or `@/components/ui-core`.

- [ ] **Step 5: Commit**

  ```bash
  git add frontend/app/\(app\)/fix frontend/lib/api/cleaning.ts frontend/lib/api/__tests__/cleaning.test.ts
  git rm frontend/app/\(dashboard\)/cleaning/page.tsx
  git commit -m "$(cat <<'EOF'
  Rebuild the fix batches list on the design package

  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01NfZiWjz1L8g8HN5DaEsNW6
  EOF
  )"
  ```

---

### Task 4: `/fix/[batchId]` — one batch

**Files:**
- Create: `frontend/app/(app)/fix/[batchId]/page.tsx`
- Test: `frontend/app/(app)/fix/[batchId]/__tests__/page.test.tsx`

**Interfaces:**
- Consumes: `getCleaningQueue({ })` filtered client-side to one `batch_id` (the list endpoint has no `batch_id` query param — confirmed by reading `getCleaningQueue`'s params in Task 1's sibling file; filter client-side instead of inventing a param), `approveCleaning(id, notes?)`, `rejectCleaning(id, reason)`, `bulkApprove({ rule_id?, severity?, max_count? })`, `applyCleaning(id, override_data?)`, `downloadCleaningExport(format, status, objectType?)` — all from `frontend/lib/api/cleaning.ts`.
- Produces: a batch detail page listing every item in the batch with its confidence, an "accept high confidence" bulk action (≥85%, same threshold the current `components/workbench/cleaning.tsx`/triage logic uses — confirm with `grep -n "0.85\|BULK_CONFIDENCE" frontend/components/workbench/*.tsx`), per-item approve, and an export action.

- [ ] **Step 1: Confirm the existing threshold and export UX**

  Run: `grep -n "0.85\|BULK_CONFIDENCE\|bulkApprove\|downloadCleaningExport" frontend/components/workbench/cleaning.tsx`
  Read the matches so the new page's "accept high confidence" button calls `bulkApprove` with the same default the legacy component used (do not invent a new threshold).

- [ ] **Step 2: Write the component test**

  ```tsx
  // frontend/app/(app)/fix/[batchId]/__tests__/page.test.tsx
  import { render, screen, fireEvent, waitFor } from "@testing-library/react";
  import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
  import { vi, describe, it, expect } from "vitest";
  import * as cleaningApi from "@/lib/api/cleaning";
  import BatchPage from "../page";

  vi.mock("next/navigation", () => ({ useParams: () => ({ batchId: "B1" }), useRouter: () => ({ push: vi.fn() }) }));

  function renderWithQuery(children: React.ReactNode) {
    const qc = new QueryClient();
    return render(<QueryClientProvider client={qc}>{children}</QueryClientProvider>);
  }

  describe("batch page", () => {
    it("shows every item in the batch and approves one", async () => {
      vi.spyOn(cleaningApi, "getCleaningQueue").mockResolvedValue({
        items: [
          { id: "i1", object_type: "material_master", status: "recommended", confidence: 0.92, record_key: "100001", priority: 1, detected_at: "", applied_at: null, rollback_deadline: null, rule_id: null, batch_id: "B1", version_id: null, merge_preview: null, record_data_before: null, record_data_after: null, golden_record_id: null, golden_field_value: null, golden_record_exists: false },
        ],
        total: 1, page: 1, per_page: 500,
      });
      const approve = vi.spyOn(cleaningApi, "approveCleaning").mockResolvedValue({ id: "i1", status: "approved" });
      renderWithQuery(<BatchPage />);
      await waitFor(() => expect(screen.getByText("100001")).toBeInTheDocument());
      fireEvent.click(screen.getByRole("button", { name: /approve/i }));
      await waitFor(() => expect(approve).toHaveBeenCalledWith("i1", undefined));
    });
  });
  ```

- [ ] **Step 3: Run it, confirm it fails**

  Run: `npm test -- fix` (page does not exist yet) → FAIL with a module-not-found error.

- [ ] **Step 4: Build the page**

  ```tsx
  "use client";

  import { useMemo } from "react";
  import { useParams } from "next/navigation";
  import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
  import type { ColumnDef } from "@tanstack/react-table";
  import { toast } from "sonner";
  import { BulkBar, Button, DataTable, ExplorerPage, Mono, Pill } from "@/design";
  import { approveCleaning, bulkApprove, downloadCleaningExport, getCleaningQueue, rejectCleaning, type CleaningQueueItem } from "@/lib/api/cleaning";
  import { queryKeys } from "@/lib/query-keys";

  const HIGH_CONFIDENCE = 0.85; // confirmed against components/workbench/cleaning.tsx in Step 1

  const columns: ColumnDef<CleaningQueueItem>[] = [
    { accessorKey: "record_key", header: "Record", cell: ({ row }) => <Mono>{row.original.record_key}</Mono> },
    { accessorKey: "rule_id", header: "Rule" },
    { accessorKey: "confidence", header: "Confidence", cell: ({ row }) => `${Math.round(row.original.confidence * 100)}%` },
    { accessorKey: "status", header: "Status", cell: ({ row }) => <Pill>{row.original.status}</Pill> },
  ];

  export default function BatchPage() {
    const { batchId } = useParams<{ batchId: string }>();
    const qc = useQueryClient();
    const { data, isLoading, isError, refetch } = useQuery({
      queryKey: queryKeys.batch(batchId),
      queryFn: () => getCleaningQueue({ per_page: 500 }),
    });
    const items = useMemo(() => (data?.items ?? []).filter((i) => i.batch_id === batchId), [data, batchId]);

    const approve = useMutation({
      mutationFn: (id: string) => approveCleaning(id),
      onSuccess: () => { toast.success("Approved"); qc.invalidateQueries({ queryKey: queryKeys.batch(batchId) }); },
    });
    const reject = useMutation({
      mutationFn: ({ id, reason }: { id: string; reason: string }) => rejectCleaning(id, reason),
      onSuccess: () => { toast.success("Rejected"); qc.invalidateQueries({ queryKey: queryKeys.batch(batchId) }); },
    });
    const acceptHighConfidence = useMutation({
      mutationFn: () => bulkApprove({ max_count: items.filter((i) => i.confidence >= HIGH_CONFIDENCE).length }),
      onSuccess: (r) => { toast.success(`Approved ${r.approved_count}`); qc.invalidateQueries({ queryKey: queryKeys.batch(batchId) }); },
    });

    return (
      <ExplorerPage
        title={`Batch ${batchId}`}
        loading={isLoading}
        error={isError ? { message: "Could not load this batch.", onRetry: refetch } : undefined}
        actions={<Button onClick={() => downloadCleaningExport("csv", "approved", items[0]?.object_type)}>Export</Button>}
      >
        <BulkBar count={items.filter((i) => i.confidence >= HIGH_CONFIDENCE).length} onAction={() => acceptHighConfidence.mutate()} actionLabel="Accept high confidence" />
        <DataTable
          mode="client"
          columns={columns}
          data={items}
          getRowId={(row) => row.id}
          rowActions={(row) => [
            { label: "Approve", onClick: () => approve.mutate(row.id) },
            { label: "Reject", onClick: () => reject.mutate({ id: row.id, reason: "steward rejected" }) },
          ]}
        />
      </ExplorerPage>
    );
  }
  ```

  Reconcile prop names (`actions`, `rowActions`, `BulkBar`'s props) against the real `@/design` exports from Task 2.

- [ ] **Step 5: Run tests**

  Run: `npm test -- fix && npm run typecheck && npm run lint`
  Expected: pass.

- [ ] **Step 6: Commit**

  ```bash
  git add "frontend/app/(app)/fix"
  git commit -m "$(cat <<'EOF'
  Add the fix batch detail page with accept, approve and export

  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01NfZiWjz1L8g8HN5DaEsNW6
  EOF
  )"
  ```

---

### Task 5: `/inbox` — issue inbox with steward keyboard handling

**Files:**
- Create: `frontend/app/(app)/inbox/page.tsx`, `frontend/lib/inbox-keys.ts`
- Delete: `frontend/app/(dashboard)/workbench/page.tsx` and its current component `frontend/components/workbench/inbox.tsx` (superseded — read it fully first per the inventory instruction so no action is dropped: assign, bulk approve, escalate, resolve, AI feedback, the five views, the three sort orders)
- Test: `frontend/lib/__tests__/inbox-keys.test.ts`

**Interfaces:**
- Consumes: `getQueueItems(filters)`, `assignItem`, `resolveItem`, `escalateItem`, `bulkApprove`, `getMetrics`, `submitAiFeedback` (`frontend/lib/api/stewardship.ts`); `getTriageMetrics`, `ownerRungs` (`frontend/lib/api/triage.ts`); `getUsers` (`frontend/lib/api/users.ts`).
- Produces: `inboxKeyHandler(event, { focusedIndex, rowCount, onApprove, onReject, onEscalate, onNext })` — a pure function the page wires to a `keydown` listener, so it is testable without rendering the page; `j`/`k` move focus, `enter` opens the fix sheet (`DrillLink` to `/objects/[object]/records/[key]`), per spec section 6.2 and the task's "steward keyboard j/k/enter" requirement.

- [ ] **Step 1: Read the full legacy inbox component**

  Read `frontend/components/workbench/inbox.tsx` end to end (it is long — this is the inventory step the task requires). List every data source and action it has: `LIVE` statuses, `VIEWS` (all/mine/unassigned/breached/today/escalated), `SORTS` (sla/priority/age), the `A approve · R reject · E escalate · N next · X select · "." quick actions` keymap already documented in its header comment, `copyToClipboard`, `ownerRungs`. The new page must keep every one of these — this task only replaces `j`/`k`/`enter` navigation and the visual shell, it does not drop assign/escalate/bulk-approve/AI-feedback.

- [ ] **Step 2: Write the failing keyboard-handler test**

  ```ts
  // frontend/lib/__tests__/inbox-keys.test.ts
  import { describe, expect, it, vi } from "vitest";
  import { inboxKeyHandler } from "../inbox-keys";

  function fakeEvent(key: string) {
    return { key, preventDefault: vi.fn() } as unknown as KeyboardEvent;
  }

  describe("inboxKeyHandler", () => {
    it("moves focus down on j, clamped to rowCount - 1", () => {
      const setFocus = vi.fn();
      inboxKeyHandler(fakeEvent("j"), { focusedIndex: 2, rowCount: 3, setFocus, onOpen: vi.fn() });
      expect(setFocus).toHaveBeenCalledWith(2); // already last row
      inboxKeyHandler(fakeEvent("j"), { focusedIndex: 0, rowCount: 3, setFocus, onOpen: vi.fn() });
      expect(setFocus).toHaveBeenCalledWith(1);
    });
    it("moves focus up on k, clamped to 0", () => {
      const setFocus = vi.fn();
      inboxKeyHandler(fakeEvent("k"), { focusedIndex: 0, rowCount: 3, setFocus, onOpen: vi.fn() });
      expect(setFocus).toHaveBeenCalledWith(0);
    });
    it("opens the focused row on enter", () => {
      const onOpen = vi.fn();
      inboxKeyHandler(fakeEvent("Enter"), { focusedIndex: 1, rowCount: 3, setFocus: vi.fn(), onOpen });
      expect(onOpen).toHaveBeenCalledWith(1);
    });
    it("ignores keys it does not own", () => {
      const setFocus = vi.fn();
      inboxKeyHandler(fakeEvent("x"), { focusedIndex: 1, rowCount: 3, setFocus, onOpen: vi.fn() });
      expect(setFocus).not.toHaveBeenCalled();
    });
  });
  ```

- [ ] **Step 3: Run it, confirm it fails**

  Run: `npm test -- inbox-keys.test.ts`
  Expected: FAIL — module `../inbox-keys` not found.

- [ ] **Step 4: Write `inbox-keys.ts` and the page**

  ```ts
  // frontend/lib/inbox-keys.ts
  export interface InboxKeyContext {
    focusedIndex: number;
    rowCount: number;
    setFocus: (index: number) => void;
    onOpen: (index: number) => void;
  }

  /** j/k move focus through the inbox list, enter opens the fix sheet (spec 6.2). */
  export function inboxKeyHandler(event: KeyboardEvent, ctx: InboxKeyContext): void {
    if (ctx.rowCount === 0) return;
    switch (event.key) {
      case "j":
        event.preventDefault();
        ctx.setFocus(Math.min(ctx.focusedIndex + 1, ctx.rowCount - 1));
        return;
      case "k":
        event.preventDefault();
        ctx.setFocus(Math.max(ctx.focusedIndex - 1, 0));
        return;
      case "Enter":
        event.preventDefault();
        ctx.onOpen(ctx.focusedIndex);
        return;
      default:
        return;
    }
  }
  ```

  Build `frontend/app/(app)/inbox/page.tsx` porting the legacy component's data wiring (views, sorts, assign/resolve/escalate/bulk-approve/AI-feedback mutations — copy them, do not drop any) onto `ExplorerPage`/`DataTable`, wire a `window.addEventListener("keydown", ...)` (or the table's own row-focus hook, if `DataTable` from Task 2 already exposes one — prefer that over a second listener) calling `inboxKeyHandler`, and route `onOpen` to a `DrillLink`/`router.push` to `/objects/${item.module}/records/${item.record_key}`. Because this file ports a large amount of existing behaviour, keep its structure close to the legacy file's (same `VIEWS`, `SORTS`, `STATUS_TONE`, mutations) and only swap component imports from `@/components/aurora` / `@/components/ui-core` to `@/design`.

  Delete `frontend/app/(dashboard)/workbench/page.tsx` and `frontend/components/workbench/inbox.tsx`.

- [ ] **Step 5: Run tests**

  Run: `npm test -- inbox-keys.test.ts && npm run typecheck && npm run lint`
  Expected: pass.

- [ ] **Step 6: Commit**

  ```bash
  git add "frontend/app/(app)/inbox" frontend/lib/inbox-keys.ts frontend/lib/__tests__/inbox-keys.test.ts
  git rm "frontend/app/(dashboard)/workbench/page.tsx" frontend/components/workbench/inbox.tsx
  git commit -m "$(cat <<'EOF'
  Rebuild the steward inbox with j/k/enter keyboard navigation

  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01NfZiWjz1L8g8HN5DaEsNW6
  EOF
  )"
  ```

---

### Task 6: Delete the now-orphaned workbench sub-pages

The legacy `/workbench/triage`, `/workbench/progress`, `/workbench/report`, `/workbench/record/[issueId]` pages lose their parent in Task 5. None has a dedicated new-route counterpart in the spec's route table (section 3.1) — their functionality is folded into `/inbox` (triage, progress) or `/objects/[object]/records/[key]` (record). Resolve them as redirects now so no route 404s mid-wave; the full redirect sweep happens in Task 31, but these four must not dangle once their page files are gone.

**Files:**
- Delete: `frontend/app/(dashboard)/workbench/triage/page.tsx`, `frontend/app/(dashboard)/workbench/progress/page.tsx`, `frontend/app/(dashboard)/workbench/report/page.tsx`, `frontend/app/(dashboard)/workbench/record/[issueId]/page.tsx`
- Delete: `frontend/components/workbench/triage-queue.tsx`, `frontend/components/workbench/progress.tsx`, `frontend/components/workbench/record-report.tsx` (confirm nothing else imports them first)
- Modify: `next.config.ts`

**Interfaces:**
- Consumes: none.
- Produces: `/workbench`, `/workbench/triage`, `/workbench/progress`, `/workbench/report` all redirect to `/inbox`; `/workbench/record/:issueId` redirects to `/inbox` (the issue id is not an object/key pair, so it cannot target `/objects/[object]/records/[key]` directly — land on `/inbox` and let the steward reopen the record from there).

- [ ] **Step 1: Confirm nothing else imports the three components**

  Run: `grep -rln "workbench/triage-queue\|workbench/progress\|workbench/record-report" frontend/app frontend/components`
  Expected: only the four doomed page files. If anything else matches, stop and leave that component in place.

- [ ] **Step 2: Delete the pages and components, add redirects**

  ```bash
  git rm "frontend/app/(dashboard)/workbench/triage/page.tsx" "frontend/app/(dashboard)/workbench/progress/page.tsx" "frontend/app/(dashboard)/workbench/report/page.tsx" "frontend/app/(dashboard)/workbench/record/[issueId]/page.tsx"
  git rm frontend/components/workbench/triage-queue.tsx frontend/components/workbench/progress.tsx frontend/components/workbench/record-report.tsx
  ```

  In `next.config.ts`, inside `redirects()`, replace the existing `/stewardship` entries and add the workbench ones:

  ```ts
  { source: "/stewardship", destination: "/inbox", permanent: false },
  { source: "/stewardship/metrics", destination: "/inbox", permanent: false },
  { source: "/workbench", destination: "/inbox", permanent: false },
  { source: "/workbench/triage", destination: "/inbox", permanent: false },
  { source: "/workbench/progress", destination: "/inbox", permanent: false },
  { source: "/workbench/report", destination: "/inbox", permanent: false },
  { source: "/workbench/record/:issueId", destination: "/inbox", permanent: false },
  ```

- [ ] **Step 3: Verify the build still resolves routes**

  Run: `npm run typecheck && npm run lint`
  Expected: pass (no dangling import of the deleted components).

- [ ] **Step 4: Commit**

  ```bash
  git add next.config.ts
  git commit -m "$(cat <<'EOF'
  Redirect orphaned workbench sub-pages to the new inbox

  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01NfZiWjz1L8g8HN5DaEsNW6
  EOF
  )"
  ```

---

### Task 7: `/systems` — systems list

**Files:**
- Create: `frontend/app/(app)/systems/page.tsx`
- Delete: `frontend/app/(dashboard)/systems/page.tsx`

**Interfaces:**
- Consumes: `getSystems()` (`frontend/lib/api/connectivity.ts`, returns `SAPSystemExtended[]`), `testConnection(systemId)` (same file).
- Produces: `/systems` lists every system with health/last-extraction, row click navigates to `/systems/[systemId]`.

- [ ] **Step 1: Read the legacy systems list page**

  Read `frontend/app/(dashboard)/systems/page.tsx` and `frontend/components/data/systems.tsx` (`HEALTH_LABEL`, `latestDqs` helpers — reuse them, do not reimplement) to capture every column and action it currently exposes (register, test connection, health pill, last DQS).

- [ ] **Step 2: Build the page**

  ```tsx
  "use client";

  import { useRouter } from "next/navigation";
  import { useQuery } from "@tanstack/react-query";
  import type { ColumnDef } from "@tanstack/react-table";
  import { DataTable, ExplorerPage, Pill } from "@/design";
  import { HEALTH_LABEL, latestDqs } from "@/components/data/systems";
  import { getSystems } from "@/lib/api/connectivity";
  import { queryKeys } from "@/lib/query-keys";
  import type { SAPSystemExtended } from "@/types/api";

  const columns: ColumnDef<SAPSystemExtended>[] = [
    { accessorKey: "name", header: "System" },
    { accessorKey: "system_type", header: "Type" },
    { accessorKey: "health_status", header: "Health", cell: ({ row }) => <Pill>{HEALTH_LABEL[row.original.health_status] ?? row.original.health_status}</Pill> },
    { id: "dqs", header: "Latest DQS", cell: ({ row }) => latestDqs(row.original) },
  ];

  export default function SystemsPage() {
    const router = useRouter();
    const { data, isLoading, isError, refetch } = useQuery({ queryKey: queryKeys.systems(), queryFn: getSystems });

    return (
      <ExplorerPage
        title="Systems"
        loading={isLoading}
        error={isError ? { message: "Could not load systems.", onRetry: refetch } : undefined}
        empty={data?.length === 0 ? { title: "No systems connected", description: "Connect a SAP system to start extracting data.", actionLabel: "Connect a system", actionHref: "/systems?new=1" } : undefined}
      >
        <DataTable mode="client" columns={columns} data={data ?? []} getRowId={(r) => r.id} onRowClick={(r) => router.push(`/systems/${r.id}`)} />
      </ExplorerPage>
    );
  }
  ```

  `queryKeys.systems()` corresponds to the `['systems']` key named in spec section 9.1 — confirm the exact accessor name in `frontend/lib/query-keys.ts` (Task 2) before using it; it may be a plain array constant rather than a function.

  Delete `frontend/app/(dashboard)/systems/page.tsx`.

- [ ] **Step 3: Verify**

  Run: `npm run typecheck && npm run lint`
  Expected: pass.

- [ ] **Step 4: Commit**

  ```bash
  git add "frontend/app/(app)/systems/page.tsx"
  git rm "frontend/app/(dashboard)/systems/page.tsx"
  git commit -m "$(cat <<'EOF'
  Rebuild the systems list on the design package

  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01NfZiWjz1L8g8HN5DaEsNW6
  EOF
  )"
  ```

---

### Task 8: `/systems/[systemId]` — one system

**Files:**
- Create: `frontend/app/(app)/systems/[systemId]/page.tsx`
- Delete: `frontend/app/(dashboard)/systems/[id]/page.tsx`, `frontend/app/(dashboard)/systems/[id]/pilot/page.tsx`, `frontend/app/(dashboard)/systems/[id]/versions/[versionId]/profile/page.tsx`

**Interfaces:**
- Consumes (all already read in the inventory pass): `getSystemModules`, `getSystems`, `testConnection` (`connectivity.ts`); `discoverSystem`, `getDesign` (`source-design.ts`); `analyseVersion`, `getSystemVersions`, `startDownload` (`system-objects.ts`); `deleteSystem`, `updateSystem` (`systems.ts`); `getFindingsAggregate` (`findings.ts`).
- Produces: one Explorer-template page with the same five concerns the legacy page's tabs had (Overview, Objects, Runs, Health, Pilot), using `Tabs` from `@/design` instead of `?tab=` query-driven `components/aurora` `Tabs`, plus an "Edit" drawer. The pilot and version-profile sub-routes fold into tabs on this one page rather than separate routes (no new-route equivalent exists for them in spec section 3.1; folding avoids orphaning them).

- [ ] **Step 1: Read all three legacy pages fully**

  Read `frontend/app/(dashboard)/systems/[id]/page.tsx`, `.../pilot/page.tsx`, `.../versions/[versionId]/profile/page.tsx` end to end. List every tab, every mutation (extract, analyse, edit, delete, pilot run, profile fetch) so nothing is lost when they merge into one page.

- [ ] **Step 2: Build the merged page**

  Port the existing `page.tsx` structure (it already uses `Tabs` and `useUrlState` for `?tab=`) onto `@/design`'s `ExplorerPage` + `Tabs`, keeping `?tab=overview|objects|runs|health|pilot|profile` in the URL via `useUrlState` (per spec section 9.2, filters/tab stay in search params). Swap:
  - `Banner, BarChart, Button, ConnectionTestButton, DataTable, Drawer, Field, Input, LineChart, Select, Stack, Tabs, Text, useDrawerParam` → their `@/design` equivalents (confirm each exists in Task 2's read; `ConnectionTestButton` is a Meridian-specific component under `frontend/components/connectivity/` or similar — grep for it with `grep -rn "function ConnectionTestButton" frontend/components` and keep importing it directly, it is not part of `@/design`).
  - `EmptyState, KeyValue, Mono, PageHeader, SectionCard, StatusBadge, TableSkeleton, Tally, type Status` → `@/design` equivalents; `PageCrumb` from `components/shell/page-crumb` is replaced by the page template's own breadcrumb (the shell owns breadcrumbs now per spec section 3.2) — drop the import.
  Add a "Pilot" tab rendering what `pilot/page.tsx` rendered, and a "Profile" sub-view under "Objects" (pick a version from `getSystemVersions`, show what `versions/[versionId]/profile/page.tsx` rendered) rather than a separate route.

  Delete the three legacy page files.

- [ ] **Step 3: Verify**

  Run: `npm run typecheck && npm run lint`
  Expected: pass. Manually confirm (via `npm run dev` or reading the diff) every mutation from Step 1's list has a call site in the new page.

- [ ] **Step 4: Commit**

  ```bash
  git add "frontend/app/(app)/systems/[systemId]"
  git rm -r "frontend/app/(dashboard)/systems/[id]"
  git commit -m "$(cat <<'EOF'
  Merge the system detail, pilot and version-profile pages into one route

  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01NfZiWjz1L8g8HN5DaEsNW6
  EOF
  )"
  ```

---

### Task 9: `/systems/[systemId]/extractions/[runId]` — one extraction

**Files:**
- Create: `frontend/app/(app)/systems/[systemId]/extractions/[runId]/page.tsx`
- Test: `frontend/app/(app)/systems/[systemId]/extractions/[runId]/__tests__/page.test.tsx`

**Interfaces:**
- Consumes: the run-steps endpoint named in spec section 9.4, `GET /api/v1/runs/{id}/steps` (a Wave 1 deliverable — its frontend wrapper is whatever `lib/api/*` file Wave 1 added; find it with `grep -rln "runs/.*steps\|/steps\`" frontend/lib/api/*.ts` before writing this page — do not invent a function name). If that search comes back empty because Wave 1 named the wrapper differently, read `frontend/lib/api/jobs.ts` and `frontend/lib/api/system-objects.ts` next (they currently hold `SystemVersion`/sync-run status and are the most likely place a steps-wrapper was added alongside existing run-status calls).
- Produces: a Report-template page showing per-step duration and, for a failed run, the decisive error line (spec section 10: "Run and extraction pages show the decisive error line from the worker... so a Basis user does not read logs").

- [ ] **Step 1: Locate the real wrapper**

  Run the greps in the Interfaces note above. Open the matched function and record its exact name, parameters and return type (expect something like `{ steps: { name, status, duration_ms, error }[] }`).

- [ ] **Step 2: Write the failing component test**

  ```tsx
  // frontend/app/(app)/systems/[systemId]/extractions/[runId]/__tests__/page.test.tsx
  import { render, screen, waitFor } from "@testing-library/react";
  import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
  import { vi, describe, it, expect } from "vitest";
  import * as runsApi from "@/lib/api/runs"; // adjust to the real module found in Step 1
  import ExtractionPage from "../page";

  vi.mock("next/navigation", () => ({ useParams: () => ({ systemId: "s1", runId: "r1" }) }));

  describe("extraction run page", () => {
    it("shows the decisive error line for a failed step", async () => {
      vi.spyOn(runsApi, "getRunSteps").mockResolvedValue({
        steps: [
          { name: "extract_BUT000", status: "ok", duration_ms: 1200, error: null },
          { name: "extract_MARA", status: "failed", duration_ms: 400, error: "RFC_COMMUNICATION_FAILURE: connection reset" },
        ],
      });
      const qc = new QueryClient();
      render(<QueryClientProvider client={qc}><ExtractionPage /></QueryClientProvider>);
      await waitFor(() => expect(screen.getByText(/RFC_COMMUNICATION_FAILURE/)).toBeInTheDocument());
    });
  });
  ```

  Replace `runsApi`/`getRunSteps` with whatever Step 1 actually found.

- [ ] **Step 3: Run it, confirm it fails**

  Run: `npm test -- extractions`
  Expected: FAIL — page module not found.

- [ ] **Step 4: Build the page**

  ```tsx
  "use client";

  import { useParams } from "next/navigation";
  import { useQuery } from "@tanstack/react-query";
  import { Banner, Mono, ReportPage, Table } from "@/design"; // reconcile exact exports with Task 2
  import { getRunSteps } from "@/lib/api/runs"; // adjust to the module found in Step 1
  import { queryKeys } from "@/lib/query-keys";

  export default function ExtractionPage() {
    const { systemId, runId } = useParams<{ systemId: string; runId: string }>();
    const { data, isLoading, isError, refetch } = useQuery({
      queryKey: queryKeys.run(runId),
      queryFn: () => getRunSteps(runId),
    });
    const failed = data?.steps.find((s) => s.status === "failed");

    return (
      <ReportPage
        title={`Extraction ${runId}`}
        loading={isLoading}
        error={isError ? { message: "Could not load this extraction.", onRetry: refetch } : undefined}
      >
        {failed && <Banner tone="critical">{failed.name}: <Mono>{failed.error}</Mono></Banner>}
        <Table
          columns={[
            { header: "Step", accessor: "name" },
            { header: "Status", accessor: "status" },
            { header: "Duration", accessor: "duration_ms", format: (v: number) => `${v}ms` },
          ]}
          rows={data?.steps ?? []}
        />
      </ReportPage>
    );
  }
  ```

- [ ] **Step 5: Run tests**

  Run: `npm test -- extractions && npm run typecheck && npm run lint`
  Expected: pass.

- [ ] **Step 6: Commit**

  ```bash
  git add "frontend/app/(app)/systems/[systemId]/extractions"
  git commit -m "$(cat <<'EOF'
  Add the extraction run page with the decisive error line

  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01NfZiWjz1L8g8HN5DaEsNW6
  EOF
  )"
  ```

---

### Task 10: `/import` — file import

**Files:**
- Create: `frontend/app/(app)/import/page.tsx`
- Delete: `frontend/app/(dashboard)/upload/page.tsx`

**Interfaces:**
- Consumes: `matchColumns(headers, sampleRows, filename, moduleHint?)`, `uploadFile(file, module, columnMapping, onProgress, signal?)` (`frontend/lib/api/upload.ts`).
- Produces: the same upload → column-match → confirm flow the legacy `components/data/import.tsx` has, rebuilt on `@/design`.

- [ ] **Step 1: Read the legacy import component fully**

  Read `frontend/components/data/import.tsx` end to end: file picker, the `matchColumns` call and its confidence display, manual remap UI, upload progress, and error handling (formula-injection / magic-byte errors surfaced from the API per `CLAUDE.md`'s security standards — keep that error path).

- [ ] **Step 2: Build the page**

  Port the component's logic into `frontend/app/(app)/import/page.tsx`, swapping `@/components/aurora`/`@/components/ui-core` imports for `@/design` equivalents found in Task 2. Keep the three-stage flow (pick file → review mapping → upload with progress) and every error message the legacy version shows.

  Delete `frontend/app/(dashboard)/upload/page.tsx`. Leave `frontend/components/data/import.tsx` only if something else still imports it (`grep -rln "components/data/import" frontend/app frontend/components`); otherwise delete it too.

- [ ] **Step 3: Verify**

  Run: `npm run typecheck && npm run lint`
  Expected: pass.

- [ ] **Step 4: Commit**

  ```bash
  git add "frontend/app/(app)/import"
  git rm "frontend/app/(dashboard)/upload/page.tsx"
  git commit -m "$(cat <<'EOF'
  Rebuild file import on the design package

  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01NfZiWjz1L8g8HN5DaEsNW6
  EOF
  )"
  ```

---

### Task 11: `/rules` — rule packs list

**Files:**
- Create: `frontend/app/(app)/rules/page.tsx`
- Delete: `frontend/app/(dashboard)/settings/rules/page.tsx`

**Interfaces:**
- Consumes: `getRules(params)`, `getRulesSummary()`, `updateRule(ruleId, { enabled })` (`frontend/lib/api/rules.ts`).
- Produces: `/rules` lists rule packs per object/module with enable/disable and the summary facets (category, severity, source), plus entry points for the readiness threshold and value-per-record settings the insights pages need (spec sections 8.1, 8.2: "threshold set in `/rules`", "value per record per feature... set in `/rules`"). Those two settings are not in `frontend/lib/api/rules.ts` today — confirm with `grep -n "readiness_threshold\|value_per_record" frontend/lib/api/*.ts api/routes/*.py`; if Wave 2 has added them, add a "Thresholds" section to this page backed by that endpoint (read that file before wiring it — do not invent the field names). If the grep finds nothing, omit the Thresholds section entirely and state that omission explicitly in the implementer's report so the controller can ledger it — do not leave a TODO placeholder in shipped code.

- [ ] **Step 1: Read the legacy rules component and confirm the threshold settings location**

  Read `frontend/components/admin/rules.tsx` fully (module/severity/dimension/source facets, dry-run-and-save custom rule flow — keep every capability). Run the grep above for the readiness and value-per-record settings.

- [ ] **Step 2: Build the page**

  Port `components/admin/rules.tsx` into `frontend/app/(app)/rules/page.tsx` on `@/design`, keeping the facet filters, the enable/disable toggle (`updateRule`), and the custom-rule authoring flow. Add the thresholds section from Step 1's finding, or omit it entirely and state the omission in the implementer's report if nothing exists.

  Delete `frontend/app/(dashboard)/settings/rules/page.tsx`.

- [ ] **Step 3: Verify**

  Run: `npm run typecheck && npm run lint`
  Expected: pass.

- [ ] **Step 4: Commit**

  ```bash
  git add "frontend/app/(app)/rules/page.tsx"
  git rm "frontend/app/(dashboard)/settings/rules/page.tsx"
  git commit -m "$(cat <<'EOF'
  Rebuild the rule packs list on the design package

  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01NfZiWjz1L8g8HN5DaEsNW6
  EOF
  )"
  ```

---

### Task 12: `/rules/[ruleId]` — rule definition editor

**Files:**
- Create: `frontend/app/(app)/rules/[ruleId]/page.tsx`

**Interfaces:**
- Consumes: `getRule(ruleId)`, `updateRule(ruleId, { enabled })` (`frontend/lib/api/rules.ts`). Note `updateRule` today only mutates `enabled` ("the backend only allows `enabled` to be mutated customer-side" per its own doc comment) — the "custom rules" editing capability from Task 11 goes through whatever custom-rule-save call `components/admin/rules.tsx` uses (`grep -n "createRule\|saveCustomRule" frontend/components/admin/rules.tsx frontend/lib/api/rules.ts`); reuse that call here for custom/mined rules, and keep this page read-only plus enable/disable for `source: "yaml" | "hq"` rules.
- Produces: a Record-template page: rule id, description, conditions/thresholds, module, severity, and (section 5) a drill target to its failing records via `DrillLink({ object: rule.module, ruleId: rule.id })`.

- [ ] **Step 1: Confirm the custom-rule save call**

  Run the grep above and read the matched function's signature.

- [ ] **Step 2: Build the page**

  ```tsx
  "use client";

  import { useParams } from "next/navigation";
  import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
  import { toast } from "sonner";
  import { DrillLink, Field, KeyValue, Mono, RecordPage, Switch } from "@/design";
  import { getRule, updateRule } from "@/lib/api/rules";
  import { queryKeys } from "@/lib/query-keys";

  export default function RulePage() {
    const { ruleId } = useParams<{ ruleId: string }>();
    const qc = useQueryClient();
    const { data, isLoading, isError, refetch } = useQuery({ queryKey: queryKeys.rule(ruleId), queryFn: () => getRule(ruleId) });
    const toggle = useMutation({
      mutationFn: (enabled: boolean) => updateRule(ruleId, { enabled }),
      onSuccess: () => { toast.success("Saved"); qc.invalidateQueries({ queryKey: queryKeys.rule(ruleId) }); },
    });

    return (
      <RecordPage
        title={data?.name}
        subtitle={<Mono>{ruleId}</Mono>}
        loading={isLoading}
        error={isError ? { message: "Could not load this rule.", onRetry: refetch } : undefined}
      >
        {data && (
          <>
            <KeyValue label="Module" value={data.module} />
            <KeyValue label="Category" value={data.category} />
            <KeyValue label="Severity" value={data.severity} />
            <KeyValue label="Source" value={data.source} />
            {data.source !== "custom" && data.source !== "mined" && (
              <Field label="Enabled"><Switch checked={data.enabled} onChange={(v) => toggle.mutate(v)} /></Field>
            )}
            <DrillLink object={data.module} ruleId={data.id}>See failing records</DrillLink>
          </>
        )}
      </RecordPage>
    );
  }
  ```

  Reconcile every `@/design` import against Task 2's findings; add the custom-rule editor fields from Step 1 if `data.source` is `"custom"` or `"mined"`.

- [ ] **Step 3: Verify**

  Run: `npm run typecheck && npm run lint`
  Expected: pass.

- [ ] **Step 4: Commit**

  ```bash
  git add "frontend/app/(app)/rules/[ruleId]"
  git commit -m "$(cat <<'EOF'
  Add the rule definition editor page

  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01NfZiWjz1L8g8HN5DaEsNW6
  EOF
  )"
  ```

---

### Task 13: `/admin/users` — users and audit

**Files:**
- Create: `frontend/app/(app)/admin/users/page.tsx`
- Delete: `frontend/app/(dashboard)/admin/page.tsx`

**Interfaces:**
- Consumes: `getUsers()`, `updateUser(userId, { role?, is_active? })`, `inviteUser(body)`, `deleteUser(userId)`, `getAssignableUsers()` (`frontend/lib/api/users.ts`).
- Produces: the same user list, role matrix and audit log the legacy `components/admin/users.tsx` has, rebuilt on `@/design`.

- [ ] **Step 1: Read `frontend/components/admin/users.tsx` fully**, listing every column, action (invite, edit role, deactivate, delete) and the audit log section.

- [ ] **Step 2: Port it to `frontend/app/(app)/admin/users/page.tsx`** on `@/design`'s `ExplorerPage`/`DataTable`/`Drawer`, keeping every action from Step 1. Delete `frontend/app/(dashboard)/admin/page.tsx`.

- [ ] **Step 3: Verify.** Run: `npm run typecheck && npm run lint` → pass.

- [ ] **Step 4: Commit**

  ```bash
  git add "frontend/app/(app)/admin/users"
  git rm "frontend/app/(dashboard)/admin/page.tsx"
  git commit -m "$(cat <<'EOF'
  Rebuild the admin users and audit page on the design package

  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01NfZiWjz1L8g8HN5DaEsNW6
  EOF
  )"
  ```

---

### Task 14: `/admin/mappings` — field mappings

**Files:**
- Create: `frontend/app/(app)/admin/mappings/page.tsx`
- Delete: `frontend/app/(dashboard)/settings/field-mapping/page.tsx`

**Interfaces:**
- Consumes: `getFieldMappings(params)`, `getModuleFieldMappings(moduleName)`, `updateFieldMapping(mappingId, body)` (`frontend/lib/api/field-mappings.ts`; read the full file for `updateFieldMapping`'s remaining body fields and any reset-to-default call before wiring the page).
- Produces: the same per-object inline-editable mapping table the legacy `components/admin/field-mapping.tsx` has.

- [ ] **Step 1: Read `frontend/components/admin/field-mapping.tsx`** fully (inline edit, per-row save, reset-to-default, `self_service_enabled` gating) and the rest of `frontend/lib/api/field-mappings.ts`.

- [ ] **Step 2: Port it to `frontend/app/(app)/admin/mappings/page.tsx`** on `@/design`, keeping inline edit, per-row save and reset. Delete `frontend/app/(dashboard)/settings/field-mapping/page.tsx`.

- [ ] **Step 3: Verify.** Run: `npm run typecheck && npm run lint` → pass.

- [ ] **Step 4: Commit**

  ```bash
  git add "frontend/app/(app)/admin/mappings"
  git rm "frontend/app/(dashboard)/settings/field-mapping/page.tsx"
  git commit -m "$(cat <<'EOF'
  Rebuild the field mappings admin page on the design package

  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01NfZiWjz1L8g8HN5DaEsNW6
  EOF
  )"
  ```

---

### Task 15: `/admin/ai` and `/admin/licence`

**Files:**
- Create: `frontend/app/(app)/admin/ai/page.tsx`, `frontend/app/(app)/admin/licence/page.tsx`
- Delete: `frontend/app/(dashboard)/settings/ai/page.tsx`, `frontend/app/(dashboard)/settings/licence/page.tsx`

**Interfaces:**
- Consumes (AI): `getLLMConfig`, `getLLMProviders`, `testLLMConnection`, `updateLLMConfig`, types `LLMConfig`, `LLMConfigUpdate`, `LLMProvider` (`frontend/lib/api/llm-settings.ts`).
- Consumes (Licence): `getLicenceManifest` (`frontend/lib/api/licence.ts`), `getUpdateStatus` (`frontend/lib/api/system-update.ts`).
- Produces: two Explorer-template pages, each a straight port of `components/admin/ai.tsx` / `components/admin/licence.tsx`.

- [ ] **Step 1: Read both legacy components fully** (`frontend/components/admin/ai.tsx`, `frontend/components/admin/licence.tsx`) — provider test-connection flow, temperature/max-tokens/timeout fields for AI; tier, seats, renewal, modules, features, platform version and the update-modal hook for Licence.

- [ ] **Step 2: Port both to `frontend/app/(app)/admin/ai/page.tsx` and `frontend/app/(app)/admin/licence/page.tsx`** on `@/design`, keeping every field and action. Delete the two legacy page files.

- [ ] **Step 3: Verify.** Run: `npm run typecheck && npm run lint` → pass.

- [ ] **Step 4: Commit**

  ```bash
  git add "frontend/app/(app)/admin/ai" "frontend/app/(app)/admin/licence"
  git rm "frontend/app/(dashboard)/settings/ai/page.tsx" "frontend/app/(dashboard)/settings/licence/page.tsx"
  git commit -m "$(cat <<'EOF'
  Rebuild the AI settings and licence admin pages on the design package

  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01NfZiWjz1L8g8HN5DaEsNW6
  EOF
  )"
  ```

---

### Task 16: `/admin/triage` and `/admin/settings`

**Files:**
- Create: `frontend/app/(app)/admin/triage/page.tsx`, `frontend/app/(app)/admin/settings/page.tsx`
- Delete: `frontend/app/(dashboard)/admin/triage/page.tsx`

**Interfaces:**
- Consumes (Triage): `getTriageQueue`, `getTriageMetrics`, `getTeams`, `createTeam`, `updateTeam`, `setTeamMembers`, `deleteTeam`, `getRules`, `createRule`, `updateRule`, `deleteRule`, `reorderRules`, `getSlaPolicies`, `saveSlaPolicy`, `deleteSlaPolicy`, `getTriageSettings`, `saveTriageSettings` (`frontend/lib/api/triage.ts` — the full file read in the research pass).
- Consumes (Settings): `getDoctor` (`frontend/lib/api/admin-doctor.ts`), `getLicenceManifest` (`frontend/lib/api/licence.ts`).
- Produces: two Explorer-template pages, straight ports of `components/admin/triage.tsx` (teams, assignment rules, SLA policies, working calendar) and `components/admin/settings.tsx` (deployment-at-a-glance, health doctor cards with Fix links).

- [ ] **Step 1: Read both legacy components fully** (`frontend/components/admin/triage.tsx`, `frontend/components/admin/settings.tsx`, and `frontend/components/admin/parts.tsx` for `DoctorCard`).

- [ ] **Step 2: Port both to `frontend/app/(app)/admin/triage/page.tsx` and `frontend/app/(app)/admin/settings/page.tsx`** on `@/design`, keeping every team/rule/SLA-policy/calendar action and every doctor card with its Fix link. Delete `frontend/app/(dashboard)/admin/triage/page.tsx`. `frontend/app/(dashboard)/settings/page.tsx` (the old Settings index, which just links to its children) also loses its last reason to exist once Tasks 11/14/15/16 finish — delete it here too since this is the last task touching `/admin/*`/`/settings/*` pages.

- [ ] **Step 3: Verify.** Run: `npm run typecheck && npm run lint` → pass.

- [ ] **Step 4: Commit**

  ```bash
  git add "frontend/app/(app)/admin/triage" "frontend/app/(app)/admin/settings"
  git rm "frontend/app/(dashboard)/admin/triage/page.tsx" "frontend/app/(dashboard)/settings/page.tsx"
  git commit -m "$(cat <<'EOF'
  Rebuild admin triage and deployment settings pages on the design package

  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01NfZiWjz1L8g8HN5DaEsNW6
  EOF
  )"
  ```

---

### Task 17: Cross-entity search ranking

**Files:**
- Create: `frontend/lib/search.ts`, `frontend/lib/__tests__/search.test.ts`

**Interfaces:**
- Consumes: `getRules({ search })` (`rules.ts`), `getSystems()` (`connectivity.ts`), `getCleaningQueue({})` + `groupIntoBatches` (`cleaning.ts`, Task 3) — no dedicated `/api/search` endpoint exists in spec section 9.4's API-additions table, so this is a client-side fan-out and rank, not a new backend call. Material/object search reuses whatever `/objects` list endpoint Wave 1 built — confirm with `grep -rn "export async function getObjects" frontend/lib/api/*.ts` before wiring Task 18.
- Produces: `rankResults(query, candidates)` — a pure function, independent of any fetch, so it is unit-testable without mocking the network; `SearchCandidate = { kind: "object" | "material" | "rule" | "batch" | "run"; id: string; label: string; href: string }`.

- [ ] **Step 1: Write the failing ranking test**

  ```ts
  // frontend/lib/__tests__/search.test.ts
  import { describe, expect, it } from "vitest";
  import { rankResults, type SearchCandidate } from "../search";

  const c = (over: Partial<SearchCandidate>): SearchCandidate => ({ kind: "object", id: "1", label: "", href: "", ...over });

  describe("rankResults", () => {
    it("ranks an exact id match first", () => {
      const candidates = [c({ id: "material_master", label: "Material master" }), c({ id: "C001", label: "C001 material group check" })];
      const [first] = rankResults("material_master", candidates);
      expect(first.id).toBe("material_master");
    });
    it("ranks a label prefix match above a substring match", () => {
      const candidates = [c({ id: "a", label: "Business partner cleanup" }), c({ id: "b", label: "Business partner" })];
      const results = rankResults("business partner", candidates);
      expect(results[0].id).toBe("b");
    });
    it("is case-insensitive and ignores non-matches", () => {
      const candidates = [c({ id: "a", label: "Material Master" }), c({ id: "b", label: "Unrelated" })];
      const results = rankResults("MATERIAL", candidates);
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe("a");
    });
    it("returns everything in input order for an empty query", () => {
      const candidates = [c({ id: "a" }), c({ id: "b" })];
      expect(rankResults("", candidates).map((r) => r.id)).toEqual(["a", "b"]);
    });
  });
  ```

- [ ] **Step 2: Run it, confirm it fails**

  Run: `npm test -- search.test.ts`
  Expected: FAIL — module `../search` not found.

- [ ] **Step 3: Write `frontend/lib/search.ts`**

  ```ts
  export interface SearchCandidate {
    kind: "object" | "material" | "rule" | "batch" | "run";
    id: string;
    label: string;
    href: string;
  }

  /** 3 = exact id, 2 = label prefix, 1 = substring, 0 = no match (dropped). */
  function score(query: string, candidate: SearchCandidate): number {
    const q = query.trim().toLowerCase();
    if (!q) return 1;
    const id = candidate.id.toLowerCase();
    const label = candidate.label.toLowerCase();
    if (id === q) return 3;
    if (label.startsWith(q) || id.startsWith(q)) return 2;
    if (label.includes(q) || id.includes(q)) return 1;
    return 0;
  }

  /** Ranks candidates for the global search page (spec section 3.1 `/search`). */
  export function rankResults(query: string, candidates: SearchCandidate[]): SearchCandidate[] {
    if (!query.trim()) return candidates;
    return candidates
      .map((c) => ({ c, s: score(query, c) }))
      .filter(({ s }) => s > 0)
      .sort((a, b) => b.s - a.s)
      .map(({ c }) => c);
  }
  ```

- [ ] **Step 4: Run tests**

  Run: `npm test -- search.test.ts`
  Expected: `4 passed`

- [ ] **Step 5: Commit**

  ```bash
  git add frontend/lib/search.ts frontend/lib/__tests__/search.test.ts
  git commit -m "$(cat <<'EOF'
  Add the cross-entity search ranking function

  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01NfZiWjz1L8g8HN5DaEsNW6
  EOF
  )"
  ```

---

### Task 18: `/search` — global search page

**Files:**
- Create: `frontend/app/(app)/search/page.tsx`

**Interfaces:**
- Consumes: `rankResults` (Task 17); `getRules({ search: q })`; `getSystems()`; `getCleaningQueue({})` + `groupIntoBatches` (Task 3); the objects-list function confirmed in Task 17 Step 1 for object/material results; the run-list function (`grep -rn "export async function getRuns\b" frontend/lib/api/*.ts`, a Wave 1 deliverable).
- Produces: `/search?q=` fans the query out to the sources above in parallel, maps each result set to `SearchCandidate[]`, ranks with `rankResults`, and renders grouped by `kind` using `ExplorerPage`.

- [ ] **Step 1: Confirm the two Wave-1 list functions**

  Run the greps from the Interfaces note. Record the exact function names, parameter names and the shape of each item (so the `SearchCandidate` mapping below uses real field names).

- [ ] **Step 2: Build the page**

  ```tsx
  "use client";

  import { useMemo } from "react";
  import { useSearchParams } from "next/navigation";
  import { useQuery } from "@tanstack/react-query";
  import { DataTable, EmptyState, ExplorerPage } from "@/design";
  import { getCleaningQueue, groupIntoBatches } from "@/lib/api/cleaning";
  import { getRules } from "@/lib/api/rules";
  import { getSystems } from "@/lib/api/connectivity";
  // import { getObjects } from "@/lib/api/objects"; — exact module confirmed in Step 1
  // import { getRuns } from "@/lib/api/runs"; — exact module confirmed in Step 1
  import { rankResults, type SearchCandidate } from "@/lib/search";
  import { queryKeys } from "@/lib/query-keys";

  export default function SearchPage() {
    const q = useSearchParams().get("q") ?? "";
    const rules = useQuery({ queryKey: queryKeys.rule("search", q), queryFn: () => getRules({ search: q }), enabled: !!q });
    const systems = useQuery({ queryKey: queryKeys.systems(), queryFn: getSystems });
    const batches = useQuery({ queryKey: queryKeys.batch("list"), queryFn: () => getCleaningQueue({ per_page: 500 }) });
    // const objects = useQuery({ queryKey: queryKeys.object("search", q), queryFn: () => getObjects({ search: q }) });
    // const runs = useQuery({ queryKey: queryKeys.run("search", q), queryFn: () => getRuns({ search: q }) });

    const candidates = useMemo<SearchCandidate[]>(() => {
      const out: SearchCandidate[] = [];
      for (const r of rules.data?.rules ?? []) out.push({ kind: "rule", id: r.id, label: r.name, href: `/rules/${r.id}` });
      for (const s of systems.data ?? []) out.push({ kind: "object", id: s.id, label: s.name, href: `/systems/${s.id}` });
      for (const b of groupIntoBatches(batches.data?.items ?? [])) out.push({ kind: "batch", id: b.batch_id, label: `Batch ${b.batch_id}`, href: `/fix/${b.batch_id}` });
      // push mapped objects/materials and runs once Step 1's modules are wired in
      return out;
    }, [rules.data, systems.data, batches.data]);

    const results = rankResults(q, candidates);
    const loading = rules.isLoading || systems.isLoading || batches.isLoading;

    return (
      <ExplorerPage title={q ? `Search: ${q}` : "Search"} loading={loading}>
        {results.length === 0 && !loading ? (
          <EmptyState title="No matches" description="Try an object id, a rule id, a batch id or a run id." />
        ) : (
          <DataTable
            mode="client"
            columns={[
              { accessorKey: "kind", header: "Type" },
              { accessorKey: "label", header: "Result" },
            ]}
            data={results}
            getRowId={(r) => `${r.kind}:${r.id}`}
            onRowClick={(r) => { window.location.href = r.href; }}
          />
        )}
      </ExplorerPage>
    );
  }
  ```

  Replace the commented object/run wiring with real calls using the exact function and field names found in Step 1 — do not ship the commented-out placeholders; they exist here only so this task's code block does not guess a name. Reconcile every `@/design` import against Task 2.

- [ ] **Step 3: Verify**

  Run: `npm run typecheck && npm run lint && npm test`
  Expected: pass.

- [ ] **Step 4: Commit**

  ```bash
  git add "frontend/app/(app)/search"
  git commit -m "$(cat <<'EOF'
  Add the global search page over objects, rules, systems, batches and runs

  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01NfZiWjz1L8g8HN5DaEsNW6
  EOF
  )"
  ```

---

### Task 19: `/mdm/glossary` and `/mdm/glossary/[id]` — business glossary

**Files:**
- Create: `frontend/app/(app)/mdm/glossary/page.tsx`, `frontend/app/(app)/mdm/glossary/[id]/page.tsx`
- Delete: `frontend/app/(dashboard)/glossary/page.tsx`, `frontend/app/(dashboard)/glossary/[id]/page.tsx`
- Modify: `next.config.ts` (add redirects, see Step 4)

**Interfaces:**
- Consumes: `getGlossaryTerms(params?)`, `getGlossaryTerm(id)`, `requestAIDraft`, `updateGlossaryTerm`, `reviewGlossaryTerm`, `batchLookupGlossary` from `frontend/lib/api/glossary.ts` (all confirmed present; exact param/return types are `GlossaryListResponse`, `GlossaryTermDetail`, `AIDraftResponse`, `BatchLookupResponse` from `@/types/api` — read those types before writing the columns/fields below).
- Produces: `/mdm/glossary` lists terms with `ExplorerPage` + `DataTable` (mode `"client"`, domain/status/mandatory-for-S4HANA/AI-drafted filters, search); `/mdm/glossary/[id]` is a `RecordPage` showing the term detail, the AI-draft action, and the review action.

- [ ] **Step 1: Read the legacy pages for exact field names**

  Read `frontend/app/(dashboard)/glossary/page.tsx` and `frontend/app/(dashboard)/glossary/[id]/page.tsx` fully before writing the new pages — copy every field name and action verbatim; do not guess what a `GlossaryTermDetail` looks like.

- [ ] **Step 2: Build `/mdm/glossary`**

  ```tsx
  "use client";

  import { useState } from "react";
  import { useQuery } from "@tanstack/react-query";
  import { DataTable, ExplorerPage, FilterBar } from "@/design";
  import { getGlossaryTerms } from "@/lib/api/glossary";
  import { queryKeys } from "@/lib/query-keys";
  import { useRouter } from "next/navigation";

  export default function GlossaryPage() {
    const router = useRouter();
    const [domain, setDomain] = useState<string | undefined>();
    const [status, setStatus] = useState<string | undefined>();
    const [search, setSearch] = useState("");
    const { data, isLoading, error } = useQuery({
      queryKey: queryKeys.glossary("list", { domain, status, search }),
      queryFn: () => getGlossaryTerms({ domain, status, search: search || undefined, per_page: 100 }),
    });

    return (
      <ExplorerPage title="Glossary" loading={isLoading} error={error}>
        <FilterBar
          search={search}
          onSearchChange={setSearch}
          filters={[
            { label: "Domain", value: domain, onChange: setDomain, options: [] /* populate from GlossaryListResponse facets once Step 1 confirms the shape */ },
            { label: "Status", value: status, onChange: setStatus, options: [] },
          ]}
        />
        <DataTable
          mode="client"
          columns={[
            { accessorKey: "term", header: "Term" },
            { accessorKey: "domain", header: "Domain" },
            { accessorKey: "status", header: "Status" },
            { accessorKey: "mandatory_for_s4hana", header: "S/4HANA mandatory" },
            { accessorKey: "ai_drafted", header: "AI drafted" },
          ]}
          data={data?.items ?? []}
          getRowId={(r) => r.id}
          onRowClick={(r) => router.push(`/mdm/glossary/${r.id}`)}
        />
      </ExplorerPage>
    );
  }
  ```

  Replace the empty `options: []` filter arrays and the `data?.items` accessor with the real field names found in Step 1 — `GlossaryListResponse`'s exact shape, not a guess.

- [ ] **Step 3: Build `/mdm/glossary/[id]`**

  Port every field, the AI-draft button (`requestAIDraft`) and the review action (`reviewGlossaryTerm`) from the legacy detail page into a `RecordPage`, using the exact mutation-wiring pattern (useMutation + `queryClient.invalidateQueries`) already established in Task 1's record fix sheet or Task 3's cleaning page — reconcile against whichever Task 2 confirms is the real `RecordPage` prop contract.

- [ ] **Step 4: Delete the legacy pages and add redirects**

  ```bash
  cd /Users/reshigan/Code/GONXT/Technology/Platforms/Meridian/Meridian_2/.claude/worktrees/redesign/frontend
  git rm "app/(dashboard)/glossary/page.tsx" "app/(dashboard)/glossary/[id]/page.tsx"
  ```
  Add to `next.config.ts`'s `redirects()` array:
  ```ts
  { source: "/glossary", destination: "/mdm/glossary", permanent: false },
  { source: "/glossary/:id", destination: "/mdm/glossary/:id", permanent: false },
  ```

- [ ] **Step 5: Verify**

  Run: `npm run typecheck && npm run lint && npm test` (from `frontend/`)
  Expected: pass.

- [ ] **Step 6: Commit**

  ```bash
  git add "frontend/app/(app)/mdm/glossary" next.config.ts
  git commit -m "$(cat <<'EOF'
  Rebuild the glossary as /mdm/glossary on the design system, retire the legacy page

  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01NfZiWjz1L8g8HN5DaEsNW6
  EOF
  )"
  ```

---

### Task 20: `/mdm/golden`, `/mdm/golden/[id]` and `/mdm/golden/merge` — golden records

**Files:**
- Create: `frontend/app/(app)/mdm/golden/page.tsx`, `frontend/app/(app)/mdm/golden/[id]/page.tsx`, `frontend/app/(app)/mdm/golden/merge/page.tsx`
- Delete: `frontend/app/(dashboard)/golden-records/page.tsx`, `frontend/app/(dashboard)/golden-records/[id]/page.tsx`, `frontend/app/(dashboard)/golden-records/[id]/merge/page.tsx`
- Modify: `next.config.ts`

**Interfaces:**
- Consumes: `getMasterRecords(params?)`, `getMasterRecord(id)`, `promoteMasterRecord(id, aiRecommendationAccepted?)`, `writebackMasterRecord(id)`, `getMasterRecordHistory(id)` from `frontend/lib/api/master-records.ts`; the legacy `[id]/page.tsx` also pulls `getRelationships` from `frontend/lib/api/relationships.ts` for the related-records panel — confirm this in Step 1 before dropping it.
- Produces: `/mdm/golden` lists master records (`ExplorerPage` + `DataTable`, confidence-range and domain/status filters); `/mdm/golden/[id]` is a `RecordPage` with promote/writeback actions and history; `/mdm/golden/merge` ports the legacy merge flow and links out to `/insights/duplicates` for candidate discovery (per the existing `/dedup` → `/insights/duplicates` redirect already in Task 31's map — do not re-implement duplicate discovery here).

- [ ] **Step 1: Read the three legacy pages fully**

  Read `frontend/app/(dashboard)/golden-records/page.tsx`, `.../[id]/page.tsx` and `.../[id]/merge/page.tsx`. Confirm whether `[id]/page.tsx` really imports `getRelationships` (grep: `grep -n "api/relationships" "frontend/app/(dashboard)/golden-records/[id]/page.tsx"`) and copy the merge flow's exact request/response fields.

- [ ] **Step 2: Build `/mdm/golden`**

  Follow the same `ExplorerPage` + `DataTable` pattern as Task 19 Step 2, with `getMasterRecords({ domain, status, min_confidence, max_confidence, page, per_page })` and columns for domain, status and confidence. Route `onRowClick` to `/mdm/golden/${id}`.

- [ ] **Step 3: Build `/mdm/golden/[id]`**

  Port the legacy detail view into a `RecordPage`: fields from `getMasterRecord`, a "Promote" button calling `promoteMasterRecord(id, aiRecommendationAccepted)`, a "Writeback" button calling `writebackMasterRecord(id)` (surface its returned `message` and `writeback_supported` flag — disable the button when `writeback_supported` is false, matching whatever the legacy page already does), a history table from `getMasterRecordHistory(id)`, and — if Step 1 confirmed it — the related-records panel from `getRelationships`.

- [ ] **Step 4: Build `/mdm/golden/merge`**

  Port the legacy merge page's field-by-field conflict resolution UI verbatim (same component shape, `@/design` primitives instead of `ui-core`/`aurora`). Keep its link to the duplicate-candidate list pointed at `/insights/duplicates`.

- [ ] **Step 5: Delete the legacy pages and add redirects**

  ```bash
  cd /Users/reshigan/Code/GONXT/Technology/Platforms/Meridian/Meridian_2/.claude/worktrees/redesign/frontend
  git rm "app/(dashboard)/golden-records/page.tsx" "app/(dashboard)/golden-records/[id]/page.tsx" "app/(dashboard)/golden-records/[id]/merge/page.tsx"
  ```
  ```ts
  { source: "/golden-records", destination: "/mdm/golden", permanent: false },
  { source: "/golden-records/:id", destination: "/mdm/golden/:id", permanent: false },
  { source: "/golden-records/:id/merge", destination: "/mdm/golden/merge", permanent: false },
  ```

- [ ] **Step 6: Verify**

  Run: `npm run typecheck && npm run lint && npm test`
  Expected: pass.

- [ ] **Step 7: Commit**

  ```bash
  git add "frontend/app/(app)/mdm/golden" next.config.ts
  git commit -m "$(cat <<'EOF'
  Rebuild golden records as /mdm/golden on the design system, retire the legacy pages

  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01NfZiWjz1L8g8HN5DaEsNW6
  EOF
  )"
  ```

---

### Task 21: `/mdm/match-rules` — match rules, folding the tuning and constraints tabs

**Files:**
- Create: `frontend/app/(app)/mdm/match-rules/page.tsx`
- Delete: `frontend/app/(dashboard)/match-rules/page.tsx`, `frontend/app/(dashboard)/match-rules/constraints/page.tsx`, `frontend/app/(dashboard)/match-rules/tuning/page.tsx`
- Modify: `next.config.ts`

**Interfaces:**
- Consumes: `getMatchRules(domain?, active?)`, `createMatchRule(body)`, `updateMatchRule(id, body)`, `deleteMatchRule(id)`, `simulateMatchRules(body)`, `getProposedRules(status?, domain?)`, `approveProposedRule(id)`, `rejectProposedRule(id)`, `submitAiFeedback(body)` from `frontend/lib/api/match-rules.ts` (the full set — all confirmed present).
- Produces: one `ExplorerPage` at `/mdm/match-rules` with three tabs — Rules (CRUD table), Constraints (the legacy `constraints/page.tsx` content), Tuning (the legacy `tuning/page.tsx` content, including AI-proposed rules review via `getProposedRules`/`approveProposedRule`/`rejectProposedRule`).

- [ ] **Step 1: Read all three legacy pages fully**

  Read `frontend/app/(dashboard)/match-rules/page.tsx`, `.../constraints/page.tsx` and `.../tuning/page.tsx`. Copy the exact `MatchRule`, `SimulationResult` and `AIProposedRulesListResponse` field names used in each (from `@/types/api`) — do not invent a column the legacy page doesn't have.

- [ ] **Step 2: Build the tabbed page**

  Structure as a single client component with a tab switcher (whatever primitive Task 2 confirms `@/design` exposes for in-page tabs — if none exists, use three `DataTable`s stacked under `SectionCard`-equivalent headers instead of inventing a tabs component). Rules tab: `DataTable` over `getMatchRules()` with create/edit/delete wired to `createMatchRule`/`updateMatchRule`/`deleteMatchRule`, and a "Simulate" button calling `simulateMatchRules({ domain })`. Constraints tab and Tuning tab: port their legacy content verbatim, including the AI-proposed-rules review list (approve/reject buttons) and the `submitAiFeedback` call on a steward decision.

- [ ] **Step 3: Delete the legacy pages and add redirects**

  ```bash
  cd /Users/reshigan/Code/GONXT/Technology/Platforms/Meridian/Meridian_2/.claude/worktrees/redesign/frontend
  git rm "app/(dashboard)/match-rules/page.tsx" "app/(dashboard)/match-rules/constraints/page.tsx" "app/(dashboard)/match-rules/tuning/page.tsx"
  ```
  ```ts
  { source: "/match-rules", destination: "/mdm/match-rules", permanent: false },
  { source: "/match-rules/constraints", destination: "/mdm/match-rules", permanent: false },
  { source: "/match-rules/tuning", destination: "/mdm/match-rules", permanent: false },
  ```

- [ ] **Step 4: Verify**

  Run: `npm run typecheck && npm run lint && npm test`
  Expected: pass.

- [ ] **Step 5: Commit**

  ```bash
  git add "frontend/app/(app)/mdm/match-rules" next.config.ts
  git commit -m "$(cat <<'EOF'
  Fold match rules, constraints and tuning into /mdm/match-rules on the design system

  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01NfZiWjz1L8g8HN5DaEsNW6
  EOF
  )"
  ```

---

### Task 22: `/insights/process` and `/insights/process/designer` — process readiness and the process designer

**Files:**
- Create: `frontend/app/(app)/insights/process/page.tsx`, `frontend/app/(app)/insights/process/designer/page.tsx`
- Delete: `frontend/app/(dashboard)/business-process/page.tsx`, `frontend/app/(dashboard)/process/page.tsx`, `frontend/app/(dashboard)/process/map.tsx`, `frontend/app/(dashboard)/process/designer/page.tsx`, `frontend/components/process/readiness.tsx`, `frontend/components/process/features.tsx`, `frontend/components/process/designer/` (its contents move into the new designer page/components, see Step 3)
- Modify: `next.config.ts`

**Interfaces:**
- `frontend/app/(dashboard)/business-process/page.tsx` and `frontend/app/(dashboard)/process/page.tsx` are both redirect shims onto `components/shell/workspace-hub.tsx`'s `id="process"` workspace; the actual readiness content is `frontend/components/process/readiness.tsx` (consumes `getBusinessProcess`, `getConfigImpact`, `getSystems` from `frontend/lib/api/connectivity.ts`, `getConfigAwareScore` from `frontend/lib/api/config-load.ts`, `getVersions` from `frontend/lib/api/versions.ts`, and renders `components/process/features.tsx`'s `FeaturesTable`) and the process-map content is `frontend/app/(dashboard)/process/map.tsx` (consumes `getMiningGraph` from `frontend/lib/api/process-mining.ts` and `getBusinessProcess` from `connectivity.ts`).
- The designer is `frontend/components/process/designer/page.tsx`'s `ProcessDesigner`, backed by every export in `frontend/lib/api/process-designer.ts` (`getReference`, `listModels`, `createModel`, `getModel`, `saveModel`, `patchModel`, `deleteModel`, `listModelVersions`, `getOverlay`, `listVariants`, `adoptVariant`, `signavioExportUrl`, `saveFailure`).
- Produces: `/insights/process` is a `ReportPage` with a Report sub-view (ported `readiness.tsx` content) and a Map sub-view (ported `process/map.tsx` content); `/insights/process/designer` ports `ProcessDesigner` onto `@/design` primitives, keeping its canvas/attributes/nodes/tree/versions/discovered sub-components (moved to `frontend/components/mdm-process-designer/` or kept under `frontend/components/process/designer/` if Task 2 confirms non-`@/design` component directories are still allowed to exist — only the top-level `page.tsx` wrapper is replaced, the canvas internals are logic, not legacy UI).

- [ ] **Step 1: Read every file named in Interfaces, fully**

  This task ports the most files of any task in this plan. Read `readiness.tsx`, `features.tsx`, `process/map.tsx` and `designer/page.tsx` (plus `designer/{canvas,attributes,nodes,tree,level-table,versions,discovered,doc,layout}.tsx|ts`) before writing anything. Copy every field name from `BusinessProcessL1`, `BusinessProcessL4`, `BusinessProcessL5Field`, `Version`, `ConfigImpactResult`, `MiningActivity`, `MiningVariant` (all from `@/types/api` or `process-mining.ts`) verbatim.

- [ ] **Step 2: Build `/insights/process`**

  Build a `ReportPage` with two sections (or tabs, per whatever `@/design` exposes — confirm in Task 2): "Readiness" ports `readiness.tsx`'s L1→L5 drill table and config-aware scoring, replacing `ui-core`'s `EmptyState`/`FilterBar`/`Mono`/`PageHeader`/`SectionCard`/`StatusBadge`/`TableSkeleton`/`Tally` with their `@/design` equivalents (confirm the exact equivalents in Task 2 — do not assume 1:1 naming); "Map" ports `process/map.tsx`'s graph view, replacing `ProcessGraph`/`ProcessGraphEmergence` (from `components/aurora`) with `@/design/charts`'s process/network chart (confirm the real chart component name in Task 2).

- [ ] **Step 3: Build `/insights/process/designer`**

  Port `ProcessDesigner` and its sub-components. The canvas/attributes/nodes/tree/level-table/versions/discovered files are logic plus low-level rendering, not `ui-core`/`aurora` components — grep them first (`grep -rln "components/aurora\|components/ui-core" frontend/components/process/designer/`) and replace only what matches; move the whole directory to live under `frontend/app/(app)/insights/process/designer/_components/` (or wherever Task 2's conventions put page-local components) so nothing is left under the deleted `frontend/components/process/` tree.

- [ ] **Step 4: Delete the legacy pages/components and add redirects**

  ```bash
  cd /Users/reshigan/Code/GONXT/Technology/Platforms/Meridian/Meridian_2/.claude/worktrees/redesign/frontend
  git rm "app/(dashboard)/business-process/page.tsx" "app/(dashboard)/process/page.tsx" "app/(dashboard)/process/map.tsx" "app/(dashboard)/process/designer/page.tsx"
  git rm components/process/readiness.tsx components/process/features.tsx
  git rm -r components/process/designer
  ```
  ```ts
  { source: "/business-process", destination: "/insights/process", permanent: false },
  { source: "/process", destination: "/insights/process", permanent: false },
  { source: "/process/designer", destination: "/insights/process/designer", permanent: false },
  ```

- [ ] **Step 5: Verify**

  Run: `npm run typecheck && npm run lint && npm test`
  Expected: pass.

- [ ] **Step 6: Commit**

  ```bash
  git add "frontend/app/(app)/insights/process" next.config.ts
  git commit -m "$(cat <<'EOF'
  Rebuild process readiness, map and designer as /insights/process(/designer) on the design system

  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01NfZiWjz1L8g8HN5DaEsNW6
  EOF
  )"
  ```

---

### Task 23: `/insights/lineage` — lineage and impact

**Files:**
- Create: `frontend/app/(app)/insights/lineage/page.tsx`
- Delete: `frontend/app/(dashboard)/lineage/page.tsx`, `frontend/components/process/lineage.tsx`
- Modify: `next.config.ts`

**Interfaces:**
- Consumes: `getLineageModel`, `getLineage(params)`, `getLineageImpact(versionId)`, `getBlastRadius(versionId, checkId)`, `getLineageGuards(params)` from `frontend/lib/api/lineage.ts`. **Naming collision:** `frontend/lib/api/contracts.ts` also exports a function named `getLineage` (Task 26 uses it) — when both modules are imported in the same file, alias one, e.g. `import { getLineage as getLineageGraph } from "@/lib/api/lineage"`. This page only needs `lineage.ts`'s version, so the collision matters only if a later shared component imports both.
- Produces: `/insights/lineage` ports `components/process/lineage.tsx`'s node/edge graph, impact table and blast-radius/guard views onto `@/design`, replacing `ProcessGraph`/`ProcessGraphEmergence` (from `components/aurora`) the same way Task 22 does.

- [ ] **Step 1: Read the legacy component fully**

  Read `frontend/components/process/lineage.tsx` and `frontend/app/(dashboard)/lineage/page.tsx` (the latter is a one-line redirect shim onto the Process workspace's lineage tab — confirm this with `cat` before assuming there's more to port). Copy every field name from `LineageGraph`, `LineageImpact`, `BlastRadius`, `LineageGuards` (all exported from `lineage.ts`) verbatim.

- [ ] **Step 2: Build the page**

  Port the graph (replacing the aurora `ProcessGraph`/`ProcessGraphEmergence` with the `@/design/charts` equivalent confirmed in Task 2), the impact table (`ImpactRow[]` from `getLineageImpact`), and the blast-radius/guard panels (`getBlastRadius`, `getLineageGuards`), inside a `ReportPage`. Use `useLatestVersion` from `frontend/components/process/shared.ts` if Task 2 confirms that hook still has a home outside the deleted `components/process/` tree — otherwise inline its logic (it is a small hook; read it first).

- [ ] **Step 3: Delete the legacy files and add the redirect**

  ```bash
  cd /Users/reshigan/Code/GONXT/Technology/Platforms/Meridian/Meridian_2/.claude/worktrees/redesign/frontend
  git rm "app/(dashboard)/lineage/page.tsx" components/process/lineage.tsx
  ```
  ```ts
  { source: "/lineage", destination: "/insights/lineage", permanent: false },
  ```

- [ ] **Step 4: Verify**

  Run: `npm run typecheck && npm run lint && npm test`
  Expected: pass.

- [ ] **Step 5: Commit**

  ```bash
  git add "frontend/app/(app)/insights/lineage" next.config.ts
  git commit -m "$(cat <<'EOF'
  Rebuild lineage and impact as /insights/lineage on the design system

  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01NfZiWjz1L8g8HN5DaEsNW6
  EOF
  )"
  ```

---

### Task 24: `/insights/mining` — pattern mining, folding the relationships graph

**Files:**
- Create: `frontend/app/(app)/insights/mining/page.tsx`
- Delete: `frontend/app/(dashboard)/mining/page.tsx`, `frontend/app/(dashboard)/relationships/page.tsx`, `frontend/components/process/graph.tsx`
- Modify: `next.config.ts`

**Interfaces:**
- Consumes: `getMiningSummary(windowDays?)`, `getMiningPatterns(params?)`, `getMiningRuns(limit?)`, `isMiningAvailable(summary)` from `frontend/lib/api/mining.ts`; `getRelationships(params?)`, `getRelationshipTypes()` from `frontend/lib/api/relationships.ts`; `components/process/graph.tsx` additionally pulls `getVersionProfile` from `lib/api/field-profile.ts`, `getSystemVersions` from `lib/api/system-objects.ts` and `getSystems` from `lib/api/systems.ts` — confirm all three still exist with those names in Step 1.
- Produces: `/insights/mining` ports `components/process/graph.tsx` verbatim onto `@/design`: both legacy routes (`/mining` and `/relationships`) already redirect into this same workspace tab (one with a `lens=patterns` query param selecting the mining view, the other with none selecting the relationships view) — the new page keeps that single-page, query-param-selected-view behaviour rather than splitting into two pages, since that is what the legacy shim pages already established as the real UX.

- [ ] **Step 1: Read the legacy component and confirm the three extra wrappers**

  Read `frontend/components/process/graph.tsx` fully. Run `grep -n "^export" frontend/lib/api/field-profile.ts frontend/lib/api/system-objects.ts frontend/lib/api/systems.ts` to confirm `getVersionProfile`, `getSystemVersions` and `getSystems` are the exact names still exported (this plan's earlier tasks may have touched `systems.ts`'s shape — check Task 7/8 first).

- [ ] **Step 2: Build the page**

  Port `graph.tsx`'s table/graph views (patterns from `getMiningPatterns`/`getMiningSummary`, relationships from `getRelationships`) onto a `ReportPage` + `DataTable`, replacing `Tally` (from `components/ui-core`) with its `@/design` equivalent. Read the `lens` search param (`useUrlState`, already used by the legacy component — confirm it is still the real hook name) to pick the patterns view vs. the relationships view, matching the legacy behaviour exactly.

- [ ] **Step 3: Delete the legacy files and add redirects**

  ```bash
  cd /Users/reshigan/Code/GONXT/Technology/Platforms/Meridian/Meridian_2/.claude/worktrees/redesign/frontend
  git rm "app/(dashboard)/mining/page.tsx" "app/(dashboard)/relationships/page.tsx" components/process/graph.tsx
  ```
  ```ts
  { source: "/mining", destination: "/insights/mining", permanent: false },
  { source: "/relationships", destination: "/insights/mining", permanent: false },
  ```

- [ ] **Step 4: Verify**

  Run: `npm run typecheck && npm run lint && npm test`
  Expected: pass.

- [ ] **Step 5: Commit**

  ```bash
  git add "frontend/app/(app)/insights/mining" next.config.ts
  git commit -m "$(cat <<'EOF'
  Fold pattern mining and relationships into /insights/mining on the design system

  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01NfZiWjz1L8g8HN5DaEsNW6
  EOF
  )"
  ```

---

### Task 25: `/insights/forecast` — DQS forecast and early warnings

**Files:**
- Create: `frontend/app/(app)/insights/forecast/page.tsx`
- Delete: `frontend/app/(dashboard)/analytics/page.tsx`
- Modify: `next.config.ts`

**Interfaces:**
- Consumes: `getPredictiveAnalytics(params?)` returning `PredictiveResponse` (`{ forecast: DqsForecast; early_warnings: EarlyWarning[] }` per the `DqsForecast`/`EarlyWarning`/`PredictiveResponse` interfaces in `frontend/lib/api/analytics.ts`) — confirm `getPredictiveAnalytics`'s exact param names in Step 1 (not shown in the export signature at a glance; read the full function).
- Produces: `/insights/forecast` is a `ReportPage` with a forecast chart (`@/design/charts`) over `DqsForecast` and an early-warnings table over `EarlyWarning[]`.

- [ ] **Step 1: Read the legacy page and the full `getPredictiveAnalytics` signature**

  Read `frontend/app/(dashboard)/analytics/page.tsx` fully and `frontend/lib/api/analytics.ts` lines around `getPredictiveAnalytics` (not just its export line) to get its parameter object's exact field names.

- [ ] **Step 2: Build the page**

  ```tsx
  "use client";

  import { useQuery } from "@tanstack/react-query";
  import { ReportPage } from "@/design";
  import { getPredictiveAnalytics } from "@/lib/api/analytics";
  import { queryKeys } from "@/lib/query-keys";

  export default function ForecastPage() {
    const { data, isLoading, error } = useQuery({
      queryKey: queryKeys.analytics("forecast"),
      queryFn: () => getPredictiveAnalytics(),
    });

    return (
      <ReportPage title="DQS forecast" loading={isLoading} error={error}>
        {/* forecast chart over data?.forecast, early-warnings table over data?.early_warnings —
            wire the exact chart component and table columns to DqsForecast/EarlyWarning's
            real fields once Step 1 confirms them; this plan does not invent field names. */}
      </ReportPage>
    );
  }
  ```

  Replace the comment with the real chart/table once Step 1's field names are confirmed — do not ship the placeholder comment.

- [ ] **Step 3: Delete the legacy page and add the redirect**

  ```bash
  cd /Users/reshigan/Code/GONXT/Technology/Platforms/Meridian/Meridian_2/.claude/worktrees/redesign/frontend
  git rm "app/(dashboard)/analytics/page.tsx"
  ```
  ```ts
  { source: "/analytics", destination: "/insights/forecast", permanent: false },
  ```

- [ ] **Step 4: Verify**

  Run: `npm run typecheck && npm run lint && npm test`
  Expected: pass.

- [ ] **Step 5: Commit**

  ```bash
  git add "frontend/app/(app)/insights/forecast" next.config.ts
  git commit -m "$(cat <<'EOF'
  Rebuild the DQS forecast as /insights/forecast on the design system

  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01NfZiWjz1L8g8HN5DaEsNW6
  EOF
  )"
  ```

---

### Task 26: `/rules/contracts` — data contracts

**Files:**
- Create: `frontend/app/(app)/rules/contracts/page.tsx`
- Delete: `frontend/app/(dashboard)/contracts/page.tsx`
- Modify: `next.config.ts`

**Interfaces:**
- Consumes: `getContracts(params?)`, `createContract(body)`, `updateContract(id, body)`, `activateContract(id)`, `getContractCompliance(id)`, `getLineage(params)` from `frontend/lib/api/contracts.ts`. **Naming collision:** this module's `getLineage` is a different function from `frontend/lib/api/lineage.ts`'s `getLineage` used by Task 23 — if this page needs both (e.g. linking a contract to its lineage view), alias the import: `import { getLineage as getContractLineage } from "@/lib/api/contracts"`.
- Produces: `/rules/contracts` lists contracts (`ExplorerPage` + `DataTable`), with create/activate actions and a compliance panel per contract (`getContractCompliance`).

- [ ] **Step 1: Read the legacy page and confirm the exact param/body shapes**

  Read `frontend/app/(dashboard)/contracts/page.tsx` fully. Run `grep -n "createContract\|updateContract\|activateContract\|getContractCompliance" -A5 frontend/lib/api/contracts.ts` to get the exact body/param field names for each call.

- [ ] **Step 2: Build the page**

  Port the legacy list/create/activate/compliance UI onto `ExplorerPage` + `DataTable`, following the same create/edit-mutation pattern used in Task 21's match rules. Use `getLineage` from `contracts.ts` only if the legacy page actually links a contract's lineage inline (confirm in Step 1) — if it just links out to `/insights/lineage`, do not call `getLineage` here at all.

- [ ] **Step 3: Delete the legacy page and add the redirect**

  ```bash
  cd /Users/reshigan/Code/GONXT/Technology/Platforms/Meridian/Meridian_2/.claude/worktrees/redesign/frontend
  git rm "app/(dashboard)/contracts/page.tsx"
  ```
  ```ts
  { source: "/contracts", destination: "/rules/contracts", permanent: false },
  ```

- [ ] **Step 4: Verify**

  Run: `npm run typecheck && npm run lint && npm test`
  Expected: pass.

- [ ] **Step 5: Commit**

  ```bash
  git add "frontend/app/(app)/rules/contracts" next.config.ts
  git commit -m "$(cat <<'EOF'
  Rebuild data contracts as /rules/contracts on the design system

  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01NfZiWjz1L8g8HN5DaEsNW6
  EOF
  )"
  ```

---

### Task 27: `/rules/scoring` — DQS weights and alert thresholds

**Files:**
- Create: `frontend/app/(app)/rules/scoring/page.tsx`
- Delete: `frontend/app/(dashboard)/settings/scoring/page.tsx`
- Modify: `next.config.ts`

**Interfaces:**
- Consumes: `getSettings()` returning `TenantSettings`, `updateDqsWeights(...)`, `updateAlertThresholds(thresholds: AlertThresholds)` from `frontend/lib/api/settings.ts` — read `updateDqsWeights`'s full signature (its export line alone doesn't show the parameter shape) before writing the form.
- Produces: `/rules/scoring` is a `RecordPage`-shaped settings form: DQS weight sliders/inputs and alert-threshold inputs, saved via the two mutations above.

- [ ] **Step 1: Read the legacy page and `updateDqsWeights`'s full signature**

  Read `frontend/app/(dashboard)/settings/scoring/page.tsx` fully and `frontend/lib/api/settings.ts` lines 9-18 to get `updateDqsWeights`'s exact parameter shape and `AlertThresholds`'s fields (from `@/types/api`).

- [ ] **Step 2: Build the page**

  Port the legacy weight/threshold form fields verbatim onto `@/design` form primitives, with a single "Save" mutation calling `updateDqsWeights` and `updateAlertThresholds` (matching however the legacy page sequences the two calls — confirm in Step 1 whether they are one submit or two separate sections with separate saves).

- [ ] **Step 3: Delete the legacy page and add the redirect**

  ```bash
  cd /Users/reshigan/Code/GONXT/Technology/Platforms/Meridian/Meridian_2/.claude/worktrees/redesign/frontend
  git rm "app/(dashboard)/settings/scoring/page.tsx"
  ```
  ```ts
  { source: "/settings/scoring", destination: "/rules/scoring", permanent: false },
  ```

- [ ] **Step 4: Verify**

  Run: `npm run typecheck && npm run lint && npm test`
  Expected: pass.

- [ ] **Step 5: Commit**

  ```bash
  git add "frontend/app/(app)/rules/scoring" next.config.ts
  git commit -m "$(cat <<'EOF'
  Rebuild DQS scoring and alert thresholds as /rules/scoring on the design system

  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01NfZiWjz1L8g8HN5DaEsNW6
  EOF
  )"
  ```

---

### Task 28: `/admin/billing` — exception billing

**Files:**
- Create: `frontend/app/(app)/admin/billing/page.tsx`
- Delete: `frontend/app/(dashboard)/settings/exception-billing/page.tsx`
- Modify: `next.config.ts`

**Interfaces:**
- Consumes: `getExceptionBilling(...)` from `frontend/lib/api/exceptions.ts` (line 141 — read its full signature; the export line alone doesn't show the parameters).
- Produces: `/admin/billing` is a `ReportPage` showing the exception-billing breakdown, ported verbatim from the legacy page.

- [ ] **Step 1: Read the legacy page and `getExceptionBilling`'s full signature**

  Read `frontend/app/(dashboard)/settings/exception-billing/page.tsx` fully and `frontend/lib/api/exceptions.ts` from line 141 to its end to get the exact parameter and return shape.

- [ ] **Step 2: Build the page**

  Port the legacy billing table/summary onto `ReportPage` + `DataTable`, using the real field names from Step 1.

- [ ] **Step 3: Delete the legacy page and add the redirect**

  ```bash
  cd /Users/reshigan/Code/GONXT/Technology/Platforms/Meridian/Meridian_2/.claude/worktrees/redesign/frontend
  git rm "app/(dashboard)/settings/exception-billing/page.tsx"
  ```
  ```ts
  { source: "/settings/exception-billing", destination: "/admin/billing", permanent: false },
  ```

- [ ] **Step 4: Verify**

  Run: `npm run typecheck && npm run lint && npm test`
  Expected: pass.

- [ ] **Step 5: Commit**

  ```bash
  git add "frontend/app/(app)/admin/billing" next.config.ts
  git commit -m "$(cat <<'EOF'
  Rebuild exception billing as /admin/billing on the design system

  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01NfZiWjz1L8g8HN5DaEsNW6
  EOF
  )"
  ```

---

### Task 29: `/inbox?kind=exception` — fold exceptions and notifications into the inbox and job tray

**Files:**
- Modify: `frontend/app/(app)/inbox/page.tsx` (Task 5's page — add the `kind=exception` filter), `frontend/design/shell/JobTray.tsx` or wherever Task 2 confirms `JobTray` really lives (add a notifications feed)
- Delete: `frontend/app/(dashboard)/exceptions/page.tsx`, `frontend/app/(dashboard)/exceptions/rules/page.tsx`
- Modify: `next.config.ts`

**Interfaces:**
- Consumes: `getExceptions(params)`, `getException(id)`, `createException(body)`, `assignException(...)`, `escalateException(...)`, `resolveException(...)`, `addComment(...)`, `getSAPMonitor()`, `getExceptionRules()`, `createExceptionRule(body)`, `updateExceptionRule(...)`, `getExceptionMetrics(...)` from `frontend/lib/api/exceptions.ts`; `getNotifications(params?)`, `markNotificationRead(id)`, `markAllNotificationsRead()`, `getUnreadCount()` from `frontend/lib/api/notifications.ts`.
- Produces: `/inbox?kind=exception` extends Task 5's inbox with an exception item kind, reconciling the exception shape with the stewardship queue-item shape (see Step 1); `/rules` (Task 11) gains the exception-rules management UI (ported from `exceptions/rules/page.tsx`); the shell's job tray (and/or the inbox's unread badge) is wired to `getUnreadCount`/`getNotifications`/`markNotificationRead`/`markAllNotificationsRead` instead of the retired `/notifications` page.

- [ ] **Step 1: Read Task 5's inbox page and the two legacy exception pages, reconcile shapes**

  Read `frontend/app/(app)/inbox/page.tsx` as it stands after Task 5, and `frontend/app/(dashboard)/exceptions/page.tsx` plus `.../exceptions/rules/page.tsx`. Write down how an `Exception` (from `getExceptions`) differs from the stewardship queue item Task 5 already renders — same severity/status vocabulary or not, same assignee field name or not. This reconciliation is the actual work of this task; do not just bolt a second unrelated table onto the inbox page.

- [ ] **Step 2: Extend the inbox for `kind=exception`**

  Add a `kind` search param (`exception` | existing default) to `/inbox`. When `kind=exception`, fetch with `getExceptions(params)` instead of the stewardship queue call, mapping each `Exception` onto the same row shape the inbox already renders (assign/escalate/resolve actions call `assignException`/`escalateException`/`resolveException` instead of the stewardship equivalents) — reuse the existing `DataTable` columns and row-action wiring, only swap the data source and the three mutations.

- [ ] **Step 3: Move exception-rules management into `/rules`**

  Port `exceptions/rules/page.tsx`'s rule-management UI (`getExceptionRules`, `createExceptionRule`, `updateExceptionRule`) into Task 11's `/rules` page as an additional section or filter, matching however Task 11 structured its rule list.

- [ ] **Step 4: Wire the job tray / unread badge to notifications**

  In whichever file Task 2 confirms is the real `JobTray` component (or the inbox page's header badge, if that is where unread count already renders per Task 5), replace any remaining reference to `/notifications` with `getUnreadCount()` for the badge and `getNotifications()`/`markNotificationRead`/`markAllNotificationsRead` for the dropdown/panel content — grep first: `grep -rn "/notifications\"" frontend/app frontend/design 2>/dev/null`.

- [ ] **Step 5: Delete the legacy pages and add redirects**

  ```bash
  cd /Users/reshigan/Code/GONXT/Technology/Platforms/Meridian/Meridian_2/.claude/worktrees/redesign/frontend
  git rm "app/(dashboard)/exceptions/page.tsx" "app/(dashboard)/exceptions/rules/page.tsx"
  ```
  ```ts
  { source: "/exceptions", destination: "/inbox?kind=exception", permanent: false },
  { source: "/exceptions/rules", destination: "/rules", permanent: false },
  { source: "/notifications", destination: "/inbox", permanent: false },
  ```

- [ ] **Step 6: Verify**

  Run: `npm run typecheck && npm run lint && npm test`
  Expected: pass, including Task 5's existing `inbox-keyboard.test.ts`.

- [ ] **Step 7: Commit**

  ```bash
  git add "frontend/app/(app)/inbox" "frontend/app/(app)/rules" frontend/design next.config.ts
  git commit -m "$(cat <<'EOF'
  Fold exceptions into the inbox, exception rules into /rules, and notifications into the job tray

  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01NfZiWjz1L8g8HN5DaEsNW6
  EOF
  )"
  ```

---

### Task 30: Rail — add the MDM section to the nav

**Files:**
- Modify: `frontend/lib/nav.ts`

**Interfaces:**
- Consumes: nothing new — this task only restructures `NAV_GROUPS`, `OFF_NAV_TITLES` and the existing item list.
- Produces: `NAV_GROUPS` gains a group named `"MDM"`, inserted between `"Fix"` and whichever group now contains `/inbox` (Task 5's inbox item currently sits inside `"Fix"` as `"Steward inbox"` at `/workbench` — leave that item where it is; this task only adds the new group, it does not relocate `/inbox`, since the spec's instruction is "the rail gains an MDM section," not a full group reorder, and a full reorder of Fix/Inbox/Insights/Systems/Rules/Admin group order is out of this plan's stated scope — flag this explicitly in the commit message and in this plan's Self-Review so a future wave can finish the reorder if the product wants the rail's group order to literally match the spec's "Home, Objects, Runs, Fix, Inbox, Insights, Systems, Rules, Admin" list).

- [ ] **Step 1: Read `frontend/lib/nav.ts` in full**

  Confirm the current `"Master data"` group (Golden records, Glossary, Contracts, Relationships) and the current `"Process and impact"` group, since both are superseded by Tasks 19-26's new routes.

- [ ] **Step 2: Replace the `"Master data"` group with a new `"MDM"` group, insert it after `"Fix"`**

  ```ts
  {
    group: "Fix",
    anyOf: ["approve", "apply", "assign", "mdm.write", "review_ai_rules"],
    items: [
      { href: "/workbench", label: "Steward inbox", icon: ClipboardIcon, licenceKey: "stewardship", anyOf: ["approve", "apply", "assign"], keywords: "workbench queue triage tasks stewardship steward team assign sla metrics" },
      { href: "/cleaning", label: "Cleaning", icon: Eraser, anyOf: ["approve", "apply"], keywords: "corrections proposals apply" },
      { href: "/exceptions", label: "Exceptions", icon: ShieldAlert, anyOf: ["approve", "assign"], keywords: "escalate sla" },
      { href: "/dedup", label: "Duplicates", icon: Copy, anyOf: ["approve", "mdm.write"], keywords: "dedup merge match" },
      { href: "/ai/rules", label: "AI rule review", icon: SparklesNavIcon, anyOf: ["review_ai_rules"], keywords: "ai rules propose" },
    ],
  },
  {
    group: "MDM",
    items: [
      { href: "/mdm/golden", label: "Golden records", icon: DatabaseIcon, keywords: "master mdm" },
      { href: "/mdm/glossary", label: "Glossary", icon: BookIcon, keywords: "terms business" },
      { href: "/mdm/match-rules", label: "Match rules", icon: Sliders, keywords: "tuning constraints" },
    ],
  },
  ```
  Update the `"Fix"` group's `"Exceptions"` item href to match whatever Task 29 lands on (`/inbox?kind=exception` if the nav item should jump straight to the filtered view — confirm against Task 29's final route shape; do not leave it pointing at the deleted `/exceptions`).

  Remove `"Contracts"` and `"Relationships"` from the old `"Master data"` group entirely: `"Contracts"` moves to a `"Rules"`-labelled group (add one, or extend an existing rules-labelled group if Task 11 already created one — confirm against Task 11's final nav wiring before deciding) pointing at `/rules/contracts`; `"Relationships"` is dropped as a standalone nav item since Task 24 folds it into `/insights/mining`, which is reached via the `"Process and impact"` group's existing `"Pattern mining"` item once its href is updated (see Step 3).

- [ ] **Step 3: Update the `"Process and impact"` group's hrefs**

  ```ts
  {
    group: "Process and impact",
    items: [
      { href: "/insights/process", label: "Process readiness", icon: Route, keywords: "l1 l5 business process ptp otc process map" },
      { href: "/insights/process/designer", label: "Process designer", icon: Route, keywords: "designer bpmn model edit l1 l5" },
      { href: "/insights/lineage", label: "Lineage and impact", icon: Network, keywords: "lineage downstream kpi blast radius guards" },
      { href: "/insights/mining", label: "Pattern mining", icon: Pickaxe, keywords: "patterns clustering relationships graph" },
    ],
  },
  ```
  Drop the old separate `"Process map"` item (`/process`) since Task 22 folds it into `/insights/process`.

- [ ] **Step 4: Add a `"Scoring"` item wherever the rules-labelled group ends up, update `OFF_NAV_TITLES`**

  Add `{ href: "/rules/scoring", label: "Scoring and alerts", icon: Sliders, anyOf: ["view"], keywords: "weights thresholds" }` to the same rules-labelled group Step 2 put `"Contracts"` in (or its own entry if Task 11's group doesn't fit it — judgment call, confirm against Task 11's final shape first). Remove the now-stale entries from `OFF_NAV_TITLES`: `"/match-rules"`, `"/match-rules/tuning"`, `"/match-rules/constraints"`, `"/settings/exception-billing"`, `"/settings/scoring"`, `"/exceptions/rules"`, `"/notifications"` (all now either real nav items or redirects covered by `PAGE_TITLES`' redirect-destination entries instead).

- [ ] **Step 5: Verify**

  Run: `npm run typecheck && npm run lint && npm test` (from `frontend/`)
  Expected: pass, including any nav-snapshot test if one exists (`grep -rln "NAV_GROUPS" frontend/__tests__ frontend/lib/__tests__ 2>/dev/null` — update it if found rather than letting it fail).

- [ ] **Step 6: Commit**

  ```bash
  git add frontend/lib/nav.ts
  git commit -m "$(cat <<'EOF'
  Add the MDM rail section, repoint Process/Rules nav items at their new routes

  Does not reorder the top-level group order to literally match spec section
  3.2's rail list (Home, Objects, Runs, Fix, Inbox, Insights, Systems, Rules,
  Admin) — only inserts MDM after Fix, per the spec's explicit instruction.
  A full group-order pass is left for a future wave if the product wants it.

  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01NfZiWjz1L8g8HN5DaEsNW6
  EOF
  )"
  ```

---

### Task 31: Retirement — delete the legacy shell, redirect every orphaned route, empty the lint allowlist

This is the biggest single task because it is the Wave 3 exit criterion (spec section 12). Do it last, after Tasks 1–30 have removed everything that has a direct replacement.

**Files:**
- Delete: `frontend/app/(dashboard)/` (everything remaining in it after Tasks 3–16's deletions — list it first, see Step 1), `frontend/components/aurora/`, `frontend/components/ui-core/`, `frontend/components/shell/`, `frontend/lib/aurora/`, `frontend/app/styles/aurora.css`, `frontend/app/styles/ui-core.css`, `frontend/lib/workspaces.ts`, `frontend/e2e/aurora-visual.spec.ts` and `frontend/e2e/aurora-visual.spec.ts-snapshots/`
- Modify: `next.config.ts` (redirect map), `frontend/app/globals.css` (strip `.vx-card`, `.vx-glass`, `--mn-*`, `--glass-*`), `frontend/scripts/lint-tokens.allow.txt` (emptied), `frontend/scripts/lint-tokens.mjs` (`TOKEN_FILES` repointed at `frontend/design/tokens.css` only, per spec section 3.4 — confirm `design/tokens.css` is the real path from Task 2 first), `frontend/DESIGN.md` (rewritten from spec section 4), `CLAUDE.md` ("Frontend design system" section rewritten to match)
- Test: a grep-based check (Step 5) asserting no remaining import from the retired directories.

**Interfaces:**
- Consumes: nothing new.
- Produces: `npm run build` passes with `app/(dashboard)` gone; `npm run lint:tokens` passes with an empty allowlist; every pre-Wave-3 route either renders under `(app)` or 30x-redirects.

- [ ] **Step 1: List what is left under `app/(dashboard)`**

  Run: `find frontend/app/"(dashboard)" -name page.tsx | sort`
  Cross this list against the routes already handled in Tasks 3–16 (fix/cleaning, inbox/workbench, systems×3, import/upload, rules/settings-rules, admin×2, admin/triage, settings×4, settings page) and against the routes deleted in Tasks 19–30 (glossary, golden-records, match-rules, business-process/process/designer, lineage, mining/relationships, analytics, contracts, settings/scoring, settings/exception-billing, exceptions/notifications). Every page.tsx still listed needs either a Task 1–30 page it maps to (it shouldn't — those are done) or a redirect destination below. If anything is still listed that this plan has not touched and is not a known orphan from the map in Step 2, stop and flag it — do not delete a page this plan never accounted for without a redirect.

- [ ] **Step 2: Write the full redirect map**

  Spec section 3.1's fold table names an exact destination for every legacy route Wave 3 touches. Tasks 19–30 already added the redirects for the routes they rebuilt; this step collects the full map in one place, including the routes Wave 3 only redirects (because their destination is a Wave 1/2-owned hub, not a Wave 3 page: `/migration`, `/versions`, `/reports`):

  ```ts
  async redirects() {
    return [
      // Already-rebuilt 1:1 routes (collapse old path onto the new one)
      { source: "/stewardship", destination: "/inbox", permanent: false },
      { source: "/stewardship/metrics", destination: "/inbox", permanent: false },
      { source: "/workbench", destination: "/inbox", permanent: false },
      { source: "/workbench/triage", destination: "/inbox", permanent: false },
      { source: "/workbench/progress", destination: "/inbox", permanent: false },
      { source: "/workbench/report", destination: "/inbox", permanent: false },
      { source: "/workbench/record/:issueId", destination: "/inbox", permanent: false },
      { source: "/cleaning", destination: "/fix", permanent: false },
      { source: "/upload", destination: "/import", permanent: false },
      { source: "/settings/rules", destination: "/rules", permanent: false },
      { source: "/settings/field-mapping", destination: "/admin/mappings", permanent: false },
      { source: "/settings/ai", destination: "/admin/ai", permanent: false },
      { source: "/settings/licence", destination: "/admin/licence", permanent: false },
      { source: "/settings", destination: "/admin/settings", permanent: false },
      { source: "/admin", destination: "/admin/users", permanent: false },
      { source: "/systems/:id/pilot", destination: "/systems/:id", permanent: false },
      { source: "/systems/:id/versions/:versionId/profile", destination: "/systems/:id", permanent: false },
      { source: "/data", destination: "/systems", permanent: false },
      { source: "/sync", destination: "/systems", permanent: false },
      { source: "/run-sync", destination: "/systems", permanent: false },
      { source: "/connectivity", destination: "/systems", permanent: false },
      { source: "/executive-report", destination: "/insights/exec", permanent: false },
      { source: "/config-impact", destination: "/insights/impact", permanent: false },
      { source: "/dedup", destination: "/insights/duplicates", permanent: false },
      { source: "/findings", destination: "/objects", permanent: false },
      { source: "/issues", destination: "/inbox", permanent: false },
      { source: "/ai/rules", destination: "/rules", permanent: false },
      // Exact spec section 3.1 fold-table mapping (Tasks 19–30 build the new page and add
      // these same lines; repeated here so the full map lives in one place for Step 1's cross-check)
      { source: "/glossary", destination: "/mdm/glossary", permanent: false },
      { source: "/glossary/:id", destination: "/mdm/glossary/:id", permanent: false },
      { source: "/golden-records", destination: "/mdm/golden", permanent: false },
      { source: "/golden-records/:id", destination: "/mdm/golden/:id", permanent: false },
      { source: "/golden-records/:id/merge", destination: "/mdm/golden/merge", permanent: false },
      { source: "/match-rules", destination: "/mdm/match-rules", permanent: false },
      { source: "/match-rules/tuning", destination: "/mdm/match-rules", permanent: false },
      { source: "/match-rules/constraints", destination: "/mdm/match-rules", permanent: false },
      { source: "/business-process", destination: "/insights/process", permanent: false },
      { source: "/process", destination: "/insights/process", permanent: false },
      { source: "/process/designer", destination: "/insights/process/designer", permanent: false },
      { source: "/lineage", destination: "/insights/lineage", permanent: false },
      { source: "/mining", destination: "/insights/mining", permanent: false },
      { source: "/relationships", destination: "/insights/mining", permanent: false },
      { source: "/analytics", destination: "/insights/forecast", permanent: false },
      { source: "/contracts", destination: "/rules/contracts", permanent: false },
      { source: "/settings/scoring", destination: "/rules/scoring", permanent: false },
      { source: "/settings/exception-billing", destination: "/admin/billing", permanent: false },
      { source: "/exceptions", destination: "/inbox?kind=exception", permanent: false },
      { source: "/exceptions/rules", destination: "/rules", permanent: false },
      { source: "/notifications", destination: "/inbox", permanent: false },
      // /command-centre's live-operations content is ported into /home/basis (Step 2a below),
      // not just redirected — but the redirect still exists for anyone with the old URL bookmarked.
      { source: "/command-centre", destination: "/home/basis", permanent: false },
      // Destination is a Wave 1/2-owned hub: Wave 3 only redirects, it does not build this page.
      { source: "/migration", destination: "/insights/readiness", permanent: false },
      { source: "/versions", destination: "/runs", permanent: false },
      { source: "/reports", destination: "/insights", permanent: false },
    ];
  },
  ```

  Delete the old `/stewardship` entries this replaces rather than duplicating `source` keys, and delete the now-superseded `/command-centre` → `/home`, `/notifications` → `/home`, `/analytics` → `/insights`, `/match-rules*` → `/rules`, `/settings/scoring` → `/rules`, `/settings/exception-billing` → `/admin/licence`, `/exceptions` → `/inbox`, and the entire `/objects`-fallback block for glossary/golden-records/process/lineage/mining/relationships/migration/contracts that an earlier draft of this plan used before the spec's fold table resolved their real destinations.

- [ ] **Step 2a: Port `/command-centre`'s live-operations content into `/home/basis`**

  `/home/basis` is owned by a sibling Wave 1/2 plan. Before porting anything, check whether it already exists in this worktree: `find frontend/app -path "*home/basis*"`. If it exists, read it fully, then port `/command-centre`'s live-operations panel (read `frontend/app/(dashboard)/command-centre/page.tsx` first) into it as an additional section, reconciling any overlapping data sources rather than duplicating a fetch. If `/home/basis` does not exist yet in this worktree, do not invent it — leave the `/command-centre` → `/home/basis` redirect in place (it will 404 until the sibling plan lands `/home/basis`), note this explicitly in the commit message, and flag it in this plan's Self-Review as a sequencing dependency on the Wave 1/2 plan, not a Wave 3 gap.

- [ ] **Step 3: Delete every remaining `(dashboard)` page, Aurora, ui-core, shell, legacy styles and `workspaces.ts`**

  ```bash
  cd /Users/reshigan/Code/GONXT/Technology/Platforms/Meridian/Meridian_2/.claude/worktrees/redesign/frontend
  git rm -r "app/(dashboard)"
  git rm -r components/aurora components/ui-core components/shell lib/aurora
  git rm app/styles/aurora.css app/styles/ui-core.css
  git rm lib/workspaces.ts
  git rm e2e/aurora-visual.spec.ts
  git rm -r "e2e/aurora-visual.spec.ts-snapshots"
  ```

  Open `frontend/app/globals.css` and remove every rule defining `.vx-card`, `.vx-glass`, `--mn-*`, `--glass-*` (grep first: `grep -n "vx-card\|vx-glass\|--mn-\|--glass-" frontend/app/globals.css`).

- [ ] **Step 4: Empty the lint-tokens allowlist and repoint `TOKEN_FILES`**

  In `frontend/scripts/lint-tokens.mjs`, change:
  ```js
  const TOKEN_FILES = new Set([
    "app/styles/aurora.css",
    "app/globals.css",
    "lib/aurora/tokens.ts",
    "components/aurora/data/chart-theme.ts",
  ]);
  ```
  to the single path confirmed in Task 2 (`design/tokens.css` per spec section 3.4 — read `frontend/design/tokens.ts` too and include it if the lint script's existing rules need a second allowed source for chart theme literals, matching however Wave 1/2 actually organised it):
  ```js
  const TOKEN_FILES = new Set(["design/tokens.css"]);
  ```
  Empty `frontend/scripts/lint-tokens.allow.txt` down to just its two header comment lines (it is already nearly empty per the current worktree state — confirm with `wc -l frontend/scripts/lint-tokens.allow.txt` that no entries need removing beyond what Tasks 3–18 already cleared by deleting their files).

- [ ] **Step 5: Add the no-legacy-import grep check and run it**

  ```bash
  cd /Users/reshigan/Code/GONXT/Technology/Platforms/Meridian/Meridian_2/.claude/worktrees/redesign/frontend
  grep -rn "lib/aurora\|components/aurora\|components/ui-core\|components/shell" app lib components design 2>/dev/null
  ```
  Expected: no output. If anything matches, fix that import (point it at `@/design`) before continuing — this is the literal Wave 3 exit test from spec section 12 ("No file imports from `lib/aurora`, `components/aurora`, `components/ui-core`").

- [ ] **Step 6: Rewrite `frontend/DESIGN.md`**

  Replace its content with spec section 4 ("Visual system") verbatim as the new source of truth — colour table, type scale, space/shape/motion, state encoding — plus a short header noting it describes `frontend/design/` (the package, not `components/ui-core`).

- [ ] **Step 7: Update `CLAUDE.md`'s "Frontend design system" section**

  In the repo-root `CLAUDE.md`, replace the two subsections "Frontend design system — Aurora (ui-core, light-first)" and "Frontend design system — Legacy (pre-Aurora)" with one section describing `frontend/design/` per spec sections 3.4 and 4: the package layout, the one indigo accent `--m-accent`, Public Sans / JetBrains Mono, and `npm run lint:tokens` now enforcing `design/tokens.css` as the sole raw-colour source with an empty allowlist.

- [ ] **Step 8: Full verification**

  Run, from `frontend/`:
  ```bash
  npm run typecheck && npm run lint && npm run lint:tokens && npm test && npm run build
  ```
  Expected: all five pass. `npm run build` is the Wave 3 exit gate — it must succeed with `app/(dashboard)` gone.

- [ ] **Step 9: Commit**

  ```bash
  cd /Users/reshigan/Code/GONXT/Technology/Platforms/Meridian/Meridian_2/.claude/worktrees/redesign
  git add next.config.ts frontend/app/globals.css frontend/scripts/lint-tokens.mjs frontend/scripts/lint-tokens.allow.txt frontend/DESIGN.md CLAUDE.md
  git commit -m "$(cat <<'EOF'
  Retire the legacy Aurora/ui-core shell and redirect every orphaned route

  Deletes app/(dashboard), components/aurora, components/ui-core,
  components/shell, lib/aurora and the legacy CSS tokens, empties the
  lint-tokens allowlist, and adds next.config.ts redirects for every
  pre-Wave-3 route that has no direct replacement in the new route tree.

  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01NfZiWjz1L8g8HN5DaEsNW6
  EOF
  )"
  ```

---

### Task 32: Playwright journeys — steward accepts a proposal, Basis reads a failed extraction

**Files:**
- Create: `frontend/e2e/steward-accept-proposal.spec.ts`, `frontend/e2e/basis-failed-extraction.spec.ts`
- Modify: `frontend/e2e/routes.json` (remove entries for deleted routes, add `fix`, `fix-batch`, `inbox`, `systems-extraction`), `frontend/e2e/fixtures/api.har` (re-recorded — see Step 3)

**Interfaces:**
- Consumes: `frontend/e2e/fixtures.ts`'s `test`/`expect` wrapper (HAR-replayed API, pinned clock — read it fully, it is the only fixture harness in the repo, per the existing `aurora-smoke.spec.ts` for the pattern to copy).
- Produces: two new specs satisfying spec section 13's "steward accepts a proposal and sees the batch" and "Basis opens a failed extraction and reads the error line" journeys (the third persona journey — lead reaches a failing record in three clicks — was Wave 1/2's test and is not re-done here).

- [ ] **Step 1: Read the existing smoke spec for the pattern**

  Read `frontend/e2e/aurora-smoke.spec.ts` and `frontend/e2e/fixtures.ts` fully: how a route is looked up from `routes.json`, how the HAR is replayed, how the clock is pinned.

- [ ] **Step 2: Update `routes.json`**

  Remove every entry whose `path` points at a route deleted in Task 31 (`/?tab=report`, `/data?tab=systems`, `/workbench`, `/admin?tab=scoring`, etc. — diff against Task 31 Step 1's deletion list) and add:
  ```json
  { "name": "fix", "path": "/fix", "heading": "Fix batches" },
  { "name": "fix-batch", "path": "/fix/B1", "heading": "Batch B1" },
  { "name": "inbox", "path": "/inbox", "heading": "Inbox" },
  { "name": "systems-extraction", "path": "/systems/s1/extractions/r1", "heading": "Extraction r1" }
  ```
  (adjust the sample ids `B1`/`s1`/`r1` to whatever Step 3's re-recording actually seeds).

- [ ] **Step 3: Re-record the HAR for the new routes**

  Run: `npm run e2e:record` (from `frontend/`, per the comment in `fixtures.ts`: "Re-record after changing which endpoints a route calls"). This requires the simulation stack described in that same comment — follow whatever `e2e/record.mjs` documents for starting it; do not hand-edit `api.har`.

- [ ] **Step 4: Write the steward journey**

  ```ts
  // frontend/e2e/steward-accept-proposal.spec.ts
  import { test, expect } from "./fixtures";

  test("steward accepts a proposal and sees the batch", async ({ page }) => {
    await page.goto("/fix");
    await expect(page.getByRole("heading", { name: "Fix batches" })).toBeVisible();
    await page.getByText("B1").click();
    await expect(page).toHaveURL(/\/fix\/B1/);
    await page.getByRole("button", { name: /approve/i }).first().click();
    await expect(page.getByText(/approved/i)).toBeVisible();
  });
  ```

- [ ] **Step 5: Write the Basis journey**

  ```ts
  // frontend/e2e/basis-failed-extraction.spec.ts
  import { test, expect } from "./fixtures";

  test("basis opens a failed extraction and reads the error line", async ({ page }) => {
    await page.goto("/systems/s1");
    await page.getByRole("tab", { name: "Runs" }).click();
    await page.getByText(/failed/i).first().click();
    await expect(page).toHaveURL(/\/systems\/s1\/extractions\//);
    await expect(page.getByText(/RFC_COMMUNICATION_FAILURE|error/i)).toBeVisible();
  });
  ```

  Adjust selectors (`getByRole("tab", { name: "Runs" })`, the failed-run row text) once Step 3's recording shows the real seeded fixture data.

- [ ] **Step 6: Run both specs**

  Run: `npx playwright test e2e/steward-accept-proposal.spec.ts e2e/basis-failed-extraction.spec.ts` (from `frontend/`)
  Expected: both pass against the re-recorded HAR.

- [ ] **Step 7: Commit**

  ```bash
  git add frontend/e2e/steward-accept-proposal.spec.ts frontend/e2e/basis-failed-extraction.spec.ts frontend/e2e/routes.json frontend/e2e/fixtures/api.har
  git commit -m "$(cat <<'EOF'
  Add steward and Basis Playwright journeys for fix batches and extractions

  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01NfZiWjz1L8g8HN5DaEsNW6
  EOF
  )"
  ```

---

## Self-Review

**Spec coverage** (walked section by section against the task list above):

- 3.1 route tree: every Wave-3 row (`/fix`, `/fix/[batchId]`, `/inbox`, `/systems`, `/systems/[systemId]`, `/systems/[systemId]/extractions/[runId]`, `/import`, `/rules`, `/rules/[ruleId]`, `/admin/*` six pages, `/search`) → Tasks 3–18. The fold table's exact legacy→new mapping (`/mdm/glossary`, `/mdm/golden`, `/mdm/match-rules`, `/insights/process(+/designer)`, `/insights/lineage`, `/insights/mining`, `/insights/forecast`, `/rules/contracts`, `/rules/scoring`, `/admin/billing`, `/inbox?kind=exception`, notifications folded into job tray + inbox, `/command-centre` into `/home/basis`, `/migration` into `/insights/readiness`, `/versions` into `/runs`, `/reports` into the `/insights` index) → Tasks 19–30, each pairing a new page build with the legacy route's deletion and redirect. The MDM rail section → Task 30. The adapter-layout retirement and "legacy route becomes a redirect" rule → Task 31.
- 3.4 design package: consumed, not built here (Wave 1a/1b deliverable) — every task reconciles against it in Task 2 before coding, per the global constraint.
- 7 record fix sheet, business partner → Task 1.
- 9.3 tables (client vs server `DataTable` mode): every `DataTable` usage above declares `mode="client"`, matching the ≤5,000-row guidance for these admin/list pages; none of the Wave 3 pages are expected to exceed that (confirmed informally — flagged for the implementer to switch to `mode="server"` if a tenant's rule or cleaning-queue list in practice exceeds 5,000 rows).
- 10 error/empty/loading states: every page task wires `loading`/`error`/`empty` through the template, reconciled against Task 2's real prop names.
- 12 Wave 3 row: fix batches, inbox, systems, extractions, import, rules, admin, search, business partner record → Tasks 1, 3–18. MDM/insights/rules/admin folds → Tasks 19–30. Delete legacy shell/Aurora/ui-core/routes/allowlist → Task 31. "No file imports from lib/aurora, components/aurora, components/ui-core" grep → Task 31 Step 5 (components/shell added per this plan's explicit scope line, beyond the spec's three named directories).
- 13 testing: Playwright steward + Basis journeys → Task 32 (lead journey is Wave 1/2's, not re-done). Vitest for search ranking and inbox keyboard handler → Tasks 17 and 5.

**Gaps I could not map to a task** (reported below, not silently resolved):

1. Spec section 9.4's endpoint table has no `GET /api/search` — Task 17/18 built search as a client-side fan-out over existing list endpoints, consistent with section 9.4's framing ("existing endpoints are reused wherever they already return the shape"), but this means search quality is bounded by what each list endpoint already supports server-side (e.g. no full-text ranking on the backend).
2. Section 8.1/8.2's "threshold set in `/rules`" and "value per record per feature... set in `/rules`" assume Wave 2 added that settings surface to the rules API; Task 11 only confirms and surfaces it if Wave 2 actually shipped it, and otherwise omits the Thresholds section entirely and has the implementer state that omission in their report — this plan cannot invent those field names.
3. The exact response shape of `GET /api/v1/runs/{id}/steps` (Task 9) and the frontend wrapper around it are unknown in the current worktree (Wave 1 has not landed here yet); Task 9 directs the implementer to grep for the real names rather than guessing.
4. Task 31 Step 2a (`/command-centre` → `/home/basis` content port) depends on the sibling Wave 1/2 plan having already landed `/home/basis` in this worktree. If it hasn't by the time Task 31 runs, the redirect is still added but the content port is deferred — this is a sequencing dependency on another plan, not a Wave 3 gap this plan can close unilaterally.
