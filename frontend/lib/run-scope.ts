import type { Version } from "@/types/api";
import { formatDate, formatModuleName } from "@/lib/format";
import { isFinished, sameLineage } from "@/lib/runs";

/**
 * Which run a page shows. There is no global run: a page without `?run=` shows the latest finished run that is
 * relevant to it (for an object page, the newest finished run that measured that object; for a cross-object page,
 * the newest finished run), and `?run=` pins an older run as a deep link. The page header names the run it shows
 * ("As of ..."), and pages where an older run matters offer the other runs of the same lineage.
 */

/** True when the run measured `object`: the object is in its scores or in the modules it was asked to analyse. */
export function runHasObject(v: Version, object: string): boolean {
  return !!v.dqs_summary?.[object] || !!v.metadata?.modules?.includes(object);
}

/** Runs read from an in-scope system; every run when the user is not scoped to systems. */
export function inSystems(versions: readonly Version[], systems: ReadonlySet<string> | null | undefined): Version[] {
  return systems ? versions.filter((v) => v.metadata?.system_id !== undefined && systems.has(v.metadata.system_id)) : [...versions];
}

const newestFirst = (a: Version, b: Version) => (a.run_at < b.run_at ? 1 : a.run_at > b.run_at ? -1 : 0);

/** The newest finished run, or the newest finished run that measured `object`, among in-scope systems. */
export function latestFinishedRun(
  versions: readonly Version[],
  opts: { object?: string; systems?: ReadonlySet<string> | null } = {},
): Version | undefined {
  return inSystems(versions, opts.systems)
    .filter((v) => isFinished(v) && !v.metadata?.archived && (!opts.object || runHasObject(v, opts.object)))
    .sort(newestFirst)[0];
}

/**
 * The runs a page may switch to from `current`: finished runs of its lineage (and, on an object page, those that
 * measured the object), newest first, `current` always included so the picker can show it.
 */
export function lineageChoices(current: Version, versions: readonly Version[], object?: string): Version[] {
  const all = versions.some((v) => v.id === current.id) ? [...versions] : [...versions, current];
  return sameLineage(current, all).filter(
    (v) => v.id === current.id || (isFinished(v) && !v.metadata?.archived && (!object || runHasObject(v, object))),
  );
}

export interface ResolvedScope {
  /** The run the page shows: `?run=` when set, else the latest relevant finished run. */
  runId: string | undefined;
  run: Version | undefined;
  /** The run the page shows without `?run=`. */
  latestId: string | undefined;
  /** `?run=` as given. */
  explicit: string | undefined;
  /** `?run=` names a run other than the latest: the page offers "Back to latest". */
  pinned: boolean;
  /** Other runs of the shown run's lineage the page may switch to, newest first, the shown run included. */
  choices: Version[];
}

export function resolveScope({ explicit, versions, object, systems }: {
  explicit?: string | null;
  versions: readonly Version[];
  object?: string;
  systems?: ReadonlySet<string> | null;
}): ResolvedScope {
  const latest = latestFinishedRun(versions, { object, systems });
  const given = explicit || undefined;
  const runId = given ?? latest?.id;
  const run = runId ? versions.find((v) => v.id === runId) : undefined;
  return {
    runId,
    run,
    latestId: latest?.id,
    explicit: given,
    pinned: !!given && given !== latest?.id,
    choices: run ? lineageChoices(run, versions, object) : [],
  };
}

/** `pathname` with the current query, `?run=` set to `run` or removed when `run` is null. */
export function hrefWithRun(pathname: string, search: URLSearchParams | string | null | undefined, run: string | null): string {
  const params = new URLSearchParams(search?.toString() ?? "");
  if (run) params.set("run", run);
  else params.delete("run");
  const q = params.toString();
  return q ? `${pathname}?${q}` : pathname;
}

/** A run's name, never a raw id: its label, else the objects it measured. */
export function runName(v: Pick<Version, "label" | "metadata" | "dqs_summary">): string {
  if (v.label) return v.label;
  const modules = v.metadata?.modules?.length ? v.metadata.modules : Object.keys(v.dqs_summary ?? {});
  return modules.length ? modules.map(formatModuleName).join(", ") : "Run";
}

/** "material_master_25k, 16 Oct 2026": the run's name and the day it ran. */
export function runScopeLabel(v: Pick<Version, "label" | "metadata" | "dqs_summary" | "run_at">): string {
  return `${runName(v)}, ${formatDate(v.run_at, "date")}`;
}

/** Picker labels: name and day, with the time added where two runs would otherwise read the same. */
export function runChoiceLabels(runs: readonly Version[]): Map<string, string> {
  const day = new Map<string, number>();
  for (const r of runs) day.set(runScopeLabel(r), (day.get(runScopeLabel(r)) ?? 0) + 1);
  return new Map(runs.map((r) => {
    const short = runScopeLabel(r);
    return [r.id, (day.get(short) ?? 0) > 1 ? `${runName(r)}, ${formatDate(r.run_at, "datetime")}` : short];
  }));
}
