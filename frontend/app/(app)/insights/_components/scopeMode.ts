// What an insight page's numbers describe, decided once for the frame and the page alike.
import type { Version } from "@/types/api";
import { isScored, latestPerLineage } from "@/lib/current-state";
import { lineageChoices } from "@/lib/run-scope";

/**
 * "current": every object at the latest finished run of its lineage (lib/current-state.ts), the scope of the homes.
 * "run": one run, named in the header ("As of ...") with a picker of the runs to switch to.
 */
export type InsightScopeMode = "current" | "run";

/**
 * Views that can describe the current state across objects: the overview and the executive summary, so Home and
 * the summary answer "how are we" with the same number. Every other view that takes its scope from the frame reads
 * an endpoint that answers one run (`/insights/rules`, `/insights/impact`, readiness, the trends of one lineage, a
 * run compared with its baseline), so it always shows one run and says so.
 */
export const CURRENT_STATE_VIEWS: readonly string[] = ["/insights", "/insights/exec"];

/** Views that take their scope from the frame and always show one run. */
export const ONE_RUN_VIEWS: readonly string[] = [
  "/insights/progress",
  "/insights/trends",
  "/insights/rules",
  "/insights/impact",
  "/insights/duplicates",
  "/insights/mining",
  "/insights/readiness",
];

/**
 * The scope of an insight view: the current state only on a view that can describe it, and only while nothing
 * pins one run: no `?run=`, and no `?module=` (an object filter narrows the page to the latest run that measured
 * that object, so it shows that run).
 */
export function insightScopeMode(pathname: string, { explicit, module }: { explicit?: string | null; module?: string | null }): InsightScopeMode {
  if (explicit || module) return "run";
  return CURRENT_STATE_VIEWS.includes(pathname) ? "current" : "run";
}

/**
 * The runs a one-run view may switch to: the other runs of the shown run's lineage, and the latest finished run of
 * every other lineage, so a view that opened on the newest run can still reach any object. Newest first, the shown
 * run included.
 */
export function insightRunChoices(current: Version, versions: readonly Version[]): Version[] {
  const out = new Map<string, Version>();
  for (const v of lineageChoices(current, versions)) out.set(v.id, v);
  for (const v of latestPerLineage(versions.filter((x) => isScored(x) && !x.metadata?.archived))) if (!out.has(v.id)) out.set(v.id, v);
  return [...out.values()].sort((a, b) => (a.run_at < b.run_at ? 1 : a.run_at > b.run_at ? -1 : 0));
}
