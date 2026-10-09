# Run Comparison Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user pick any two runs (or a run and its pinned baseline), see what moved and why in plain sentences, download the comparison PDF, and turn regressions into fix batches, all on the redesign shell.

**Architecture:** Frontend only. Pure helpers in `frontend/lib/{runs,narrative}.ts` compute every derived number; pages compose `@/design` templates and primitives around existing API clients (`versions.ts`, `remediation.ts`, `reports.ts`). Two small client additions: `compareVersions` accepts an omitted `v1`, and `createBatch` posts to the existing batch route. The vs page URL convention becomes `/runs/{newer}/vs/{older | baseline}`.

**Tech Stack:** Next.js 15 App Router, React Query, TanStack Table, recharts via `@/design` charts, sonner toasts, vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-09-run-comparison-insights-reports-design.md` (sections 2.1, 3.1 to 3.5, 7).

## Global Constraints

- Every page is built from `@/design` (`frontend/design/index.ts`) on the redesign shell from PR #413. No legacy components, no `components/ui-core`, no raw hex, no `any`. `npm run lint:tokens` allowlist is never extended.
- The redesign (#413) ships first; `feat/run-comparison` branches from `feat/frontend-redesign` and rebases onto `main` once #413 merges.
- All numbers come from the API or from pure functions in `frontend/lib/*`; the narrative is template text, never LLM output.
- Append-only rule ids, root cause for every failure, one PR per phase, opened and not merged.
- Gate for every task, run from `frontend/`: `npm run typecheck && npm run lint && npm run lint:tokens && npx vitest run`. All four must pass before the commit step. Never run `npm run build`.
- Commit messages are normal prose and end with the two trailer lines:
  `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` and
  `Claude-Session: https://claude.ai/code/session_01NfZiWjz1L8g8HN5DaEsNW6`.
- Tests under `__tests__/` next to the file under test. Component tests use `renderWithQuery` from `@/__tests__/render`. Any page that calls `useUrlState` must mock `next/navigation` with `useRouter`, `usePathname` and `useSearchParams` (a stable `URLSearchParams` instance).
- URL convention: `/runs/{v2}/vs/{v1}` where `v2` (`versionId` param) is the newer run and `v1` (`b` param) is the older run or the literal `baseline`.

---

## File map

| File | Responsibility |
|---|---|
| `frontend/lib/runs.ts` (new) | Pure helpers over `Version[]`: `overallDqs`, `scopeOf`, `previousRunId`, `baselineRunId`, `runSeries`. |
| `frontend/lib/narrative.ts` (new) | `compareNarrative` template sentences. |
| `frontend/lib/api/versions.ts` | `compareVersions(v1: string \| undefined, …)`, exported `RecordDiff` type. |
| `frontend/lib/api/remediation.ts` | `createBatch`, `BatchCreated`. |
| `frontend/app/(app)/runs/page.tsx` | Runs list: DQS column, two-run compare, per-system sparklines, system filter. |
| `frontend/app/(app)/runs/[versionId]/page.tsx` | Run detail: compare buttons, pin/unpin baseline, Baseline pill. |
| `frontend/app/(app)/runs/[versionId]/vs/[b]/page.tsx` | Comparison report: module cards, narrative, PDF, create fix batch, record diff table. |
| `frontend/app/(app)/fix/batches-tab.tsx` | `Before vs after` link for exported batches. |
| `frontend/lib/nav.ts` | Relabel `/runs` to `Runs`. |

---

### Task 1: Pure run helpers

**Files:**
- Create: `frontend/lib/runs.ts`
- Test: `frontend/lib/__tests__/runs.test.ts`

**Interfaces:**
- Consumes: `Version` from `@/types/api` (`dqs_summary: Record<string, DQSSummary> | null`, `DQSSummary.composite_score: number`, `metadata.system_id?: string`, `metadata.baseline?: boolean`, `status`, `run_at`).
- Produces:
  - `overallDqs(version: Version): number | null`
  - `scopeOf(version: Version): string` (system id or `"upload"`)
  - `previousRunId(current: Version, runs: Version[]): string | null`
  - `baselineRunId(current: Version, runs: Version[]): string | null`
  - `runSeries(runs: Version[], max?: number): RunSeries[]` with `RunSeries { scope: string; points: { x: string; y: number }[] }`

- [ ] **Step 1: Write the failing tests**

```ts
// frontend/lib/__tests__/runs.test.ts
import { describe, expect, it } from "vitest";
import type { Version } from "@/types/api";
import { baselineRunId, overallDqs, previousRunId, runSeries, scopeOf } from "../runs";

function dqs(composite_score: number) {
  return {
    composite_score,
    dimension_scores: {},
    critical_count: 0, high_count: 0, medium_count: 0, low_count: 0,
    total_checks: 0, passing_checks: 0, capped: false, cap_reason: null,
  };
}

function run(over: Partial<Version> & { id: string }): Version {
  return {
    label: null,
    status: "complete",
    run_at: "2026-10-01T00:00:00Z",
    dqs_summary: null,
    metadata: { modules: ["material_master"], file_name: "f.csv", row_count: 1, system_id: "sys-1" },
    ...over,
  };
}

describe("overallDqs", () => {
  it("returns null when there is no summary", () => {
    expect(overallDqs(run({ id: "a" }))).toBeNull();
    expect(overallDqs(run({ id: "a", dqs_summary: {} }))).toBeNull();
  });
  it("averages module composite scores", () => {
    const v = run({ id: "a", dqs_summary: { material_master: dqs(70), fi_gl: dqs(80) } });
    expect(overallDqs(v)).toBe(75);
  });
});

describe("scopeOf", () => {
  it("falls back to upload without a system id", () => {
    expect(scopeOf(run({ id: "a", metadata: null }))).toBe("upload");
    expect(scopeOf(run({ id: "a" }))).toBe("sys-1");
  });
});

describe("previousRunId", () => {
  const runs = [
    run({ id: "new", run_at: "2026-10-08T00:00:00Z" }),
    run({ id: "mid", run_at: "2026-10-05T00:00:00Z" }),
    run({ id: "failed", run_at: "2026-10-04T00:00:00Z", status: "failed" }),
    run({ id: "other", run_at: "2026-10-03T00:00:00Z", metadata: { modules: [], file_name: "x", row_count: 0, system_id: "sys-2" } }),
    run({ id: "old", run_at: "2026-10-01T00:00:00Z" }),
  ];
  it("picks the latest complete earlier run in the same scope", () => {
    expect(previousRunId(runs[0], runs)).toBe("mid");
    expect(previousRunId(runs[1], runs)).toBe("old");
  });
  it("returns null when nothing is earlier", () => {
    expect(previousRunId(runs[4], runs)).toBeNull();
  });
});

describe("baselineRunId", () => {
  it("returns another pinned complete run in scope, never itself", () => {
    const base = run({ id: "base", metadata: { modules: [], file_name: "x", row_count: 0, system_id: "sys-1", baseline: true } });
    const cur = run({ id: "cur" });
    expect(baselineRunId(cur, [cur, base])).toBe("base");
    expect(baselineRunId(base, [cur, base])).toBeNull();
    expect(baselineRunId(cur, [cur])).toBeNull();
  });
});

describe("runSeries", () => {
  it("builds one ascending series per scope, newest scope first, capped", () => {
    const runs = [
      run({ id: "a2", run_at: "2026-10-08T00:00:00Z", dqs_summary: { m: dqs(80) } }),
      run({ id: "a1", run_at: "2026-10-01T00:00:00Z", dqs_summary: { m: dqs(70) } }),
      run({ id: "b1", run_at: "2026-10-02T00:00:00Z", dqs_summary: { m: dqs(60) }, metadata: null }),
      run({ id: "skip", run_at: "2026-10-09T00:00:00Z", status: "failed", dqs_summary: { m: dqs(1) } }),
      run({ id: "nodqs", run_at: "2026-10-09T00:00:00Z" }),
    ];
    expect(runSeries(runs)).toEqual([
      { scope: "sys-1", points: [{ x: "2026-10-01T00:00:00Z", y: 70 }, { x: "2026-10-08T00:00:00Z", y: 80 }] },
      { scope: "upload", points: [{ x: "2026-10-02T00:00:00Z", y: 60 }] },
    ]);
    expect(runSeries(runs, 1)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run lib/__tests__/runs.test.ts`
Expected: FAIL, cannot resolve `../runs`.

- [ ] **Step 3: Write the implementation**

```ts
// frontend/lib/runs.ts
import type { Version } from "@/types/api";

/** Mean of the module composite scores, or null when the run carries no scores. */
export function overallDqs(version: Version): number | null {
  const scores = Object.values(version.dqs_summary ?? {}).map((s) => s.composite_score);
  if (scores.length === 0) return null;
  return scores.reduce((a, b) => a + b, 0) / scores.length;
}

/** A run's comparison scope: its system id, or "upload" for imported files. */
export function scopeOf(version: Version): string {
  return version.metadata?.system_id ?? "upload";
}

function sameScopeComplete(current: Version, runs: Version[]): Version[] {
  const scope = scopeOf(current);
  return runs.filter((r) => r.id !== current.id && r.status === "complete" && scopeOf(r) === scope);
}

/** The latest complete run in the same scope that started before `current`. */
export function previousRunId(current: Version, runs: Version[]): string | null {
  const earlier = sameScopeComplete(current, runs)
    .filter((r) => r.run_at < current.run_at)
    .sort((a, b) => (a.run_at < b.run_at ? 1 : -1));
  return earlier[0]?.id ?? null;
}

