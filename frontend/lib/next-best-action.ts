/**
 * The next best action in plain words, from the deterministic planner's top-ranked action
 * (GET /api/v1/analytics/prescriptive, api/services/analytics_engine.py PrescriptiveAnalytics): what to do, why it
 * ranks first, and the one place to act, carrying the run (`?run=`). Pure, so every scope words it the same way.
 */
import type { NextBestAction } from "@/lib/api/analytics";
import { formatModuleName, plural } from "@/lib/format";

export interface NextBestActionView {
  title: string;
  why: string;
  verb: string;
  href: string;
}

const hours = (h: number) => plural(Math.max(1, Math.round(h)), "hour");

export function nextBestActionView(act: NextBestAction, run: string): NextBestActionView {
  const effort = `about ${hours(act.effort_hours)} of work`;
  if (act.type === "finding" && act.check_id && act.module) {
    const object = formatModuleName(act.module);
    const failing = plural(act.affected_count, "record");
    const share = act.total_count > 0 ? ` of ${act.total_count.toLocaleString()} checked` : "";
    return {
      title: `Fix ${act.check_id} in ${object}`,
      why: `${failing}${share} fail this ${act.severity} check. Fixing them clears the most severity-weighted records per hour of anything open in this run, ${effort}.`,
      verb: "Open failing records",
      // The object's records filtered to the check: the list to work through (design/shell/DrillLink buildDrillHref).
      href: `/objects/${encodeURIComponent(act.module)}?${new URLSearchParams({ run, tab: "records", check_id: act.check_id })}`,
    };
  }
  if (act.type === "cleaning") {
    return {
      title: act.title,
      why: `A proposed fix waits for review; it is the quickest open item to clear, ${effort}.`,
      verb: "Review proposed fix",
      href: `/fix?${new URLSearchParams({ tab: "cleaning", run })}`,
    };
  }
  return {
    title: act.title,
    why: `A ${act.severity} exception on ${plural(act.affected_count, "record")} is open; it clears the most weighted records per hour, ${effort}.`,
    verb: "Open exception",
    // The Inbox lists exceptions under Tasks with ?kind=exception (app/(app)/inbox/page.tsx); it has no run filter.
    href: "/inbox?kind=exception",
  };
}
