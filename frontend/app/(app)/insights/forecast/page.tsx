"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";
import { Button, Card, DataTable, DrillLink, EmptyState, Line, Select, Status } from "@/design";
import { getPredictiveAnalytics, type DqsForecast, type EarlyWarning, type PredictiveResponse } from "@/lib/api/analytics";
import { apiErrorMessage, isListFailure } from "@/lib/error";
import { formatModuleName, plural } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";
import { CardSkeleton, InsightFrame } from "../_components/InsightFrame";
import { withScope } from "../_components/useInsightScope";

/** The API's traffic-light signal in the product's one verdict vocabulary. */
const SIGNAL_VERDICT: Record<EarlyWarning["signal"], string> = { red: "no-go", amber: "at-risk", green: "go" };

/** The API's trend enum as a plain phrase. */
const TREND_WORDS: Record<string, string> = { improving: "improving", stable: "holding steady", declining: "declining", critical: "falling fast" };
const trendWords = (t: string) => TREND_WORDS[t] ?? t.replace(/_/g, " ");

const warningColumns: ColumnDef<EarlyWarning>[] = [
  { accessorKey: "module_id", header: "Object", cell: ({ row }) => <DrillLink object={row.original.module_id}>{formatModuleName(row.original.module_id)}</DrillLink> },
  {
    accessorKey: "signal",
    header: "Verdict",
    cell: ({ row }) => <Status kind="verdict" value={SIGNAL_VERDICT[row.original.signal]} />,
  },
  { accessorKey: "message", header: "Message" },
  { accessorKey: "recommended_action", header: "Recommended action" },
];

/** Why there is no forecast yet, from the API's `reason`, `runs_seen` and `days_seen`. */
export function forecastEmptyDetail(d: Pick<PredictiveResponse, "reason" | "runs_seen" | "days_seen"> | undefined): string {
  const runs = d?.runs_seen;
  const days = d?.days_seen;
  if (d?.reason === "needs_three_days" || (typeof days === "number" && days < 3)) {
    const cover = typeof days === "number" ? `; ${typeof runs === "number" ? `these ${plural(runs, "run")} cover` : "the runs cover"} ${plural(days, "day")}` : "";
    return `A forecast needs runs on three different days${cover}.`;
  }
  if (typeof runs === "number" && runs === 0) return "A forecast needs finished runs, and none exists yet.";
  return "A forecast needs runs on three different days.";
}

/**
 * The forecast reads every object's score history across all runs (`GET /analytics/predictive`), not one run, so
 * the header names what it saw ("Every object, 6 runs on 1 day") rather than a run.
 */
export default function ForecastPage() {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: queryKeys.analyticsPredictive(),
    queryFn: () => getPredictiveAnalytics(),
  });
  const forecasts = useMemo(() => data?.forecasts ?? [], [data]);
  const warnings = data?.early_warnings ?? [];

  const [moduleId, setModuleId] = useState("");
  const selected: DqsForecast | undefined = useMemo(
    () => forecasts.find((f) => f.module_id === moduleId) ?? forecasts[0],
    [forecasts, moduleId],
  );

  const points = useMemo(
    () =>
      selected
        ? [
            { x: "Now", y: selected.current_score },
            { x: "7 days", y: selected.forecast_7d },
            { x: "30 days", y: selected.forecast_30d },
            { x: "90 days", y: selected.forecast_90d },
          ]
        : [],
    [selected],
  );

  // One line per module in data order, so a hue always means the same module; the ten series hues cap it.
  const series = useMemo(
    () => (selected && forecasts.indexOf(selected) >= 10 ? [selected] : forecasts.slice(0, 10)).map((f) => ({
      name: formatModuleName(f.module_id),
      data: [
        { x: "Now", y: f.current_score },
        { x: "7 days", y: f.forecast_7d },
        { x: "30 days", y: f.forecast_30d },
        { x: "90 days", y: f.forecast_90d },
      ],
    })),
    [forecasts, selected],
  );
  const hidden = Math.max(0, forecasts.length - 10);

  const state = isLoading ? "loading" : isListFailure({ isError: !!error, error }) ? "error" : forecasts.length === 0 ? "empty" : undefined;

  const declining = forecasts.filter((f) => f.trend === "declining" || f.trend === "critical");
  const worst = [...forecasts].sort((x, y) => x.forecast_30d - y.forecast_30d)[0];
  const seen = data && typeof data.runs_seen === "number" ? `${plural(data.runs_seen, "run")} on ${plural(data.days_seen ?? 0, "day")}` : undefined;

  return (
    <InsightFrame
      title="Forecast"
      meta={seen ? `Every object, ${seen}` : undefined}
      insight={{
        situation: {
          sentence: worst ? `${formatModuleName(worst.module_id)} is predicted at ${worst.forecast_30d} in 30 days` : "Not enough runs to forecast",
          tone: declining.length ? "at-risk" : "go",
        },
        changed: { sentence: `${plural(declining.length, "object is", "objects are")} declining` },
        why: { sentence: warnings.length ? `${plural(warnings.length, "early warning is", "early warnings are")} open` : "No early warning is open" },
        next: { sentence: worst ? `Review rules for ${formatModuleName(worst.module_id)}` : "Run another analysis", action: { label: worst ? "Open failing rules" : "Open runs", href: worst ? withScope("/insights/rules", { module: worst.module_id }) : "/runs" } },
      }}
      state={state}
      skeleton={
        <>
          <CardSkeleton height={320} />
          <CardSkeleton height={160} />
        </>
      }
      emptyProps={{
        title: "Not enough runs to forecast",
        detail: forecastEmptyDetail(data),
        ghost: "chart",
        action: <Button render={<Link href="/runs">Open runs</Link>} />,
      }}
      errorProps={{ message: apiErrorMessage(error), onRetry: () => void refetch() }}
    >
      <Card title="Predicted DQS">
        <div className="flex flex-col gap-3">
          {forecasts.length > 0 && (
            <Select
              label="Object"
              value={selected?.module_id ?? ""}
              onValueChange={setModuleId}
              options={forecasts.map((f) => ({ value: f.module_id, label: formatModuleName(f.module_id) }))}
            />
          )}
          {points.length > 0 ? <Line data={points} series={series} /> : <EmptyState title="No forecast for this module" action={<Button render={<Link href="/runs">Open runs</Link>} />} />}
          {hidden > 0 && (
            <p className="m-text-meta m-ink-3">{`${hidden} more objects, shown one at a time when selected above`}</p>
          )}
          {selected && (
            <p className="m-text-body m-ink-2">
              {`${formatModuleName(selected.module_id)} is ${trendWords(selected.trend)}, ${selected.confidence}% confidence over ${plural(selected.points, "run")} across ${plural(selected.span_days, "day")}`}
            </p>
          )}
        </div>
      </Card>
      <Card title="Early warnings">
        {warnings.length === 0 ? (
          <EmptyState title="No early warnings" detail="Every object is holding its score." action={<Button render={<Link href="/objects">Open objects</Link>} />} />
        ) : (
        <DataTable columns={warningColumns} data={warnings} getRowId={(w) => `${w.module_id}-${w.signal}-${w.message}`} hideToolbar dense height="auto" />
        )}
      </Card>
    </InsightFrame>
  );
}
