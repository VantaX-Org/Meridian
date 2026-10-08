# Fix batches and post-cleanup monitoring — design spec

Status: ready to build. Author: frontend design authority. Builder: engineer (no design decisions left open).
Source of truth for tokens, type and rules: `frontend/DESIGN.md`. Where this spec and DESIGN.md disagree, DESIGN.md wins and the builder reports the conflict.

This spec covers two things that ship together:

1. **Fix batches** — a new tab in the Fix workbench hub (`/workbench?tab=batches`). Lists remediation batches, opens one, lets a steward edit proposals, lets a second person accept high-confidence proposals and approve, and exports the file.
2. **Monitoring** — the post-cleanup baseline comparison per system. Lives as the first section of the same tab (justified below).

Meridian never posts to SAP. An export is a file a person loads through their own controlled process. Every screen says this once, in the place the person decides.

---

## 0. Decisions, in one line each

| Decision | Choice | Why |
|---|---|---|
| Where monitoring lives | Section at the top of the Fix batches tab, not its own tab | Monitor results are what draft the system batches; same audience, same permission (`view`), and most tenants would otherwise open an empty tab. |
| Batch detail | Full-height drawer (`DetailDrawer`), id in URL `?batch=<id>` via `useDrawerParam("batch")` | Matches Cleaning and Queue; the notification link `/workbench?tab=batches&batch=<id>` opens it directly. |
| Items table inside the drawer | Yes, paged client-side (100 per page) with `Pager` | A batch can hold 50,000 items; the API returns them all, the drawer must stay fast. |
| Proposed-value edit | Inline in the row, one row at a time, Enter saves, Escape cancels | Stewards edit one value then move on; a modal per value is slow. |
| Four-eyes in the UI | Disable the button and say why in the button's help text; still show the API 403 in a `Banner tone="danger"` | Client knows creator and accepter; server is authority. Both messages are sentences. |
| Tally level | `Tally level={2}`, three figures, one per tab | Hub tabs use level 2 (Cleaning does). |
| Stale threshold | 36 hours | Daily schedule plus slack; constant `STALE_AFTER_MS = 36 * 60 * 60 * 1000` in the surface file, not configurable. |

---

## 1. Registration (shell wiring)

### 1.1 `frontend/lib/workspaces.ts`

Add to the workbench workspace tabs, after `cleaning`:

```ts
{ id: "batches", label: "Fix batches", href: "/remediation", anyOf: ["approve", "apply", "export"] },
```

`anyOf` is required because `/remediation` has no nav entry (`isTabVisible` falls back to `nav?.anyOf`, which is undefined here). A viewer with only `view` does not see the tab; the API still protects every endpoint.

### 1.2 `frontend/components/shell/tab-bodies.tsx`

```ts
"/remediation": named(() => import("@/components/workbench/batches"), "FixBatchesSurface"),
```

### 1.3 `frontend/lib/nav.ts`

Add to `OFF_NAV_TITLES`:

```ts
"/remediation": "Fix batches",
```

### 1.4 Legacy route

Create `frontend/app/(dashboard)/remediation/page.tsx` as a copy of `app/(dashboard)/cleaning/page.tsx` with `q.set("tab", "batches")`. The query (`batch`, `status`, `sort`) travels with the redirect.

### 1.5 URL state (rule 12: the URL is the state)

| Param | Values | Owner |
|---|---|---|
| `tab` | `batches` | hub |
| `batch` | batch id | `useDrawerParam("batch")` |
| `status` | `draft`, `approved`, `exported` (absent = all) | `useUrlState("status")` |
| `sort` | `key:dir`, keys from the table below | `useUrlState("sort")` |
| `q` | search text (name) | `useUrlState("q")` |
| `item` | item id highlighted and scrolled to in the drawer (optional, set by event history links) | `useUrlState("item")` |

---

## 2. API client — `frontend/lib/api/remediation.ts`

New file. No `any`. All ids are `string` (UUIDs). All timestamps are ISO strings. Numbers are `number`, never strings.

