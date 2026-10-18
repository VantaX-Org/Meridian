// frontend/lib/current-state.ts
import type { DQSSummary, Version } from "@/types/api";
import type { ObjectSummary } from "@/lib/api/v1/objects";
import type { FindingsAggregate } from "@/lib/api/findings";
import { DEFAULT_SCORE_BANDS, type ScoreBands } from "@/design/primitives/ScoreRing";
import { formatDate, formatModuleName, plural, runAxisLabels } from "@/lib/format";
import { isFinished, lineageOf } from "@/lib/runs";
import { runDqs, type TrendPoint } from "@/lib/home-metrics";

/**
 * The current state of a tenant: every object at the latest finished run of its lineage (a system, or uploads of
 * the same objects; see `lineageOf`), the cross-object view `GET /findings/aggregate` takes by default. A home page
 * summarises this, never the single newest run, so ten uploads of one object do not hide the other fifteen.
 *
 * An object (a module) measured by more than one current run, e.g. read from a system and also uploaded, is taken
 * from the newest of them: one row per object, as the objects list keys its rows.
 */

/** A run with scores: finished and at least one module in its `dqs_summary`. */
export const isScored = (v: Version): boolean => isFinished(v) && Object.keys(v.dqs_summary ?? {}).length > 0;

const newestFirst = (a: Version, b: Version) => (a.run_at < b.run_at ? 1 : a.run_at > b.run_at ? -1 : 0);

/** The latest scored run of each lineage, newest first. */
export function latestPerLineage(versions: readonly Version[]): Version[] {
  const out = new Map<string, Version>();
  for (const v of [...versions].filter(isScored).sort(newestFirst)) {
    const key = lineageOf(v);
    if (!out.has(key)) out.set(key, v);
  }
  return [...out.values()];
}

/** One object of the current state: its module's scores and the run they come from. */
export interface StateObject {
  module: string;
  summary: DQSSummary;
  run: Version;
}

/**
 * Each object once, from the newest of `runs` that measured it, ordered by module. `modules`, when given, keeps
 * only those objects (a module-scoped user).
 */
export function stateObjects(runs: readonly (Version | null | undefined)[], modules?: ReadonlySet<string> | null): StateObject[] {
  const out = new Map<string, StateObject>();
  for (const run of runs.filter((r): r is Version => !!r).sort(newestFirst)) {
    for (const [module, summary] of Object.entries(run.dqs_summary ?? {})) {
      if (!summary || out.has(module) || (modules && !modules.has(module))) continue;
      out.set(module, { module, summary, run });
    }
  }
  return [...out.values()].sort((a, b) => a.module.localeCompare(b.module));
}

/** The objects as one `dqs_summary`, so the per-run metrics (`runDqs`, `runDimensions`, `runCap`, ...) read them whole. */
export function stateSummary(objects: readonly StateObject[]): Pick<Version, "dqs_summary"> {
  return { dqs_summary: Object.fromEntries(objects.map((o) => [o.module, o.summary])) };
}

/** Mean composite score of the measured objects (as `runDqs` does for one run), or null when none is measured. */
export function stateDqs(objects: readonly StateObject[]): number | null {
  return runDqs(stateSummary(objects));
}

/** Same bands as the API's `tier()`: >= target pass, >= warning warn, else fail. */
export function tierOf(score: number | null, bands: ScoreBands = DEFAULT_SCORE_BANDS): ObjectSummary["readiness"] {
  if (score == null) return null;
  return score >= bands.target ? "pass" : score >= bands.warning ? "warn" : "fail";
}

/** An objects-list row built from the current state, with the run it was measured in. */
export type StateRow = Omit<ObjectSummary, "affected_records" | "trend"> & {
  /** Null when the aggregate cannot attribute the records to this object's run (see `stateRows`). */
  affected_records: number | null;
  run_id: string;
};

/**
 * Objects-list rows for the current state. Score, readiness and failing checks come from each object's run;
 * affected records from `GET /findings/aggregate` (`by_module`), taken only when exactly one of the aggregate's runs
 * measured the object and it is this object's run, since the aggregate sums a module across runs.
 */
export function stateRows(
  objects: readonly StateObject[],
  bands?: ScoreBands,
  aggregate?: Pick<FindingsAggregate, "version_ids" | "by_module"> | null,
  versions: readonly Version[] = [],
): StateRow[] {
  const aggIds = new Set(aggregate?.version_ids ?? []);
  const byId = new Map(versions.map((v) => [v.id, v]));
  const affected = new Map((aggregate?.by_module ?? []).map((m) => [m.module, m.affected]));
  return objects.map(({ module, summary: s, run }) => {
    const measuredBy = [...aggIds].filter((id) => !!byId.get(id)?.dqs_summary?.[module]);
    const attributable = aggIds.has(run.id) && measuredBy.length === 1 && measuredBy[0] === run.id;
    return {
      module,
      label: formatModuleName(module),
      composite_score: s.composite_score,
      readiness: tierOf(s.composite_score, bands),
      failing_checks: s.critical_count + s.high_count + s.medium_count + s.low_count,
      critical_checks: s.critical_count,
      high_checks: s.high_count,
      affected_records: attributable ? affected.get(module) ?? 0 : null,
      run_id: run.id,
    };
  });
}

/** Failing critical and high checks across the objects: the "blocking findings" of the current state. */
export function blockingTotal(objects: readonly StateObject[]): number {
  return objects.reduce((n, o) => n + o.summary.critical_count + o.summary.high_count, 0);
}

/**
 * The current state's score over runs, oldest first: after each scored run, every object at the latest run of its
 * lineage up to then. The last step is the change the newest run made; an object's first run adds it to the set.
 */
export function stateSeries(versions: readonly Version[], modules?: ReadonlySet<string> | null): TrendPoint[] {
  const runs = [...versions].filter(isScored).sort((a, b) => -newestFirst(a, b));
  const ticks = runAxisLabels(runs);
  const atLineage = new Map<string, Version>();
  const out: TrendPoint[] = [];
  for (const run of runs) {
    atLineage.set(lineageOf(run), run);
    const y = stateDqs(stateObjects([...atLineage.values()], modules));
    if (y != null) out.push({ x: run.id, label: ticks.get(run.id) ?? formatDate(run.run_at, "date"), y, runId: run.id });
  }
  return out;
}

/** "Current state of 15 objects, latest run 16 Oct 2026": the header line of a cross-object home. */
export function stateScopeLine(objectCount: number, latestRunAt: string): string {
  return `Current state of ${plural(objectCount, "object")}, latest run ${formatDate(latestRunAt, "date")}`;
}

/** What a run measured, for copy: one object's name, else "these N objects". */
export function runObjectsName(v: Version): string {
  const modules = Object.keys(v.dqs_summary ?? {});
  return modules.length === 1 ? formatModuleName(modules[0]) : `these ${plural(modules.length, "object")}`;
}
