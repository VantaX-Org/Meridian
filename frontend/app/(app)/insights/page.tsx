// frontend/app/(app)/insights/page.tsx
"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { Button, DataTable, Delta, DimensionBars, Heatmap, Line, Pill, Skeleton, statusLabel, toneOfTier, type ChartPoint, type ExportOption, type HeatmapCell, Score } from "@/design";
import { downloadAuthenticated } from "@/lib/api/download";
import {
  getCleansing, getHeatmap, getOverview, getRootCauses, getRuleRanking, getTrends, l1Label, type RuleRow,
} from "@/lib/api/insights";
import { getS4Readiness } from "@/lib/api/migration";
import { getBoardReportUrl, getWorkbookUrl } from "@/lib/api/reports";
import { getFindingsAggregate } from "@/lib/api/findings";
import { criticalHighHref } from "@/lib/current-state";
import { previousInLineage } from "@/lib/runs";
import { apiErrorMessage, isListFailure } from "@/lib/error";
import { deltaSentence, formatModuleName, labelOf, plural, shortCapReason, trendSentence } from "@/lib/format";
import { fixHref } from "@/lib/drill";
import { reportFilename } from "@/lib/report-filename";
import { runName } from "@/lib/run-scope";
import { queryKeys } from "@/lib/query-keys";
import { useDayOne, DayOneAction } from "@/hooks/use-day-one";
import { InsightFrame, formatMoneyCompact } from "./_components/InsightFrame";
import { PAGE_PURPOSE } from "./_components/InsightViews";
import { scopeTrendRuns, trendPoints } from "./_components/trendLineage";
import { Section } from "./_components/Section";
import { InsightActions } from "./_components/InsightActions";
import { useFindingOpener } from "./_components/FindingOpener";
import { ruleColumns } from "./_components/RuleColumns";
import { useInsightScope, withScope } from "./_components/useInsightScope";
import { CurrentOverview } from "./_components/CurrentOverview";
import { CleansingFunnel, RootCauseList, S4Chart, s4Totals } from "./_components/RunAnalyses";


const dimLabel = (d: string) => (d === "composite" ? "Composite" : labelOf(d));

/**
 * Without `?run=` or `?module=` the overview is the current state across objects (`CurrentOverview`); a `?run=`
 * deep link, the header's run picker or an object filter shows one run, and the header says so.
 */
export default function InsightsOverviewPage() {
  const { mode } = useInsightScope();
  return mode === "current" ? <CurrentOverview /> : <RunOverview />;
}