```ts
import { apiClient } from "@/lib/api/client"; // whatever versions.ts imports; reuse it

export type BatchStatus = "draft" | "approved" | "exported";
export type ProposalSource = "rule" | "steward" | "manual";
export type Confidence = "high" | "medium" | "low";
export type ReconStatus = "fixed" | "still_failing";
export type ExportFormat = "cockpit_xlsx" | "cockpit_csv" | "mass_change_csv";
export type EventAction = "created" | "proposed" | "accepted" | "approved" | "exported" | "reconciled";

export interface BatchFilter {
  status?: string | null;
  module?: string | null;
  check_id?: string | null;
  severity?: string | null;
  assigned_to?: string | null;
  scope?: string | null;
  search?: string | null;
  version_id?: string | null;
  issue_ids?: string[] | null;
  baseline_id?: string | null;   // set by the monitor
  monitor?: boolean | null;      // true when drafted by the monitor
}

export interface Batch {
  id: string;
  name: string;
  status: BatchStatus;
  filter: BatchFilter;
  created_by: string | null;          // null = drafted by Meridian monitor
  created_by_label: string | null;    // "Meridian monitor" for system batches
  created_at: string;
  approved_by: string | null;
  approved_by_label: string | null;
  approved_at: string | null;
  exported_at: string | null;
}

/** One row of GET /batches: the batch plus its counts. */
export interface BatchSummary extends Batch {
  items: number;
  with_proposal: number;
  auto_approvable: number;
  fixed: number;
  still_failing: number;
}

export interface BatchItem {
  id: string;
  batch_id: string;
  issue_id: string;
  scope: string;
  module: string;
  check_id: string;
  record_key: string;
  grain: string | null;
  field: string | null;              // "TABLE.FIELD"
  current_value: string | null;
  proposed_value: string | null;
  proposal_source: ProposalSource;
  confidence: Confidence | null;
  accepted: boolean;
  recon_status: ReconStatus | null;
  recon_version: string | null;
  updated_at: string;
  auto_approvable: boolean;
}

export interface BatchDetail {
  batch: Batch;
  items: BatchItem[];
}

export interface BatchEvent {
  item_id: string;
  action: EventAction;
  from_value: string | null;
  to_value: string | null;
  user_label: string | null;         // "system" for reconciliation
  version_id: string | null;
  created_at: string;
}

export interface MonitorRun {
  id: string;
  run_at: string | null;
  dqs: number | null;
}

export interface RegressedCheck {
  check_id: string;
  module: string;
  severity: string;
  new: number;
}

export interface MonitorSummary {
  baseline_id: string;
  baseline_run_at: string | null;
  new_records: number;
  regressed_checks: RegressedCheck[];      // capped at 50, sorted by new desc
  regressed_check_count: number;
  resolved_records: number;
  batch_id: string | null;
  batch_items: number;
  batch_auto_approvable?: number;
}

export interface MonitorItem {
  scope: string;                            // system id, or "upload"
  system_name: string | null;               // "Imported files" for upload; may be null if system deleted
  baseline: MonitorRun;
  latest: MonitorRun;
  monitor: MonitorSummary | null;           // null: latest is the baseline, or latest predates monitoring
}

export const listBatches = () => get<{ items: BatchSummary[] }>("/api/v1/remediation/batches");
export const getBatch = (id: string) => get<BatchDetail>(`/api/v1/remediation/batches/${id}`);
export const getBatchEvents = (id: string, itemId?: string) =>
  get<{ items: BatchEvent[] }>(`/api/v1/remediation/batches/${id}/events`, itemId ? { item_id: itemId } : undefined);
export const getMonitor = () => get<{ items: MonitorItem[] }>("/api/v1/remediation/monitor");

export const patchItem = (batchId: string, itemId: string, proposed_value: string | null) =>
  patch<{ id: string; proposed_value: string | null }>(`/api/v1/remediation/batches/${batchId}/items/${itemId}`, { proposed_value });
export const acceptHighConfidence = (id: string) =>
  post<{ id: string; accepted: number; accepted_by: string }>(`/api/v1/remediation/batches/${id}/accept-high-confidence`);
export const approveBatch = (id: string) =>
  post<{ id: string; status: "approved"; approved_by: string }>(`/api/v1/remediation/batches/${id}/approve`);

/** POST that streams a file. Existing download helpers are GET-only. */
export async function exportBatch(id: string, format: ExportFormat): Promise<void> {
  // POST `/api/v1/remediation/batches/${id}/export?format=${format}` with responseType "blob".
  // On a non-2xx response whose body is JSON, read the Blob as text, parse `{detail}` and throw
  // `new Error(detail)` so the UI can show the 409 sentence. Otherwise save the Blob under the
  // filename from Content-Disposition, falling back to `remediation_${id}_${format}.${format === "cockpit_xlsx" ? "xlsx" : "csv"}`.
}

/** Error message for any remediation call: the API's `detail` sentence, else the client error. */
export function errorText(e: unknown): string;   // same shape as the local helper in components/data/analyses.tsx; move it here or import it
```

