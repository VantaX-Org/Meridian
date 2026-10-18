// frontend/app/(app)/insights/exec/page.tsx
"use client";

import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";
import { Button, Card, DataTable, DrillLink, Delta, EmptyState, Heatmap, Pill, Stat, Tabs, Waterfall, type ExportOption, type PillTone } from "@/design";
import { getRoi } from "@/lib/api/analytics";
import { downloadAuthenticated } from "@/lib/api/download";
import { getExec, getOverview, getProvenCost, getRuleRanking, l1Label, largestValueAtRisk, valueAtRiskByL1, type ExecWaterfallPoint, type OwnerCardResponse, type ReadinessCell } from "@/lib/api/insights";
import { getBoardReportUrl, getReportJsonExportUrl, getWorkbookUrl } from "@/lib/api/reports";
import { deltaSentence, formatModuleName, labelOf, plural, shortCapReason } from "@/lib/format";
import { apiErrorMessage, isListFailure } from "@/lib/error";
import { queryKeys } from "@/lib/query-keys";
import { useDayOne, DayOneAction } from "@/hooks/use-day-one";
import { ruleColumns } from "../_components/RuleColumns";
import { useFindingOpener } from "../_components/FindingOpener";
import { Section } from "../_components/Section";
import { InsightActions } from "../_components/InsightActions";
import { useInsightScope, withScope } from "../_components/useInsightScope";
import { CardSkeleton, InsightFrame, formatMoney } from "../_components/InsightFrame";

const VERDICT_TONE: Record<ReadinessCell["verdict"], PillTone> = {
  go: "go",
  at_risk: "at-risk",
  no_go: "no-go",
};

const VERDICT_LABEL: Record<ReadinessCell["verdict"], string> = { go: "Go", at_risk: "At risk", no_go: "No-go" };

const plain = (n: number) => formatMoney(n);

const readinessColumns: ColumnDef<ReadinessCell>[] = [
  { accessorKey: "module", header: "Object", cell: ({ row }) => <DrillLink object={row.original.module}>{formatModuleName(row.original.module)}</DrillLink> },
  { accessorKey: "wave", header: "Wave" },
  {
    accessorKey: "verdict",
    header: "Verdict",
    cell: ({ row }) => <Pill tone={VERDICT_TONE[row.original.verdict]}>{VERDICT_LABEL[row.original.verdict]}</Pill>,
  },
  {
    accessorKey: "blocker_count",
    header: "Blocking rules",
    meta: { numeric: true },
    cell: ({ row }) => <DrillLink object={row.original.module} filters={{ blocking: "true" }}>{row.original.blocker_count.toLocaleString()}</DrillLink>,
  },
  {
    accessorKey: "records_blocked",
    header: "Records blocked",
    meta: { numeric: true },
    cell: ({ row }) => <DrillLink object={row.original.module} filters={{ blocking: "true" }}>{row.original.records_blocked.toLocaleString()}</DrillLink>,
  },
];

const ownerColumns: ColumnDef<OwnerCardResponse>[] = [
  { accessorKey: "owner", header: "Owner" },
  { accessorKey: "score", header: "Score", cell: ({ row }) => <DrillLink href="/insights/owners">{row.original.score}</DrillLink> },
  { accessorKey: "delta", header: "Change", cell: ({ row }) => <Delta value={row.original.delta} /> },
];