/** The pinned baseline of `current`'s scope, if it is a different complete run. */
export function baselineRunId(current: Version, runs: Version[]): string | null {
  return sameScopeComplete(current, runs).find((r) => r.metadata?.baseline === true)?.id ?? null;
}

export interface RunSeries {
  scope: string;
  points: { x: string; y: number }[];
}

/** One ascending DQS series per scope from complete, scored runs; scopes ordered by their latest run. */
export function runSeries(runs: Version[], max = 6): RunSeries[] {
  const byScope = new Map<string, { x: string; y: number }[]>();
  for (const r of runs) {
    if (r.status !== "complete") continue;
    const y = overallDqs(r);
    if (y === null) continue;
    const scope = scopeOf(r);
    const points = byScope.get(scope) ?? [];
    points.push({ x: r.run_at, y });
    byScope.set(scope, points);
  }
  return [...byScope.entries()]
    .map(([scope, points]) => ({ scope, points: points.sort((a, b) => (a.x < b.x ? -1 : 1)) }))
    .sort((a, b) => (a.points[a.points.length - 1].x < b.points[b.points.length - 1].x ? 1 : -1))
    .slice(0, max);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run lib/__tests__/runs.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Gate and commit**

Run: `cd frontend && npm run typecheck && npm run lint && npm run lint:tokens && npx vitest run`

```bash
git add frontend/lib/runs.ts frontend/lib/__tests__/runs.test.ts
git commit -m "Add pure run helpers for DQS, scope, previous and baseline run lookup"
```

---

### Task 2: API client additions

**Files:**
- Modify: `frontend/lib/api/versions.ts` (lines 54-71: `RecordDiffCheck`, `compareRecords`; the `compareVersions` function above them)
- Modify: `frontend/lib/api/remediation.ts` (append after `errorText`)
- Test: `frontend/lib/api/__tests__/compare-clients.test.ts`

**Interfaces:**
- Consumes: `apiClient` default export from `frontend/lib/api/client.ts` (axios instance), `BatchFilter` from `remediation.ts`.
- Produces:
  - `compareVersions(v1: string | undefined, v2: string, module?: string): Promise<VersionComparison>` (GET `/api/v1/versions/compare`, params `{ v1, v2, module }`; axios drops undefined params).
  - `export interface RecordDiff { v1: string; v2: string; totals: { new: number; resolved: number; persisting: number }; checks: RecordDiffCheck[] }` and `compareRecords(...): Promise<RecordDiff>`.
  - `export interface BatchCreated { id: string; name: string; status: BatchStatus; item_count: number }`
  - `createBatch(name: string, filter: BatchFilter): Promise<BatchCreated>` (POST `/api/v1/remediation/batches`, body `{ name, filter }`).

- [ ] **Step 1: Write the failing tests**

```ts
// frontend/lib/api/__tests__/compare-clients.test.ts
import { afterEach, describe, expect, it, vi } from "vitest";
import apiClient from "@/lib/api/client";
import { compareVersions } from "@/lib/api/versions";
import { createBatch } from "@/lib/api/remediation";

afterEach(() => vi.restoreAllMocks());

describe("compareVersions", () => {
  it("omits v1 so the API resolves the baseline", async () => {
    const get = vi.spyOn(apiClient, "get").mockResolvedValue({ data: { ok: true } });
    await compareVersions(undefined, "v2", "material_master");
    expect(get).toHaveBeenCalledWith("/api/v1/versions/compare", { params: { v1: undefined, v2: "v2", module: "material_master" } });
  });
});

describe("createBatch", () => {
  it("posts name and filter and returns the created batch", async () => {
    const created = { id: "b1", name: "Regressions MM041 Oct 8", status: "draft", item_count: 12 };
    const post = vi.spyOn(apiClient, "post").mockResolvedValue({ data: created });
    const result = await createBatch(created.name, { version_id: "v2", check_id: "MM041", module: "material_master" });
    expect(post).toHaveBeenCalledWith("/api/v1/remediation/batches", {
      name: created.name,
      filter: { version_id: "v2", check_id: "MM041", module: "material_master" },
    });
    expect(result).toEqual(created);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run lib/api/__tests__/compare-clients.test.ts`
Expected: FAIL. `createBatch` is not exported; `compareVersions` rejects `undefined` at typecheck (vitest may still run; the typecheck gate catches it).

- [ ] **Step 3: Change `compareVersions`, add `RecordDiff`, add `createBatch`**

In `frontend/lib/api/versions.ts` change the signature of `compareVersions` so the first parameter is `v1: string | undefined` (keep body and params object unchanged). Replace the inline return type of `compareRecords` with a named export placed directly above it:

```ts
export interface RecordDiff {
  v1: string;
  v2: string;
  totals: { new: number; resolved: number; persisting: number };
  checks: RecordDiffCheck[];
}

export async function compareRecords(v2: string, v1?: string, module?: string): Promise<RecordDiff> {
  const { data } = await apiClient.get("/api/v1/versions/compare/records", { params: { v1, v2, module } });
  return data;
}
```

Append to `frontend/lib/api/remediation.ts`:

```ts
export interface BatchCreated {
  id: string;
  name: string;
  status: BatchStatus;
  item_count: number;
}

/** Drafts a batch from the open issues matching `filter`. The API answers 400 when nothing matches or the cap is exceeded. */
export async function createBatch(name: string, filter: BatchFilter): Promise<BatchCreated> {
  const { data } = await apiClient.post<BatchCreated>("/api/v1/remediation/batches", { name, filter });
  return data;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run lib/api/__tests__/compare-clients.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Gate and commit**

Run: `cd frontend && npm run typecheck && npm run lint && npm run lint:tokens && npx vitest run`

```bash
git add frontend/lib/api/versions.ts frontend/lib/api/remediation.ts frontend/lib/api/__tests__/compare-clients.test.ts
git commit -m "Let compareVersions resolve the baseline and add the createBatch client"
```

---

### Task 3: Comparison narrative

**Files:**
- Create: `frontend/lib/narrative.ts`
- Test: `frontend/lib/__tests__/narrative.test.ts`

**Interfaces:**
- Consumes: `VersionComparison`, `ModuleDelta`, `CheckChange` from `@/types/api`; `RecordDiff` from `@/lib/api/versions` (Task 2); `formatModuleName` from `@/lib/format`.
- Produces: `compareNarrative(cmp: VersionComparison, diff: RecordDiff | null): string[]`.

Sentences, in order, each omitted when its data is empty:

1. `DQS moved from 71.2 to 74.8 (+3.6) across 3 modules.` Overall = mean of `v1_score` and of `v2_score` over `cmp.delta`. Omitted when `cmp.delta` is empty. Singular `module` when one.
2. `Material master improved most (+6.1), driven by validity (+9.0).` Module with the largest `|dqs_change|`; verb `improved` when positive, `declined` when negative; omitted when every change is 0. Dimension = the one with the largest `|change|` in that module, in the same direction; the `driven by` clause is omitted when the module has no dimensions.
3. `2 checks newly fail: MM041 (critical, 1 240 records), MM077 (high, 88 records).` From `cmp.checks.newly_failing`, sorted by `v2_affected` descending, first three listed, then `and N more` when longer. Singular `1 check newly fails:`.
4. `5 checks fixed, 3 410 records resolved.` Count from `cmp.checks.fixed`; records from `diff.totals.resolved`; when `diff` is null the sentence is `5 checks fixed.` Singular `1 check fixed`.
5. `4 checks did not run cleanly in both runs; their deltas are excluded.` Count of `diff.checks` with `comparable === false`. Omitted when zero or `diff` is null. Singular `1 check did not run cleanly in both runs; its delta is excluded.`

Numbers: `new Intl.NumberFormat("en-ZA")` for counts; scores `toFixed(1)`; signed deltas as `+3.6` / `-2.0`.

- [ ] **Step 1: Write the failing tests**

```ts
// frontend/lib/__tests__/narrative.test.ts
import { describe, expect, it } from "vitest";
import type { VersionComparison } from "@/types/api";
import type { RecordDiff } from "@/lib/api/versions";
import { compareNarrative } from "../narrative";

const nf = new Intl.NumberFormat("en-ZA");

const version = (id: string) => ({ id, label: null, status: "complete", run_at: "2026-10-08T00:00:00Z", dqs_summary: null, metadata: null });

function cmp(over: Partial<VersionComparison> = {}): VersionComparison {
  return {
    v1: version("v1"),
    v2: version("v2"),
    delta: {
      material_master: { dqs_change: 6.1, v1_score: 70.0, v2_score: 76.1, dimensions: { validity: { v1: 60, v2: 69, change: 9 }, completeness: { v1: 80, v2: 81, change: 1 } } },
      fi_gl: { dqs_change: 1.0, v1_score: 72.4, v2_score: 73.4, dimensions: {} },
    },
    checks: {
      newly_failing: [
        { check_id: "MM077", module: "material_master", severity: "high", v1_affected: 0, v2_affected: 88 },
        { check_id: "MM041", module: "material_master", severity: "critical", v1_affected: 0, v2_affected: 1240 },
      ],
      fixed: [
        { check_id: "FI001", module: "fi_gl", severity: "low", v1_affected: 10, v2_affected: 0 },
        { check_id: "FI002", module: "fi_gl", severity: "low", v1_affected: 10, v2_affected: 0 },
      ],
    },
    ...over,
  };
}

const diff: RecordDiff = {
  v1: "v1", v2: "v2",
  totals: { new: 1328, resolved: 3410, persisting: 5 },
  checks: [
    { check_id: "MM041", module: "material_master", severity: "critical", new: 1240, resolved: 0, persisting: 0, comparable: true },
    { check_id: "X1", module: "fi_gl", severity: "low", new: 0, resolved: 0, persisting: 0, comparable: false },
    { check_id: "X2", module: "fi_gl", severity: "low", new: 0, resolved: 0, persisting: 0, comparable: false },
  ],
};

describe("compareNarrative", () => {
  it("writes every sentence in order", () => {
    expect(compareNarrative(cmp(), diff)).toEqual([
      "DQS moved from 71.2 to 74.8 (+3.6) across 2 modules.",
      "Material master improved most (+6.1), driven by validity (+9.0).",
      `2 checks newly fail: MM041 (critical, ${nf.format(1240)} records), MM077 (high, ${nf.format(88)} records).`,
      `2 checks fixed, ${nf.format(3410)} records resolved.`,
      "2 checks did not run cleanly in both runs; their deltas are excluded.",
    ]);
  });

  it("omits empty sentences and handles the null diff", () => {
    const out = compareNarrative(cmp({ delta: {}, checks: { newly_failing: [], fixed: [cmp().checks.fixed[0]] } }), null);
    expect(out).toEqual(["1 check fixed."]);
  });

  it("names a decline and caps the regression list at three", () => {
    const many = Array.from({ length: 5 }, (_, i) => ({ check_id: `C${i}`, module: "fi_gl", severity: "low", v1_affected: 0, v2_affected: 10 - i }));
    const out = compareNarrative(
      cmp({ delta: { fi_gl: { dqs_change: -2, v1_score: 70, v2_score: 68, dimensions: { accuracy: { v1: 50, v2: 46, change: -4 } } } }, checks: { newly_failing: many, fixed: [] } }),
      null,
    );
    expect(out[0]).toBe("DQS moved from 70.0 to 68.0 (-2.0) across 1 module.");
    expect(out[1]).toBe("Fi gl declined most (-2.0), driven by accuracy (-4.0).");
    expect(out[2]).toBe("5 checks newly fail: C0 (low, 10 records), C1 (low, 9 records), C2 (low, 8 records), and 2 more.");
    expect(out).toHaveLength(3);
  });
});
```

If `formatModuleName("fi_gl")` returns something other than `Fi gl` (check `frontend/lib/format.ts`), use its actual output in the test; the rule is "use `formatModuleName`", not the literal text.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run lib/__tests__/narrative.test.ts`
Expected: FAIL, cannot resolve `../narrative`.

- [ ] **Step 3: Write the implementation**

```ts
// frontend/lib/narrative.ts
import type { VersionComparison } from "@/types/api";
import type { RecordDiff } from "@/lib/api/versions";
import { formatModuleName } from "@/lib/format";

const nf = new Intl.NumberFormat("en-ZA");
const score = (n: number) => n.toFixed(1);
const signed = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(1)}`;
const plural = (n: number, one: string, many: string) => `${nf.format(n)} ${n === 1 ? one : many}`;

function overallSentence(cmp: VersionComparison): string | null {
  const deltas = Object.values(cmp.delta);
  if (deltas.length === 0) return null;
  const mean = (pick: (d: (typeof deltas)[number]) => number) => deltas.reduce((a, d) => a + pick(d), 0) / deltas.length;
  const before = mean((d) => d.v1_score);
  const after = mean((d) => d.v2_score);
  return `DQS moved from ${score(before)} to ${score(after)} (${signed(after - before)}) across ${plural(deltas.length, "module", "modules")}.`;
}

function moverSentence(cmp: VersionComparison): string | null {
  const entries = Object.entries(cmp.delta).filter(([, d]) => d.dqs_change !== 0);
  if (entries.length === 0) return null;
  const [name, d] = entries.sort(([, a], [, b]) => Math.abs(b.dqs_change) - Math.abs(a.dqs_change))[0];
  const verb = d.dqs_change > 0 ? "improved" : "declined";
  const dims = Object.entries(d.dimensions).sort(([, a], [, b]) => Math.abs(b.change) - Math.abs(a.change));
  const driver = dims[0] ? `, driven by ${dims[0][0]} (${signed(dims[0][1].change)})` : "";
  return `${formatModuleName(name)} ${verb} most (${signed(d.dqs_change)})${driver}.`;
}

function regressionSentence(cmp: VersionComparison): string | null {
  const failing = [...cmp.checks.newly_failing].sort((a, b) => b.v2_affected - a.v2_affected);
  if (failing.length === 0) return null;
  const listed = failing.slice(0, 3).map((c) => `${c.check_id} (${c.severity}, ${nf.format(c.v2_affected)} records)`);
  const more = failing.length > 3 ? `, and ${nf.format(failing.length - 3)} more` : "";
  const head = failing.length === 1 ? "1 check newly fails" : `${nf.format(failing.length)} checks newly fail`;
  return `${head}: ${listed.join(", ")}${more}.`;
}

function fixedSentence(cmp: VersionComparison, diff: RecordDiff | null): string | null {
  const n = cmp.checks.fixed.length;
  if (n === 0) return null;
  const head = plural(n, "check fixed", "checks fixed");
  return diff ? `${head}, ${nf.format(diff.totals.resolved)} records resolved.` : `${head}.`;
}

function excludedSentence(diff: RecordDiff | null): string | null {
  const n = diff?.checks.filter((c) => !c.comparable).length ?? 0;
  if (n === 0) return null;
  return n === 1
    ? "1 check did not run cleanly in both runs; its delta is excluded."
    : `${nf.format(n)} checks did not run cleanly in both runs; their deltas are excluded.`;
}

/** Template sentences describing a comparison. Pure; every number comes from the API payloads. */
export function compareNarrative(cmp: VersionComparison, diff: RecordDiff | null): string[] {
  return [overallSentence(cmp), moverSentence(cmp), regressionSentence(cmp), fixedSentence(cmp, diff), excludedSentence(diff)]
    .filter((s): s is string => s !== null);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run lib/__tests__/narrative.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Gate and commit**

Run: `cd frontend && npm run typecheck && npm run lint && npm run lint:tokens && npx vitest run`

```bash
git add frontend/lib/narrative.ts frontend/lib/__tests__/narrative.test.ts
git commit -m "Add the deterministic comparison narrative"
```

---

### Task 4: Runs list with DQS, two-run compare and per-system sparklines

**Files:**
- Modify: `frontend/app/(app)/runs/page.tsx` (replace whole file)
- Modify: `frontend/app/(app)/runs/__tests__/page.test.tsx` (replace whole file)

**Interfaces:**
- Consumes: `overallDqs`, `runSeries` from `@/lib/runs` (Task 1); `useUrlState` from `@/hooks/use-url-state`; `DataTable` `bulkActions?: (selected: T[]) => ReactNode` (selection column checkboxes are labelled `Select row {id}`); `Sparkline({ data: ChartPoint[] })`; `Button`; `queryKeys.run("list")`, `queryKeys.versionsList(filters)`.
- Produces: the runs page. No new exports.

Behaviour:
- Table query: `queryKeys.versionsList({ system_id: system || undefined })` with `getVersions(system ? { system_id: system } : undefined)` where `system` is `useUrlState("system")`.
- Sparkline query: `queryKeys.run("list")` with `getVersions()` (unfiltered). One sparkline per scope from `runSeries(versions)`, labelled with the system name (or `Imported files` for `upload`), rendered as a button that sets the `system` URL state (`upload` sets it to empty, since the API has no upload filter). The active scope shows a `Pill tone="go"`. A `Show all` ghost button clears the filter when one is set.
- Columns: Run, Status, Started, System, Modules, DQS (`overallDqs` to one decimal or `—`).
- `bulkActions`: when exactly two rows are selected, a primary `Compare` button that pushes `/runs/{newer}/vs/{older}` where newer is the row with the later `run_at`; otherwise the text `Select exactly two runs to compare`.

- [ ] **Step 1: Write the failing tests**

```tsx
// frontend/app/(app)/runs/__tests__/page.test.tsx
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as systemsApi from "@/lib/api/systems";
import type { SAPSystem } from "@/lib/api/systems";
import * as versionsApi from "@/lib/api/versions";
import type { Version } from "@/types/api";
import RunsPage from "../page";

const push = vi.fn();
const searchParams = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/runs",
  useSearchParams: () => searchParams,
}));

const dqs = (composite_score: number) => ({
  composite_score, dimension_scores: {}, critical_count: 0, high_count: 0, medium_count: 0, low_count: 0,
  total_checks: 0, passing_checks: 0, capped: false, cap_reason: null,
});

function version(over: Partial<Version> & { id: string }): Version {
  return {
    label: null, status: "complete", run_at: "2026-10-08T00:00:00Z", dqs_summary: null,
    metadata: { modules: ["material_master"], file_name: "upload.csv", row_count: 10, system_id: "sys-1" },
    ...over,
  };
}

const system: SAPSystem = {
  id: "sys-1", name: "ECC Prod", system_type: "ecc", host: null, client: null, sysnr: null, username: null,
  base_url: null, company_id: null, auth_type: null, description: null, environment: "PRD", is_active: true,
  created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", last_sync_at: null, last_sync_status: null,
};

const newer = version({ id: "v2", label: "Oct 8 upload", dqs_summary: { material_master: dqs(74.8) } });
const older = version({ id: "v1", label: "Oct 1 upload", run_at: "2026-10-01T00:00:00Z", dqs_summary: { material_master: dqs(71.2) } });

describe("RunsPage", () => {
  it("shows the DQS column and a sparkline per system", async () => {
    vi.spyOn(versionsApi, "getVersions").mockResolvedValue({ versions: [newer, older] });
    vi.spyOn(systemsApi, "getSystems").mockResolvedValue([system]);
    renderWithQuery(<RunsPage />);
    await waitFor(() => expect(screen.getByText("Oct 8 upload")).toBeInTheDocument());
    expect(screen.getByText("74.8")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /ECC Prod/ })).toBeInTheDocument();
  });

  it("compares the newer run against the older one when two rows are selected", async () => {
    vi.spyOn(versionsApi, "getVersions").mockResolvedValue({ versions: [newer, older] });
    vi.spyOn(systemsApi, "getSystems").mockResolvedValue([system]);
    renderWithQuery(<RunsPage />);
    await waitFor(() => expect(screen.getByText("Oct 8 upload")).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("Select row v1"));
    expect(screen.getByText("Select exactly two runs to compare")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Select row v2"));
    fireEvent.click(screen.getByRole("button", { name: "Compare" }));
    expect(push).toHaveBeenCalledWith("/runs/v2/vs/v1");
  });

  it("shows the empty state when there are no runs", async () => {
    vi.spyOn(versionsApi, "getVersions").mockResolvedValue({ versions: [] });
    vi.spyOn(systemsApi, "getSystems").mockResolvedValue([]);
    renderWithQuery(<RunsPage />);
    await waitFor(() => expect(screen.getByText(/no runs/i)).toBeInTheDocument());
  });
});
```

If the existing test file's `SAPSystem` fixture has different field names from the one above, keep the existing fixture's shape (it compiles against the real type) and only add the three tests.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run "app/(app)/runs/__tests__/page.test.tsx"`
Expected: FAIL, no `74.8` text, no `Select row v1` checkbox.

- [ ] **Step 3: Write the page**

```tsx
// frontend/app/(app)/runs/page.tsx
"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Button, DataTable, ExplorerPage, Pill, Sparkline } from "@/design";
import { useUrlState } from "@/hooks/use-url-state";
import { getSystems } from "@/lib/api/systems";
import { getVersions } from "@/lib/api/versions";
import { formatDate, formatModuleName } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";
import { overallDqs, runSeries } from "@/lib/runs";
import type { Version } from "@/types/api";

function makeColumns(systemName: Map<string, string>): ColumnDef<Version>[] {
  return [
    { id: "label", accessorFn: (v) => v.label ?? v.id, header: "Run" },
    { accessorKey: "status", header: "Status" },
    { id: "run_at", accessorFn: (v) => v.run_at, header: "Started", cell: ({ row }) => formatDate(row.original.run_at, "datetime") },
    { id: "system", accessorFn: (v) => systemName.get(v.metadata?.system_id ?? "") ?? "—", header: "System" },
    { id: "modules", accessorFn: (v) => (v.metadata?.modules ?? []).map(formatModuleName).join(", "), header: "Modules" },
    {
      id: "dqs",
      accessorFn: (v) => overallDqs(v) ?? -1,
      header: "DQS",
      cell: ({ row }) => {
        const dqs = overallDqs(row.original);
        return dqs === null ? "—" : <span className="tabular-nums">{dqs.toFixed(1)}</span>;
      },
    },
  ];
}

function scopeName(scope: string, systemName: Map<string, string>): string {
  return scope === "upload" ? "Imported files" : (systemName.get(scope) ?? scope);
}

export default function RunsPage() {
  const router = useRouter();
  const [system, setSystem] = useUrlState("system");

  const all = useQuery({ queryKey: queryKeys.run("list"), queryFn: () => getVersions() });
  const filtered = useQuery({
    queryKey: queryKeys.versionsList({ system_id: system || undefined }),
    queryFn: () => getVersions(system ? { system_id: system } : undefined),
  });
  const systems = useQuery({ queryKey: queryKeys.systems(), queryFn: getSystems });

  const systemName = useMemo(() => new Map((systems.data ?? []).map((s) => [s.id, s.name])), [systems.data]);
  const columns = useMemo(() => makeColumns(systemName), [systemName]);
  const series = useMemo(() => runSeries(all.data?.versions ?? []), [all.data]);
  const rows = filtered.data?.versions ?? [];

  const state = filtered.isLoading ? "loading" : filtered.isError ? "error" : rows.length === 0 ? "empty" : undefined;

  const summary = series.length > 0 && (
    <div className="flex flex-wrap items-center gap-3">
      {series.map((s) => {
        const active = system === (s.scope === "upload" ? "" : s.scope);
        return (
          <button
            key={s.scope}
            type="button"
            onClick={() => setSystem(s.scope === "upload" ? "" : s.scope)}
            className="flex items-center gap-2 rounded border px-2 py-1 text-[13px]"
            style={{ borderColor: "var(--m-line)", background: "var(--m-sheet)" }}
          >
            <span>{scopeName(s.scope, systemName)}</span>
            <Sparkline data={s.points} />
            {active && system ? <Pill tone="go">Filtered</Pill> : null}
          </button>
        );
      })}
      {system ? <Button variant="ghost" onClick={() => setSystem("")}>Show all</Button> : null}
    </div>
  );

  return (
    <ExplorerPage
      summary={summary}
      table={
        <DataTable
          columns={columns}
          data={rows}
          getRowId={(row) => row.id}
          onRowClick={(row) => router.push(`/runs/${row.id}`)}
          bulkActions={(selected) =>
            selected.length === 2 ? (
              <Button
                onClick={() => {
                  const [a, b] = selected;
                  const [newer, older] = a.run_at >= b.run_at ? [a, b] : [b, a];
                  router.push(`/runs/${newer.id}/vs/${older.id}`);
                }}
              >
                Compare
              </Button>
            ) : (
              <span className="text-[13px]" style={{ color: "var(--m-ink-2)" }}>Select exactly two runs to compare</span>
            )
          }
        />
      }
      state={state}
      emptyProps={{ title: "No runs yet. Upload a file or connect a system to start a run." }}
      errorProps={{ message: `Couldn't load runs. ${filtered.error?.message ?? ""}`.trim(), onRetry: () => filtered.refetch() }}
    />
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run "app/(app)/runs/__tests__/page.test.tsx"`
Expected: PASS, 3 tests. If recharts logs a `width(0)` warning in jsdom, that is noise, not a failure.

- [ ] **Step 5: Gate and commit**

Run: `cd frontend && npm run typecheck && npm run lint && npm run lint:tokens && npx vitest run`

```bash
git add "frontend/app/(app)/runs/page.tsx" "frontend/app/(app)/runs/__tests__/page.test.tsx"
git commit -m "Show DQS, per-system trend sparklines and two-run compare on the runs list"
```

---

### Task 5: Run detail compare and baseline actions

**Files:**
- Modify: `frontend/app/(app)/runs/[versionId]/page.tsx` (replace whole file)
- Modify: `frontend/app/(app)/runs/[versionId]/__tests__/page.test.tsx` (replace whole file)

**Interfaces:**
- Consumes: `previousRunId`, `baselineRunId`, `scopeOf` from `@/lib/runs` (Task 1); `pinBaseline(id, pinned)` and `getVersions` from `@/lib/api/versions`; `useRole().can("analyse")`; `queryKeys.run(id)`, `queryKeys.run("list")`, `queryKeys.versionsList(filters)`.
- Produces: the run detail page. No new exports.

Behaviour (all actions live in the narrative block, under the title line):
- `Compare with previous` (secondary) links to `/runs/{versionId}/vs/{prevId}`; hidden when `previousRunId` is null.
- `Compare with baseline` (secondary) links to `/runs/{versionId}/vs/baseline`; shown only when `baselineRunId` is non-null.
- `Pin as baseline` / `Unpin baseline` (ghost) shown only to users with the `analyse` permission; calls `pinBaseline(versionId, !isBaseline)` and on success invalidates `queryKeys.run(versionId)`, `queryKeys.run("list")` and the `["versions-list"]` prefix; on error `toast.error(message)`.
- A `Pill tone="go"` reading `Baseline` next to the status pill when `metadata.baseline === true`.
- Scope list query: `queryKeys.versionsList({ system_id })` where `system_id` is `version.metadata?.system_id`, fetched with `getVersions(system_id ? { system_id } : undefined)`, enabled once the version has loaded.

- [ ] **Step 1: Write the failing tests**

```tsx
// frontend/app/(app)/runs/[versionId]/__tests__/page.test.tsx
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as runsApi from "@/lib/api/v1/runs";
import * as versionsApi from "@/lib/api/versions";
import type { Version } from "@/types/api";
import RunDetailPage from "../page";

vi.mock("next/navigation", () => ({ useParams: () => ({ versionId: "v2" }) }));

const can = vi.fn((action: string) => action === "analyse");
vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ role: "analyst", can, isAdmin: false, isManager: false, isViewer: false }) }));

