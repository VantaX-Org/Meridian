// frontend/app/(app)/insights/exec/page.tsx
"use client";

import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button, buildDrillHref, Card, DataTable, DrillLink, Delta, EmptyState, Heatmap, Stat, Tabs, Waterfall, type ExportOption, Status, toVerdict, Score } from "@/design";
import { getRoi } from "@/lib/api/analytics";
import { getFindings } from "@/lib/api/findings";
import { stateDelta } from "@/lib/current-state";
import { downloadAuthenticated } from "@/lib/api/download";
import { getCurrentOverview, getExec, getOverview, getProvenCost, getRuleRanking, l1Label, largestValueAtRisk, valueAtRiskByL1, type ExecWaterfallPoint, type OwnerCardResponse, type ReadinessCell } from "@/lib/api/insights";
import { getBoardReportUrl, getReportJsonExportUrl, getWorkbookUrl } from "@/lib/api/reports";
import { capRuleIds, deltaSentence, featureLabel, formatCompact, formatModuleName, labelOf, plural, shortCapReason } from "@/lib/format";
import { reportFilename } from "@/lib/report-filename";
import { runName } from "@/lib/run-scope";
import { previousInLineage } from "@/lib/runs";
import { apiErrorMessage, isListFailure } from "@/lib/error";
import { drillLabel, fixHref } from "@/lib/drill";
import { queryKeys } from "@/lib/query-keys";
import { useDayOne, DayOneAction } from "@/hooks/use-day-one";
import { DrillCount } from "../_components/DrillCount";
import { ruleColumns } from "../_components/RuleColumns";
import { useFindingOpener } from "../_components/FindingOpener";
import { Section } from "../_components/Section";
import { InsightActions } from "../_components/InsightActions";
import { useInsightScope, withScope } from "../_components/useInsightScope";
import { CardSkeleton, InsightFrame, formatMoney } from "../_components/InsightFrame";
import { PAGE_PURPOSE } from "../_components/InsightViews";
import { currentFindingColumns, currentFixFirst } from "../_components/CurrentOverview";
import { useCurrentState } from "../_components/useCurrentState";
import { migrationGapColumns, useWaveIds } from "../_components/migrationGaps";



/** An axis tick of an amount: "ZAR 5.7M"; without a currency the compact number alone. */
const moneyTick = (currency?: string | null) => (n: number) => (currency ? `${currency} ${formatCompact(n)}` : formatCompact(n));

/** One L1's waterfall caption: the total at risk and the feature carrying most of it. */
function waterfallCaption(l1: string, points: readonly ExecWaterfallPoint[], currency?: string | null): string {
  const total = points.reduce((s, p) => s + p.y, 0);
  const top = points.reduce<ExecWaterfallPoint | undefined>((m, p) => (!m || p.y > m.y ? p : m), undefined);
  const head = `${l1Label(l1)}: ${formatMoney(total, currency)} at risk across ${plural(points.length, "priced feature")}`;
  return top && points.length > 1 ? `${head}; ${top.x} carries the most, ${formatMoney(top.y, currency)}` : head;
}

// The object opens its records in Fix work; the gap counts open the wave's gap view (migrationGaps.tsx).
const readinessColumns = (run: string | undefined, waveIds: ReadonlyMap<string, string>): ColumnDef<ReadinessCell>[] => [
  { accessorKey: "module", header: "Object", cell: ({ row }) => <DrillCount href={fixHref({ run, module: row.original.module })} label={drillLabel({ what: "open records", module: row.original.module })}>{formatModuleName(row.original.module)}</DrillCount> },
  { accessorKey: "wave", header: "Wave" },
  {
    accessorKey: "verdict",
    header: "Verdict",
    cell: ({ row }) => <Status kind="verdict" value={row.original.verdict} />,
  },
  ...migrationGapColumns(waveIds),
];

const ownerColumns = (run?: string): ColumnDef<OwnerCardResponse>[] => [
  { accessorKey: "owner", header: "Owner", cell: ({ row }) => row.original.user_id
    ? <DrillLink href={fixHref({ assignee: row.original.user_id, run })}>{row.original.owner}</DrillLink> : row.original.owner },
  { accessorKey: "score", header: "Score", cell: ({ row }) => <DrillLink href={withScope("/insights/owners", { run })}>{row.original.score}</DrillLink> },
  { accessorKey: "delta", header: "Change", cell: ({ row }) => <Delta value={row.original.delta} /> },
];

