"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";
import { Button, Card, DataTable, EmptyState, Line, Select, Status, statusLabel, type LineSeries } from "@/design";
import { getPredictiveAnalytics, type DqsForecast, type EarlyWarning, type PredictiveResponse } from "@/lib/api/analytics";
import { apiErrorMessage, isListFailure } from "@/lib/error";
import { formatModuleName, plural } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";
import { CardSkeleton, InsightFrame } from "../_components/InsightFrame";
import { useInsightScope, withScope } from "../_components/useInsightScope";
import { PAGE_PURPOSE } from "../_components/InsightViews";

/** The API's traffic-light signal in the product's one verdict vocabulary. */
const SIGNAL_VERDICT: Record<EarlyWarning["signal"], string> = { red: "no-go", amber: "at-risk", green: "go" };

/** The API's trend enum as a plain phrase. */
const TREND_WORDS: Record<string, string> = { improving: "heading up", stable: "holding steady", declining: "heading down", critical: "falling fast" };
const trendWords = (t: string) => TREND_WORDS[t] ?? t.replace(/_/g, " ");

const warningColumns: ColumnDef<EarlyWarning>[] = [
  { accessorKey: "module_id", header: "Object", cell: ({ row }) => formatModuleName(row.original.module_id) },
  {
    accessorKey: "signal",
    header: "Verdict",
    cell: ({ row }) => <Status kind="verdict" value={SIGNAL_VERDICT[row.original.signal]} />,
  },
  { accessorKey: "message", header: "Message" },
  { accessorKey: "recommended_action", header: "Recommended action" },
  {
    id: "open", header: "", enableSorting: false, size: 90,
    cell: ({ row }) => <Link href={`/objects/${row.original.module_id}`} aria-label={`Open ${formatModuleName(row.original.module_id)}`} className="m-ink-accent underline-offset-2 hover:underline">Open</Link>,
  },
];

/** The verdict of a forecast: its early warning's signal when one is open, else what its trend says. */
const forecastVerdict = (f: DqsForecast, warnings: EarlyWarning[]): string => {
  const w = warnings.find((x) => x.module_id === f.module_id);
  return w ? SIGNAL_VERDICT[w.signal] : f.trend === "critical" ? "no-go" : f.trend === "declining" ? "at-risk" : "go";
};

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

/** The projected horizons in days, each with the history span the API needs before it projects that far. */
export const HORIZONS = [
  { days: 7, minSpan: 0 },
  { days: 30, minSpan: 10 },
  { days: 90, minSpan: 30 },
] as const;
type Horizon = (typeof HORIZONS)[number]["days"];

/** One projected horizon of a forecast: the point and its 95% range, or null when the API left it out. */
export function horizonOf(f: DqsForecast, days: Horizon): { days: Horizon; value: number; low: number; high: number } | null {
  const value = f[`forecast_${days}d`];
  if (value == null) return null;
  return { days, value, low: f[`forecast_${days}d_low`] ?? value, high: f[`forecast_${days}d_high`] ?? value };
}

/** The furthest horizon the API projected (30 days at most: 90 days is too far to rank objects on). */
export function headlineHorizon(f: DqsForecast) {
  return horizonOf(f, 30) ?? horizonOf(f, 7);
}

/** A point on the days axis as words: "Today", "4 days ago", "In 30 days". */
export function dayLabel(day: number): string {
  const n = Math.round(Math.abs(day));
  if (n === 0) return "Today";
  return day < 0 ? `${plural(n, "day")} ago` : `In ${plural(n, "day")}`;
}

/**
 * One object's line on a days axis: its daily scores before today (negative days), today's score at 0 and each
 * projected horizon at its day count, so the slope reads true. With `band`, the 95% range fans out from today.
 */
export function forecastSeries(f: DqsForecast, band: boolean): LineSeries {
  const past = (f.history ?? []).filter((h) => h.day < 0).map((h) => {
    const x = Math.round(h.day * 10) / 10;
    return { x, y: h.score, label: dayLabel(x) };
  });
  const ahead = HORIZONS.map((h) => horizonOf(f, h.days)).filter((h) => h !== null);
  return {
    name: formatModuleName(f.module_id),
    data: [...past, { x: 0, y: f.current_score, label: dayLabel(0) }, ...ahead.map((h) => ({ x: h.days, y: h.value, label: dayLabel(h.days) }))],
    band: band && ahead.length ? [{ x: 0, low: f.current_score, high: f.current_score }, ...ahead.map((h) => ({ x: h.days, low: h.low, high: h.high }))] : undefined,
  };
}

/** Axis ticks: the earliest day any shown line starts on, today, and every horizon a shown line reaches. */
export function forecastTicks(lines: readonly LineSeries[]): { x: number; label: string }[] {
  const xs = lines.flatMap((sr) => sr.data.map((p) => Number(p.x)));
  if (xs.length === 0) return [];
  const first = Math.min(0, ...xs);
  const ticks = new Set<number>([first, 0, ...HORIZONS.map((h) => h.days).filter((d) => xs.includes(d))]);
  return [...ticks].sort((a, b) => a - b).map((x) => ({ x, label: dayLabel(x) }));
}