function version(over: Partial<Version> & { id: string }): Version {
  return {
    label: null, status: "complete", run_at: "2026-10-08T00:00:00Z", dqs_summary: null,
    metadata: { modules: ["material_master"], file_name: "f.csv", row_count: 1, system_id: "sys-1" },
    ...over,
  };
}

const current = version({ id: "v2", label: "Oct 8" });
const previous = version({ id: "v1", label: "Oct 1", run_at: "2026-10-01T00:00:00Z" });
const baseline = version({ id: "v0", label: "Go-live baseline", run_at: "2026-09-01T00:00:00Z", metadata: { modules: [], file_name: "f.csv", row_count: 1, system_id: "sys-1", baseline: true } });

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(runsApi, "getRunSteps").mockResolvedValue({ version_id: "v2", steps: [] });
});

describe("RunDetailPage", () => {
  it("renders the decisive error of a failed step", async () => {
    vi.spyOn(versionsApi, "getVersion").mockResolvedValue(version({ id: "v2", label: "Oct 8", status: "failed" }));
    vi.spyOn(versionsApi, "getVersions").mockResolvedValue({ versions: [] });
    vi.spyOn(runsApi, "getRunSteps").mockResolvedValue({
      version_id: "v2",
      steps: [{ step_number: 4, step_name: "Generating AI insights", status: "failed", started_at: "t0", finished_at: "t1", duration_ms: 1200, error_detail: "LLM provider timed out after 120s" }],
    });
    renderWithQuery(<RunDetailPage />);
    await waitFor(() => expect(screen.getByText("LLM provider timed out after 120s")).toBeInTheDocument());
  });

  it("links to the previous run and the baseline", async () => {
    vi.spyOn(versionsApi, "getVersion").mockResolvedValue(current);
    vi.spyOn(versionsApi, "getVersions").mockResolvedValue({ versions: [current, previous, baseline] });
    renderWithQuery(<RunDetailPage />);
    await waitFor(() => expect(screen.getByRole("link", { name: "Compare with previous" })).toHaveAttribute("href", "/runs/v2/vs/v1"));
    expect(screen.getByRole("link", { name: "Compare with baseline" })).toHaveAttribute("href", "/runs/v2/vs/baseline");
  });

  it("hides compare links when there is nothing to compare with", async () => {
    vi.spyOn(versionsApi, "getVersion").mockResolvedValue(current);
    vi.spyOn(versionsApi, "getVersions").mockResolvedValue({ versions: [current] });
    renderWithQuery(<RunDetailPage />);
    await waitFor(() => expect(screen.getByText("Oct 8")).toBeInTheDocument());
    expect(screen.queryByRole("link", { name: /Compare with/ })).toBeNull();
  });

  it("pins the run as baseline and shows the pill", async () => {
    vi.spyOn(versionsApi, "getVersion").mockResolvedValue(current);
    vi.spyOn(versionsApi, "getVersions").mockResolvedValue({ versions: [current] });
    const pin = vi.spyOn(versionsApi, "pinBaseline").mockResolvedValue({ baseline: true });
    renderWithQuery(<RunDetailPage />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Pin as baseline" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Pin as baseline" }));
    await waitFor(() => expect(pin).toHaveBeenCalledWith("v2", true));
  });

  it("shows the Baseline pill and the unpin action for a pinned run", async () => {
    vi.spyOn(versionsApi, "getVersion").mockResolvedValue(baseline);
    vi.spyOn(versionsApi, "getVersions").mockResolvedValue({ versions: [baseline] });
    renderWithQuery(<RunDetailPage />);
    await waitFor(() => expect(screen.getByText("Baseline")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Unpin baseline" })).toBeInTheDocument();
  });
});
```

If `vi.mock("next/navigation")` needs `useParams` to return `v0` for the last test, keep one mock returning `v2` and instead make the `getVersion` spy return `baseline` with `id: "v2"` (copy the object and override `id`). The assertions do not depend on the id.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run "app/(app)/runs/[versionId]/__tests__/page.test.tsx"`
Expected: FAIL, no `Compare with previous` link.

