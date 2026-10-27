"use client";

// The strip above the object page's tabs. The Records to fix tab itself is the Fix work queue with this object fixed
// (components/work/fix-work.tsx), so its filters are Fix work's URL keys: `check`, `sev`, `st`, `mine`, `sugg`, `due`.
import { useSearchParams } from "next/navigation";
import { Stat } from "@/design";
import type { WorkObject } from "@/lib/api/work";
import type { ObjectSummary } from "@/lib/api/v1/objects";

/** Fix work's filter keys (and its selected record), cleared when a tile sets its own. */
const FIX_KEYS = ["check", "sev", "st", "mine", "assignee", "sugg", "due", "system", "part", "q", "record"] as const;

/** The URL of the object page with `patch` applied (null deletes a key). */
function useHrefWith(object: string) {
  const search = useSearchParams();
  return (patch: Record<string, string | null>) => {
    const params = new URLSearchParams(search?.toString() ?? "");
    for (const [k, v] of Object.entries(patch)) { if (v) params.set(k, v); else params.delete(k); }
    const q = params.toString();
    return q ? `/objects/${object}?${q}` : `/objects/${object}`;
  };
}

/**
 * The compact strip above the object's tabs: its records to fix (the work list), how many of those are critical, how many
 * carry a suggested value and how many are overdue (the DQS is the header's ring). The counts come from the work
 * list; before it is built, the first tile shows the run's rule failures (summed over rules) and says so. Each tile
 * opens Records to fix with its filter. On that tab the queue's own tiles say the same, so the page hides this strip.
 */
export function FixStrip({ object, summary, work, loading }: {
  object: string; summary: ObjectSummary | undefined; work: WorkObject | undefined; loading: boolean;
}) {
  const hrefWith = useHrefWith(object);
  const fix = (patch: Record<string, string | null>) =>
    hrefWith({ tab: "fix", ...Object.fromEntries(FIX_KEYS.map((k) => [k, null])), ...patch });
  const failing = work?.open ?? (loading ? undefined : summary?.affected_records);
  return (
    <div className="m-stat-grid" data-testid="fix-strip">
      <Stat label={work || loading ? "Records to fix" : "Rule failures"} value={failing == null ? "—" : failing.toLocaleString()} href={fix({})} loading={loading && !work} />
      <Stat
        label="Critical"
        value={work ? work.critical.toLocaleString() : "—"}
        tone={work ? (work.critical > 0 ? "no-go" : "go") : undefined}
        href={work && work.critical > 0 ? fix({ sev: "critical" }) : undefined}
        loading={loading && !work}
      />
      <Stat
        label="With a suggestion"
        value={work ? work.proposed.toLocaleString() : "—"}
        hint={work && work.open > 0 ? `${Math.round((work.proposed / work.open) * 100)}% of records to fix` : undefined}
        href={work && work.proposed > 0 ? fix({ sugg: "1" }) : undefined}
        loading={loading && !work}
      />
      <Stat
        label="Overdue"
        value={work ? work.overdue.toLocaleString() : "—"}
        tone={work ? (work.overdue > 0 ? "no-go" : "go") : undefined}
        href={work && work.overdue > 0 ? fix({ due: "overdue" }) : undefined}
        loading={loading && !work}
      />
    </div>
  );
}
