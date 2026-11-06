"use client";

import { useRunParam } from "@/lib/v2/hooks";
import { useLandscape } from "@/lib/v2/queries";
import { useTimeline } from "@/lib/v2/runs-queries";
import { useObjectRun } from "@/lib/v2/scope";
import { findSystem, moduleFromSlug } from "@/lib/v2/score";
import { formatModuleName } from "@/lib/format";
import { ObjectTrend } from "../../ObjectTrend";
import { Skeleton, V2Link } from "../../parts";
import { t } from "@/lib/v2/i18n";

/**
 * The Overview tab: the object's measured score at each finished run, full width, under the dimension bars and the
 * failing-rule list the object frame already draws. A one-run object shows a stated empty state, not a blank chart.
 */
export function OverviewTab({ system: systemSegment, module: moduleSegment }: { system: string; module: string }) {
  const runParam = useRunParam();
  const L = useLandscape(runParam);
  const mod = moduleFromSlug(moduleSegment);
  const system = L.data ? findSystem(L.data.systems, decodeURIComponent(systemSegment)) : undefined;
  const timeline = useTimeline(system?.id ?? null, 50, mod);
  const sel = useObjectRun(system?.id ?? null, mod);
  if (!system) return null;
  const label = formatModuleName(mod);
  return (
    <section className="m2-sec" aria-label={t("Score over runs")} data-testid="overview-trend">
      <h2 className="m2-h2">{t("Score over runs")}</h2>
      {timeline.isLoading ? (
        <Skeleton width="100%" height={220} />
      ) : (
        <ObjectTrend size="card" runs={timeline.data?.runs ?? []} module={mod} system={system.name} object={label} selectedId={sel.runId} />
      )}
      <p className="m2-meta m2-why1">
        {t("Each point is one finished run of this object. The Trend tab lists what changed between runs.")}{" "}
        <V2Link href={`/o/${systemSegment}/${moduleSegment}/trend`}>{t("Open the Trend tab")}</V2Link>
      </p>
    </section>
  );
}
