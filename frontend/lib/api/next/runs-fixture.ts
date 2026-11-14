/**
 * Fixture mode for the object page: 500 generated runs of one object on the first fixture system, so paging, the
 * switcher and "Showing N of M" are exercised at a size a real tenant reaches. No customer names, no personal data:
 * the system id is the fixture landscape's first system, record keys are synthetic numbers.
 */
import type { VersionHead } from "@/lib/api/v2/runs";
import type { RoundTripResult } from "@/lib/api/v2/roundtrip";
import type { TargetTemplate } from "@/lib/api/v2/migration";
import type { Change, CompareRecord, CompareSetsPage, CompareSummary, ObjectCycle, RunsPage, RunsQuery, SetsQuery } from "./runs";

export const FIXTURE_SYSTEM = "a1b2c3d4-0001-4000-8000-000000000001";
export const FIXTURE_MODULE = "material_master";
export const FIXTURE_RUNS = 500;
/** A second system with a short history of one object, so the runs page has more than one system to filter by. */
export const FIXTURE_SYSTEM_2 = "a1b2c3d4-0002-4000-8000-000000000002";
export const FIXTURE_MODULE_2 = "employee_central";
export const FIXTURE_RUNS_2 = 24;
/** Objects of the first system: the first is the one the object page uses, the others make a run span several objects. */
export const FIXTURE_MODULES = [FIXTURE_MODULE, "customer_master", "vendor_master"] as const;

