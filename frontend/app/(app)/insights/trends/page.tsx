"use client";

/** Insights > Trends: how the composite and each dimension moved across runs. */

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Card, DataTable, Heatmap, Line, PageHeader, ReportPage, Select, type ChartPoint, type HeatmapCell } from "@/design";
import { getSystems } from "@/lib/api/connectivity";
import { useSystemScope } from "@/lib/permissions";
import { getRuleRanking, getTrends, type RuleRow, type TrendRun } from "@/lib/api/insights";
import { apiErrorMessage, isListFailure } from "@/lib/error";
import { formatDate, labelOf } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";
import { ruleColumns } from "../_components/RuleColumns";
import { useFindingOpener } from "../_components/FindingOpener";
import { useInsightScope } from "../_components/useInsightScope";
import { InsightTabs } from "../_components/InsightViews";

const WINDOWS = [{ value: "6", label: "Last 6 runs" }, { value: "12", label: "Last 12 runs" }, { value: "24", label: "Last 24 runs" }];
const DIMENSIONS = ["completeness", "validity", "uniqueness", "consistency", "timeliness", "accuracy"];

const xOf = (r: TrendRun) => r.label || (r.run_at ? formatDate(r.run_at) : r.version_id.slice(0, 8));

export default function TrendsPage() {
  const { run, runs, versions, resolving } = useInsightScope();
  const finding = useFindingOpener(run);
  const [win, setWin] = useState("12");
  const systemScope = useSystemScope();
  const systems = useQuery({ queryKey: queryKeys.systems(), queryFn: getSystems, meta: { ignoreError: true }, select: systemScope });
  const [systemChoice, setSystem] = useState("all");
  const systemId = systemChoice === "all" ? undefined : systemChoice;
  const q = useQuery({ queryKey: queryKeys.insights("trends", run, win, systemId ?? "all"), queryFn: () => getTrends({ version_id: run, system_id: systemId, limit: Number(win) }), enabled: !!run });
  const moved = useQuery({ queryKey: queryKeys.insights("rules", run, undefined, "moved"), queryFn: () => getRuleRanking({ version_id: run, limit: 200 }), enabled: !!run });

  const trend = useMemo(() => q.data?.runs ?? [], [q.data]);
  const names = trend.map(xOf);
  const composite = useMemo<ChartPoint[]>(() => trend.flatMap((r) => (r.composite === null ? [] : [{ x: xOf(r), y: r.composite }])), [trend]);
  const annotations = (q.data?.annotations ?? []).flatMap((a) => {
    const r = trend.find((t) => t.version_id === a.version_id);
    return r ? [{ x: xOf(r), label: a.label, kind: a.kind }] : [];
  });
  const dimLine = (d: string): ChartPoint[] => trend.flatMap((r) => (typeof r.dimensions[d] === "number" ? [{ x: xOf(r), y: r.dimensions[d] }] : []));
  const deltas: HeatmapCell[] = [];
  for (const d of DIMENSIONS) {
    for (let i = 1; i < trend.length; i++) {
      const a = trend[i - 1].dimensions[d];
      const b = trend[i].dimensions[d];
      if (typeof a === "number" && typeof b === "number") deltas.push({ row: labelOf(d), col: names[i], value: Math.round((b - a) * 10) / 10 });
    }
  }
  const movedRows = (moved.data?.rows ?? []).filter((r) => r.delta_affected).sort((a, b) => Math.abs(b.delta_affected ?? 0) - Math.abs(a.delta_affected ?? 0)).slice(0, 15);
  const movedCols = useMemo<ColumnDef<RuleRow>[]>(() => ruleColumns(run, true), [run]);

  const last = composite[composite.length - 1];
  const first = composite[0];
  const narrative = last && first && composite.length > 1
    ? `Composite score ${last.y >= first.y ? "rose" : "fell"} from ${Math.round(first.y * 10) / 10} to ${Math.round(last.y * 10) / 10} over ${composite.length} runs.`
    : "A trend needs at least two scored runs.";

  return (
    <ReportPage
      header={
        <PageHeader
          title="Trends"
          meta={`${runs.length} completed runs`}
          tabs={<InsightTabs />}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              {(systems.data?.length ?? 0) > 1 ? (
                <Select label="System" value={systemChoice} onValueChange={setSystem} options={[{ value: "all", label: "All systems" }, ...(systems.data ?? []).map((s) => ({ value: s.id, label: s.name }))]} />
              ) : null}
              <Select label="Window" value={win} onValueChange={setWin} options={WINDOWS} />
            </div>
          }
        />
      }
      narrative={narrative}
      state={resolving || q.isLoading || versions.isLoading ? "loading" : isListFailure(q) ? "error" : !run || trend.length === 0 ? "empty" : undefined}
      emptyProps={{ title: "No runs to compare yet", detail: "Trends appear after the second finished run." }}
      errorProps={{ message: apiErrorMessage(q.error), onRetry: () => void q.refetch() }}
      charts={
        <div className="grid gap-4 @5xl:grid-cols-12">
          <div className="@5xl:col-span-12">
            <Card title="Composite score">
              <Line data={composite} label="Composite score per run" annotations={annotations} />
            </Card>
          </div>
          {DIMENSIONS.map((d) => (
            <div key={d} className="@5xl:col-span-4">
              <Card title={labelOf(d)}><Line data={dimLine(d)} label={`${labelOf(d)} score per run`} height={140} /></Card>
            </div>
          ))}
          <div className="@5xl:col-span-12">
            <Card title="Change per run">
              <div role="region" aria-label="Dimension score change between runs" tabIndex={0} className="overflow-x-auto">
                <Heatmap rows={DIMENSIONS.map(labelOf)} cols={names.slice(1)} cells={deltas} mode="div" range={[-10, 10]} />
              </div>
            </Card>
          </div>
        </div>
      }
      tables={
        <Card title="Rules that moved most">
          <DataTable columns={movedCols} data={movedRows} getRowId={(r) => `${r.module}:${r.check_id}`} onRowClick={(r) => void finding.open(r)} hideToolbar dense height="auto" />
          {finding.drawer}
        </Card>
      }
    />
  );
}