- [ ] **Step 3: Write the page**

Keep the existing `STATUS_TONE`, `statusTone`, steps columns and steps table exactly as they are. Replace the component body with:

```tsx
// frontend/app/(app)/runs/[versionId]/page.tsx  (component only; keep the file's existing imports, STATUS_TONE, statusTone and stepColumns)
"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button, DataTable, ErrorState, Pill, ReportPage } from "@/design";
import { useRole } from "@/hooks/use-role";
import { getRunSteps } from "@/lib/api/v1/runs";
import { getVersion, getVersions, pinBaseline } from "@/lib/api/versions";
import { formatDate } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";
import { baselineRunId, previousRunId } from "@/lib/runs";

export default function RunDetailPage() {
  const { versionId } = useParams<{ versionId: string }>();
  const qc = useQueryClient();
  const { can } = useRole();

  const version = useQuery({ queryKey: queryKeys.run(versionId), queryFn: () => getVersion(versionId) });
  const steps = useQuery({ queryKey: [...queryKeys.run(versionId), "steps"], queryFn: () => getRunSteps(versionId) });
  const systemId = version.data?.metadata?.system_id;
  const scope = useQuery({
    queryKey: queryKeys.versionsList({ system_id: systemId }),
    queryFn: () => getVersions(systemId ? { system_id: systemId } : undefined),
    enabled: version.isSuccess,
  });

  const isBaseline = version.data?.metadata?.baseline === true;
  const pin = useMutation({
    mutationFn: () => pinBaseline(versionId, !isBaseline),
    onSuccess: () => {
      toast.success(isBaseline ? "Baseline unpinned" : "Pinned as baseline");
      qc.invalidateQueries({ queryKey: queryKeys.run(versionId) });
      qc.invalidateQueries({ queryKey: queryKeys.run("list") });
      qc.invalidateQueries({ queryKey: ["versions-list"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (version.isError) {
    return <ErrorState message="Couldn't load this run." onRetry={() => version.refetch()} />;
  }

  const v = version.data;
  const runs = scope.data?.versions ?? [];
  const prevId = v ? previousRunId(v, runs) : null;
  const baseId = v ? baselineRunId(v, runs) : null;
  const stepRows = steps.data?.steps ?? [];
  const state = steps.isLoading ? "loading" : steps.isError ? "error" : stepRows.length === 0 ? "empty" : undefined;

  const narrative = v ? (
    <div className="flex flex-col gap-2">
      <p className="flex items-center gap-2">
        <span>{v.label ?? versionId} — started {formatDate(v.run_at, "datetime")}.</span>
        <Pill tone={statusTone(v.status)}>{v.status}</Pill>
        {isBaseline ? <Pill tone="go">Baseline</Pill> : null}
      </p>
      <div className="flex flex-wrap gap-2">
        {prevId ? <Link href={`/runs/${versionId}/vs/${prevId}`}><Button variant="secondary">Compare with previous</Button></Link> : null}
        {baseId ? <Link href={`/runs/${versionId}/vs/baseline`}><Button variant="secondary">Compare with baseline</Button></Link> : null}
        {can("analyse") ? (
          <Button variant="ghost" disabled={pin.isPending} onClick={() => pin.mutate()}>
            {isBaseline ? "Unpin baseline" : "Pin as baseline"}
          </Button>
        ) : null}
      </div>
    </div>
  ) : (
    <p>Loading run…</p>
  );

  return (
    <ReportPage
      narrative={narrative}
      charts={null}
      tables={<DataTable columns={stepColumns} data={stepRows} getRowId={(s) => String(s.step_number)} />}
      state={state}
      emptyProps={{ title: "No step history for this run yet." }}
      errorProps={{ message: "Couldn't load the run steps.", onRetry: () => steps.refetch() }}
    />
  );
}
```