Labels (export from the same file so the surface never shows a raw id, rule 18):

```ts
export const STATUS_LABEL: Record<BatchStatus, string> = { draft: "Draft", approved: "Approved", exported: "Exported" };
export const SOURCE_LABEL: Record<ProposalSource, string> = { rule: "Rule", steward: "Steward", manual: "Manual" };
export const CONFIDENCE_LABEL: Record<Confidence, string> = { high: "High", medium: "Medium", low: "Low" };
export const RECON_LABEL: Record<ReconStatus, string> = { fixed: "Fixed", still_failing: "Still failing" };
export const FORMAT_LABEL: Record<ExportFormat, string> = {
  cockpit_xlsx: "Migration Cockpit workbook (xlsx)",
  cockpit_csv: "Migration Cockpit CSV",
  mass_change_csv: "Mass change CSV",
};
export const EVENT_LABEL: Record<EventAction, string> = {
  created: "Drafted", proposed: "Proposal changed", accepted: "Accepted", approved: "Approved", exported: "Exported", reconciled: "Reconciled",
};
```

Query keys: `["remediation", "batches"]`, `["remediation", "batch", id]`, `["remediation", "events", id]`, `["remediation", "monitor"]`. Every mutation invalidates `["remediation"]`.

---

## 3. Screen 1 — Fix batches tab

File: `frontend/components/workbench/batches.tsx`, export `FixBatchesSurface`. Reuse the idiom of `components/workbench/cleaning.tsx` (`useAction` mutation helper, `meta()` column helper, confirm `Banner`, `DetailDrawer` layout). Do not invent new CSS; the `ui-*` classes listed here exist in `app/styles/ui-core.css`.

### 3.1 Page structure, top to bottom

```
<div class="ui-page">
  <PageHeader title="Fix batches" summary={verdict sentence} actions={none} />
  <section Monitoring>               (see section 4; omitted entirely only when user lacks `view`, which cannot happen here)
  <Tally level={2} figures=[3] />
  <FilterBar ...>
  <DataTable batches />
  <DetailDrawer when ?batch= />
</div>
```

One `h1` per route: `PageHeader` renders it. The hub already renders the workspace title; follow what Cleaning does (Cleaning uses `PageHeader` inside the tab body and lint passes, so do the same).

### 3.2 Page header

- Title: `Fix batches`
- Summary (rule 4, say the verdict in a sentence), computed from the batch list:
  - no batches: `No fix batches yet. Batches are drafted from failing records or by the monitor when a system regresses against its baseline.`
  - otherwise: `{n_draft} draft, {n_approved} approved and waiting for export, {n_exported} exported. Nothing is written to SAP; an export is a file you load yourself.`
  Use `formatNumber`-equivalent tabular figures; "and" never "&". If any count is 0 drop that clause (e.g. `2 draft, 1 exported.`).
- No header actions. Batch creation is not part of this screen (no UI exists for `POST /batches` yet; do not add one).

### 3.3 Tally (one loud element, rule 2)

`Tally level={2}` with exactly three `TallyFigure`s. Figures are counts; clicking filters the list (rule 1).

| label | value | verdict (text) | href |
|---|---|---|---|
| `Draft batches` | count of `status === "draft"` | `{sum auto_approvable across drafts} proposals can be accepted in bulk` (or `No high-confidence proposals waiting` when 0) | `/workbench?tab=batches&status=draft` |
| `Waiting for export` | count of `status === "approved"` | `Approved, not yet exported` | `/workbench?tab=batches&status=approved` |
| `Still failing after export` | sum of `still_failing` across exported batches | `Across {n_exported} exported batches` | `/workbench?tab=batches&status=exported&sort=still_failing:desc` |

`value` is a `number` or `null` while loading; never a string (lint `tally-figure-numeric`). Pass `loading` and `error` through from the query. Tone: third figure `tone="danger"` only when value > 0, else no tone.

### 3.4 Filter bar

`FilterBar` with:

- `search` bound to `q`, placeholder `Search batch names`.
- One `FilterGroup` "Status" with `CountChips` for `draft`, `approved`, `exported` using `STATUS_LABEL` and the counts from the full list. Selected chip = `status` param. One selection at a time; clicking the selected chip clears it.
- `onClear` clears `status`, `q`, `sort`.
- No `actions`.

Filtering is client-side on the list the API returned (the endpoint has no params).