export const fixtureRunId = (n: number): string => `f0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const numberOf = (id: string): number => (/^f0000000-0000-4000-8000-(\d{12})$/.test(id) ? Number(id.slice(-12)) : 0);
/** Runs of the second system are numbered from 1001. */
const SECOND = 1000;
const isSecond = (n: number) => n > SECOND;

/** Every fourth run is a pull; the three between are cleaned from the run before. Every 97th run failed. */
const isPull = (n: number) => n % 4 === 1;
const failed = (n: number) => n % 97 === 0;
const score = (n: number) => Math.min(98, 52 + (n % 4) * 6 + Math.floor(n / 40));
const START = Date.UTC(2025, 0, 6, 6, 0, 0);

function head(n: number): VersionHead {
  if (isSecond(n)) {
    const k = n - SECOND;
    const v = Math.min(96, 60 + (k % 5) * 4 + k);
    return {
      id: fixtureRunId(n),
      run_at: new Date(START + k * 30 * 3600_000).toISOString(),
      label: null,
      run_number: k,
      parent_version_id: null,
      status: k === 7 ? "failed" : k === FIXTURE_RUNS_2 ? "running" : "complete",
      dqs_summary: k === 7 || k === FIXTURE_RUNS_2 ? null : { [FIXTURE_MODULE_2]: { composite_score: v, raw_score: v, capped: false, total_checks: 96 } },
      metadata: { system_id: FIXTURE_SYSTEM_2, modules: [FIXTURE_MODULE_2], trigger: "scheduled" },
      severity_counts: { critical: 0, high: 3, medium: 6, low: 8 },
      system_name: "People system",
    };
  }
  const s = score(n);
  const summary = (m: string, d: number) => ({ composite_score: Math.max(0, Math.min(99, s + d)), raw_score: Math.max(0, Math.min(99, s + d)), capped: false, total_checks: 120 + (n % 9) });
  return {
    id: fixtureRunId(n),
    run_at: new Date(START + n * 18 * 3600_000).toISOString(),
    label: null,
    run_number: n,
    parent_version_id: isPull(n) ? null : fixtureRunId(n - 1),
    status: failed(n) ? "failed" : n === FIXTURE_RUNS ? "running" : "complete",
    // The newest run is still going, so only its first object is scored so far: a partial run the screens must show honestly.
    dqs_summary: failed(n) ? null : n === FIXTURE_RUNS ? { [FIXTURE_MODULES[0]]: summary(FIXTURE_MODULES[0], 0) } : { [FIXTURE_MODULES[0]]: { ...summary(FIXTURE_MODULES[0], 0), total_checks: 140 + (n % 9) }, [FIXTURE_MODULES[1]]: summary(FIXTURE_MODULES[1], -9), [FIXTURE_MODULES[2]]: summary(FIXTURE_MODULES[2], 6) },
    metadata: { system_id: FIXTURE_SYSTEM, modules: [...FIXTURE_MODULES], trigger: isPull(n) ? (n % 8 === 1 ? "scheduled" : "manual") : "upload", ...(isPull(n) ? {} : { source: "roundtrip", file_name: `cleaning_${n - 1}.xlsx` }) },
    severity_counts: { critical: n % 3, high: 4 + (n % 5), medium: 9, low: 12 },
    system_name: "ECC production",
  };
}

export function fixtureRunsPage(q: RunsQuery): RunsPage {
  const limit = q.limit ?? 50;
  const offset = q.offset ?? 0;
  const first = Array.from({ length: FIXTURE_RUNS }, (_, i) => FIXTURE_RUNS - i);
  const second = Array.from({ length: FIXTURE_RUNS_2 }, (_, i) => SECOND + FIXTURE_RUNS_2 - i);
  let all: number[] = [];
  const wantFirst = (!q.system_id || q.system_id === FIXTURE_SYSTEM) && (!q.module || (FIXTURE_MODULES as readonly string[]).includes(q.module));
  const wantSecond = (!q.system_id || q.system_id === FIXTURE_SYSTEM_2) && (!q.module || q.module === FIXTURE_MODULE_2);
  if (wantFirst) all = all.concat(first);
  if (wantSecond) all = all.concat(second);
  const bad = (n: number) => (isSecond(n) ? n - SECOND === 7 : failed(n));
  const live = (n: number) => (isSecond(n) ? n - SECOND === FIXTURE_RUNS_2 : n === FIXTURE_RUNS);
  if (q.status === "failed") all = all.filter(bad);
  if (q.status === "complete") all = all.filter((n) => !bad(n) && !live(n));
  if (q.status === "active") all = all.filter(live);
  if (q.sort && !q.sort.startsWith("-")) all = all.reverse();
  const versions = all.slice(offset, offset + limit).map(head);
  const next = offset + limit < all.length ? offset + limit : null;
  return { versions, total: all.length, limit, offset, next_offset: next };
}

export function fixtureRun(id: string): VersionHead | null {
  const n = numberOf(id);
  return (n >= 1 && n <= FIXTURE_RUNS) || (n > SECOND && n <= SECOND + FIXTURE_RUNS_2) ? head(n) : null;
}

/** Kept target templates per object. The first object has two versions, the second one, the third none, so every picker state shows. */
export function fixtureTemplates(module: string): TargetTemplate[] {
  const mk = (version: number, name: string): TargetTemplate => ({ id: `tpl-${module}-${version}`, name, version, filename: `${module}_v${version}.xlsx`, size_bytes: 48_000 + version * 1_024, coverage: 0.92, column_map: {}, last_fill_at: null, last_fill_version_id: null, created_by: "fixture", created_at: "2025-01-06T06:00:00Z" } as unknown as TargetTemplate);
  if (module === FIXTURE_MODULES[0]) return [mk(1, "Standard load"), mk(2, "Standard load, revised")];
  if (module === FIXTURE_MODULES[1]) return [mk(1, "Standard load")];
  return [];
}

/** Counts of one pair: a cleaned run resolves most of what its parent failed; a pull brings new findings. */
function totals(v1: number, v2: number): Record<Change, number> {
  if (!v1 || !v2) return { new: 0, resolved: 0, regressed: 0, persisting: 0 };
  const gap = Math.abs(v2 - v1);
  return { new: 3 + ((v2 * 7) % 11) + gap, resolved: 18 + ((v1 + v2) % 23), regressed: (v2 % 3) + (gap > 1 ? 1 : 0), persisting: 40 + (v1 % 17) };
}

const CHECKS = [
  { id: "MM_BASE_UNIT_MISSING", reason: "Base unit of measure is empty" },
  { id: "MM_GROSS_WEIGHT_ZERO", reason: "Gross weight is zero for a stocked material" },
  { id: "MM_DESC_DUPLICATE", reason: "Description matches another material" },
  { id: "MM_MATKL_INVALID", reason: "Material group is not in the configured list" },
];
const FIELDS: Record<string, string> = { MM_BASE_UNIT_MISSING: "MEINS", MM_GROSS_WEIGHT_ZERO: "BRGEW", MM_DESC_DUPLICATE: "MAKTX", MM_MATKL_INVALID: "MATKL" };

export function fixtureSummary(a: string, b: string): CompareSummary {
  const t = totals(numberOf(a), numberOf(b));
  return {
    v1: a,
    v2: b,
    totals: t,
    checks: CHECKS.map((c, i) => ({ check_id: c.id, module: FIXTURE_MODULE, reason: c.reason, new: Math.floor(t.new / 4) + (i === 0 ? t.new % 4 : 0), resolved: Math.floor(t.resolved / 4) + (i === 0 ? t.resolved % 4 : 0), regressed: i === 0 ? t.regressed : 0, persisting: Math.floor(t.persisting / 4) + (i === 0 ? t.persisting % 4 : 0) })),
  };
}

export function fixtureSets(q: SetsQuery): CompareSetsPage {
  const t = totals(numberOf(q.v1 ?? ""), numberOf(q.v2));
  const kinds: Change[] = q.change ? [q.change] : ["new", "regressed", "resolved", "persisting"];
  const all: CompareRecord[] = [];
  for (const k of kinds) {
    for (let i = 0; i < t[k]; i++) {
      const c = CHECKS[i % CHECKS.length];
      const f = FIELDS[c.id];
      const key = String(100000 + i * 13 + k.length);
      const before = k === "new" || k === "regressed" ? null : { [f]: f === "BRGEW" ? "0" : "" };
      const after = k === "resolved" ? null : { [f]: f === "BRGEW" ? "0" : "" };
      all.push({ check_id: c.id, record_key: key, module: FIXTURE_MODULE, change: k, reason: c.reason, values_before: before, values_after: after });
    }
  }
  const limit = q.limit ?? 50;
  const offset = q.offset ?? 0;
  return { v1: q.v1 ?? "", v2: q.v2, records: all.slice(offset, offset + limit), total: all.length, limit, offset, next_offset: offset + limit < all.length ? offset + limit : null };
}

export function fixtureCycles(): Record<string, ObjectCycle> {
  const newest = head(FIXTURE_RUNS);
  return { [FIXTURE_MODULE]: { number: 4, step: "compare", since: newest.run_at, parent_run: newest.parent_version_id ?? null, downloaded_at: null, downloaded_by: null } };
}

/** The answer of an upload in fixture mode: the newest fixture run, cleaned from the one before it. */
export function fixtureUpload(fileName: string): RoundTripResult {
  return {
    version_id: fixtureRunId(FIXTURE_RUNS),
    job_id: null,
    status: "pending",
    parent_version_id: fixtureRunId(FIXTURE_RUNS - 1),
    kind: "cleaning",
    applied: 42,
    unchanged: 7,
    unmatched: 3,
    unmapped: {},
    skipped: fileName.includes("notes") ? { Notes: "No record key column" } : {},
    no_table: [],
    no_field: [],
  };
}
