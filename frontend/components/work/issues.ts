import type { RecordFilter, WorkGroup, WorkRecord } from "@/lib/api/work";

/**
 * The Issues pane beside the Fix work queue follows the queue's filters. GET /work/groups applies the object,
 * severity and "has a suggestion" itself; the record-level filters (mine, an assignee, a status other than open,
 * overdue, a key part, a source system, a record search) it cannot. Under those the pane counts the queue's own
 * records once every page of it is loaded (the queue is short under such a filter: "Mine" is a person's records),
 * and otherwise says plainly that it lists every open issue.
 */
export function recordLevelFilters(f: RecordFilter): string[] {
  return [
    f.assigned === "me" ? "Mine" : f.assigned ? "the assignee" : null,
    f.status && f.status !== "open" ? "the status" : null,
    f.due ? "overdue" : null,
    f.part ? "the key part" : null,
    f.since ? "the baseline" : null,
    f.system ? "the source system" : null,
    f.q ? "the search" : null,
  ].filter((x): x is string => !!x);
}

const SEVERITY_RANK = ["critical", "high", "medium", "low"];
const rank = (s: string) => (SEVERITY_RANK.includes(s) ? SEVERITY_RANK.indexOf(s) : SEVERITY_RANK.length);
const groupKey =(module: string, check: string) => `${module}|${check}`;

export type IssuesView =
  /** No record-level filter: the groups as the server counts them. */
  | { mode: "all"; groups: WorkGroup[] }
  /** Record-level filters and the whole list loaded: only the issues on the listed records, counted on them. */
  | { mode: "list"; groups: WorkGroup[] }
  /** Record-level filters and more records than are loaded: every open issue, and the filters it does not follow. */
  | { mode: "unfiltered"; groups: WorkGroup[]; ignores: string[] };

export function issuesView(groups: WorkGroup[], filter: RecordFilter, records: Pick<WorkRecord, "module" | "checks">[], complete: boolean): IssuesView {
  const ignores = recordLevelFilters(filter);
  if (!ignores.length) return { mode: "all", groups };
  if (!complete) return { mode: "unfiltered", groups, ignores };
  const counts = new Map<string, number>();
  for (const r of records) for (const c of new Set(r.checks)) counts.set(groupKey(r.module, c), (counts.get(groupKey(r.module, c)) ?? 0) + 1);
  return {
    mode: "list",
    groups: groups
      .filter((g) => counts.has(groupKey(g.module, g.check_id)))
      .map((g) => ({ ...g, open: counts.get(groupKey(g.module, g.check_id)) ?? 0 }))
      // Worst first, as the server ranks them: severity, then the records on the list.
      .sort((a, b) => rank(a.severity) - rank(b.severity) || b.open - a.open),
  };
}