### 3.5 Batch table

`DataTable` with `ariaLabel="Fix batches. Use j and k to move, Enter to open."`, `maxHeight="62vh"`, sort in header writing `?sort=key:dir` (rule 6a). Default sort `created_at:desc`. Row click and Enter open `?batch=<id>`.

| key | header | cell | meta |
|---|---|---|---|
| `name` | `Batch` | `ui-cell-stack`: main = name; sub = `Drafted by {created_by_label ?? "Meridian monitor"}` (system batch) or `Created by {created_by_label}` | `sticky`, `minWidth: 280` |
| `status` | `Status` | `StatusBadge` — mapping: draft `idle`, approved `running` (in flight to a file), exported `ok`. Child text from `STATUS_LABEL`. For exported batches with `still_failing > 0`, badge status `high` and text `Exported, {still_failing} still failing` | `width: 180` |
| `items` | `Records` | tabular number | `align: "end"`, `numeric` |
| `with_proposal` | `With a proposal` | `{with_proposal}` with `ui-cell-stack__sub` `{pct} of records` when items > 0 (rule 3: percentage only next to its count) | `align: "end"`, `numeric` |
| `auto_approvable` | `High confidence` | number; `0` renders as `0`, not a dash | `align: "end"`, `numeric` |
| `fixed` | `Fixed` | number; for non-exported batches show `null` as an empty cell with `aria-label="Not exported yet"` (rule 17: a figure is a number or null; no "None") | `align: "end"`, `numeric` |
| `still_failing` | `Still failing` | number, same null rule; `ui-delta-up` colour only when > 0 | `align: "end"`, `numeric` |
| `created_at` | `Created` | `formatDate(created_at, "datetime")` (rule 19) with `title` of the full value | `width: 170` |

Column order as listed. Sort keys: `name`, `status`, `items`, `with_proposal`, `auto_approvable`, `fixed`, `still_failing`, `created_at`.

### 3.6 Table states

| State | Render |
|---|---|
| loading | `TableSkeleton rows={6} label="Loading fix batches"` |
| error | `Banner tone="danger" title="Fix batches did not load"` with `errorText(e)` as body and an `action` `Button variant="secondary" size="sm"` `Try again` that refetches |
| empty (no batches at all) | `EmptyState`: `No fix batches yet.` second line `Draft one from Failing records, or pin a baseline so the monitor drafts regressions for you.` `action` = `Button variant="secondary"` `Open failing records` → `/issues`. No illustration (rule 9). |
| filtered empty | `EmptyState`: `No {STATUS_LABEL[status].toLowerCase()} batches match.` `action` ghost `Clear filters` |

### 3.7 Batch detail drawer

Opens when `?batch=` is set. `DetailDrawer open onClose={clear batch param} ariaLabel="Fix batch detail"`. Width: the drawer's wide size (same as Cleaning's job drawer). Focus moves to the drawer title on open; Escape closes; closing returns focus to the row that opened it.

Data: `getBatch(id)` and `getBatchEvents(id)` in parallel. Both `useQuery`, `enabled: !!id`.

#### 3.7.1 Drawer head (`ui-drawer-head`)

- `ui-drawer-head__title`: batch name (plain text, not mono).
- Below the title, one line (`ui-micro`): `StatusBadge` as in the table, then `Drafted by Meridian monitor on {formatDate(created_at,"datetime")}` or `Created by {created_by_label} on {date}`.
- Right side: action cluster (section 3.7.4).

Drawer-level 404: `EmptyState` `This batch no longer exists.` with `Back to batches` ghost button clearing the param.

#### 3.7.2 Summary (`Part title="Summary"`, `KeyValue`)

Rows, in order. Numbers tabular; a null figure renders as an empty value, not a word.

| k | v |
|---|---|
| `Records` | items.length |
| `With a proposal` | count where `proposed_value !== null`, then `({pct} of records)` |
| `High confidence, not yet accepted` | count where `auto_approvable && !accepted` |
| `Accepted` | count where `accepted` |
| `Rules` | distinct `check_id` count, e.g. `3 rules` |
| `Approved` | `{approved_by_label} on {formatDate(approved_at,"datetime")}`; omit the row when null |
| `Exported` | `formatDate(exported_at,"datetime")`; omit when null |
| `Fixed after export` | count `recon_status === "fixed"`; omit the row unless status is exported |
| `Still failing after export` | count `recon_status === "still_failing"`; omit unless exported |
| `Not yet re-checked` | count exported items with `recon_status === null`; omit unless exported |
| `Baseline` | only for monitor batches (`filter.monitor`): link text `Compare with baseline` → `/versions?v1={filter.baseline_id}&v2={filter.version_id}` |