/** The sentence under the chart: each horizon with its range, why a horizon is missing, and what the fit saw. */
export function forecastDetail(f: DqsForecast): string {
  const shown = HORIZONS.map((h) => horizonOf(f, h.days)).filter((h) => h !== null);
  const parts = shown.map((h) => `in ${h.days} days ${h.value} (range ${Math.round(h.low)}–${Math.round(h.high)})`);
  const missing = HORIZONS.find((h) => horizonOf(f, h.days) === null);
  const why = missing ? ` No ${missing.days}-day point: the runs span ${plural(f.span_days, "day")}, and ${missing.days} days needs ${missing.minSpan}.` : "";
  return `${formatModuleName(f.module_id)}: ${trendWords(f.trend)}, ${parts.join("; ")}.${why} From ${plural(f.points, "run")} across ${plural(f.span_days, "day")}.`;
}

/**
 * The forecast reads every object's score history across all runs (`GET /analytics/predictive`), not one run, so
 * the header names what it saw ("Every object, 6 runs on 1 day") rather than a run.
 */
export default function ForecastPage() {
  const { run } = useInsightScope();
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

  // One line per module in data order, so a hue always means the same module; the ten series hues cap it. The
  // selected object is isolated and carries the range band; the others stay behind it, dimmed.
  const series = useMemo(
    () => (selected && forecasts.indexOf(selected) >= 10 ? [selected] : forecasts.slice(0, 10)).map((f) => forecastSeries(f, f === selected)),
    [forecasts, selected],
  );
  const ticks = useMemo(() => forecastTicks(series), [series]);
  const hidden = Math.max(0, forecasts.length - 10);

  const state = isLoading ? "loading" : isListFailure({ isError: !!error, error }) ? "error" : forecasts.length === 0 ? "empty" : undefined;

  const declining = forecasts.filter((f) => f.trend === "declining" || f.trend === "critical");
  const worst = [...forecasts].sort((x, y) => (headlineHorizon(x)?.value ?? x.current_score) - (headlineHorizon(y)?.value ?? y.current_score))[0];
  const worstAt = worst ? headlineHorizon(worst) : null;
  const seen = data && typeof data.runs_seen === "number" ? `${plural(data.runs_seen, "run")} on ${plural(data.days_seen ?? 0, "day")}` : undefined;

  return (
    <InsightFrame
      title="Forecast"
      purpose={PAGE_PURPOSE["/insights/forecast"]}
      meta={seen ? `Every object, from ${seen}` : undefined}
      run={run}
      insight={{
        situation: {
          sentence: worst && worstAt
            ? `${formatModuleName(worst.module_id)} is predicted at ${worstAt.value} in ${worstAt.days} days (range ${Math.round(worstAt.low)}–${Math.round(worstAt.high)}): ${statusLabel("verdict", forecastVerdict(worst, warnings))}`
            : "Not enough runs to forecast",
          tone: declining.length ? "at-risk" : "go",
        },
        changed: { sentence: `${plural(declining.length, "object is", "objects are")} heading down` },
        why: { sentence: warnings.length ? `${plural(warnings.length, "early warning is", "early warnings are")} open` : "No early warning is open" },
        next: { sentence: worst ? `Review the failing rules of ${formatModuleName(worst.module_id)}` : "Run another analysis", action: { label: worst ? "Open failing rules" : "Open runs", href: worst ? withScope("/insights/rules", { module: worst.module_id }) : "/runs" } },
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
      <Card title="Predicted score" meta="Daily scores so far and the expected score if nothing changes; the shaded band is the range it is likely to fall in">
        <div className="flex flex-col gap-3">
          {forecasts.length > 0 && (
            <Select
              label="Object"
              value={selected?.module_id ?? ""}
              onValueChange={setModuleId}
              options={forecasts.map((f) => ({ value: f.module_id, label: formatModuleName(f.module_id) }))}
            />
          )}
          {selected ? (
            <Line
              data={[]}
              series={series}
              numericX
              xDomain={ticks}
              highlight={formatModuleName(selected.module_id)}
              annotations={[{ x: 0, label: "Projected" }]}
              label="Predicted score by day"
            />
          ) : <EmptyState title="No forecast for this object" detail="It needs runs on three different days." action={<Button render={<Link href="/runs">Open runs</Link>} />} />}
          {hidden > 0 && (
            <p className="m-text-meta m-ink-3">{`${plural(hidden, "more object")}, shown one at a time when selected above`}</p>
          )}
          {selected && (
            <p className="m-text-body m-ink-2">
              {forecastDetail(selected)}
            </p>
          )}
        </div>
      </Card>
      <Card title="Early warnings" meta="Objects the forecast flags, with what to do about each">
        {warnings.length === 0 ? (
          <EmptyState title="No early warnings" detail="Every object is holding its score." action={<Button render={<Link href="/objects">Open objects</Link>} />} />
        ) : (
        <DataTable columns={warningColumns} data={warnings} getRowId={(w) => `${w.module_id}-${w.signal}-${w.message}`} hideToolbar height="auto" />
        )}
      </Card>
    </InsightFrame>
  );
}
