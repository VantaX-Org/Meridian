import type { AreaObject, LoadArea } from "@/lib/api/config-load";
import { t as tr, lcFirst } from "@/lib/v2/i18n";
import { int } from "@/lib/v2/score";


/** The cause or outcome of one object's read, in plain words. The object name is shown beside it, so it is not repeated. */
export function objectText(o: AreaObject): string {
  if (o.cause === "auth") return tr("No authorisation to read this table. The user needs read access to it.");
  if (o.cause === "timeout") return tr("Reading timed out. Try again outside peak hours or ask Basis to raise the RFC timeout.");
  if (o.cause === "not_in_release") return tr("The table does not exist in this release. Nothing to fix.");
  if (o.cause === "not_exposed") return tr("The system does not expose this object. Nothing to fix.");
  if (o.state === "loaded") return tr("{rows} found.", { rows: int(o.rows) });
  if (o.state === "empty") return tr("No rows.");
  return o.detail || tr("Not read.");
}

/** One line per area: what was found (up to two objects), or that nothing was found. */
export function areaFound(a: LoadArea): string {
  const found = a.objects.filter((o) => o.state === "loaded" && o.rows > 0).slice(0, 2);
  if (!found.length) return tr("No {lower} configuration found.", { lower: lcFirst(a.label) });
  return found.map((o) => `${int(o.rows)} ${lcFirst(o.label ?? o.object)}`).join(", ");
}

/**
 * Where an object's configuration came from. A loaded or empty object was read live from the system. One that failed,
 * or that the system does not expose, falls back to the SAP standard baseline, so the rules that depend on it apply by default.
 */
export function objectSource(state: string): "live" | "baseline" {
  return state === "loaded" || state === "empty" ? "live" : "baseline";
}

export const SOURCE_WORD: Record<string, string> = {
  get live() { return tr("Live from the system"); },
  get live_snapshot() { return tr("Live, from the last load"); },
  get baseline() { return tr("SAP standard baseline"); },
  get mixed() { return tr("Live and baseline mixed"); },
  get unavailable() { return tr("Not available"); },
};

export const AREA_STATUS_WORD: Record<string, string> = { get loaded() { return tr("Loaded"); }, get failed() { return tr("Not fully read"); }, get running() { return tr("Reading"); }, get waiting() { return tr("Waiting"); }, get not_available() { return tr("Not available"); } };
