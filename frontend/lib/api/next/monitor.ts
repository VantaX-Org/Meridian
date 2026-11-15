/**
 * The monitor feed (api/routes/objects.py).
 *   GET /objects/monitor/feed   module, limit (1 to 500), offset: new and regressed findings per object (with severity and owner), plus resolved per run, newest run first
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
  severity: string | null;
  owner: string | null;
}

/** One run with new findings. The fields after `resolved` are optional so older servers still parse. */
export interface FeedRun {
  version_id: string;
  resolved: number;
  module?: string;
  label?: string;
  baseline_version_id?: string;
  /** The run's last_run_at, the same value its feed items carry as detected_at. */
  detected_at?: string | null;
  owner?: string | null;
}

export interface FeedPage {
  items: Finding[];
  runs: FeedRun[];
  total: number;
  limit: number;
  offset: number;
  next_offset: number | null;
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

/**
 * One entry per run, newest first; findings keep the feed's order (most records first).
 * Groups come from the findings and from `runs`, so a run whose findings are off the loaded page,
 * or that only resolved records, still counts. A group's day is the run's detected_at (last_run_at
 * on the server), taken from `runs` when present and otherwise from its first finding.
 */
export function groupByRun(items: Finding[], runs: FeedRun[] = []): RunGroup[] {
  const by = new Map<string, RunGroup>();
  const blank = (version_id: string): RunGroup => ({ version_id, baseline_version_id: "", module: "", label: "", detected_at: null, findings: [], newCount: 0, regressedCount: 0, resolvedCount: 0 });
  for (const r of runs) {
    by.set(r.version_id, { ...blank(r.version_id), baseline_version_id: r.baseline_version_id ?? "", module: r.module ?? "", label: r.label ?? "", detected_at: r.detected_at ?? null, resolvedCount: r.resolved });
  }
  for (const f of items) {
    let g = by.get(f.version_id);
    if (!g) {
      g = blank(f.version_id);
      by.set(f.version_id, g);
    }
    if (!g.findings.length) {
      g.baseline_version_id ||= f.baseline_version_id;
      g.module ||= f.module;
      g.label ||= f.label;
      g.detected_at ??= f.detected_at;
    }
    g.findings.push(f);
    if (f.change === "new") g.newCount += f.records;
    else g.regressedCount += f.records;
  }
  // A run listed in `runs` with no label and no finding has nothing to show.
  return [...by.values()].filter((g) => g.label).sort((a, b) => (b.detected_at ?? "").localeCompare(a.detected_at ?? ""));
}

export interface DayCount { day: string; newCount: number; resolvedCount: number; regressedCount: number }

/** The strip shows at most this many days, the newest ones. */
export const MAX_DAYS = 60;

export interface DaySpread {
  days: DayCount[];
  /** Run groups left out because they carry no date. */
  undated: number;
  /** Older days left out by the MAX_DAYS cap. */
  hiddenDays: number;
}

/** Sums run groups per calendar day (UTC, from detected_at), oldest first, newest MAX_DAYS days only. */
export function perDay(groups: RunGroup[]): DaySpread {
  const by = new Map<string, DayCount>();
  let undated = 0;
  for (const g of groups) {
    const day = g.detected_at?.slice(0, 10);
    if (!day) {
      undated += 1;
      continue;
    }
    const d = by.get(day) ?? { day, newCount: 0, resolvedCount: 0, regressedCount: 0 };
    d.newCount += g.newCount;
    d.resolvedCount += g.resolvedCount;
    d.regressedCount += g.regressedCount;
    by.set(day, d);
  }
  const all = [...by.values()].sort((a, b) => a.day.localeCompare(b.day));
  return { days: all.slice(-MAX_DAYS), undated, hiddenDays: Math.max(0, all.length - MAX_DAYS) };
}
