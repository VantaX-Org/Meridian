// The steward work list as the object screens read it: the per-object counts and the link into an object's records to fix.
import { getWorkSummary } from "@/lib/api/work";

/** The work list's record counts are capped server-side at this many (api/routes/work.py COUNT_CAP). */
export const WORK_COUNT_CAP = 100_000;

/** Per object of a run: records to fix, critical, with a suggestion, overdue. Shares the ["work"] prefix decisions invalidate. */
export const workSummaryQuery = (run: string | undefined) => ({
  queryKey: ["work", "summary", run ?? "latest"],
  queryFn: () => getWorkSummary(run),
  enabled: !!run,
  staleTime: 30_000,
  retry: false,
  meta: { ignoreError: true },
});

/** "1,234 records", or "100,000+ records" when the server stopped counting. */
export function recordCount(total: number, capped: boolean): string {
  if (capped) return `${WORK_COUNT_CAP.toLocaleString()}+ records`;
  return `${total.toLocaleString()} ${total === 1 ? "record" : "records"}`;
}

/** The tab is the Fix work queue, so its filters take Fix work's URL keys; the older names map onto them. */
const FIX_KEY: Record<string, string> = { issue: "check", suggested: "sugg", status: "st" };

/** The object page's Records to fix tab, optionally filtered (`sev`, `sugg`, `due`, `check`). `run` undefined opens the object's own latest run. */
export function toFixHref(module: string, run: string | undefined, filters: Record<string, string> = {}): string {
  const keyed = Object.fromEntries(Object.entries(filters).map(([k, v]) => [Object.hasOwn(FIX_KEY, k) ? FIX_KEY[k] : k, v]));
  const q = new URLSearchParams({ ...(run ? { run } : {}), tab: "fix", ...keyed });
  return `/objects/${module}?${q.toString()}`;
}
