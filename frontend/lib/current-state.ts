// frontend/lib/current-state.ts
import type { DQSSummary, Version } from "@/types/api";
import type { ObjectSummary } from "@/lib/api/v1/objects";
import type { FindingsAggregate } from "@/lib/api/findings";
import { DEFAULT_SCORE_BANDS, type ScoreBands } from "@/design/primitives/ScoreRing";
import { formatDate, formatModuleName, plural, round1, runAxisLabels } from "@/lib/format";
import { isFinished, lineageOf, previousInLineage } from "@/lib/runs";
import { runDqs, type TrendPoint } from "@/lib/home-metrics";

/**
 * The current state of a tenant: every object at the latest finished run of its lineage (a system, or uploads of
 * the same objects; see `lineageOf`), the cross-object view `GET /findings/aggregate` takes by default. A home page
 * summarises this, never the single newest run, so ten uploads of one object do not hide the other fifteen.
 *
 * An object (a module) measured by more than one current run, e.g. read from a system and also uploaded, is taken
 * from the newest of them: one row per object, as the objects list keys its rows.
 */

/**
 * Screens that describe the current state when no `?run=` pins one: every home (`/home`, `/home/<persona>`), the
 * Insights overview and the executive summary (`insights/_components/scopeMode.ts` CURRENT_STATE_VIEWS). A chosen
 * run is never carried onto them (components/global-run.tsx), and they name their scope "Current state".
 */
export function isCurrentStateView(pathname: string): boolean {
  return pathname === "/home" || pathname.startsWith("/home/") || pathname === "/insights" || pathname === "/insights/exec";
}

/** The one name of the current-state scope, wherever a picker or header shows it. */
export const CURRENT_STATE_LABEL = "Current state";

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

/** Measured dimension scores, as the API's `_measured_dimensions`: a coverage of 0 means the dimension was not measured. */
export function measuredDimensions(s: DQSSummary): Record<string, number> {
  const coverage: Partial<Record<string, number>> = s.dimension_coverage ?? {};
  const scores: Partial<Record<string, number | null>> = { ...s.dimension_scores };
  return Object.fromEntries(
    Object.entries(scores).filter((e): e is [string, number] => e[1] != null && coverage[e[0]] !== 0),
  );
}

/** The lowest measured dimension, as the API's `_worst_dimension` (ties: the first in the summary). */
export function worstDimension(s: DQSSummary): string | null {
  let worst: [string, number] | null = null;
  for (const e of Object.entries(measuredDimensions(s))) if (!worst || e[1] < worst[1]) worst = e;
  return worst?.[0] ?? null;
}

const TREND_RUNS = 8;

/**
 * The object's composite score over the last <=8 scored runs of `run`'s lineage up to and including `run`, oldest
 * first, as the API's list `trend`: runs that did not score the object are skipped. One entry means its first run.
 */
export function lineageTrend(module: string, run: Version, versions: readonly Version[]): number[] {
  const lineage = lineageOf(run);
  const inLineage = [run, ...versions.filter((v) => v.id !== run.id && isScored(v) && lineageOf(v) === lineage && v.run_at <= run.run_at)];
  return inLineage
    .sort(newestFirst)
    .slice(0, TREND_RUNS)
    .reverse()
    .map((v) => v.dqs_summary?.[module]?.composite_score)
    .filter((y): y is number => y != null);
}

/** An objects-list row of the current state: the object's row at its own latest run, and that run. */
export type CurrentObjectRow = Omit<ObjectSummary, "affected_records"> & {
  /** Null only when the object's run could not be read and the aggregate cannot attribute its records. */
  affected_records: number | null;
  run_id: string;
};

/**
 * The objects list of the current state: every object at the latest finished run of its lineage (`stateObjects`
 * over `runs`, the result of `latestPerLineage`). Each row is the object's row from `GET /objects?run=<its run>`
 * (`lists`, keyed by run id), so score, readiness, failing checks, affected records, worst dimension and trend are
 * that run's. A run whose list could not be read still lists its objects from the run's `dqs_summary`
 * (`stateRows`: affected records from the aggregate where attributable, dimensions derived as the API derives
 * them). An object a run's list holds without a summary (findings, no score) is kept from the newest run listing it.
 */
export function currentObjectRows(
  runs: readonly Version[],
  lists: ReadonlyMap<string, readonly ObjectSummary[] | undefined>,
  opts: {
    bands?: ScoreBands;
    aggregate?: Pick<FindingsAggregate, "version_ids" | "by_module"> | null;
    versions?: readonly Version[];
    modules?: ReadonlySet<string> | null;
  } = {},
): CurrentObjectRow[] {
  const objects = stateObjects(runs, opts.modules);
  const fallback = new Map(stateRows(objects, opts.bands, opts.aggregate, opts.versions).map((r) => [r.module, r]));
  const out = new Map<string, CurrentObjectRow>();
  for (const { module, summary, run } of objects) {
    const listed = lists.get(run.id)?.find((o) => o.module === module);
    const base = fallback.get(module);
    if (listed) out.set(module, { ...listed, run_id: run.id });
    else if (base) out.set(module, { ...base, worst_dimension: worstDimension(summary), dimension_scores: measuredDimensions(summary), trend: lineageTrend(module, run, opts.versions ?? runs) });
  }
  for (const run of [...runs].sort(newestFirst)) {
    for (const o of lists.get(run.id) ?? []) {
      if (out.has(o.module) || (opts.modules && !opts.modules.has(o.module))) continue;
      out.set(o.module, { ...o, run_id: run.id });
    }
  }
  return [...out.values()].sort((a, b) => a.module.localeCompare(b.module));
}

/**
 * Failing critical and high checks across the objects: the "Critical and high findings" tile of the current state.
 * Not "blocking findings": the insights overview's blockers (`blockers.count`) are failing rules that are critical
 * or that the S/4 readiness pack counts as blocking, a different set.
 */
export function criticalHighTotal(objects: readonly StateObject[]): number {
  return objects.reduce((n, o) => n + o.summary.critical_count + o.summary.high_count, 0);
}

/** The `severity` value that lists the findings behind `criticalHighTotal`. */
export const CRITICAL_AND_HIGH = "critical,high";

/**
 * The findings behind `criticalHighTotal`: one run's findings tab filtered to critical and high, or (several runs)
 * the current-state findings on the Insights overview, filtered the same way. `module` narrows one run's tab to an
 * object, for a count taken over that object alone.
 */
export function criticalHighHref(runs: readonly Pick<Version, "id">[], module?: string): string {
  if (runs.length !== 1) return `/insights?severity=${CRITICAL_AND_HIGH}`;
  return `/runs/${runs[0].id}?tab=findings${module ? `&module=${encodeURIComponent(module)}` : ""}&severity=${CRITICAL_AND_HIGH}`;
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

/**
 * The change the newest run made to the current state's score: `runs` (the latest run of each lineage, newest
 * first) with the newest swapped for the run before it in its own lineage, so it never compares one object with
 * another. Null when the newest run is its lineage's first or nothing is scored. Home, the Insights overview and the
 * executive summary show this one delta.
 */
export function stateDelta(runs: readonly Version[], finished: readonly Version[], modules?: ReadonlySet<string> | null): number | null {
  const newest = runs[0];
  if (!newest) return null;
  const dqs = stateDqs(stateObjects(runs, modules));
  const previous = previousInLineage(newest, [...finished]);
  const previousDqs = previous ? stateDqs(stateObjects(runs.map((r) => (r.id === newest.id ? previous : r)), modules)) : null;
  return dqs != null && previousDqs != null ? round1(dqs - previousDqs) : null;
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
