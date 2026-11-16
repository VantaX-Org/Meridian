"use client";

import { useLiveRuns } from "@/lib/api/next/live-runs";
import { useFixture, withFixture } from "@/lib/api/v2/fixture";
import { formatDuration } from "@/lib/format";
import { t } from "@/lib/v2/i18n";
import { Button, Hairline } from "@/ui/kit";

/** One thin line per run in flight, from /jobs/active/progress. Nothing renders when no run is live. */
export function JobHairline() {
  const fx = useFixture();
  const { runs } = useLiveRuns();
  const live = runs.filter((r) => r.status === "queued" || r.status === "running").slice(0, 3);
  return (
    <Hairline
      label={t("Runs in progress")}
      items={live.map((r) => ({
        id: r.id,
        label: r.label,
        pct: r.pct ?? null,
        meta: `${r.status === "queued" ? t("Queued, place {n}", { n: r.queue_position ?? 1 }) : r.pct != null ? `${Math.round(r.pct)}%` : t("Working")}${r.eta_s != null ? ` ${t("{time} left", { time: formatDuration(r.eta_s * 1000) })}` : ""}`,
        action: r.version_id ? <Button variant="ghost" href={withFixture(`/n/run/${r.version_id}`, fx)}>{t("Open")}</Button> : undefined,
      }))}
    />
  );
}