Rename the existing steps column array to `stepColumns` if it has another name, so the snippet compiles. Wrapping a `Button` in `Link` keeps the accessible name on the link (`getByRole("link", { name })` matches the button text).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run "app/(app)/runs/[versionId]/__tests__/page.test.tsx"`
Expected: PASS, 5 tests.

- [ ] **Step 5: Gate and commit**

Run: `cd frontend && npm run typecheck && npm run lint && npm run lint:tokens && npx vitest run`

```bash
git add "frontend/app/(app)/runs/[versionId]/page.tsx" "frontend/app/(app)/runs/[versionId]/__tests__/page.test.tsx"
git commit -m "Add compare and baseline actions to the run detail page"
```

---

### Task 6: Comparison report page

**Files:**
- Modify: `frontend/app/(app)/runs/[versionId]/vs/[b]/page.tsx` (replace whole file)
- Modify: `frontend/app/(app)/runs/[versionId]/vs/[b]/__tests__/page.test.tsx` (replace whole file)

**Interfaces:**
- Consumes: `compareVersions(v1 | undefined, v2, module?)`, `compareRecords(v2, v1?, module?)`, `compareRecordKeys`, `RecordDiff`, `RecordDiffCheck` from `@/lib/api/versions` (Task 2); `createBatch`, `errorText` from `@/lib/api/remediation` (Task 2); `compareNarrative` from `@/lib/narrative` (Task 3); `getComparisonReportUrl` from `@/lib/api/reports`; `downloadAuthenticated` from `@/lib/api/download`; `useUrlState("module")`; `useRole().can("apply")`; design `ReportPage, Stat, Delta, Bar, Mono, Pill, Button, DataTable, Sparkline, Waterfall, Pager, Skeleton`; `queryKeys.runCompare(a, b)`.
- Produces: the comparison page. No new exports.

Semantics: `versionId` param is `v2` (newer); `b` is `v1` (older) or `"baseline"`. `const v1Param = b === "baseline" ? undefined : b`. Both queries key on `queryKeys.runCompare(versionId, b)` plus a discriminator and the module: `[...runCompare(versionId, b), "modules", module]` for `compareVersions(v1Param, versionId, module || undefined)` and `[...runCompare(versionId, b), "records", module]` for `compareRecords(versionId, v1Param, module || undefined)`. The record keys query and local filter stay as today, with `v1: diff.v1, v2: versionId` (resolved ids from the records response).

Layout, top to bottom, inside `ReportPage`:
- `narrative`: header line `{v2 label} vs {v1 label}` (labels from `cmp.v1`/`cmp.v2`, `label ?? formatDate(run_at, "date")`), a `Baseline` pill after the v1 label when `b === "baseline"`, then one `<p>` per `compareNarrative` sentence. Under the header: `Download PDF` (secondary, calls `downloadAuthenticated(getComparisonReportUrl(versionId, v1Param), "comparison.pdf")`, `toast.error` on failure), a module `<select>` labelled `Module` listing `All modules` plus the keys of `cmp.delta`, bound to the `module` URL state.
- `charts`: one card per module in `cmp.delta` (`<section aria-label={formatModuleName(name)}>`), containing three `Stat`s (Before `v1_score.toFixed(1)`, After `v2_score.toFixed(1)`, Change `<Delta value={round1(dqs_change)} />`), a `Bar` with one point per dimension `{ x: dimension, y: round1(change), dimension }`, and two lists:
  - `Newly failing`: rows for `cmp.checks.newly_failing` filtered to the module. Each row is a `<button>` that sets `checkId` (opens the record drill below), showing `<Mono>{check_id}</Mono>`, `<Pill tone={severityTone(severity)}>{severity}</Pill>` and `{nf.format(v2_affected)} records`; next to it a `Create fix batch` ghost button when `can("apply")`. The list header carries a bulk `Create fix batches` button (when `can("apply")` and the list is non-empty) that creates one batch per row sequentially.
  - `Fixed`: same rows without the batch button, count = `v1_affected`.
  - `severityTone`: `critical`/`high` → `no-go`, `medium` → `at-risk`, else `neutral`.
- `tables`: the existing record diff `DataTable` (columns Check, Severity, New, Resolved, Persisting, Trend) over `diff.checks`, the `Waterfall`, and the existing record-keys drill with its filter input (`aria-label="Filter record keys"`) and `Pager`, unchanged in behaviour.
- `createBatch` mutation: `createBatch(`Regressions ${check_id} ${v2Label}`, { version_id: versionId, check_id, module })`; on success `toast.success("Batch created", { action: { label: "Open batches", onClick: () => router.push("/fix?tab=batches") } })` and invalidate `queryKeys.remediationBatches()`; on error `toast.error(errorText(e))` (shows the API's 400 detail verbatim).
- `state`: `loading` while either query loads; `error` when either errors (`Couldn't compare these runs.`); `empty` when `cmp.delta` is empty and `diff.checks` is empty (`No differences. These two runs have identical results.`).

