// frontend/app/(app)/insights/forecast/page.tsx
/**
 * Port of the predictive-analytics forecast (previously only shown inline on
 * the legacy command-centre overview) onto
 * @/design, as its own report page.
 *
 * Deviations from the task-25 brief:
 * - The brief's `PredictiveResponse` shape (`{ forecast: DqsForecast; ... }`)
 *   is wrong; the real `lib/api/analytics.ts` returns
 *   `{ forecasts: DqsForecast[]; early_warnings: EarlyWarning[] }` (plural,
 *   one forecast per module) — ported against the real shape.
 * - `getPredictiveAnalytics` takes a bare `moduleId?: string`, not a params
 *   object — called with no args here, same as the legacy overview widget.
 * - There was no standalone legacy `/analytics` page to delete — the dashboard
 *   never had one; the forecast was embedded inline in the command-centre
 *   overview and the workbench progress widget. Only the `/analytics` redirect
 *   destination changes, from `/` to `/insights/forecast`.
 * - `queryKeys` has no `analytics` factory; reused the pre-existing ad-hoc
 *   `["analytics.predictive"]` array the legacy overview already used, per
 *   ponytail rung 2 (reuse, don't wrap).
 * - `ReportPage`'s real props are `{narrative, charts, tables?, onExport?,
 *   state?, emptyProps?, errorProps?}`, not the brief's placeholder
 *   `{title, loading, error}`.
 * - `@/design`'s `Line` chart takes a single-series `ChartPoint[]`
 *   (`{x, y}`); since forecasts are per-module, a `Select` picks the module
 *   whose 4-point trend (now/7d/30d/90d) is charted.
 */
"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";
import { Button, DataTable, EmptyState, Line, Pill, ReportPage, Select, type PillTone } from "@/design";
import { getPredictiveAnalytics, type DqsForecast, type EarlyWarning } from "@/lib/api/analytics";
import { apiErrorMessage, isListFailure } from "@/lib/error";
import { formatModuleName } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";

const SIGNAL_TONE: Record<EarlyWarning["signal"], PillTone> = {
  red: "no-go",
  amber: "at-risk",
  green: "go",
};

const warningColumns: ColumnDef<EarlyWarning>[] = [
  { accessorKey: "module_id", header: "Module", cell: ({ row }) => formatModuleName(row.original.module_id) },
  {
    accessorKey: "signal",
    header: "Signal",
    cell: ({ row }) => <Pill tone={SIGNAL_TONE[row.original.signal]}>{row.original.signal}</Pill>,
  },
  { accessorKey: "message", header: "Message" },
  { accessorKey: "recommended_action", header: "Recommended action" },
];

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

  const state = isLoading ? "loading" : isListFailure({ isError: !!error, error }) ? "error" : forecasts.length === 0 ? "empty" : undefined;

  return (
    <div className="flex flex-col gap-6 p-6">
      <div>
        <h2 className="text-[20px] font-medium" style={{ color: "var(--m-ink)" }}>DQS forecast</h2>
        <p className="text-[13px]" style={{ color: "var(--m-ink-muted)" }}>
          Projected data quality score by module, and the early warnings behind it.
        </p>
      </div>
      <ReportPage
        state={state}
        errorProps={{
          message: apiErrorMessage(error),
          onRetry: () => refetch(),
        }}
        emptyProps={{
          title: "Not enough runs to forecast.",
          action: <Button render={<Link href="/runs">Open runs</Link>} />,
        }}
        narrative={
          selected
            ? `${formatModuleName(selected.module_id)}: ${selected.trend} trend, ${selected.confidence}% confidence over ${selected.points} runs across ${selected.span_days} days.`
            : "Select a module to see its forecast."
        }
        charts={
          <div className="flex flex-col gap-3">
            {forecasts.length > 0 && (
              <Select
                value={selected?.module_id ?? ""}
                onValueChange={setModuleId}
                options={forecasts.map((f) => ({ value: f.module_id, label: formatModuleName(f.module_id) }))}
              />
            )}
            {points.length > 0 ? <Line data={points} /> : <EmptyState title="No forecast for this module" />}
          </div>
        }
        tables={
          <DataTable
            columns={warningColumns}
            data={warnings}
            getRowId={(w) => `${w.module_id}-${w.signal}-${w.message}`}
          />
        }
      />
    </div>
  );
}
