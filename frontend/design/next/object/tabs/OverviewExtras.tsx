"use client";

import { useTimeline } from "@/lib/v2/runs-queries";
import { t } from "@/lib/v2/i18n";
import Link from "next/link";
import { runLabel } from "@/lib/v2/run-label";
import { formatDate } from "@/lib/format";
import { f1 } from "@/lib/v2/score";
import { ErrorState, Skeleton } from "@/design/next/kit";
import { AreaTrend } from "@/design/next/viz";
import type { ObjectRun } from "../useObjectRun";
import "./tabs-f.css";

/** The object's measured score at each finished run. A one-run object shows a stated empty state, not a blank chart. */
export function OverviewExtras({ o }: { o: ObjectRun }) {
  const timeline = useTimeline(o.systemId, 50, o.module);
  const points = (timeline.data?.runs ?? []).flatMap((r) => {
    const s = r.objects[o.module];
    const v = s ? (s.raw_score ?? s.score) : null;
    if (v == null) return [];
    return [{ label: t("{name}, {date}: measured {score}", { name: runLabel(o.systemName, r.run_number), date: formatDate(r.run_at, "date"), score: f1(v) }), value: v }];
  });
  return (
    <section className="nx-tf-sec" aria-label={t("Score over runs")} data-testid="overview-trend">
      <h2 className="nx-sec-h">{t("Score over runs")}</h2>
      {timeline.isLoading ? (
        <Skeleton lines={4} label={t("Loading")} />
      ) : timeline.isError ? (
        <ErrorState sentence={t("The run history could not be read.")} error={timeline.error} onRetry={() => void timeline.refetch()} />
      ) : (
        <AreaTrend points={points} label={t("Score over runs")} height={160} empty={t("One run so far. The line starts at the next run.")} />
      )}
      <p className="nx-muted">
        {t("Each point is one finished run of this object. The Trend tab lists what changed between runs.")}{" "}
        <Link className="nx-link" href={o.hrefWith(`/next/o/${o.systemSeg}/${o.moduleSeg}/trend`)}>{t("Open the Trend tab")}</Link>
      </p>
    </section>
  );
}