function RunOverview() {
  const router = useRouter();
  const dayOne = useDayOne();
  const { run, module, runs, versions, resolving, error: listError, refetch: refetchList } = useInsightScope();
  // No run to show because the run list (or the day-one sources) failed: an error, never "No insights yet".
  const loadError = run ? null : listError ?? (dayOne.status === "error" ? dayOne.error : null);
  const finding = useFindingOpener(run);
  const on = !!run;
  const scope = { version_id: run, module };

  const ov = useQuery({ queryKey: queryKeys.insights("overview", run, module), queryFn: () => getOverview(scope), enabled: on });
  const causes = useQuery({ queryKey: queryKeys.insights("root-causes", run, module), queryFn: () => getRootCauses(scope), enabled: on });
  const rules = useQuery({ queryKey: queryKeys.insights("rules", run, module, "top10"), queryFn: () => getRuleRanking({ ...scope, limit: 10 }), enabled: on });
  const trends = useQuery({ queryKey: queryKeys.insights("trends", run, "12"), queryFn: () => getTrends({ version_id: run, limit: 12 }), enabled: on });
  const heat = useQuery({ queryKey: queryKeys.insights("heatmap", run, module), queryFn: () => getHeatmap(scope), enabled: on });
  const cleanse = useQuery({ queryKey: queryKeys.insights("cleansing", run, module), queryFn: () => getCleansing(scope), enabled: on });
  const s4 = useQuery({ queryKey: queryKeys.insights("s4-readiness", run), queryFn: () => getS4Readiness(run ?? ""), enabled: on });
  // The run's failing critical and high rules: the same count the current state shows, from the run's severity totals.
  const agg = useQuery({
    queryKey: module ? [...queryKeys.findingsAggregate(run ?? ""), module] : queryKeys.findingsAggregate(run ?? ""),
    queryFn: () => getFindingsAggregate({ version_id: run, module }),
    enabled: on,
  });
  const criticalHigh = agg.data ? agg.data.severity.critical + agg.data.severity.high : undefined;

  const o = ov.data;
  // The trend follows this run's lineage only (its system, or uploads of the same objects), keyed by run id with
  // the date as the tick, so a user-supplied run label never becomes an axis label.
  const current = runs.find((r) => r.id === run);
  const trendRuns = useMemo(() => scopeTrendRuns(trends.data?.runs ?? [], current, run), [trends.data, current, run]);
  const trendLine = useMemo<ChartPoint[]>(() => trendPoints(trendRuns, (r) => r.composite), [trendRuns]);
  const inTrend = new Set(trendRuns.map((r) => r.version_id));
  const annotations = (trends.data?.annotations ?? []).flatMap((a) => (inTrend.has(a.version_id) ? [{ x: a.version_id, label: a.label, kind: a.kind }] : []));
  const thisRun = trendRuns.find((r) => r.version_id === run) ?? trendRuns[trendRuns.length - 1];
  const trendNote = trendLine.length > 1 ? trendSentence(trendLine[0].y, trendLine[trendLine.length - 1].y, trendLine.length) : undefined;
  const dims = Object.entries(thisRun?.dimensions ?? {}).map(([d, y]) => ({ x: dimLabel(d), y, dimension: d }));

  const areas = s4.data?.areas ?? [];
  const { blocking, warning } = s4Totals(areas);

  const heatRows = [...(heat.data?.rows ?? [])].sort((a, b) => a.group.localeCompare(b.group) || a.module.localeCompare(b.module));
  const heatDims = heat.data?.dimensions ?? [];
  const heatCells: HeatmapCell[] = heatRows.flatMap((r) => heatDims.filter((d) => typeof r.scores[d] === "number").map((d) => ({ row: formatModuleName(r.module), col: dimLabel(d), value: r.scores[d] })));
  const tierOf = (cell: HeatmapCell) => {
    const m = heatRows.find((r) => formatModuleName(r.module) === cell.row);
    const d = heatDims.find((x) => dimLabel(x) === cell.col);
    return m && d ? toneOfTier(m.tier[d]) : undefined;
  };

  // Files are named by the run (and the object, for a workbook filtered to one), never its id.
  const runLabel = current ? runName(current) : undefined;
  // The board pack compares with the run before this one in its lineage; without it every pack says nothing changed.
  const previous = current ? previousInLineage(current, runs) : null;
  const exportOptions: ExportOption[] = run ? [
    { format: "pdf", label: "Board pack (PDF)", run: () => downloadAuthenticated(getBoardReportUrl(run, previous?.id), reportFilename("board", runLabel)) },
    { format: "xlsx", label: "Analyst workbook (Excel)", run: () => downloadAuthenticated(getWorkbookUrl(run, { module }), reportFilename("workbook", [runLabel, module && formatModuleName(module)].filter(Boolean).join(", "))) },
  ] : [];

  const fixColumns: ColumnDef<RuleRow>[] = ruleColumns(run, true);
  // Only the run scope gates the page; each section follows its own query, so a slow or failed overview
  // leaves the hero blank with a retry and the other sections still render.
  const ovFailed = isListFailure(ov);
  const state: "loading" | "empty" | "error" | undefined =
    resolving || dayOne.status === "loading" ? "loading"
    : loadError ? "error"
    : !run || (ov.isSuccess && !o) ? "empty" : undefined;
  const loading = ov.isLoading;
  const fallback = (s: string) => (loading ? "Loading" : s);

  return (
    <InsightFrame
      title="Insights"
      purpose={PAGE_PURPOSE["/insights"]}
      scope
      meta={module ? <Pill tone="info">{formatModuleName(module)}</Pill> : undefined}
      actions={<InsightActions run={run} module={module} options={exportOptions} />}
      insight={{
        hero: true,
        loading,
        lead: (
          <div className="m-hero-lead">
            <Score
                size="hero"
                loading={loading}
                value={o?.dqs.composite}
                versionId={run}
                href={withScope("/insights/trends", { run })}
                hint={o?.dqs.capped ? `Capped: ${o.dqs.cap_reason ? shortCapReason(o.dqs.cap_reason) : "critical failures"}` : undefined}
                delta={o?.dqs.delta != null ? <Delta value={o.dqs.delta} /> : undefined}
              />
            {loading && !o ? (
              <div aria-hidden className="m-hero-verdict">
                <Skeleton hero width="70%" height={28} />
                <Skeleton hero width="50%" height={14} />
              </div>
            ) : (
            <div className="m-hero-verdict" data-testid="hero-verdict">
              <span className="font-semibold m-text-verdict-line m-ink [letter-spacing:var(--m-tracking-title)]">
                {o?.dqs.tier ? statusLabel("verdict", o.dqs.tier) : "Not scored yet"}
              </span>
              <span className="m-text-body m-ink-2">
                {/* A comparison, not the Critical and high tile again: the score against the run before. */}
                {o ? (o.dqs.previous != null ? `Was ${o.dqs.previous.toFixed(1)} in the previous run` : "First scored run") : " "}
              </span>
            </div>
            )}
          </div>
        ),
        stats: [
          // The same headline as the current state: failing critical and high rules, opening exactly those findings.
          { label: "Critical and high findings", value: criticalHigh ?? "—", hint: criticalHigh ? "failing rules" : criticalHigh === 0 ? "none" : undefined, tone: criticalHigh == null ? undefined : criticalHigh ? "no-go" : "go", to: run ? criticalHighHref([{ id: run }], module) : undefined, versionId: run },
          // Blocking findings (critical, or blocking an S/4 load) are their own set, opened on the readiness view.
          { label: "Blocking findings", value: o?.blockers.count ?? "—", to: withScope("/insights/readiness", { run }), hint: o ? (o.blockers.waves ? plural(o.blockers.waves, "wave") : "No wave defined") : undefined, tone: o ? (o.blockers.count ? "no-go" : "go") : undefined, versionId: run },
          { label: "Records with a suggested value", value: o?.auto_fixable.records ?? "—", to: fixHref({ run, module, sugg: true }), hint: o?.auto_fixable.pct != null ? `${Math.round(o.auto_fixable.pct)}% of failing records` : undefined, versionId: run },
          {
            label: o?.value_at_risk.worst_l1 ? `Most at risk: ${l1Label(o.value_at_risk.worst_l1)}` : "Most at risk",
            value: o?.value_at_risk.worst_l1 ? formatMoneyCompact(o.value_at_risk.worst_l1_amount, o.value_at_risk.currency) : "—",
            to: withScope("/insights/impact", { run }),
            hint: o?.value_at_risk.worst_l1 ? plural(o.value_at_risk.features_blocked, "feature blocked", "features blocked") : undefined,
          },
        ],
        situation: { sentence: o ? `${o.dqs.composite != null ? `DQS ${o.dqs.composite.toFixed(1)}` : "Not scored"}${o.dqs.tier ? `, ${statusLabel("verdict", o.dqs.tier)}` : ""}` : fallback("—"), tone: o?.dqs.tier === "no_go" ? "no-go" : o?.dqs.tier === "at_risk" ? "at-risk" : o?.dqs.tier === "go" ? "go" : undefined, href: withScope("/insights/trends", { run }) },
        changed: { sentence: o?.dqs.delta != null ? deltaSentence(o.dqs.delta) : fallback("No earlier run") },
        why: { sentence: o ? plural(o.blockers.count, "blocking finding") : fallback("—"), href: withScope("/insights/readiness", { run }) },
        next: { sentence: "Fix the highest-impact rules first", action: { label: "Open failing rules", href: withScope("/insights/rules", { run, module }) } },
      }}
      state={state}
      emptyProps={{
        title: "No insights yet",
        detail: dayOne.step?.detail ?? "Insights appear after the first analysis.",
        ghost: "table",
        action: <DayOneAction step={dayOne.step} fallbackHref="/runs" fallbackLabel="Open runs" />,
      }}
      errorProps={{ error: loadError, onRetry: () => { refetchList(); dayOne.refetch(); } }}
    >
      <div className="flex flex-col [gap:var(--m-section-gap)]" data-testid="insights-overview">
        {ovFailed && (
          <div role="alert" className="flex items-center gap-3 m-text-body">
            <span>{`The score did not load. ${apiErrorMessage(ov.error)}`}</span>
            <Button variant="secondary" onClick={() => { void ov.refetch(); void versions.refetch(); }}>Retry</Button>
          </div>
        )}

        {/* The ledger: the failing rules ranked by what moves the score, each with its one action. */}
        <Section
          title="Fix first" height={264} query={rules}
          meta="Ranked by impact on the score"
          actions={<Link href={withScope("/insights/rules", { run, module })} className="m-text-body underline-offset-2 hover:underline">See all</Link>}
        >
          <DataTable columns={fixColumns} data={rules.data?.rows ?? []} getRowId={(r) => `${r.module}:${r.check_id}`} onRowClick={(r) => void finding.open(r)} hideToolbar height="auto" />
        </Section>

        <div className="grid gap-4 @5xl:grid-cols-12">
          <div className="@5xl:col-span-8">
            <Section title="Trend" height={180} query={trends} meta={trendNote}>
              {trendLine.length < 2 ? <p className="m-text-body m-ink-3">A trend needs a second scored run of the same system or upload. <Link href="/runs" className="m-ink-accent underline underline-offset-2">Open runs</Link></p> : (
                <Line data={trendLine} label="Score per run" annotations={annotations} height={180} />
              )}
            </Section>
          </div>
          <div className="@5xl:col-span-4">
            <Section title="Dimensions" height={180} query={trends} meta="The six measures behind the score">
              {dims.length === 0 ? <p className="m-text-body m-ink-3">This run has no dimension scores. <Link href={withScope("/insights/rules", { run, module })} className="m-ink-accent underline underline-offset-2">Open failing rules</Link></p>
                // The same bars as Home's hero: six rows read faster than a radar, and each opens its objects.
                : <DimensionBars label="Dimension scores, this run" items={dims.map((d) => ({ key: d.dimension, label: d.x, score: d.y, href: withScope("/objects", { run, dimension: d.dimension }) }))} />}
            </Section>
          </div>

          <div className="@5xl:col-span-4">
            <Section title="Root causes" height={200} query={causes} meta={causes.data ? `${Math.min(5, causes.data.clusters.length)} of ${causes.data.clusters.length}` : undefined}>
              <RootCauseList clusters={causes.data?.clusters ?? []} run={run} empty="No failing fields in this run." />
            </Section>
          </div>
          <div className="@5xl:col-span-4">
            <Section title="S/4 migration" height={200} query={s4} meta={s4.data ? `${blocking.toLocaleString()} blocking, ${warning.toLocaleString()} warning` : undefined}>
              <S4Chart areas={areas} run={run} />
            </Section>
          </div>
          <div className="@5xl:col-span-4">
            <Section title="Cleansing opportunity" height={200} query={cleanse}>
              <CleansingFunnel steps={cleanse.data?.steps ?? []} run={run} />
            </Section>
          </div>

          <div className="@5xl:col-span-12">
            <Section title="Object heatmap" height={240} query={heat} meta="Each object's score per dimension; select a cell to open it">
              {heatRows.length === 0 ? <p className="m-text-body m-ink-3">This run has no object scores yet. <Link href="/runs" className="m-ink-accent underline underline-offset-2">Open runs</Link></p> : (
                <div role="region" aria-label="Object scores by dimension" tabIndex={0} className="overflow-x-auto">
                  <Heatmap
                    rows={heatRows.map((r) => formatModuleName(r.module))}
                    cols={heatDims.map(dimLabel)}
                    cells={heatCells}
                    tone={tierOf}
                    cellSize={32}
                    rowHref={(row) => {
                      const m = heatRows.find((r) => formatModuleName(r.module) === row);
                      return m ? withScope(`/objects/${m.module}`, { run }) : "/objects";
                    }}
                    onPointClick={(cell) => {
                      const m = heatRows.find((r) => formatModuleName(r.module) === cell.row);
                      const d = heatDims.find((x) => dimLabel(x) === cell.col);
                      if (m) router.push(withScope(`/objects/${m.module}`, { run, dimension: d && d !== "composite" ? d : undefined }));
                    }}
                  />
                </div>
              )}
            </Section>
          </div>
        </div>
      </div>
      {finding.drawer}
    </InsightFrame>
  );
}
