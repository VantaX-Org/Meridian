"use client";

/** Insights > Trends: how the composite and each dimension moved across the runs of one lineage. */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";
import { Button, Card, DataTable, EmptyState, Heatmap, Line, Select, type ChartPoint, type HeatmapCell } from "@/design";
import { getSystems } from "@/lib/api/connectivity";
import { useSystemScope } from "@/lib/permissions";
import { getRuleRanking, getTrends, type RuleRow } from "@/lib/api/insights";
import { apiErrorMessage, isListFailure } from "@/lib/error";
import { labelOf, plural, trendSentence } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";
import { runPageHref } from "@/lib/runs";
import { ruleColumns } from "../_components/RuleColumns";
import { useFindingOpener } from "../_components/FindingOpener";
import { useInsightScope, withScope } from "../_components/useInsightScope";
import { CardSkeleton, InsightFrame } from "../_components/InsightFrame";
import { scopeTrendRuns, trendDomain, trendPoints } from "../_components/trendLineage";

const WINDOWS = [{ value: "6", label: "Last 6 runs" }, { value: "12", label: "Last 12 runs" }, { value: "24", label: "Last 24 runs" }];
const DIMENSIONS = ["completeness", "validity", "uniqueness", "consistency", "timeliness", "accuracy"];

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
  const router = useRouter();
  // A dot opens its own run, with ?run= naming that run so the page and the shell agree.
  const openRun = (p: ChartPoint) => { if (p.runId) router.push(runPageHref(p.runId)); };

  const current = runs.find((r) => r.id === run);
  const trend = useMemo(() => scopeTrendRuns(q.data?.runs ?? [], current, run), [q.data, current, run]);
  const domain = useMemo(() => trendDomain(trend), [trend]);
  const labelByRun = new Map(domain.map((d) => [d.x, d.label ?? d.x]));
  const composite = useMemo(() => trendPoints(trend, (r) => r.composite), [trend]);
  const annotations = (q.data?.annotations ?? []).flatMap((a) => (labelByRun.has(a.version_id) ? [{ x: a.version_id, label: a.label, kind: a.kind }] : []));
  const dimLine = (d: string) => trendPoints(trend, (r) => r.dimensions[d]);
  const deltas: HeatmapCell[] = [];
  for (const d of DIMENSIONS) {
    for (let i = 1; i < trend.length; i++) {
      const a = trend[i - 1].dimensions[d];
      const b = trend[i].dimensions[d];
      if (typeof a === "number" && typeof b === "number") deltas.push({ row: labelOf(d), col: labelByRun.get(trend[i].version_id) ?? trend[i].version_id, value: Math.round((b - a) * 10) / 10 });
    }
  }
  const movedRows = (moved.data?.rows ?? []).filter((r) => r.delta_affected).sort((a, b) => Math.abs(b.delta_affected ?? 0) - Math.abs(a.delta_affected ?? 0)).slice(0, 15);
  const movedCols = useMemo<ColumnDef<RuleRow>[]>(() => ruleColumns(run, true), [run]);

  const last = composite[composite.length - 1];
  const first = composite[0];
  const narrative = last && first && composite.length > 1 ? trendSentence(first.y, last.y, composite.length) : "A trend needs at least two scored runs.";
  const change = last && first && composite.length > 1 ? Math.round((last.y - first.y) * 10) / 10 : null;
  const biggestMove = movedRows[0];
  const state = resolving || q.isLoading || versions.isLoading ? "loading" : isListFailure(q) ? "error" : !run || trend.length === 0 ? "empty" : undefined;

  return (
    <InsightFrame
      title="Trends"
      scope
      meta={run ? `${plural(trend.length, "run")} in this lineage` : `${plural(runs.length, "completed run")}`}
      run={run}
      controls={
        <>
          {(systems.data?.length ?? 0) > 1 ? (
            <Select label="System" value={systemChoice} onValueChange={setSystem} options={[{ value: "all", label: "All systems" }, ...(systems.data ?? []).map((s) => ({ value: s.id, label: s.name }))]} />
          ) : null}
          <Select label="Window" value={win} onValueChange={setWin} options={WINDOWS} />
        </>
      }
      insight={{
        situation: { sentence: narrative, tone: change === null ? "neutral" : change > 0 ? "go" : change < 0 ? "at-risk" : "neutral", href: withScope("/insights/progress", { run }) },
        changed: { sentence: change === null ? "Change appears after the second run." : change === 0 ? "The score has not moved across these runs." : `${change > 0 ? "Up" : "Down"} ${Math.abs(change)} points from the first to the latest run.` },
        why: { sentence: biggestMove ? `${biggestMove.check_id} moved most, ${Math.abs(biggestMove.delta_affected ?? 0).toLocaleString()} records ${(biggestMove.delta_affected ?? 0) > 0 ? "more" : "fewer"} failing.` : "No rule changed its failing records.", href: withScope("/insights/rules", { run }) },
        next: { sentence: "Compare the latest run with its baseline.", action: { label: "Open progress", href: withScope("/insights/progress", { run }) } },
      }}
      state={state}
      skeleton={<><CardSkeleton height={240} /><CardSkeleton height={140} /></>}
      emptyProps={{ title: "No runs to compare yet", detail: "Trends appear after the second finished run of the same system or upload.", ghost: "chart", action: <Button variant="secondary" render={<Link href="/runs">Open runs</Link>} /> }}
      errorProps={{ message: apiErrorMessage(q.error), onRetry: () => void q.refetch() }}
    >
      <div className="grid gap-4 @5xl:grid-cols-12">
        <div className="@5xl:col-span-12">
          <Card title="Composite score" meta={narrative}>
            <Line data={composite} xDomain={domain} label="Composite score per run" annotations={annotations} onPointClick={openRun} />
          </Card>
        </div>
        {DIMENSIONS.map((d) => {
          const points = dimLine(d);
          return (
            <div key={d} className="@5xl:col-span-4">
              <Card title={labelOf(d)}>
                {points.length === 0
                  ? <EmptyState variant="inline" title="Not measured in these runs" />
                  : <Line data={points} xDomain={domain} label={`${labelOf(d)} score per run`} height={140} onPointClick={openRun} />}
              </Card>
            </div>
          );
        })}
        <div className="@5xl:col-span-12">
          <Card title="Change per run" meta="Dimension score change from the run before, in points">
            {deltas.length === 0 ? (
              <EmptyState variant="inline" title="Change appears after the second run" />
            ) : (
              <div role="region" aria-label="Dimension score change between runs" tabIndex={0} className="overflow-x-auto">
                <Heatmap rows={DIMENSIONS.map(labelOf)} cols={trend.slice(1).map((r) => labelByRun.get(r.version_id) ?? r.version_id)} cells={deltas} mode="div" range={[-10, 10]} cellSize={40} />
              </div>
            )}
          </Card>
        </div>
      </div>
      <Card title="Rules that moved most">
        <DataTable columns={movedCols} data={movedRows} getRowId={(r) => `${r.module}:${r.check_id}`} onRowClick={(r) => void finding.open(r)} hideToolbar dense height="auto" />
        {finding.drawer}
      </Card>
    </InsightFrame>
  );
}