export default function ExecPage() {
  const { run } = useInsightScope();
  const dayOne = useDayOne();
  const finding = useFindingOpener(run);
  const rules = useQuery({ queryKey: queryKeys.insights("rules", run, undefined, "top10"), queryFn: () => getRuleRanking({ version_id: run, limit: 10 }), enabled: !!run });

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: queryKeys.insights("exec", run),
    queryFn: () => getExec({ version_id: run }),
    enabled: !!run,
  });

  const cost = useQuery({ queryKey: queryKeys.insights("proven-cost", run), queryFn: () => getProvenCost({ version_id: run }), enabled: !!run });
  const overview = useQuery({ queryKey: queryKeys.insights("overview", run), queryFn: () => getOverview({ version_id: run }), enabled: !!run });
  const dqs = overview.data?.dqs;
  const VERDICT_SENTENCE: Record<string, string> = { go: "Ready to load", at_risk: "At risk", no_go: "Not ready" };
  const currency = cost.data?.currency;
  const roi = useQuery({ queryKey: ["roi"], queryFn: getRoi });
  const state: "loading" | "empty" | "error" | undefined = isLoading || dayOne.status === "loading"
    ? "loading"
    : isListFailure({ isError, error })
      ? "error"
      // Only a missing run is empty: a scored run with no waves, features or owners still shows the score,
      // Fix first and ROI, each section carrying its own empty line.
      : !run || (data && !data.version_id)
        ? "empty"
        : undefined;

  const vid = data?.version_id ?? undefined;
  const exportOptions: ExportOption[] = vid ? [
    { format: "pdf", label: "Board pack (PDF)", run: () => downloadAuthenticated(getBoardReportUrl(vid), `board_${vid}.pdf`) },
    { format: "xlsx", label: "Analyst workbook (Excel)", run: () => downloadAuthenticated(getWorkbookUrl(vid, {}), `workbook_${vid}.xlsx`) },
    { format: "json", label: "Run data (JSON)", run: () => downloadAuthenticated(getReportJsonExportUrl(vid), `run_${vid}.json`) },
  ] : [];
  const noGo = data?.readiness_cells.filter((c) => c.verdict === "no_go").length ?? 0;
  const owners = data?.owner_rows ?? [];
  const up = owners.filter((o) => o.delta > 0).length;
  const down = owners.filter((o) => o.delta < 0).length;
  const cells = data?.readiness_cells ?? [];
  const blocked = cells.filter((c) => c.blocker_count > 0 || c.records_blocked > 0).sort((a, b) => b.records_blocked - a.records_blocked);
  const heatRows = [...new Set(cells.map((c) => formatModuleName(c.module)))];
  const heatCols = [...new Set(cells.map((c) => c.wave))];
  const byL1 = new Map<string, ExecWaterfallPoint[]>();
  for (const pt of data?.waterfall ?? []) byL1.set(pt.l1 || "unassigned", [...(byL1.get(pt.l1 || "unassigned") ?? []), pt]);
  const l1Tabs = [...byL1].sort(([a], [b]) => a.localeCompare(b));
  const topRisk = data ? largestValueAtRisk(valueAtRiskByL1(data.impact_rows)) : null;

  return (
    <InsightFrame
      title="Executive summary"
      scope
      actions={<InsightActions run={vid} options={exportOptions} />}
      insight={{
        hero: true,
        lead: dqs && typeof dqs.composite === "number" ? (
          <div className="flex flex-wrap items-end gap-x-8 gap-y-4">
            <div style={{ minWidth: 260, width: "max-content", maxWidth: 360 }}>
              <Stat
                hero
                label="Data quality score"
                help="dqs"
                value={dqs.composite}
                bar={dqs.composite}
                decimals={1}
                versionId={vid}
                hint={dqs.capped ? `Capped at ${dqs.composite <= 70 ? 70 : 85}` : undefined}
                delta={dqs.delta != null ? <Delta value={dqs.delta} /> : undefined}
              />
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-1" style={{ minWidth: "min(100%, 16rem)", maxWidth: "48ch" }}>
              <span className="font-semibold" style={{ fontSize: "var(--m-text-verdict)", lineHeight: "var(--m-leading-verdict)", color: "var(--m-hero-ink)", letterSpacing: "var(--m-tracking-title)" }}>
                {dqs.tier ? VERDICT_SENTENCE[dqs.tier] ?? labelOf(dqs.tier) : "Scored"}
              </span>
              <span className="m-text-body" style={{ color: "var(--m-hero-ink-2)" }}>
                {dqs.capped && dqs.cap_reason ? `Capped: ${shortCapReason(dqs.cap_reason)}` : deltaSentence(dqs.delta)}
              </span>
            </div>
          </div>
        ) : undefined,
        stats: data ? [
          { label: "No-go cells", value: noGo, tone: noGo ? "no-go" : "go", to: "/insights/readiness" },
          { label: "Largest L1 at risk", value: topRisk ? formatMoney(topRisk.value_at_risk, currency) : "—", to: "/insights/impact" },
          { label: "Owners improved", value: up, to: "/insights/owners" },
          { label: "Owners slipped", value: down, tone: down ? "at-risk" : undefined, to: "/insights/owners" },
        ] : undefined,
        situation: { sentence: data?.narrative || (cells.length ? `${noGo} of ${plural(cells.length, "readiness cell")} ${noGo === 1 ? "is" : "are"} no-go` : "No readiness waves are defined yet"), tone: noGo ? "no-go" : "go" },
        changed: { sentence: owners.length === 0 ? "No owner is scored yet" : up + down === 0 ? "No owner moved since the last run" : `${plural(up, "owner")} improved, ${down} slipped since the last run` },
        why: { sentence: topRisk ? `${l1Label(topRisk.l1)} carries the most value at risk, ${formatMoney(topRisk.value_at_risk, currency)}` : "No value at risk", href: "/insights/impact" },
        next: noGo
          ? { sentence: "Clear the no-go cells first", action: { label: "Open readiness", href: withScope("/insights/readiness", { run }) } }
          : { sentence: "Share the board pack", action: { label: "Open reports", href: withScope("/insights/reports", { run }) } },
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
      errorProps={{ message: apiErrorMessage(error), onRetry: () => void refetch() }}
    >
      <div className="grid gap-4 @5xl:grid-cols-12">
        <div className="@5xl:col-span-12">
          <Card title="Readiness by wave" meta={cells.length ? `${noGo} no-go, ${cells.length - noGo} ready` : undefined} actions={<Link href={withScope("/insights/readiness", { run })} className="m-text-body underline-offset-2 hover:underline">Open readiness</Link>}>
            {cells.length === 0 && (
              <EmptyState variant="inline" title="No readiness waves yet" detail="Create a wave in the migration cockpit to score objects per wave." action={<Link href="/migration" className="underline-offset-2 hover:underline">Open migration cockpit</Link>} />
            )}
            {cells.length > 0 && (
              <div role="region" aria-label="Readiness by object and wave" tabIndex={0} className="mb-3 overflow-x-auto">
                <Heatmap
                  rows={heatRows}
                  cols={heatCols}
                  cells={cells.map((c) => ({ row: formatModuleName(c.module), col: c.wave, value: VERDICT_TONE[c.verdict] as "go" | "at-risk" | "no-go" }))}
                  rowHref={(row) => withScope(`/objects/${cells.find((c) => formatModuleName(c.module) === row)?.module ?? ""}`, { run })}
                />
              </div>
            )}
            {cells.length === 0 ? null : blocked.length === 0 ? (
              <p className="m-text-body" style={{ color: "var(--m-ink-2)" }}>Every object and wave can load.</p>
            ) : (
              <DataTable columns={readinessColumns} data={blocked} getRowId={(row) => `${row.module}-${row.wave}`} hideToolbar dense height="auto" />
            )}
          </Card>
        </div>
        {l1Tabs.length > 0 && (
          <div className="@5xl:col-span-7">
            <Card title="Score movement">
              <Tabs
                items={l1Tabs.map(([l1, points]) => ({
                  value: l1,
                  label: l1Label(l1),
                  content: (
                    <>
                      <Waterfall data={points} label={`Score movement, ${l1Label(l1)}`} />
                      <p className="mt-2 m-text-body" style={{ color: "var(--m-ink-2)" }}>{`${l1Label(l1)}: from ${points[0].x} to ${points[points.length - 1].x}.`}</p>
                    </>
                  ),
                }))}
              />
            </Card>
          </div>
        )}
        <div className={l1Tabs.length > 0 ? "@5xl:col-span-5" : "@5xl:col-span-12"}>
          <Section title="Fix first" height={240} query={rules} meta="Select a rule to see the records, the fix and the root cause" actions={<Link href={withScope("/insights/rules", { run })} className="m-text-body underline-offset-2 hover:underline">See all</Link>}>
            <DataTable columns={ruleColumns(run, true)} data={rules.data?.rows ?? []} getRowId={(r) => `${r.module}:${r.check_id}`} onRowClick={(r) => void finding.open(r)} hideToolbar dense height="auto" />
          </Section>
        </div>
        <div className="@5xl:col-span-12">
          <Card title="Owners" actions={<Link href={withScope("/insights/owners", { run })} className="m-text-body underline-offset-2 hover:underline">Open owners</Link>}>
            {owners.length === 0 ? (
              <EmptyState variant="inline" title="No owner is scored yet" detail="Owners appear once findings are assigned." action={<Link href="/inbox" className="underline-offset-2 hover:underline">Open inbox</Link>} />
            ) : (
              <DataTable columns={ownerColumns} data={owners} getRowId={(row) => row.owner} hideToolbar dense height="auto" />
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
              ) : roi.data && !roi.data.roi.subscription_annual ? (
                <p className="m-text-body" style={{ color: "var(--m-ink-2)" }}>
                  Return on investment appears once the subscription and cost per record are set.{" "}
                  <Link href="/admin/settings" className="underline-offset-2 hover:underline">Open settings</Link>
                </p>
              ) : roi.data && !roi.data.roi.risk_mitigated ? (
                // No multiple or payback can be stated before any cost is avoided; "0x" and "0 months" would read as a verdict.
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  <Stat label="Cost avoided" value="No cost avoided yet" hint="Appears once approved fixes are applied" href={withScope("/fix", { run })} />
                  <Stat label="Annual subscription" value={plain(roi.data.roi.subscription_annual)} />
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  <Stat label="ROI multiple" loading={roi.isLoading} value={roi.data ? `${roi.data.roi.roi_multiple}x` : "—"} />
                  <Stat label="Payback" loading={roi.isLoading} value={roi.data ? `${plural(roi.data.roi.payback_months, "month")}` : "—"} />
                  <Stat label="Risk mitigated" loading={roi.isLoading} value={roi.data ? plain(roi.data.roi.risk_mitigated) : "—"} />
                  <Stat label="Annual subscription" loading={roi.isLoading} value={roi.data ? plain(roi.data.roi.subscription_annual) : "—"} />
                </div>
              )}
          </Card>
        </div>
      </div>
      {finding.drawer}
    </InsightFrame>
  );
}