- [ ] **Step 1: Write the failing tests**

```tsx
// frontend/app/(app)/runs/[versionId]/vs/[b]/__tests__/page.test.tsx
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithQuery } from "@/__tests__/render";
import * as downloadApi from "@/lib/api/download";
import * as remediationApi from "@/lib/api/remediation";
import * as versionsApi from "@/lib/api/versions";
import type { RecordDiff } from "@/lib/api/versions";
import type { VersionComparison } from "@/types/api";
import CompareRunsPage from "../page";

let params = { versionId: "v2", b: "v1" };
const push = vi.fn();
const searchParams = new URLSearchParams();
vi.mock("next/navigation", () => ({
  useParams: () => params,
  useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/runs/v2/vs/v1",
  useSearchParams: () => searchParams,
}));
const can = vi.fn((action: string) => action === "apply");
vi.mock("@/hooks/use-role", () => ({ useRole: () => ({ role: "steward", can, isAdmin: false, isManager: true, isViewer: false }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const version = (id: string, label: string) => ({ id, label, status: "complete", run_at: "2026-10-08T00:00:00Z", dqs_summary: null, metadata: null });

const cmp: VersionComparison = {
  v1: version("v1", "Oct 1"),
  v2: version("v2", "Oct 8"),
  delta: {
    material_master: { dqs_change: 3.6, v1_score: 71.2, v2_score: 74.8, dimensions: { validity: { v1: 60, v2: 69, change: 9 } } },
  },
  checks: {
    newly_failing: [{ check_id: "MM041", module: "material_master", severity: "critical", v1_affected: 0, v2_affected: 1240 }],
    fixed: [{ check_id: "MM002", module: "material_master", severity: "low", v1_affected: 7, v2_affected: 0 }],
  },
};

const diff: RecordDiff = {
  v1: "v1", v2: "v2",
  totals: { new: 1240, resolved: 7, persisting: 20 },
  checks: [{ check_id: "MM041", module: "material_master", severity: "critical", new: 1240, resolved: 0, persisting: 20, comparable: true }],
};

beforeEach(() => {
  vi.restoreAllMocks();
  params = { versionId: "v2", b: "v1" };
  vi.spyOn(versionsApi, "compareVersions").mockResolvedValue(cmp);
  vi.spyOn(versionsApi, "compareRecords").mockResolvedValue(diff);
  vi.spyOn(versionsApi, "compareRecordKeys").mockResolvedValue({ record_keys: [] });
});

describe("CompareRunsPage", () => {
  it("renders the narrative, module card and record diff table", async () => {
    renderWithQuery(<CompareRunsPage />);
    await waitFor(() => expect(screen.getByText("DQS moved from 71.2 to 74.8 (+3.6) across 1 module.")).toBeInTheDocument());
    expect(screen.getByText("Oct 8 vs Oct 1")).toBeInTheDocument();
    expect(screen.getByText("74.8")).toBeInTheDocument();
    expect(screen.getAllByText("MM041").length).toBeGreaterThan(0);
    expect(screen.getByText("MM002")).toBeInTheDocument();
  });

  it("asks the API to resolve the baseline when b is the literal", async () => {
    params = { versionId: "v2", b: "baseline" };
    renderWithQuery(<CompareRunsPage />);
    await waitFor(() => expect(versionsApi.compareVersions).toHaveBeenCalledWith(undefined, "v2", undefined));
    expect(versionsApi.compareRecords).toHaveBeenCalledWith("v2", undefined, undefined);
    await waitFor(() => expect(screen.getByText("Baseline")).toBeInTheDocument());
  });

  it("downloads the comparison PDF", async () => {
    const dl = vi.spyOn(downloadApi, "downloadAuthenticated").mockResolvedValue();
    renderWithQuery(<CompareRunsPage />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Download PDF" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Download PDF" }));
    expect(dl).toHaveBeenCalledWith("/api/v1/reports/compare.pdf?v2=v2&v1=v1", "comparison.pdf");
  });

  it("creates a fix batch for a newly failing check", async () => {
    const create = vi.spyOn(remediationApi, "createBatch").mockResolvedValue({ id: "b1", name: "Regressions MM041 Oct 8", status: "draft", item_count: 1240 });
    renderWithQuery(<CompareRunsPage />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Create fix batch" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Create fix batch" }));
    await waitFor(() => expect(create).toHaveBeenCalledWith("Regressions MM041 Oct 8", { version_id: "v2", check_id: "MM041", module: "material_master" }));
  });

  it("hides fix batch actions without the apply permission", async () => {
    can.mockImplementation(() => false);
    renderWithQuery(<CompareRunsPage />);
    await waitFor(() => expect(screen.getByText("Oct 8 vs Oct 1")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /Create fix batch/ })).toBeNull();
    can.mockImplementation((action: string) => action === "apply");
  });

  it("shows an empty state when there is nothing to compare", async () => {
    vi.spyOn(versionsApi, "compareVersions").mockResolvedValue({ ...cmp, delta: {}, checks: { newly_failing: [], fixed: [] } });
    vi.spyOn(versionsApi, "compareRecords").mockResolvedValue({ ...diff, totals: { new: 0, resolved: 0, persisting: 0 }, checks: [] });
    renderWithQuery(<CompareRunsPage />);
    await waitFor(() => expect(screen.getByText(/no differences/i)).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run "app/(app)/runs/[versionId]/vs/[b]/__tests__/page.test.tsx"`
Expected: FAIL, narrative text not found.

- [ ] **Step 3: Write the page**

