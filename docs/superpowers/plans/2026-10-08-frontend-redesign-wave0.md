# Frontend redesign Wave 0: freeze fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop pages freezing when a job completes, and make the two blank workspace tabs render.

**Architecture:** The job SSE stream in `hooks/use-jobs.ts` currently invalidates every React Query cache in the app when any job completes, which refetches every page at once. Replace the predicate with a fixed list of the query-key prefixes a run changes. The blank tabs are hub tabs whose routes have no entry in `TAB_BODIES`; add the two entries.

**Tech Stack:** Next.js 16, React 19, TanStack Query 5, TypeScript strict.

**Spec:** `docs/superpowers/specs/2026-10-08-frontend-redesign-design.md`, section 11.

## Global Constraints

- No `any` types. `npm run typecheck`, `npm run lint` and `npm run lint:tokens` must pass. Never add lines to the lint:tokens allowlist.
- Run frontend commands from `frontend/`.
- Commit messages in normal prose with the footer lines `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01NfZiWjz1L8g8HN5DaEsNW6`.
- Do not touch `(dashboard)` pages beyond the files named here.

---

### Task 1: Scoped invalidation on job completion

**Files:**
- Modify: `frontend/hooks/use-jobs.ts:30-33`

**Interfaces:**
- Produces: `export const RUN_TOUCHED_KEYS: readonly string[]` (query-key prefixes a run changes). Wave 1's JobTray replaces this list with the job payload's `touches` field.

- [ ] **Step 1: Add the key list and use it**

Replace lines 30 to 33 of `frontend/hooks/use-jobs.ts` so the block reads:

```ts
          if (job.status === "completed") {
            // a finished job changed only the run-scoped data; everything else keeps its cache
            qc.invalidateQueries({ predicate: (q) => RUN_TOUCHED_KEYS.has(String(q.queryKey[0])) });
          }
```

and add after `const ACTIVE = ...` on line 9:

```ts
/** Query-key prefixes a run (sync, checks, batch) changes. Wave 1 reads this from the job's `touches`. */
export const RUN_TOUCHED_KEYS: ReadonlySet<string> = new Set([
  "issues", "issue", "version", "versions", "system-versions", "material",
  "config-impact", "pilot-scorecard", "notifications-unread-count",
]);
```

- [ ] **Step 2: Typecheck and lint**

Run: `cd frontend && npm run typecheck && npm run lint`
Expected: both exit 0.

- [ ] **Step 3: Commit**

```bash
git add frontend/hooks/use-jobs.ts
git commit -m "fix(frontend): invalidate only run-scoped queries when a job completes

A completed job used to invalidate every React Query cache except the jobs
list, so every mounted page refetched at once and the UI froze. Invalidate
only the key prefixes a run changes.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NfZiWjz1L8g8HN5DaEsNW6"
```

### Task 2: Blank tabs render their pages

**Files:**
- Modify: `frontend/components/shell/tab-bodies.tsx` (inside `TAB_BODIES`)

**Interfaces:**
- Consumes: `RuleCoverage` from `@/components/analyse/coverage`, `ProcessDesigner` from `@/components/process/designer/page` (both already exported).

- [ ] **Step 1: Add the two entries**

Inside `TAB_BODIES`, next to the other `/analyse/*` entries add:

```ts
  "/analyse/coverage": named(() => import("@/components/analyse/coverage"), "RuleCoverage"),
```

and next to the other `/process/*` entries add:

```ts
  "/process/designer": named(() => import("@/components/process/designer/page"), "ProcessDesigner"),
```

If there are no sibling `/analyse/*` or `/process/*` entries, add them at the end of the object.

- [ ] **Step 2: Typecheck, lint, confirm the hub resolves both**

Run: `cd frontend && npm run typecheck && npm run lint && grep -c '"/analyse/coverage"\|"/process/designer"' components/shell/tab-bodies.tsx`
Expected: exit 0 and the grep prints `2`.

- [ ] **Step 3: Commit**

```bash
git add frontend/components/shell/tab-bodies.tsx
git commit -m "fix(frontend): render the Rule coverage and Designer tabs

Both tabs were listed in the workspace hubs but had no body in TAB_BODIES,
so the hub rendered nothing when they were selected.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NfZiWjz1L8g8HN5DaEsNW6"
```

### Task 3: Virtualise large unvirtualised tables

**Files:**
- Modify: any `frontend/components/**` table that renders more than 2,000 rows without `@tanstack/react-virtual`.

- [ ] **Step 1: Find candidates**

Run: `cd frontend && grep -rln "useVirtualizer" components | sort > /tmp/virt.txt; grep -rln "<tbody" components | sort | comm -23 - /tmp/virt.txt`
Expected: a list of table components without a virtualiser. For each, check whether its data source is a paged endpoint (page size at most 500) or an unbounded list. Only unbounded lists (findings records, material lists, duplicate candidates) need changing. If every candidate is paged, write "no unbounded tables" in the commit message of Task 2 and stop here.

- [ ] **Step 2: For each unbounded table, wrap rows with the existing pattern**

Copy the virtualiser usage from the first file in `/tmp/virt.txt` (it uses `useVirtualizer({ count, getScrollElement, estimateSize: () => 36 })` over a `ref`'d scroll container and maps `rowVirtualizer.getVirtualItems()` to rows with `transform: translateY`). Keep columns and row content unchanged.

- [ ] **Step 3: Typecheck, lint, commit**

Run: `cd frontend && npm run typecheck && npm run lint`
Expected: exit 0.

```bash
git add frontend/components
git commit -m "fix(frontend): virtualise unbounded record tables

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01NfZiWjz1L8g8HN5DaEsNW6"
```
