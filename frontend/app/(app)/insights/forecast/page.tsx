"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";
import { Button, Card, DataTable, EmptyState, Line, Pill, Select, type PillTone } from "@/design";
import { getPredictiveAnalytics, type DqsForecast, type EarlyWarning } from "@/lib/api/analytics";
import { apiErrorMessage, isListFailure } from "@/lib/error";
import { formatModuleName } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";
import { CardSkeleton, InsightFrame } from "../_components/InsightFrame";

const SIGNAL_TONE: Record<EarlyWarning["signal"], PillTone> = {
  red: "no-go",
  amber: "at-risk",
  green: "go",
};

const SIGNAL_LABEL: Record<EarlyWarning["signal"], string> = { red: "Red", amber: "Amber", green: "Green" };

const warningColumns: ColumnDef<EarlyWarning>[] = [
  { accessorKey: "module_id", header: "Module", cell: ({ row }) => formatModuleName(row.original.module_id) },
  {
    accessorKey: "signal",
    header: "Signal",
    cell: ({ row }) => <Pill tone={SIGNAL_TONE[row.original.signal]}>{SIGNAL_LABEL[row.original.signal]}</Pill>,
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

  const declining = forecasts.filter((f) => f.trend === "declining" || f.trend === "critical");
  const worst = [...forecasts].sort((x, y) => x.forecast_30d - y.forecast_30d)[0];

  return (
    <InsightFrame
      title="Forecast"
      insight={{
        situation: {
          sentence: worst ? `${formatModuleName(worst.module_id)} is predicted at ${worst.forecast_30d}% DQS in 30 days` : "Not enough runs to forecast",
          tone: declining.length ? "at-risk" : "go",
        },
        changed: { sentence: `${declining.length} modules are declining` },
        why: { sentence: warnings.length ? `${warnings.length} early warnings are open` : "—" },
        next: { sentence: worst ? `Review rules for ${formatModuleName(worst.module_id)}` : "Run another analysis", action: { label: "Open runs", href: "/runs" } },
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
        detail: "A forecast needs at least two analyses.",
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
          {points.length > 0 ? <Line data={points} /> : <EmptyState title="No forecast for this module" action={<Button render={<Link href="/runs">Open runs</Link>} />} />}
          {selected && (
            <p className="m-text-body" style={{ color: "var(--m-ink-2)" }}>
              {`${formatModuleName(selected.module_id)}: ${selected.trend} trend, ${selected.confidence}% confidence over ${selected.points} runs across ${selected.span_days} days`}
            </p>
          )}
        </div>
      </Card>
      <Card title="Early warnings">
        {warnings.length === 0 ? (
          <EmptyState title="No early warnings" detail="Every module is holding its score." action={<Button render={<Link href="/objects">Open objects</Link>} />} />
        ) : (
        <DataTable columns={warningColumns} data={warnings} getRowId={(w) => `${w.module_id}-${w.signal}-${w.message}`} hideToolbar dense height="auto" />
        )}
      </Card>
    </InsightFrame>
  );
}
