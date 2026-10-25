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

/** The object page's Records to fix tab, optionally filtered (`sev`, `suggested`, `due`). `run` undefined opens the object's own latest run. */
export function toFixHref(module: string, run: string | undefined, filters: Record<string, string> = {}): string {
  const q = new URLSearchParams({ ...(run ? { run } : {}), tab: "fix", ...filters });
  return `/objects/${module}?${q.toString()}`;
}