```tsx
// frontend/app/(app)/runs/[versionId]/vs/[b]/page.tsx
"use client";

import { useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { Bar, Button, DataTable, Delta, Mono, Pager, Pill, ReportPage, Sparkline, Stat, Waterfall, type PillTone } from "@/design";
import { useRole } from "@/hooks/use-role";
import { useUrlState } from "@/hooks/use-url-state";
import { downloadAuthenticated } from "@/lib/api/download";
import { createBatch, errorText } from "@/lib/api/remediation";
import { getComparisonReportUrl } from "@/lib/api/reports";
import { compareRecordKeys, compareRecords, compareVersions, type RecordDiffCheck } from "@/lib/api/versions";
import { formatDate, formatModuleName } from "@/lib/format";
import { compareNarrative } from "@/lib/narrative";
import { queryKeys } from "@/lib/query-keys";
import type { CheckChange, Version } from "@/types/api";

const KEYS_PAGE_SIZE = 25;
const nf = new Intl.NumberFormat("en-ZA");
const round1 = (n: number) => Math.round(n * 10) / 10;
const runLabel = (v: Version) => v.label ?? formatDate(v.run_at, "date");

function severityTone(severity: string): PillTone {
  if (severity === "critical" || severity === "high") return "no-go";
  if (severity === "medium") return "at-risk";
  return "neutral";
}

const diffColumns: ColumnDef<RecordDiffCheck>[] = [
  { accessorKey: "check_id", header: "Check", cell: ({ row }) => <Mono>{row.original.check_id}</Mono> },
  { accessorKey: "severity", header: "Severity" },
  { accessorKey: "new", header: "New" },
  { accessorKey: "resolved", header: "Resolved" },
  { accessorKey: "persisting", header: "Persisting" },
  {
    id: "trend",
    header: "Trend",
    enableSorting: false,
    cell: ({ row }) => {
      const c = row.original;
      return <Sparkline data={[{ x: "before", y: c.persisting + c.resolved }, { x: "after", y: c.persisting + c.new }]} />;
    },
  },
];

function CheckList({ title, rows, count, onOpen, action, bulk }: {
  title: string;
  rows: CheckChange[];
  count: (c: CheckChange) => number;
  onOpen: (checkId: string) => void;
  action?: (c: CheckChange) => React.ReactNode;
  bulk?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <h3 className="text-[13px] font-medium" style={{ color: "var(--m-ink-2)" }}>{title}</h3>
        {bulk}
      </div>
      {rows.length === 0 ? (
        <p className="text-[13px]" style={{ color: "var(--m-ink-3)" }}>None</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {rows.map((c) => (
            <li key={c.check_id} className="flex items-center gap-2 text-[13px]">
              <button type="button" className="flex items-center gap-2" onClick={() => onOpen(c.check_id)}>
                <Mono>{c.check_id}</Mono>
                <Pill tone={severityTone(c.severity)}>{c.severity}</Pill>
                <span className="tabular-nums">{nf.format(count(c))} records</span>
              </button>
              {action?.(c)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function CompareRunsPage() {
  const { versionId, b } = useParams<{ versionId: string; b: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const { can } = useRole();
  const [module, setModule] = useUrlState("module");
  const [checkId, setCheckId] = useState<string | null>(null);
  const [keyFilter, setKeyFilter] = useState("");
  const [keyPage, setKeyPage] = useState(0);

  const v1Param = b === "baseline" ? undefined : b;
  const moduleParam = module || undefined;

  const cmpQ = useQuery({
    queryKey: [...queryKeys.runCompare(versionId, b), "modules", module],
    queryFn: () => compareVersions(v1Param, versionId, moduleParam),
  });
  const diffQ = useQuery({
    queryKey: [...queryKeys.runCompare(versionId, b), "records", module],
    queryFn: () => compareRecords(versionId, v1Param, moduleParam),
  });
  const resolvedV1 = diffQ.data?.v1;
  const keysQ = useQuery({
    queryKey: [...queryKeys.runCompare(versionId, b), "keys", checkId, "new"],
    queryFn: () => compareRecordKeys(checkId ?? "", { v1: resolvedV1 ?? "", v2: versionId, change: "new" }),
    enabled: checkId !== null && resolvedV1 !== undefined,
  });

  const cmp = cmpQ.data;
  const diff = diffQ.data ?? null;
  const v2Label = cmp ? runLabel(cmp.v2) : versionId;

  const create = useMutation({
    mutationFn: (c: CheckChange) => createBatch(`Regressions ${c.check_id} ${v2Label}`, { version_id: versionId, check_id: c.check_id, module: c.module }),
    onSuccess: () => {
      toast.success("Batch created", { action: { label: "Open batches", onClick: () => router.push("/fix?tab=batches") } });
      qc.invalidateQueries({ queryKey: queryKeys.remediationBatches() });
    },
    onError: (e: unknown) => toast.error(errorText(e)),
  });

  const sentences = useMemo(() => (cmp ? compareNarrative(cmp, diff) : []), [cmp, diff]);
  const keys = keysQ.data?.record_keys ?? [];
  const filteredKeys = keyFilter ? keys.filter((k) => k.toLowerCase().includes(keyFilter.toLowerCase())) : keys;
  const pageKeys = filteredKeys.slice(keyPage * KEYS_PAGE_SIZE, (keyPage + 1) * KEYS_PAGE_SIZE);

  const loading = cmpQ.isLoading || diffQ.isLoading;
  const errored = cmpQ.isError || diffQ.isError;
  const empty = !!cmp && !!diff && Object.keys(cmp.delta).length === 0 && diff.checks.length === 0;
  const state = loading ? "loading" : errored ? "error" : empty ? "empty" : undefined;

  const onDownload = () =>
    downloadAuthenticated(getComparisonReportUrl(versionId, v1Param), "comparison.pdf").catch((e: unknown) => toast.error(errorText(e)));

  const narrative = (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-[15px] font-semibold">{cmp ? `${runLabel(cmp.v2)} vs ${runLabel(cmp.v1)}` : "Comparing runs…"}</h2>
        {b === "baseline" ? <Pill tone="go">Baseline</Pill> : null}
        <Button variant="secondary" onClick={onDownload}>Download PDF</Button>
        <label className="flex items-center gap-1 text-[13px]">
          <span>Module</span>
          <select value={module} onChange={(e) => setModule(e.target.value)} className="rounded border px-2 py-1" style={{ borderColor: "var(--m-line)" }}>
            <option value="">All modules</option>
            {Object.keys(cmp?.delta ?? {}).map((m) => <option key={m} value={m}>{formatModuleName(m)}</option>)}
          </select>
        </label>
      </div>
      {sentences.map((s) => <p key={s}>{s}</p>)}
    </div>
  );

  const charts = cmp ? (
    <div className="flex flex-col gap-4">
      {Object.entries(cmp.delta).map(([name, d]) => {
        const failing = cmp.checks.newly_failing.filter((c) => c.module === name);
        const fixed = cmp.checks.fixed.filter((c) => c.module === name);
        const canFix = can("apply");
        return (
          <section key={name} aria-label={formatModuleName(name)} className="flex flex-col gap-3 rounded border p-3" style={{ borderColor: "var(--m-line)", background: "var(--m-sheet)" }}>
            <h2 className="text-[15px] font-semibold">{formatModuleName(name)}</h2>
            <div className="flex gap-6">
              <Stat label="Before" value={<span className="tabular-nums">{d.v1_score.toFixed(1)}</span>} />
              <Stat label="After" value={<span className="tabular-nums">{d.v2_score.toFixed(1)}</span>} />
              <Stat label="Change" value={<Delta value={round1(d.dqs_change)} />} />
            </div>
            <Bar data={Object.entries(d.dimensions).map(([dim, x]) => ({ x: dim, y: round1(x.change), dimension: dim }))} />
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <CheckList
                title="Newly failing"
                rows={failing}
                count={(c) => c.v2_affected}
                onOpen={(id) => { setCheckId(id); setKeyPage(0); }}
                action={canFix ? (c) => (
                  <Button variant="ghost" disabled={create.isPending} onClick={() => create.mutate(c)}>Create fix batch</Button>
                ) : undefined}
                bulk={canFix && failing.length > 0 ? (
                  <Button variant="ghost" disabled={create.isPending} onClick={async () => { for (const c of failing) await create.mutateAsync(c).catch(() => undefined); }}>
                    Create fix batches
                  </Button>
                ) : undefined}
              />
              <CheckList title="Fixed" rows={fixed} count={(c) => c.v1_affected} onOpen={(id) => { setCheckId(id); setKeyPage(0); }} />
            </div>
          </section>
        );
      })}
    </div>
  ) : null;

  const tables = diff ? (
    <div className="flex flex-col gap-4">
      <Waterfall
        data={[
          { x: "Resolved", y: -diff.totals.resolved },
          { x: "New", y: diff.totals.new },
          { x: "Persisting", y: diff.totals.persisting },
        ]}
      />
      <DataTable columns={diffColumns} data={diff.checks} getRowId={(c) => c.check_id} onRowClick={(c) => { setCheckId(c.check_id); setKeyPage(0); }} height={360} />
      {checkId ? (
        <div className="flex flex-col gap-2">
          <h3 className="text-[13px] font-medium">New failures for <Mono>{checkId}</Mono></h3>
          <input
            aria-label="Filter record keys"
            placeholder="Filter record keys…"
            value={keyFilter}
            onChange={(e) => { setKeyFilter(e.target.value); setKeyPage(0); }}
            className="rounded border px-3 py-1.5 text-[13px]"
            style={{ borderColor: "var(--m-line)" }}
          />
          <ul className="text-[13px]">
            {pageKeys.map((k) => <li key={k}><Mono>{k}</Mono></li>)}
          </ul>
          <Pager page={keyPage} pageSize={KEYS_PAGE_SIZE} total={filteredKeys.length} onPageChange={setKeyPage} />
        </div>
      ) : null}
    </div>
  ) : null;

  return (
    <ReportPage
      narrative={narrative}
      charts={charts}
      tables={tables}
      state={state}
      emptyProps={{ title: "No differences. These two runs have identical results." }}
      errorProps={{ message: `Couldn't compare these runs. ${cmpQ.error?.message ?? diffQ.error?.message ?? ""}`.trim(), onRetry: () => { cmpQ.refetch(); diffQ.refetch(); } }}
    />
  );
}
```

Before writing, read the current file for the exact `Waterfall` and `Pager` prop names and the current keys drill markup, and keep those exactly as the existing page uses them; the snippet above shows intent for those two components, the existing file is the authority for their props.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run "app/(app)/runs/[versionId]/vs/[b]/__tests__/page.test.tsx"`
Expected: PASS, 6 tests.

- [ ] **Step 5: Gate and commit**

Run: `cd frontend && npm run typecheck && npm run lint && npm run lint:tokens && npx vitest run`

```bash
git add "frontend/app/(app)/runs/[versionId]/vs/[b]/page.tsx" "frontend/app/(app)/runs/[versionId]/vs/[b]/__tests__/page.test.tsx"
git commit -m "Build the comparison report with module cards, narrative, PDF export and fix batches"
```

---

