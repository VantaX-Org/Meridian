import type { Version } from "@/types/api";
import { formatDate, formatModuleName } from "@/lib/format";
import { isFinished, labelFamily, sameLineage } from "@/lib/runs";

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

/**
 * True when the run is known not to have measured `object`: it says which objects it covers (scores or asked-for
 * modules) and `object` is not among them. A run that says nothing about its objects is not ruled out here.
 */
export function runLacksObject(v: Version, object: string): boolean {
  const knows = Object.keys(v.dqs_summary ?? {}).length > 0 || (v.metadata?.modules?.length ?? 0) > 0;
  return knows && !runHasObject(v, object);
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

/** The least a run needs to be named: its label; the objects it measured and the day it ran refine the fallback. */
export type RunNameInput = { label?: string | null; run_at?: string | null } & Partial<Pick<Version, "metadata" | "dqs_summary">>;

/** "16 Oct, 05:17": the day and time a run ran; the year is shown only when it is not this year. */
export function runWhen(iso: string | null | undefined): string {
  const text = formatDate(iso, "datetime");
  const year = String(new Date().getFullYear());
  return text.replace(/ (\d{4}),? /, (m, y: string) => (y === year ? ", " : m));
}

/** True for an upload or dataset name such as `controlling_1k` or `export.xlsx`, which names a file, not a run. */
function looksLikeFileName(label: string): boolean {
  return /^\S+$/.test(label) && (label.includes("_") || /\.[a-z0-9]{2,5}$/i.test(label));
}

/** The objects a run measured, as words: "Controlling", "Material master and Business partner", "Controlling and 3 more". */
function runObjects(v: RunNameInput): string {
  const modules = v.metadata?.modules?.length ? v.metadata.modules : Object.keys(v.dqs_summary ?? {});
  if (modules.length) {
    const names = modules.map(formatModuleName);
    return names.length <= 2 ? names.join(" and ") : `${names[0]} and ${names.length - 1} more`;
  }
  const label = v.label?.trim();
  if (!label) return "";
  if (!looksLikeFileName(label)) return label;
  const family = labelFamily(label.replace(/\.[a-z0-9]{2,5}$/i, ""));
  return family ? formatModuleName(family) : "";
}

/**
 * The one name of a run, never a raw id or file name: the objects it measured and when it ran ("Controlling,
 * 16 Oct, 05:17"). The upload's file name stays available as `runFileName`, for a tooltip or a detail list. Every
 * surface that prints a run goes through here (or `runScopeLabel`), so one run reads the same on every page.
 */
export function runName(v: RunNameInput): string {
  // A name a person gave the run (not a file or dataset name) is theirs: it stands as it is.
  const given = v.label?.trim();
  if (given && !looksLikeFileName(given)) return given;
  const objects = runObjects(v);
  const when = v.run_at ? runWhen(v.run_at) : "";
  if (objects && when) return `${objects}, ${when}`;
  return objects || when || "Run";
}

/** The file or dataset name a run was made from, when it carries one: secondary text beside `runName`. */
export function runFileName(v: RunNameInput): string | undefined {
  return v.metadata?.file_name?.trim() || (v.label && looksLikeFileName(v.label.trim()) ? v.label.trim() : undefined);
}

/** Where a run's data came from: the system's name when a lookup has it, else "upload" for a file. */
export function runSourceLabel(v: RunNameInput, systemName?: string | null): string {
  if (v.metadata?.system_id) return systemName ?? "System";
  return "upload";
}

/** The run's name; kept as its own export so a surface that wants a short scope label reads the same text. */
export function runScopeLabel(v: RunNameInput & Pick<Version, "run_at">): string {
  const given = v.label?.trim();
  // A name a person gave the run carries no time of its own, so its day follows it.
  return given && !looksLikeFileName(given) ? `${given}, ${formatDate(v.run_at, "date")}` : runName(v);
}

/** The run's name, with its number within its lineage when the API sends one: "Material master, 14 Oct, 05:00, run 2". */
export function runScopeLabelNumbered(v: RunNameInput & Pick<Version, "run_at"> & { run_number?: number | null }): string {
  const short = runScopeLabel(v);
  return v.run_number ? `${short}, run ${v.run_number}` : short;
}

/**
 * Picker labels: the run's name, which carries the time. Two runs that still read the same (same objects, same
 * minute) get their run number so a re-run is pickable.
 */
export function runChoiceLabels(runs: readonly Version[]): Map<string, string> {
  const seen = new Map<string, number>();
  for (const r of runs) seen.set(runName(r), (seen.get(runName(r)) ?? 0) + 1);
  return new Map(runs.map((r) => {
    const name = runName(r);
    return [r.id, r.run_number && (seen.get(name) ?? 0) > 1 ? `${name}, run ${r.run_number}` : name];
  }));
}

/** "controlling_1k.csv" -> "Controlling": the object an upload or dataset name stands for. */
export function objectFromFileName(name: string): string {
  const family = labelFamily(name.trim().replace(/\.[a-z0-9]{2,5}$/i, ""));
  return family ? formatModuleName(family) : name.trim();
}

/**
 * A job's name in words: "Re-analysis | material_master_25k" reads "Re-analysis of Material master" and an upload's
 * "controlling_1k.csv" reads "Upload of Controlling". Any other label is already a sentence and stays as it is.
 */
export function jobName(label: string): string {
  const run = /^(Analysis|Re-analysis)\s*\|\s*(.+)$/.exec(label);
  if (run) return `${run[1]} of ${looksLikeFileName(run[2].trim()) ? objectFromFileName(run[2]) : run[2].trim()}`;
  if (/^\S+\.(csv|xlsx?|parquet|txt|tsv)$/i.test(label.trim())) return `Upload of ${objectFromFileName(label)}`;
  return label;
}