Under the KeyValue, one `ui-note`: `Nothing is written to SAP. Approve the batch, export the file and load it through your own process. The next run marks each record fixed or still failing.`

#### 3.7.3 Four-eyes state (shown above the actions when it applies)

Compute from `useAuth().user.id` (`User.id`) and the events list:

- `isCreator = batch.created_by !== null && batch.created_by === user.id`
- `isAccepter = batch.created_by === null && events.some(e => e.action === "accepted" && e.user_label === user.name)` — events carry only `user_label`, so match on the display name; this is a hint, the server decides.

When either is true and the batch is a draft, render `Banner tone="info"` (role status) with:

- creator: title `A second person approves this batch.` body `You created it, so you cannot accept its proposals or approve it. Ask an approver to open this batch.`
- accepter (system batch): title `A second person approves this batch.` body `You accepted its proposals, so someone else must approve it.`

The matching buttons are disabled (`aria-disabled`, `title` = the body sentence). Never hide them; a hidden control makes the four-eyes rule invisible.

#### 3.7.4 Actions

A row of controls at the top right of the drawer. Visible by permission; disabled by state. Each disabled button has a `title` with the sentence explaining why.

| Button | Shown when | Enabled when | Behaviour |
|---|---|---|---|
| `Accept {n} high-confidence` (`Button variant="secondary"`), n = `auto_approvable && !accepted` count | `can("approve")` and status draft | n > 0 and not `isCreator` | Opens inline confirm (3.7.5) |
| `Approve batch` (`Button` primary) | `can("approve")` and status draft | not `isCreator` and not `isAccepter` and `with_proposal > 0` (title when 0: `Add a proposed value to at least one record first.`) | Opens inline confirm (3.7.5) |
| Export: `Select` of `FORMAT_LABEL` (default `cockpit_xlsx`, `aria-label="Export format"`) + `Button variant="secondary"` `Export file` | `can("export")` and status is approved or exported | always, when shown | Calls `exportBatch`. Button text while pending: `Preparing file`. Exported batches show `Export again`. |

If the user has none of `approve`/`export`, the action row is a single `ui-micro` line: `You can edit proposed values. An approver accepts and approves; an exporter downloads the file.`

Status not draft and no export permission: `ui-micro` `Approved on {date}. Waiting for an exporter to download the file.` (or `Exported on {date}.`).

#### 3.7.5 Inline confirms (same pattern as Cleaning)

`Banner tone="info"` placed directly under the actions row, with `Button size="sm"` to confirm and a ghost `Not now` to dismiss.

- Accept: title `Accept {n} high-confidence proposals?` body `These are rule proposals the rule itself re-verified. Accepting marks them for approval; nothing is written to SAP.` Confirm button `Accept {n}`.
- Approve: title `Approve this batch?` body `{with_proposal} records get a value in the export; {items - with_proposal} without a proposal stay with the steward and are left out of the file. After approval nobody can edit proposals.` Confirm `Approve`.

#### 3.7.6 Result and error feedback

- Success: `toast.success` with a sentence: `Accepted {accepted} proposals.` / `Batch approved.` / `File downloaded.`
- Error: `Banner tone="danger"` (role alert) rendered in the same slot as the inline confirm, title `That did not work.`, body `errorText(e)`. The API sentences surface verbatim:
  - `The batch creator cannot accept its proposals.`
  - `The batch creator cannot approve it.`
  - `You accepted this batch's proposals; a second person must approve it.`
  - `Batch is already approved.` / `Batch is already exported.`
  - `Approve the batch before exporting it.`
  - `Only draft batches can be edited.`
  Also `toast.error(errorText(e))` so a person who scrolled sees it. Banner stays until dismissed (`Dismiss` ghost) or the next action.
- On 403 or 409 also invalidate the batch query so the drawer reflects the real state.

#### 3.7.7 Items table (`Part title="Records"`)

Above the table, one filter line: `Chip`s `All {n}`, `With a proposal {n}`, `High confidence {n}`, `No proposal {n}`, and for exported batches `Still failing {n}`, `Fixed {n}`. Single select; client-side. Plus a `Select` `Rule` listing distinct `check_id` (mono) with `All rules` default. Default view sorts as the API returns (module, check_id, record_key).