### Task 7: Before vs after link on exported batches

**Files:**
- Modify: `frontend/app/(app)/fix/batches-tab.tsx` (`columns` array at line 87 inside `BatchesTab`; `BatchDetailBody` `<dl>` at lines 308-319)
- Modify: `frontend/app/(app)/fix/__tests__/batches-tab.test.tsx` (add two tests)

**Interfaces:**
- Consumes: `getMonitor` → `{ items: MonitorItem[] }`, `MonitorItem { scope, baseline: { id }, latest: { id } }`, `Batch { status, filter: { version_id, module, scope } }`, `queryKeys.remediationMonitor()`, design `Tooltip`, `next/link`.
- Produces: `export function compareHref(batch: Batch, monitor: MonitorItem[]): string | null` in `batches-tab.tsx`.

Rule: only for `batch.status === "exported"`. Scope = `batch.filter.scope ?? "upload"`. Find the `MonitorItem` with that scope; without one return null. `v1 = batch.filter.version_id ?? item.baseline.id`, `v2 = item.latest.id`; when `v2 === v1` return null. Href = `/runs/${v2}/vs/${v1}` plus `?module=${encodeURIComponent(batch.filter.module)}` when the module filter is set. Null renders a disabled secondary `Button` wrapped in `Tooltip label="No run since export"`; a string renders a `Link` with the text `Before vs after`.

- [ ] **Step 1: Write the failing tests**

Add to `frontend/app/(app)/fix/__tests__/batches-tab.test.tsx`, after the existing describe blocks, reusing its `batch(over)` fixture and `remediationApi` spies:

```tsx
import { compareHref } from "../batches-tab";

describe("compareHref", () => {
  const monitor = [{ scope: "sys-1", system_name: "ECC Prod", baseline: { id: "v0", run_at: "t", dqs: 70 }, latest: { id: "v9", run_at: "t", dqs: 75 }, monitor: null }];
  it("uses the batch's run as v1 and the latest monitor run as v2, with the module filter", () => {
    const b = batch({ status: "exported", filter: { version_id: "v2", module: "material_master", scope: "sys-1" } });
    expect(compareHref(b, monitor)).toBe("/runs/v9/vs/v2?module=material_master");
  });
  it("falls back to the baseline and returns null when nothing ran since", () => {
    const b = batch({ status: "exported", filter: { version_id: null, module: null, scope: "sys-1" } });
    expect(compareHref(b, monitor)).toBe("/runs/v9/vs/v0");
    expect(compareHref(batch({ status: "exported", filter: { version_id: "v9", scope: "sys-1" } }), monitor)).toBeNull();
    expect(compareHref(batch({ status: "exported", filter: { scope: "sys-2" } }), monitor)).toBeNull();
    expect(compareHref(batch({ status: "draft", filter: { scope: "sys-1" } }), monitor)).toBeNull();
  });
});

describe("Before vs after link", () => {
  it("renders the link for an exported batch with a newer run", async () => {
    vi.spyOn(remediationApi, "listBatches").mockResolvedValue({ batches: [batch({ id: "b1", status: "exported", filter: { version_id: "v2", scope: "sys-1" } })] });
    vi.spyOn(remediationApi, "getMonitor").mockResolvedValue({ items: [{ scope: "sys-1", system_name: "ECC Prod", baseline: { id: "v0", run_at: "t", dqs: 70 }, latest: { id: "v9", run_at: "t", dqs: 75 }, monitor: null }] });
    render(<BatchesTab />);
    await waitFor(() => expect(screen.getAllByRole("link", { name: "Before vs after" })[0]).toHaveAttribute("href", "/runs/v9/vs/v2"));
  });
});
```

Match the `listBatches` response shape and the render helper (`render` vs `renderWithQuery`) to what the existing tests in that file already use; the `batch()` fixture's `filter` type is `BatchFilter`, whose fields are all optional and nullable.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run "app/(app)/fix/__tests__/batches-tab.test.tsx"`
Expected: FAIL, `compareHref` is not exported.

- [ ] **Step 3: Implement**

Add near `scopeLabel` in `batches-tab.tsx`:

```tsx
/** Where an exported batch's effect can be seen: the latest run of its scope against the run it was cut from. */
export function compareHref(batch: Batch, monitor: MonitorItem[]): string | null {
  if (batch.status !== "exported") return null;
  const item = monitor.find((m) => m.scope === (batch.filter.scope ?? "upload"));
  if (!item) return null;
  const v1 = batch.filter.version_id ?? item.baseline.id;
  const v2 = item.latest.id;
  if (v1 === v2) return null;
  const q = batch.filter.module ? `?module=${encodeURIComponent(batch.filter.module)}` : "";
  return `/runs/${v2}/vs/${v1}${q}`;
}

function BeforeAfter({ batch, monitor }: { batch: Batch; monitor: MonitorItem[] }) {
  if (batch.status !== "exported") return null;
  const href = compareHref(batch, monitor);
  if (!href) {
    return (
      <Tooltip label="No run since export">
        <Button variant="secondary" disabled>Before vs after</Button>
      </Tooltip>
    );
  }
  return <Link href={href} onClick={(e) => e.stopPropagation()}>Before vs after</Link>;
}
```

Import `Tooltip` from `@/design` and `Batch` from `@/lib/api/remediation` (add to the existing import lists). In `BatchesTab`, add `const monitor = useQuery({ queryKey: queryKeys.remediationMonitor(), queryFn: getMonitor, staleTime: 60_000 });` next to the batches query and append a column to the `columns` array:

```tsx
    {
      id: "compare",
      header: "",
      enableSorting: false,
      cell: ({ row }) => <BeforeAfter batch={row.original} monitor={monitor.data?.items ?? []} />,
    },
```

In `BatchDetailBody`, add the same monitor `useQuery` and render `<BeforeAfter batch={batch} monitor={monitor.data?.items ?? []} />` directly after the closing `</dl>`. (`Link` is already imported in this file; `Batch` extends into `BatchDetail`, so passing the detail object is type-correct.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run "app/(app)/fix/__tests__/batches-tab.test.tsx"`
Expected: PASS, all existing tests plus 3 new.

- [ ] **Step 5: Gate and commit**

Run: `cd frontend && npm run typecheck && npm run lint && npm run lint:tokens && npx vitest run`

```bash
git add "frontend/app/(app)/fix/batches-tab.tsx" "frontend/app/(app)/fix/__tests__/batches-tab.test.tsx"
git commit -m "Link exported fix batches to their before-and-after comparison"
```

---

### Task 8: Navigation relabel

**Files:**
- Modify: `frontend/lib/nav.ts:115`
- Modify: `frontend/lib/__tests__/nav.test.ts`

**Interfaces:**
- Consumes: `NAV_GROUPS`, `flattenNav`, `getPageTitle` from `@/lib/nav`.
- Produces: nothing new.

- [ ] **Step 1: Write the failing test**

Append to `frontend/lib/__tests__/nav.test.ts` inside its existing `describe`:

```ts
  it("labels the runs page Runs and keeps compare searchable", () => {
    const runs = flattenNav(NAV_GROUPS).find((n) => n.href === "/runs");
    expect(runs?.label).toBe("Runs");
    expect(runs?.keywords).toContain("compare");
    expect(getPageTitle("/runs")).toBe("Runs");
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run lib/__tests__/nav.test.ts`
Expected: FAIL, label is `Compare versions`.

- [ ] **Step 3: Relabel**

Change the entry at `frontend/lib/nav.ts:115` to:

```ts
  { href: "/runs", label: "Runs", icon: GitCompareIcon, licenceKey: "versions", keywords: "compare history snapshots baseline" },
```

`PAGE_TITLES` is derived from nav labels, so it needs no edit. If `OFF_NAV_TITLES` (around line 182) carries an entry for `/runs/`-prefixed routes labelled `Compare versions`, relabel it `Runs` too.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && npx vitest run lib/__tests__/nav.test.ts`
Expected: PASS.

- [ ] **Step 5: Gate and commit**

Run: `cd frontend && npm run typecheck && npm run lint && npm run lint:tokens && npx vitest run`

```bash
git add frontend/lib/nav.ts frontend/lib/__tests__/nav.test.ts
git commit -m "Relabel the compare page as Runs"
```

---

## Self-review

- Spec 3.1: DQS column (Task 4), two-run compare with newer/older ordering (Task 4), sparklines per system with click filter via `useUrlState("system")` (Task 4), `overallDqs` (Task 1). The spec's per-row `Compare` action is covered by the selection flow plus the detail page's `Compare with previous`; no separate per-row action is built.
- Spec 3.2: compare with previous / baseline, pin and unpin with invalidation, Baseline pill (Task 5; helpers in Task 1).
- Spec 3.3: baseline literal, module cards with Stat/Delta/Bar and both lists, Download PDF, module URL filter, narrative (Task 3, Task 6), Create fix batch per row and bulk with `apply` gating and verbatim 400 (Task 2, Task 6).
- Spec 3.4: `Before vs after` in table and drawer with the disabled tooltip (Task 7).
- Spec 3.5: relabel (Task 8).
- Deviation recorded: narrative sentence 5 says `did not run cleanly in both runs`, matching the API's `comparable` semantics (skipped, errored or truncated), not only "ran only in the newer run". The spec text is amended to match.
- Type consistency: `RecordDiff` (Task 2) is consumed by Tasks 3 and 6; `compareVersions(v1 | undefined, v2, module?)` by Task 6; `createBatch(name, filter)` by Task 6; `runSeries` points `{x, y}` are structurally `ChartPoint`.
