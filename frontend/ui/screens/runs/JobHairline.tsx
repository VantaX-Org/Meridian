"use client";

import { useLiveRuns } from "@/lib/api/next/live-runs";
import { useFixture, withFixture } from "@/lib/api/v2/fixture";
import { formatDuration } from "@/lib/format";
import { t } from "@/lib/v2/i18n";
import { Button } from "@/ui/kit";
import "./runs.css";

/** One thin line per run in flight, from /jobs/active/progress. Nothing renders when no run is live. */
export function JobHairline() {
  const fx = useFixture();
  const { runs } = useLiveRuns();
  const live = runs.filter((r) => r.status === "queued" || r.status === "running");
  if (live.length === 0) return null;
  return (
    <div role="status" aria-label={t("Runs in progress")} className="rn-stack">
      {live.slice(0, 3).map((r) => (
        <div key={r.id} className="rn-hair">
          <div className="rn-hair-row">
            <span>{r.label}</span>
            <span className="mx-muted">
              {r.status === "queued" ? t("Queued, place {n}", { n: r.queue_position ?? 1 }) : r.pct != null ? `${Math.round(r.pct)}%` : t("Working")}
              {r.eta_s != null ? ` ${t("{time} left", { time: formatDuration(r.eta_s * 1000) })}` : ""}
            </span>
            {r.version_id ? <Button variant="ghost" href={withFixture(`/n/run/${r.version_id}`, fx)}>{t("Open")}</Button> : null}
          </div>
          <div className="rn-hair-bar" role="progressbar" aria-label={r.label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={r.pct != null ? Math.round(r.pct) : undefined}>
            <div className="rn-hair-fill" data-indeterminate={r.pct == null} style={r.pct != null ? { inlineSize: `${Math.max(2, Math.min(100, r.pct))}%` } : undefined} />
          </div>
        </div>
      ))}
    </div>
  );
}
