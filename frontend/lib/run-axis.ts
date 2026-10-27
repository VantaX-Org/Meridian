import { formatDate } from "@/lib/format";

const KINDS = ["date", "datetime", "seconds"] as const;

/**
 * Axis ticks for a run series keyed by run id, in ONE format for the whole axis: the date when every run has a day of
 * its own, else date and time to the minute when that tells them apart, else to the second; runs that still share a
 * tick get an ordinal ("#2", in run order). A per-run choice put "16 Oct, 03:01:32" beside "16 Oct, 03:04" on one
 * axis. Run labels are user-supplied upload names, so they never become ticks.
 */
export function runAxisTicks(runs: readonly { id: string; run_at: string | null | undefined }[]): Map<string, string> {
  const unique = (k: (typeof KINDS)[number]) => {
    const keys = runs.map((r) => formatDate(r.run_at, k));
    return new Set(keys).size === keys.length;
  };
  const kind = KINDS.find(unique) ?? "seconds";
  const out = new Map<string, string>();
  const seen = new Map<string, number>();
  const tally = new Map<string, number>();
  for (const r of runs) {
    const k = formatDate(r.run_at, kind);
    tally.set(k, (tally.get(k) ?? 0) + 1);
  }
  const ordered = [...runs].sort((a, b) => (a.run_at ?? "").localeCompare(b.run_at ?? ""));
  for (const r of ordered) {
    const k = formatDate(r.run_at, kind);
    if ((tally.get(k) ?? 0) <= 1 || k === "—") { out.set(r.id, k); continue; }
    const n = (seen.get(k) ?? 0) + 1;
    seen.set(k, n);
    out.set(r.id, `${k} #${n}`);
  }
  return out;
}