`DataTable` with `ariaLabel="Batch records. Use j and k to move, Enter to edit the proposed value."`, `maxHeight="48vh"`, client-side `Pager` 100 rows a page.

| key | header | cell | meta |
|---|---|---|---|
| `record_key` | `Record` | `<Mono>{record_key}</Mono>`; `title` full key; truncate with ellipsis at 32 ch | `sticky`, `minWidth: 220` |
| `check_id` | `Rule` | `<Mono>` check id as a link to `/analyse/rule/{check_id}`; sub line `formatModuleName(module)` in `ui-cell-stack__sub` | `width: 160` |
| `field` | `Field` | `FieldChip table={TABLE} field={FIELD}` split on the first `.`; empty cell when null | `width: 170` |
| `current_value` | `Current` | `<Mono>` value; null → empty cell with `aria-label="Blank"` | `minWidth: 140` |
| `proposed_value` | `Proposed` | see 3.7.8 | `minWidth: 200` |
| `confidence` | `Confidence` | `StatusBadge`: high `ok`, medium `medium`, low `low`; null → empty | `width: 120` |
| `proposal_source` | `Source` | `SOURCE_LABEL`; for `rule` add sub `Re-verified by the rule` | `width: 130` |
| `accepted` | `Accepted` | text `Yes` or empty | `width: 90` |
| `recon_status` | `After export` | `StatusBadge` fixed `ok` / still_failing `high` with `RECON_LABEL`; null → `ui-micro` `Not re-checked yet` only on exported batches, else empty | `width: 150`, column hidden entirely unless status is exported |

Row with `?item=` matching gets `aria-current="true"` and is scrolled into view on open.

#### 3.7.8 Editing a proposed value

Only when `can("apply")` and status is draft. Otherwise the cell is read-only mono text.

- Read mode: `<Mono>{proposed_value}</Mono>` or, when null, a ghost `ui-link-button` `Add value`. Clicking the cell (or Enter on the focused row) enters edit mode. A pencil is not needed; the hover cursor and focus ring do the work.
- Edit mode: an `Input` (mono text, `maxLength={4000}`, `aria-label="Proposed value for {record_key}"`) prefilled with the current proposal, autofocused and selected. Below it, `ui-micro`: `Enter saves, Escape cancels. Clear the field to remove the proposal.` and a ghost `Remove proposal` button when a value exists.
- Save: `patchItem(batchId, itemId, value.trim() === "" ? null : value)`. Optimistic update of the row: `proposed_value`, `proposal_source` becomes `steward` (or `manual` when null), `confidence` null, `accepted` false, `auto_approvable` false. Then invalidate.
- Toast on success: `Proposal updated.` On error: revert row and show the sentence (`Only draft batches can be edited.`) in the drawer error slot.
- One row in edit mode at a time; starting another cancels the first without saving.

#### 3.7.9 Event history (`Part title="History"`)

`getBatchEvents(id)` returns one event per item, so a batch of 10,000 items has 10,000 `created` events. Group before render:

- Group by (`action`, `user_label`, `created_at` to the minute, `version_id`). Render one line per group in a `ui-plain-list`, newest first:
  - `{EVENT_LABEL[action]} {count === 1 ? "1 record" : count + " records"} by {user_label ?? "Meridian monitor"}` and `formatDate(created_at,"datetime")` on the right (`ui-micro`).
  - `reconciled` groups split further by `to_value`: `Re-checked: {fixedCount} fixed, {stillCount} still failing` with a link `Open run` → `/data/runs/{version_id}`.
  - `proposed` groups of a single record show `<Mono>{from_value}</Mono> to <Mono>{to_value}</Mono>` under the line, and the record key as a link that sets `?item=`.
- Show the latest 20 groups; `Show all {n}` ghost expands.
- Empty: not possible (every batch has `created`); if the query errors show `ui-micro` `History did not load.` with `Try again`.

### 3.8 Keyboard and accessibility

- Table: j/k move, Enter opens (DataTable already does this). Drawer: Escape closes, focus returns to the originating row.
- Every icon-free button has visible text. Disabled buttons carry `aria-disabled` and a `title` sentence.
- Inline edit announces via the input's `aria-label`; the save result is announced through `toast` (sonner uses a live region).
- Banners use `role="status"` (info) or `role="alert"` (danger) — `Banner` already does this by tone.
- Tabular figures everywhere a number appears (`.aurora-number` or `numeric` meta).
- No colour-only meaning: `StatusBadge` carries shape and text; `ui-delta-up` is paired with the number and header.

