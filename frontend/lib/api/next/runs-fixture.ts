/**
 * Fixture mode for the object page: 500 generated runs of one object on the first fixture system, so paging, the
 * switcher and "Showing N of M" are exercised at a size a real tenant reaches. No customer names, no personal data:
 * the system id is the fixture landscape's first system, record keys are synthetic numbers.
 */
import type { VersionHead } from "@/lib/api/v2/runs";
import type { RoundTripResult } from "@/lib/api/v2/roundtrip";
import type { Change, CompareRecord, CompareSetsPage, CompareSummary, ObjectCycle, RunsPage, RunsQuery, SetsQuery } from "./runs";

export const FIXTURE_SYSTEM = "a1b2c3d4-0001-4000-8000-000000000001";
export const FIXTURE_MODULE = "material_master";
export const FIXTURE_RUNS = 500;

export const fixtureRunId = (n: number): string => `f0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const numberOf = (id: string): number => (/^f0000000-0000-4000-8000-(\d{12})$/.test(id) ? Number(id.slice(-12)) : 0);

/** Every fourth run is a pull; the three between are cleaned from the run before. Every 97th run failed. */
const isPull = (n: number) => n % 4 === 1;
const failed = (n: number) => n % 97 === 0;
const score = (n: number) => Math.min(98, 52 + (n % 4) * 6 + Math.floor(n / 40));
const START = Date.UTC(2025, 0, 6, 6, 0, 0);

function head(n: number): VersionHead {
  const s = score(n);
  return {
    id: fixtureRunId(n),
    run_at: new Date(START + n * 18 * 3600_000).toISOString(),
    label: null,
    run_number: n,
    parent_version_id: isPull(n) ? null : fixtureRunId(n - 1),
    status: failed(n) ? "failed" : "complete",
    dqs_summary: failed(n) ? null : { [FIXTURE_MODULE]: { composite_score: s, raw_score: s, capped: false, total_checks: 140 + (n % 9) } },
    metadata: { system_id: FIXTURE_SYSTEM, modules: [FIXTURE_MODULE], trigger: isPull(n) ? (n % 8 === 1 ? "scheduled" : "manual") : "upload", ...(isPull(n) ? {} : { source: "roundtrip", file_name: `cleaning_${n - 1}.xlsx` }) },
    severity_counts: { critical: n % 3, high: 4 + (n % 5), medium: 9, low: 12 },
    system_name: "ECC production",
  };
}

export function fixtureRunsPage(q: RunsQuery): RunsPage {
  const limit = q.limit ?? 50;
  const offset = q.offset ?? 0;
  const mine = (!q.system_id || q.system_id === FIXTURE_SYSTEM) && (!q.module || q.module === FIXTURE_MODULE);
  let all = mine ? Array.from({ length: FIXTURE_RUNS }, (_, i) => FIXTURE_RUNS - i) : [];
  if (q.status === "failed") all = all.filter(failed);
  if (q.status === "complete") all = all.filter((n) => !failed(n));
  if (q.status === "active") all = [];
  if (q.sort && !q.sort.startsWith("-")) all = all.reverse();
  const versions = all.slice(offset, offset + limit).map(head);
  const next = offset + limit < all.length ? offset + limit : null;
  return { versions, total: all.length, limit, offset, next_offset: next };
}

export function fixtureRun(id: string): VersionHead | null {
  const n = numberOf(id);
  return n >= 1 && n <= FIXTURE_RUNS ? head(n) : null;
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
