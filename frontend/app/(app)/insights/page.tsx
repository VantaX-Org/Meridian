// frontend/app/(app)/insights/page.tsx
"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import {
  Bar, Button, Card, DataTable, Delta, Funnel, Heatmap, Line, Pill, Radar, Stat, toneOfTier, type ChartPoint,
  type ExportOption, type HeatmapCell,
} from "@/design";
import { downloadAuthenticated } from "@/lib/api/download";
import {
  getCleansing, getHeatmap, getOverview, getRootCauses, getRuleRanking, getTrends, l1Label, type RuleRow,
} from "@/lib/api/insights";
import { getS4Readiness } from "@/lib/api/migration";
import { getBoardReportUrl, getWorkbookUrl } from "@/lib/api/reports";
import { apiErrorMessage, isListFailure } from "@/lib/error";
import { deltaSentence, formatModuleName, labelOf, plural, shortCapReason, trendSentence } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";
import { useDayOne, DayOneAction } from "@/hooks/use-day-one";
import { InsightFrame, formatMoney } from "./_components/InsightFrame";
import { scopeTrendRuns, trendPoints } from "./_components/trendLineage";
import { Section } from "./_components/Section";
import { InsightActions } from "./_components/InsightActions";
import { useFindingOpener } from "./_components/FindingOpener";
import { ruleColumns } from "./_components/RuleColumns";
import { useInsightScope, withScope } from "./_components/useInsightScope";

const VERDICT_SENTENCE: Record<string, string> = { go: "Ready to load", at_risk: "At risk", no_go: "Not ready" };


const dimLabel = (d: string) => (d === "composite" ? "Composite" : labelOf(d));