---

## 4. Screen 2 — Monitoring section

Rendered inside `FixBatchesSurface` above the Tally, as `SectionCard title="Monitoring since cleanup"`, `meta` = `Checked {relativeTime(max latest.run_at)}` when there is data. Component: `MonitoringSection` in the same file (or `components/workbench/monitoring.tsx` if the surface file passes 400 lines).

Data: `getMonitor()`; `staleTime` 60 s.

### 4.1 Section states

| State | Render |
|---|---|
| loading | `TableSkeleton rows={2} label="Loading monitoring"` |
| error | `Banner tone="danger" title="Monitoring did not load"` + `errorText`, `Try again` |
| empty (`items.length === 0`) | `EmptyState`: `No system has a baseline yet.` second line `After a cleanup, compare the clean run with an older one and pin it as the baseline. Every later run is then checked for records that fail again, and regressions are drafted into a fix batch here.` `action` = `Button variant="secondary"` `Open compare versions` → `/analyse?tab=analyses`. Hide the section's `meta`. |
| data | One row per `MonitorItem` (4.2), stacked `ui-stack`. Sorted as returned (system name, then scope). |

### 4.2 System row

Each system is a bordered block inside the section (`ui-ranked` layout is wrong here; use a plain `div` with `ui-section__body` spacing and a top divider between systems). Three zones, left to right at desktop, stacked at phone width:

**Zone A — identity (min 220px)**

- Line 1 (section title weight, 15/20): `system_name ?? "System {scope.slice(0,8)}"`. When `system_name` is null and scope is not `upload`, label `Removed system` and render the scope in `<Mono>` beneath.
- Line 2 `ui-micro`: `Baseline {formatDate(baseline.run_at,"datetime")}` as a link to `/data/runs/{baseline.id}`.
- Line 3 `ui-micro`: `Latest {formatDate(latest.run_at,"datetime")}` as a link to `/data/runs/{latest.id}`; append ` ({relativeTime(latest.run_at)})`.

**Zone B — scores (fixed 200px)**

Two `Metric`s side by side (`MetricStrip`), labels `Baseline DQS` and `Latest DQS`, values tabular 24px, `null` renders empty with `text="Not scored"` only if the component supports `text`; otherwise an empty value. Beneath latest, a delta: `ui-delta-up` when latest > baseline with `+{d}`, `ui-delta-down` when lower with `−{d}` (use the minus sign, not a hyphen; the glyph lint allows it — if it does not, use the word `down {d}`). Equal: `No change`. Rule 3 is respected because the DQS is the score the product already names, and the counts in zone C are the actionable numbers.

**Zone C — what changed (flex)**

Depends on `monitor`:

1. `monitor === null && latest.id === baseline.id`:
   `ui-note`: `The baseline is the latest run. The next run is compared with it.`

2. `monitor === null && latest.id !== baseline.id`:
   `ui-note`: `The latest run was made before monitoring was switched on. The next run is compared with the baseline.`

3. `monitor` present:
   - Two big counts in a row (`Metric` 24px, tabular):
     - `Failing again` = `monitor.new_records`. Tone danger when > 0. Click → the drafted batch if `batch_id`, else `/versions?v1={monitor.baseline_id}&v2={latest.id}`.
     - `Resolved since baseline` = `monitor.resolved_records`. No tone. Click → `/versions?v1={monitor.baseline_id}&v2={latest.id}`.
   - Verdict sentence under the counts (rule 4):
     - new_records 0: `No record that passed in the baseline fails now.`
     - with batch: `{regressed_check_count} rules regressed. {batch_items} records are in a draft fix batch{batch_auto_approvable ? ", " + batch_auto_approvable + " with a high-confidence proposal" : ""}.`
     - without batch: `{regressed_check_count} rules regressed. The records are already in open fix batches.`
   - Batch link, when `batch_id`: `Button variant="secondary" size="sm"` `Open fix batch` → sets `?batch={batch_id}` (same tab; also sets `status` to none). If the batch is not in the loaded list (deleted), fall back to the deep link anyway; the drawer shows its 404 state.
   - Top regressed rules (`ui-mini-table`, max 5 rows, only when `regressed_checks.length > 0`): columns `Rule` (`<Mono>` link to `/analyse/rule/{check_id}`), `Module` (`formatModuleName`), `Severity` (`StatusBadge status={severity as Status}` with `labelOf(severity)`), `New` (tabular, `align end`). Footer `ui-micro` when more than 5: `And {regressed_check_count - 5} more rules` as a link to `/versions?v1={baseline_id}&v2={latest.id}`.

