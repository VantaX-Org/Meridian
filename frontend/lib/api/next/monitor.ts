/**
 * The monitor feed (api/routes/objects.py).
 *   GET /objects/monitor/feed   module, limit (1 to 500), offset: new and regressed findings per object, newest run first
 */
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { v2Get } from "@/lib/api/v2/client";
import { useFixture } from "@/lib/api/v2/fixture";

export interface Finding {
  module: string;
  label: string;
  check_id: string;
  change: "new" | "regressed";
  records: number;
  reason: string;
  version_id: string;
  baseline_version_id: string;
  detected_at: string | null;
}

export interface FeedPage {
  items: Finding[];
  total: number;
  limit: number;
  offset: number;
  next_offset: number | null;
  /** Records that failed in the baseline and pass in the run, per run (version id). Runs with none are absent. */
  resolved?: Record<string, number>;
}

export interface FeedQuery {
  module?: string;
  limit: number;
}

export function getFeed(q: FeedQuery): Promise<FeedPage> {
  return v2Get<FeedPage>("/objects/monitor/feed", { module: q.module || undefined, limit: q.limit, offset: 0 });
}

/** The first `limit` findings; the screen raises the limit to show more, so the server stays the pager. */
export function useFeed(q: FeedQuery) {
  const fixture = useFixture();
  return useQuery({ queryKey: ["next", "monitor-feed", fixture, q], queryFn: () => getFeed(q), placeholderData: keepPreviousData });
}

export interface RunGroup {
  version_id: string;
  baseline_version_id: string;
  module: string;
  label: string;
  detected_at: string | null;
  findings: Finding[];
  newCount: number;
  regressedCount: number;
  resolvedCount: number;
}

/** One entry per run, in the order the feed delivers them; findings keep the feed's order (most records first). */
export function groupByRun(items: Finding[], resolved: Record<string, number> = {}): RunGroup[] {
  const by = new Map<string, RunGroup>();
  for (const f of items) {
    let g = by.get(f.version_id);
    if (!g) {
      g = { version_id: f.version_id, baseline_version_id: f.baseline_version_id, module: f.module, label: f.label, detected_at: f.detected_at, findings: [], newCount: 0, regressedCount: 0, resolvedCount: resolved[f.version_id] ?? 0 };
      by.set(f.version_id, g);
    }
    g.findings.push(f);
    if (f.change === "new") g.newCount += f.records;
    else g.regressedCount += f.records;
  }
  return [...by.values()];
}