export default function ExecPage() {
  const { run, mode, runs, error: listError, refetch: refetchList } = useInsightScope();
  const isCurrent = mode === "current";
  const router = useRouter();
  const dayOne = useDayOne();
  // No run because the run list (or the day-one sources) failed: an error, never "No executive summary yet".
  const loadError = run ? null : listError ?? (dayOne.status === "error" ? dayOne.error : null);
  const waveIds = useWaveIds();
  const finding = useFindingOpener(run);
  // One run: that run's rules ranked by impact. The current state: each object's findings from its own latest run,
  // as on the Insights overview (same request and cache entry), never the newest run's rules alone.
  const rules = useQuery({ queryKey: queryKeys.insights("rules", run, undefined, "top10"), queryFn: () => getRuleRanking({ version_id: run, limit: 10 }), enabled: !!run && !isCurrent });
  const current = useCurrentState();
  const currentFindings = useQuery({
    queryKey: ["home-top-findings", "current"],
    queryFn: () => getFindings({ sort: "impact", limit: 100 }),
    enabled: isCurrent && !!current.newest,
  });
  const currentFix = currentFixFirst(currentFindings.data?.findings ?? [], current.objects, current.modules, 10);
  // The change the newest run made to the current state: the same delta Home and the Insights overview show.
  const currentDelta = isCurrent ? stateDelta(current.runs, current.finished, current.modules) : null;

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: queryKeys.insights("exec", isCurrent ? "current" : run),
    queryFn: () => getExec(isCurrent ? { scope: "current" } : { version_id: run }),
    enabled: !!run,
  });

  const cost = useQuery({ queryKey: queryKeys.insights("proven-cost", run), queryFn: () => getProvenCost({ version_id: run }), enabled: !!run });
  // The tier and cap reason of what the hero shows: the current state in current mode, the run otherwise.
  const overview = useQuery({
    // Its own key: the cache holds the dqs block only, not the overview other pages read under the plain key.
    queryKey: queryKeys.insights("overview", isCurrent ? "current" : run, undefined, "dqs"),
    queryFn: async () => (isCurrent ? (await getCurrentOverview()).dqs : (await getOverview({ version_id: run })).dqs),
    enabled: !!run,
  });
  const dqs = overview.data;
  const delta = isCurrent ? currentDelta : dqs?.delta ?? null;
  const VERDICT_SENTENCE: Record<string, string> = { go: "Go", at_risk: "At risk", no_go: "No-go" };
  // The score, cap and reason from the exec API (the current-state composite in current mode); the overview's otherwise.
  const exec = data;
  const composite = exec?.composite ?? dqs?.composite;
  const cap = exec?.cap ?? undefined;
  const capReason = exec?.cap_reason ?? dqs?.cap_reason ?? null;
  const capped = cap != null || !!dqs?.capped;
  const capRule = capRuleIds(capReason)[0];
  const currency = cost.data?.currency;
  const roi = useQuery({ queryKey: ["roi"], queryFn: getRoi });
  // The run the summary describes (null in current mode, which spans runs) and the run its exports are built from:
  // that run, or in current mode the newest run of the current state.
  const vid = data?.version_id ?? undefined;
  const exportVid = data?.latest_version_id ?? vid;
  const state: "loading" | "empty" | "error" | undefined = isLoading || dayOne.status === "loading"
    ? "loading"
    : loadError || isListFailure({ isError, error })
      ? "error"
      // Only a tenant with no run is empty: a scored run with no waves, features or owners still shows the score,
      // Fix first and ROI, each section carrying its own empty line; the current state has no version_id by design.
      : !run || (data && !vid && !exportVid)
        ? "empty"
        : undefined;

  const exportRun = runs.find((r) => r.id === exportVid);
  // The board pack's deltas are against the run before the exported one in its lineage; without it a pack says nothing changed.
  const compareVid = exportRun ? previousInLineage(exportRun, runs)?.id : undefined;
  const scopeLabel = exportRun ? runName(exportRun) : isCurrent ? "latest run" : undefined;
  const latest = isCurrent ? ", latest run" : "";
  const boardFile = () => reportFilename("board", scopeLabel);
  const exportOptions: ExportOption[] = exportVid ? [
    { format: "pdf", label: `Board pack${latest} (PDF)`, run: () => downloadAuthenticated(getBoardReportUrl(exportVid, compareVid), boardFile()) },
    { format: "xlsx", label: `Analyst workbook${latest} (Excel)`, run: () => downloadAuthenticated(getWorkbookUrl(exportVid, {}), reportFilename("workbook", scopeLabel)) },
    { format: "json", label: `Run data${latest} (JSON)`, run: () => downloadAuthenticated(getReportJsonExportUrl(exportVid), reportFilename("run_data", scopeLabel)) },
  ] : [];
  const noGo = data?.readiness_cells.filter((c) => c.verdict === "no_go").length ?? 0;
  const atRiskCells = data?.readiness_cells.filter((c) => c.verdict === "at_risk").length ?? 0;
  const goCells = data?.readiness_cells.filter((c) => c.verdict === "go").length ?? 0;
  const owners = data?.owner_rows ?? [];
  const up = owners.filter((o) => o.delta > 0).length;
  const down = owners.filter((o) => o.delta < 0).length;
  const cells = data?.readiness_cells ?? [];
  const blocked = cells.filter((c) => c.blocker_count > 0 || c.records_blocked > 0).sort((a, b) => b.records_blocked - a.records_blocked);
  const heatRows = [...new Set(cells.map((c) => formatModuleName(c.module)))];
  const heatCols = [...new Set(cells.map((c) => c.wave))];
  const byL1 = new Map<string, ExecWaterfallPoint[]>();
  // Each step reads by its feature's name, as on the Impact page, never the machine id.
  for (const pt of data?.waterfall ?? []) byL1.set(pt.l1 || "unassigned", [...(byL1.get(pt.l1 || "unassigned") ?? []), { ...pt, x: featureLabel(String(pt.x)) }]);
  const l1Tabs = [...byL1].sort(([a], [b]) => a.localeCompare(b));
  const topRisk = data ? largestValueAtRisk(valueAtRiskByL1(data.impact_rows)) : null;
  const boardPack = exportVid ? () => void downloadAuthenticated(getBoardReportUrl(exportVid, compareVid), boardFile()).catch((e: unknown) => toast.error(apiErrorMessage(e))) : undefined;
  const pairs = (n: number) => plural(n, "object and wave pair", "object and wave pairs");

  return (
    <InsightFrame
      title="Executive summary"
      purpose={PAGE_PURPOSE["/insights/exec"]}
      scope
      actions={<InsightActions run={vid} current={isCurrent} options={exportOptions} />}
      insight={{
        hero: true,
        lead: typeof composite === "number" ? (
          <div className="m-hero-lead">
            {/* One score, the hero; how it is scored opens the scoring page, never a second ring from another source. */}
            <Score
                size="hero"
                value={composite}
                cap={cap}
                versionId={vid}
                hint={cap != null ? `Capped at ${cap}` : undefined}
                delta={delta != null ? <Delta value={delta} /> : undefined}
              />
            <Link href="/rules/scoring" className="m-text-body m-ink-accent underline underline-offset-2" data-testid="how-scored">How it is scored</Link>
            <div className="m-hero-verdict" data-testid="hero-verdict">
              <span className="font-semibold m-text-verdict-line m-ink [letter-spacing:var(--m-tracking-title)]">
                {dqs?.tier ? VERDICT_SENTENCE[dqs.tier] ?? labelOf(dqs.tier) : "Scored"}
              </span>
              <span className="m-text-body m-ink-2">
                {/* The current state moves by the newest run's change (stateDelta), as on Home and the overview. */}
                {capped && capReason ? `Capped: ${shortCapReason(capReason)}` : isCurrent ? (delta != null ? deltaSentence(delta, "with the latest run") : "Every object at its latest run") : deltaSentence(dqs?.delta)}
              </span>
            </div>
          </div>
        ) : undefined,
        stats: data ? [
          { label: "Objects blocked in a wave", value: noGo, hint: cells.length ? `of ${pairs(cells.length)}` : "No wave set up", tone: noGo ? "no-go" : "go", to: withScope("/insights/readiness", { run: vid }) },
          { label: topRisk ? `Most at risk: ${l1Label(topRisk.l1)}` : "Most at risk", value: topRisk ? formatMoney(topRisk.value_at_risk, currency) : "—", hint: topRisk ? undefined : "Nothing priced yet", to: withScope("/insights/impact", { run: vid }) },
          { label: "Owners improved", value: up, to: withScope("/insights/owners", { run: vid }) },
          { label: "Owners slipped", value: down, tone: down ? "at-risk" : undefined, to: withScope("/insights/owners", { run: vid }) },
        ] : undefined,
        situation: {
          sentence: data?.narrative || (cells.length ? `${noGo} of ${pairs(cells.length)} cannot load` : "No migration wave is set up yet"),
          tone: cells.length === 0 ? "neutral" : noGo ? "no-go" : "go",
        },
        changed: { sentence: owners.length === 0 ? "Nobody owns an issue yet" : up + down === 0 ? "No owner moved since the last run" : `${plural(up, "owner")} improved, ${down} slipped since the last run` },
        why: { sentence: topRisk ? `${l1Label(topRisk.l1)} carries the most value at risk, ${formatMoney(topRisk.value_at_risk, currency)}` : "Nothing is priced at risk yet", href: withScope("/insights/impact", { run: vid }) },
        // The next step follows the verdict: lift a cap first, then the objects that cannot load, then share.
        next: capped
          ? { sentence: `Lift the cap: fix ${capRule ?? "the critical rules"}`, action: { label: "Open failing rules", href: withScope("/insights/rules", { run, severity: "critical" }) } }
          : noGo
            ? { sentence: "Clear what blocks the objects that cannot load", action: { label: "Open waves", href: withScope("/insights/readiness", { run }) } }
            : boardPack
              ? { sentence: "Share the board pack with leadership", action: { label: "Download board pack", onClick: boardPack } }
              : { sentence: "Pick a report to share", action: { label: "Open reports", href: withScope("/insights/reports", { run }) } },
      }}
      state={state}
      skeleton={
        <>
          <CardSkeleton height={240} />
          <CardSkeleton height={96} />
          <CardSkeleton height={200} />
        </>
      }
      emptyProps={{
        title: "No executive summary yet",
        detail: dayOne.step?.detail ?? "It appears once a run has finished analysing.",
        action: <DayOneAction step={dayOne.step} fallbackHref="/runs" fallbackLabel="Open runs" />,
      }}
      errorProps={loadError ? { error: loadError, onRetry: () => { refetchList(); dayOne.refetch(); } } : { error, onRetry: () => void refetch() }}
    >
      <div className="grid gap-4 @5xl:grid-cols-12">
        <div className="@5xl:col-span-12">
          {isCurrent ? (
            <Section title="Fix first" height={240} query={currentFindings} meta="Highest-impact failing rules, each object at its latest run" actions={<Link href="/insights" className="m-text-body underline-offset-2 hover:underline">Open overview</Link>}>
              <DataTable
                columns={currentFindingColumns}
                data={currentFix}
                getRowId={(f) => f.id}
                onRowClick={(f) => router.push(buildDrillHref({ object: f.module, ruleId: f.check_id, run: f.version_id }))}
                hideToolbar dense height="auto"
              />
            </Section>
          ) : (
            <Section title="Fix first" height={240} query={rules} meta="Ranked by impact on the score" actions={<Link href={withScope("/insights/rules", { run })} className="m-text-body underline-offset-2 hover:underline">See all</Link>}>
              <DataTable columns={ruleColumns(run, true)} data={rules.data?.rows ?? []} getRowId={(r) => `${r.module}:${r.check_id}`} onRowClick={(r) => void finding.open(r)} hideToolbar dense height="auto" />
            </Section>
          )}
        </div>
        <div className="@5xl:col-span-12">
          <Card title="Readiness by wave" meta={cells.length ? `${goCells} go, ${atRiskCells} at risk, ${noGo} no-go` : undefined} actions={<Link href={withScope("/insights/readiness", { run })} className="m-text-body underline-offset-2 hover:underline">Open waves</Link>}>
            {cells.length === 0 && (
              <EmptyState variant="inline" title="No waves yet" detail="Create a wave in the migration cockpit to score objects per wave." action={<Link href="/migration" className="underline-offset-2 hover:underline">Open migration cockpit</Link>} />
            )}
            {cells.length > 0 && (
              <div role="region" aria-label="Readiness by object and wave" tabIndex={0} className="mb-3 overflow-x-auto">
                <Heatmap
                  rows={heatRows}
                  cols={heatCols}
                  cells={cells.map((c) => ({ row: formatModuleName(c.module), col: c.wave, value: toVerdict(c.verdict) ?? "at-risk" }))}
                  rowHref={(row) => withScope(`/objects/${cells.find((c) => formatModuleName(c.module) === row)?.module ?? ""}`, { run })}
                />
              </div>
            )}
            {cells.length === 0 ? null : blocked.length === 0 ? (
              <EmptyState variant="inline" title="Every object and wave can load" action={<Link href={withScope("/insights/readiness", { run })} className="underline-offset-2 hover:underline">Open waves</Link>} />
            ) : (
              <DataTable columns={readinessColumns(run, waveIds)} data={blocked} getRowId={(row) => `${row.module}-${row.wave}`} hideToolbar dense height="auto" />
            )}
          </Card>
        </div>
        {l1Tabs.length > 0 && (
          <div className="@5xl:col-span-7">
            <Card title="Value at risk by feature" meta="Each step is one priced feature, grouped by the process it serves">
              <Tabs
                items={l1Tabs.map(([l1, points]) => ({
                  value: l1,
                  label: l1Label(l1),
                  content: (
                    <>
                      <Waterfall data={points} label={`Value at risk by feature, ${l1Label(l1)}`} formatValue={(n) => formatMoney(n, currency)} formatTick={moneyTick(currency)} />
                      <p className="mt-2 m-text-body m-ink-2">{waterfallCaption(l1, points, currency)}</p>
                    </>
                  ),
                }))}
              />
            </Card>
          </div>
        )}
        <div className={l1Tabs.length > 0 ? "@5xl:col-span-5" : "@5xl:col-span-12"}>
          <Card title="Owners" actions={<Link href={withScope("/insights/owners", { run })} className="m-text-body underline-offset-2 hover:underline">Open owners</Link>}>
            {owners.length === 0 ? (
              <EmptyState variant="inline" title="No owner is scored yet" detail="Owners appear once records in Fix work are assigned to someone." action={<Link href={withScope("/fix", { run })} className="underline-offset-2 hover:underline">Open Fix work</Link>} />
            ) : (
              <DataTable columns={ownerColumns(vid)} data={owners} getRowId={(row) => row.owner} hideToolbar dense height="auto" />
            )}
          </Card>
        </div>
        <div className="@5xl:col-span-12">
          <Card title="Return on investment">
              {roi.isError ? (
                <div className="flex items-center gap-3 m-text-body" role="alert">
                  <span>Return on investment did not load. {apiErrorMessage(roi.error)}</span>
                  <Button variant="secondary" onClick={() => void roi.refetch()}>Retry</Button>
                </div>
              ) : roi.data && !roi.data.roi.risk_mitigated ? (
                // No multiple or payback can be stated before any cost is avoided; "0x" and "0 months" would read as a verdict.
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  <Stat label="Cost avoided" value="No cost avoided yet" hint="Appears once approved fixes are applied" href={withScope("/fix", { run })} />
                </div>
              ) : roi.data && roi.data.roi.subscription_annual == null ? (
                // No subscription is configured anywhere, so the multiple, payback and fee are not stated: only the cost avoided.
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  <Stat label="Cost avoided" value={formatMoney(roi.data.roi.risk_mitigated, roi.data.roi.currency)} />
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  <Stat label="ROI multiple" loading={roi.isLoading} value={roi.data?.roi.roi_multiple != null ? `${roi.data.roi.roi_multiple}x` : "—"} />
                  <Stat label="Payback" loading={roi.isLoading} value={roi.data?.roi.payback_months != null ? plural(roi.data.roi.payback_months, "month") : "—"} />
                  <Stat label="Cost avoided" loading={roi.isLoading} value={roi.data ? formatMoney(roi.data.roi.risk_mitigated, roi.data.roi.currency) : "—"} />
                  <Stat label="Annual subscription" loading={roi.isLoading} value={roi.data?.roi.subscription_annual != null ? formatMoney(roi.data.roi.subscription_annual, roi.data.roi.currency) : "—"} />
                </div>
              )}
          </Card>
        </div>
      </div>
      {finding.drawer}
    </InsightFrame>
  );
}