**Stale warning** (any case) when `Date.now() - Date.parse(latest.run_at) > STALE_AFTER_MS`:

`Banner tone="warning"` at the top of zone C, title `No run in the last 36 hours.`, body:
- scope is a system: `The daily schedule did not run. Check the system's schedules.` with `action` ghost `Open schedules` → `/systems/{scope}` (SchedulesPanel sits on the system's Overview tab).
- scope `upload`: `Imported files are only re-checked when a new file is imported.` with `action` ghost `Import a file` → `/data?tab=import`.

Only one banner per system; the warning does not replace the counts.

### 4.3 Monitoring accessibility

- Each system block is a `region` with `aria-label="{system name} monitoring"`.
- Counts are buttons or links with visible text; the number alone is never the only label (`aria-label="{n} records failing again, open the fix batch"`).
- Delta glyphs are paired with words in `title`.

---

## 5. Copy inventory (sentence case, no arrows, no middle dots, "and" not "&")

Collected here so the builder copies rather than paraphrases.

- Tab label: `Fix batches`
- Header summary: see 3.2
- Tally labels: `Draft batches`, `Waiting for export`, `Still failing after export`
- Status chips: `Draft`, `Approved`, `Exported`
- Empty list: `No fix batches yet.` / `Draft one from Failing records, or pin a baseline so the monitor drafts regressions for you.`
- Drawer note: `Nothing is written to SAP. Approve the batch, export the file and load it through your own process. The next run marks each record fixed or still failing.`
- Four-eyes banner titles and bodies: see 3.7.3
- Confirms: see 3.7.5
- Buttons: `Accept {n} high-confidence`, `Approve batch`, `Export file`, `Export again`, `Not now`, `Dismiss`, `Try again`, `Add value`, `Remove proposal`, `Open fix batch`, `Open schedules`, `Import a file`, `Open compare versions`, `Open failing records`, `Show all {n}`
- Monitoring: `Monitoring since cleanup`, `Baseline DQS`, `Latest DQS`, `Failing again`, `Resolved since baseline`, `No run in the last 36 hours.`, `The baseline is the latest run. The next run is compared with it.`

Words banned on these screens: `None`, `Unknown`, `Never`, `N/A`, `Remediation` (say `Fix batch`), `Write-back`, `Push to SAP`.

---

## 6. Visual rules the builder must not bend

- Tokens only: `--aurora-*` through the `ui-*` classes and primitives. No hex, no gradient, no blur, no new CSS unless a listed class is missing; then add it to `ui-core.css` using tokens and name it in the PR.
- Fonts: UI text in the default face; `<Mono>` only for check ids, `TABLE.FIELD`, record keys, run ids and field values.
- Colour means defect state. Petrol accent only on links, focus and the selected chip. `draft` is `idle` grey, not accent.
- Radii: controls 4px, sheets 6px (primitives already do this).
- Motion: none except the drawer's existing transition.
- Light first; verify dark by toggling `data-theme="dark"`; no new colours.

---

## 7. Acceptance checklist

- [ ] `npm run lint:tokens`, `npm run lint`, `npm run typecheck` pass with no disables and no allowlist edits.
- [ ] `/workbench?tab=batches&batch=<id>` from a notification opens the drawer directly; closing it leaves `?tab=batches`.
- [ ] A batch creator sees Accept and Approve disabled with the sentence in `title`; forcing the request shows the API 403 sentence in a danger banner.
- [ ] On a system batch, the accepter sees Approve disabled after accepting; a different approver can approve.
- [ ] Export of a draft shows `Approve the batch before exporting it.`; export of an approved batch downloads `remediation_<id>_<format>.<ext>` and the row turns `Exported`.
- [ ] Editing a proposal on an approved batch is not offered; the API 409 sentence appears if attempted through a stale drawer.
- [ ] Monitoring: empty state links to compare versions; a system with a 40-hour-old latest run shows the stale banner linking `/systems/{scope}`; `Open fix batch` opens the drawer in place.
- [ ] Every number that can be opened opens its rows (Tally, counts, chips).
- [ ] No `any` in `frontend/lib/api/remediation.ts`; export helper surfaces JSON `detail` from a Blob error.
- [ ] Keyboard-only pass: tab, j/k, Enter, Escape reach every control; focus returns after the drawer closes.
