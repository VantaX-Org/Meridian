import type { AreaObject, LoadArea } from "@/lib/api/config-load";

const lower = (t: string) => t.charAt(0).toLowerCase() + t.slice(1);

/** The cause or outcome of one object's read, in plain words. The object name is shown beside it, so it is not repeated. */
export function objectText(o: AreaObject): string {
  if (o.cause === "auth") return "No authorisation to read this table. The user needs read access to it.";
  if (o.cause === "timeout") return "Reading timed out. Try again outside peak hours or ask Basis to raise the RFC timeout.";
  if (o.cause === "not_in_release") return "The table does not exist in this release. Nothing to fix.";
  if (o.cause === "not_exposed") return "The system does not expose this object. Nothing to fix.";
  if (o.state === "loaded") return `${o.rows.toLocaleString("en-US")} found.`;
  if (o.state === "empty") return "No rows.";
  return o.detail || "Not read.";
}

/** One line per area: what was found (up to two objects), or that nothing was found. */
export function areaFound(a: LoadArea): string {
  const found = a.objects.filter((o) => o.state === "loaded" && o.rows > 0).slice(0, 2);
  if (!found.length) return `No ${lower(a.label)} configuration found.`;
  return found.map((o) => `${o.rows.toLocaleString("en-US")} ${lower(o.label ?? o.object)}`).join(", ");
}

/**
 * Where an object's configuration came from. A loaded or empty object was read live from the system. One that failed,
 * or that the system does not expose, falls back to the SAP standard baseline, so the rules that depend on it apply by default.
 */
export function objectSource(state: string): "live" | "baseline" {
  return state === "loaded" || state === "empty" ? "live" : "baseline";
}

export const SOURCE_WORD: Record<string, string> = {
  live: "Live from the system",
  live_snapshot: "Live, from the last load",
  baseline: "SAP standard baseline",
  mixed: "Live and baseline mixed",
  unavailable: "Not available",
};

export const AREA_STATUS_WORD: Record<string, string> = { loaded: "Loaded", failed: "Not fully read", running: "Reading", waiting: "Waiting", not_available: "Not available" };