export default function InsightsOverviewPage() {
  const router = useRouter();
  const dayOne = useDayOne();
  const { run, module, runs, versions, resolving } = useInsightScope();
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
  const blocking = areas.map((a) => a.blocking_failing).reduce((a, b) => a + b, 0);
  const warning = areas.map((a) => Math.max(0, a.failing - a.blocking_failing)).reduce((a, b) => a + b, 0);

  const heatRows = [...(heat.data?.rows ?? [])].sort((a, b) => a.group.localeCompare(b.group) || a.module.localeCompare(b.module));
  const heatDims = heat.data?.dimensions ?? [];
  const heatCells: HeatmapCell[] = heatRows.flatMap((r) => heatDims.filter((d) => typeof r.scores[d] === "number").map((d) => ({ row: formatModuleName(r.module), col: dimLabel(d), value: r.scores[d] })));
  const tierOf = (cell: HeatmapCell) => {
    const m = heatRows.find((r) => formatModuleName(r.module) === cell.row);
    const d = heatDims.find((x) => dimLabel(x) === cell.col);
    return m && d ? toneOfTier(m.tier[d]) : undefined;
  };

  const exportOptions: ExportOption[] = run ? [
    { format: "pdf", label: "Board pack (PDF)", run: () => downloadAuthenticated(getBoardReportUrl(run), `board_${run}.pdf`) },
    { format: "xlsx", label: "Analyst workbook (Excel)", run: () => downloadAuthenticated(getWorkbookUrl(run, { module }), `workbook_${run}.xlsx`) },
  ] : [];

  const fixHref = (extra: Record<string, string>) => withScope("/fix", { run, ...extra });

  const fixColumns: ColumnDef<RuleRow>[] = ruleColumns(run, true);
  const state: "loading" | "empty" | "error" | undefined =
    resolving || ov.isLoading || dayOne.status === "loading" ? "loading"
    : isListFailure(ov) ? "error"
    : !run || !o ? "empty" : undefined;
  const loading = ov.isLoading;
  const fallback = (s: string) => (loading ? "Loading" : s);
  const nl = o?.narrative ?? [];

  return (
    <InsightFrame
      title="Insights"
      scope
      meta={module ? <Pill tone="info">{formatModuleName(module)}</Pill> : "Scope: all objects"}
      actions={<InsightActions run={run} module={module} options={exportOptions} />}
      insight={{
        hero: true,
        loading,
        lead: (
          <div className="flex flex-wrap items-end gap-x-8 gap-y-4">
            <div style={{ minWidth: 260, width: "max-content", maxWidth: 360 }}>
              <Stat
                hero
                label="Data quality score"
                help="dqs"
                loading={loading}
                value={o?.dqs.composite ?? "—"}
                bar={o?.dqs.composite ?? undefined}
                decimals={1}
                versionId={run}
                href={withScope("/insights/trends", { run })}
                tone={o?.dqs.tier === "go" ? "go" : o?.dqs.tier === "at_risk" ? "at-risk" : o?.dqs.tier === "no_go" ? "no-go" : undefined}
                hint={o?.dqs.capped ? `Capped: ${o.dqs.cap_reason ? shortCapReason(o.dqs.cap_reason) : "critical failures"}` : undefined}
                delta={o?.dqs.delta != null ? <Delta value={o.dqs.delta} /> : undefined}
              />
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-1" style={{ minWidth: "min(100%, 16rem)", maxWidth: "48ch" }}>
              <span className="font-semibold" style={{ fontSize: "var(--m-text-verdict)", lineHeight: "var(--m-leading-verdict)", color: "var(--m-hero-ink)", letterSpacing: "var(--m-tracking-title)" }}>
                {o?.dqs.tier ? VERDICT_SENTENCE[o.dqs.tier] ?? labelOf(o.dqs.tier) : loading ? "Scoring" : "Not scored yet"}
              </span>
              <span className="m-text-body" style={{ color: "var(--m-hero-ink-2)" }}>
                {o ? `${plural(o.blockers.count, "blocking gap")}${o.blockers.waves ? ` across ${plural(o.blockers.waves, "wave")}` : ""}` : " "}
              </span>
            </div>
          </div>
        ),
        stats: [
          { label: "Blocking gaps", value: o?.blockers.count ?? "—", to: withScope("/insights/readiness", { run }), hint: o ? (o.blockers.waves ? plural(o.blockers.waves, "wave") : "No wave defined") : undefined, tone: o ? (o.blockers.count ? "no-go" : "go") : undefined, versionId: run },
          { label: "Auto-fixable records", value: o?.auto_fixable.records ?? "—", to: fixHref({ source: "rule", confidence: "high" }), hint: o?.auto_fixable.pct != null ? `${Math.round(o.auto_fixable.pct)}% of failing records` : undefined, versionId: run },
          {
            label: "Value at risk, worst L1",
            value: o?.value_at_risk.worst_l1 ? formatMoney(o.value_at_risk.worst_l1_amount, o.value_at_risk.currency) : "—",
            to: withScope("/insights/impact", { run }),
            hint: o?.value_at_risk.worst_l1 ? `${l1Label(o.value_at_risk.worst_l1)}, ${o.value_at_risk.features_blocked} features blocked` : undefined,
          },
        ],
        situation: { sentence: o ? `DQS ${o.dqs.composite ?? "not scored"}${o.dqs.tier ? `, ${labelOf(o.dqs.tier).toLowerCase()}` : ""}` : fallback("—"), tone: o?.dqs.tier === "no_go" ? "no-go" : o?.dqs.tier === "at_risk" ? "at-risk" : o?.dqs.tier === "go" ? "go" : undefined, href: withScope("/insights/trends", { run }) },
        changed: { sentence: o?.dqs.delta != null ? deltaSentence(o.dqs.delta) : fallback("No earlier run") },
        why: { sentence: o ? plural(o.blockers.count, "blocking gap") : fallback("—"), href: withScope("/insights/readiness", { run }) },
        next: { sentence: "Fix the highest-impact rules first", action: { label: "Open failing rules", href: withScope("/insights/rules", { run, module }) } },
      }}
      state={state}
      emptyProps={{
        title: "No insights yet",
        detail: dayOne.step?.detail ?? "Insights appear after the first analysis.",
        ghost: "table",
        action: <DayOneAction step={dayOne.step} fallbackHref="/runs" fallbackLabel="Open runs" />,
      }}
      errorProps={{ message: apiErrorMessage(ov.error), onRetry: () => { void ov.refetch(); void versions.refetch(); } }}
    >
      <div className="grid gap-4 @5xl:grid-cols-12" data-testid="insights-overview">
        {nl.length > 0 && (
          <div className="@5xl:col-span-12">
            <Card title="Summary">
              <ul className="flex flex-col gap-1">
                {nl.map((l) => (
                  <li key={l.text} className="m-text-body">
                    {l.href ? <Link href={withScope(l.href, { run, module })} className="underline-offset-2 hover:underline">{l.text}</Link> : l.text}
                  </li>
                ))}
              </ul>
            </Card>
          </div>
        )}

        <div className="@5xl:col-span-6">
          <Section title="Root causes" height={264} query={causes} meta={causes.data ? `${Math.min(5, causes.data.clusters.length)} of ${causes.data.clusters.length}` : undefined}>
            {(causes.data?.clusters.length ?? 0) === 0 ? (
              <p className="m-text-body" style={{ color: "var(--m-ink-3)" }}>No failing fields in this run.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {[...(causes.data?.clusters ?? [])].sort((a, b) => b.impact - a.impact).slice(0, 5).map((c) => {
                  const where = c.table && c.field ? `${c.table}.${c.field}` : null;
                  return (
                    <li key={c.key} className="m-card-sm flex flex-col gap-1" style={{ background: "var(--m-surface)", borderRadius: "var(--m-radius-sheet)", padding: "var(--m-space-3)" }}>
                      <span className="font-medium">
                        {where ? `${where} fails on ${c.records.toLocaleString()}${c.records_estimated ? " (estimated)" : ""} records` : `${formatModuleName(c.module)}: ${c.records.toLocaleString()} records without a known field`}
                      </span>
                      <span className="m-text-meta" style={{ color: "var(--m-ink-3)" }}>
                        {`${c.rules.length} ${c.rules.length === 1 ? "rule" : "rules"}, ${labelOf(c.dimension).toLowerCase()}, ${labelOf(c.severity).toLowerCase()}`}
                      </span>
                      <span className="m-text-meta" style={{ color: "var(--m-ink-3)" }}>
                        {`Impact ${c.impact.toLocaleString()}${c.auto_fix_pct != null ? `, ${Math.round(c.auto_fix_pct)}% auto-fixable` : ""}`}
                      </span>
                      <span className="flex gap-3 m-text-body">
                        <Link href={withScope("/insights/rules", { run, module: c.module, field: c.field ?? undefined })} className="underline-offset-2 hover:underline">Open rules</Link>
                        <Link href={withScope(`/objects/${c.module}`, { tab: "records", run, check: c.rules[0] })} className="underline-offset-2 hover:underline">Open records</Link>
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </Section>
        </div>

        <div className="@5xl:col-span-6">
          <Section
            title="Fix first" height={264} query={rules}
            actions={<Link href={withScope("/insights/rules", { run, module })} className="m-text-body underline-offset-2 hover:underline">See all</Link>}
          >
            <DataTable columns={fixColumns} data={rules.data?.rows ?? []} getRowId={(r) => `${r.module}:${r.check_id}`} onRowClick={(r) => void finding.open(r)} hideToolbar dense height="auto" />
          </Section>
        </div>

        <div className="@5xl:col-span-8">
          <Section title="Trend" height={240} query={trends} meta={trendNote}>
            {trendLine.length < 2 ? <p className="m-text-body" style={{ color: "var(--m-ink-3)" }}>A trend needs at least two scored runs of this object.</p> : (
              <Line data={trendLine} label="Composite score per run" annotations={annotations} />
            )}
          </Section>
        </div>
        <div className="@5xl:col-span-4">
          <Section title="Dimensions" height={280} query={trends}>
            {dims.length === 0 ? <p className="m-text-body" style={{ color: "var(--m-ink-3)" }}>No dimension scores in this run.</p>
              : dims.length < 3 ? <Bar data={dims} label="Dimension scores, this run" height={160} />
              : <Radar data={dims} label="Dimension scores, this run" />}
          </Section>
        </div>

        <div className="@5xl:col-span-12">
          <Section title="Object heatmap" height={320} query={heat}>
            {heatRows.length === 0 ? <p className="m-text-body" style={{ color: "var(--m-ink-3)" }}>No object scores in this run.</p> : (
              <div role="region" aria-label="Object scores by dimension" tabIndex={0} className="overflow-x-auto">
                <Heatmap
                  rows={heatRows.map((r) => formatModuleName(r.module))}
                  cols={heatDims.map(dimLabel)}
                  cells={heatCells}
                  tone={tierOf}
                  cellSize={40}
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

        <div className="@5xl:col-span-6">
          <Section title="S/4 migration" height={240} query={s4} meta={s4.data ? `${blocking.toLocaleString()} blocking, ${warning.toLocaleString()} warning` : undefined}>
            {areas.length === 0 ? <p className="m-text-body" style={{ color: "var(--m-ink-3)" }}>No S/4 areas assessed.</p> : (
              <>
                <Bar
                  data={areas.filter((a) => a.failing > 0).map((a) => ({ x: a.label, y: a.blocking_failing }))}
                  label="Blocking failing rules per S/4 area"
                  height={200}
                  onPointClick={(p) => router.push(withScope("/insights/readiness", { run, area: areas.find((a) => a.label === p.x)?.area }))}
                />
                <p className="mt-2 m-text-body" style={{ color: "var(--m-ink-2)" }}>
                  {`${blocking.toLocaleString()} blocking and ${warning.toLocaleString()} warning failing rules. `}
                  <Link href={withScope("/insights/readiness", { run })} className="underline-offset-2 hover:underline">Open readiness</Link>
                </p>
              </>
            )}
          </Section>
        </div>
        <div className="@5xl:col-span-6">
          <Section title="Cleansing opportunity" height={240} query={cleanse}>
            <div aria-label="Cleansing funnel, failing records to applied fixes" role="group">
              <Funnel
                stages={(cleanse.data?.steps ?? []).map((s) => ({ label: s.label, value: s.records }))}
                onStageClick={(st) => {
                  const key = cleanse.data?.steps.find((s) => s.label === st.label)?.key;
                  router.push(fixHref({ status: key ?? "" }));
                }}
              />
            </div>
            <div className="mt-3">
              <Button variant="secondary" render={<Link href={fixHref({ source: "rule", confidence: "high" })}>Create remediation batch</Link>} />
            </div>
          </Section>
        </div>

      </div>
      {finding.drawer}
    </InsightFrame>
  );
}
