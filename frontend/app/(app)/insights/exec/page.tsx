// frontend/app/(app)/insights/exec/page.tsx
"use client";

import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";
import { Button, Card, DataTable, DrillLink, Delta, ExportMenu, Heatmap, Pill, Stat, Tabs, Waterfall, type ExportOption, type PillTone } from "@/design";
import { getRoi } from "@/lib/api/analytics";
import { downloadAuthenticated } from "@/lib/api/download";
import { getExec, getProvenCost, getRuleRanking, l1Label, largestValueAtRisk, valueAtRiskByL1, type ExecWaterfallPoint, type OwnerCardResponse, type ReadinessCell } from "@/lib/api/insights";
import { getBoardReportUrl, getReportJsonExportUrl, getWorkbookUrl } from "@/lib/api/reports";
import { useRole } from "@/hooks/use-role";
import { formatModuleName } from "@/lib/format";
import { apiErrorMessage, isListFailure } from "@/lib/error";
import { queryKeys } from "@/lib/query-keys";
import { useDayOne, DayOneAction } from "@/hooks/use-day-one";
import { ruleColumns } from "../_components/RuleColumns";
import { useFindingOpener } from "../_components/FindingOpener";
import { Section } from "../_components/Section";
import { useInsightScope, withScope } from "../_components/useInsightScope";
import { CardSkeleton, InsightFrame, formatMoney, useRunLabel } from "../_components/InsightFrame";

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
    header: "Blockers",
    cell: ({ row }) => <DrillLink object={row.original.module} filters={{ blocking: "true" }}>{row.original.blocker_count}</DrillLink>,
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
  const { can } = useRole();
  const finding = useFindingOpener(run);
  const rules = useQuery({ queryKey: queryKeys.insights("rules", run, undefined, "top10"), queryFn: () => getRuleRanking({ version_id: run, limit: 10 }), enabled: !!run });

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: queryKeys.insights("exec", run),
    queryFn: () => getExec({ version_id: run }),
    enabled: !!run,
  });
  const runLabel = useRunLabel(data?.version_id);

  const cost = useQuery({ queryKey: queryKeys.insights("proven-cost", run), queryFn: () => getProvenCost({ version_id: run }), enabled: !!run });
  const currency = cost.data?.currency;
  const roi = useQuery({ queryKey: ["roi"], queryFn: getRoi });
  const state: "loading" | "empty" | "error" | undefined = isLoading || dayOne.status === "loading"
    ? "loading"
    : isListFailure({ isError, error })
      ? "error"
      : data && data.readiness_cells.length === 0 && data.impact_rows.length === 0 && data.owner_rows.length === 0
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
  const heatRows = [...new Set(cells.map((c) => formatModuleName(c.module)))];
  const heatCols = [...new Set(cells.map((c) => c.wave))];
  const byL1 = new Map<string, ExecWaterfallPoint[]>();
  for (const pt of data?.waterfall ?? []) byL1.set(pt.l1 || "unassigned", [...(byL1.get(pt.l1 || "unassigned") ?? []), pt]);
  const l1Tabs = [...byL1].sort(([a], [b]) => a.localeCompare(b));
  const topRisk = data ? largestValueAtRisk(valueAtRiskByL1(data.impact_rows)) : null;

  return (
    <InsightFrame
      title="Executive summary"
      meta={runLabel}
      actions={can("export") ? <ExportMenu options={exportOptions} /> : <Pill tone="info">Export needs auditor or analyst role</Pill>}
      insight={{
        hero: true,
        stats: data ? [
          { label: "No-go cells", value: noGo, tone: noGo ? "no-go" : "go", to: "/insights/readiness" },
          { label: "Largest L1 at risk", value: topRisk ? formatMoney(topRisk.value_at_risk, currency) : "—", to: "/insights/impact" },
          { label: "Owners improved", value: up, to: "/insights/owners" },
          { label: "Owners slipped", value: down, tone: down ? "at-risk" : undefined, to: "/insights/owners" },
        ] : undefined,
        situation: { sentence: data?.narrative || `${noGo} no-go cells across the waves` , tone: noGo ? "no-go" : "go" },
        changed: { sentence: up + down === 0 ? "—" : `${up} owners improved, ${down} slipped since the last run` },
        why: { sentence: topRisk ? `${l1Label(topRisk.l1)} carries the most value at risk, ${formatMoney(topRisk.value_at_risk, currency)}` : "No value at risk", href: "/insights/impact" },
        next: { sentence: noGo ? "Clear the no-go cells first" : "Share the report", action: { label: "Open readiness", href: "/insights/readiness" } },
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
          <Card title="Readiness by wave">
            {cells.length > 0 && (
              <div role="region" aria-label="Readiness by object and wave" tabIndex={0} className="mb-3 overflow-x-auto">
                <Heatmap
                  rows={heatRows}
                  cols={heatCols}
                  cells={cells.map((c) => ({ row: formatModuleName(c.module), col: c.wave, value: VERDICT_TONE[c.verdict] as "go" | "at-risk" | "no-go" }))}
                  rowHref={(row) => `/objects/${cells.find((c) => formatModuleName(c.module) === row)?.module ?? ""}`}
                />
              </div>
            )}
            <DataTable columns={readinessColumns} data={cells} getRowId={(row) => `${row.module}-${row.wave}`} hideToolbar dense height="auto" />
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
          <Section title="Fix first" height={240} query={rules} actions={<Link href={withScope("/insights/rules", { run })} className="m-text-body underline-offset-2 hover:underline">See all</Link>}>
            <DataTable columns={ruleColumns(run, true)} data={rules.data?.rows ?? []} getRowId={(r) => `${r.module}:${r.check_id}`} onRowClick={(r) => void finding.open(r)} hideToolbar dense height="auto" />
          </Section>
        </div>
        <div className="@5xl:col-span-12">
          <Card title="Owners">
            <DataTable columns={ownerColumns} data={data?.owner_rows ?? []} getRowId={(row) => row.owner} hideToolbar dense height="auto" />
          </Card>
        </div>
        <div className="@5xl:col-span-12">
          <details open={roi.isError || undefined}>
            <summary className="cursor-pointer m-text-body font-medium">Return on investment</summary>
            <Card>
              {roi.isError ? (
                <div className="flex items-center gap-3 m-text-body" role="alert">
                  <span>Return on investment did not load. {apiErrorMessage(roi.error)}</span>
                  <Button variant="secondary" onClick={() => void roi.refetch()}>Retry</Button>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  <Stat label="ROI multiple" loading={roi.isLoading} value={roi.data ? `${roi.data.roi.roi_multiple}x` : "—"} />
                  <Stat label="Payback" loading={roi.isLoading} value={roi.data ? `${roi.data.roi.payback_months} months` : "—"} />
                  <Stat label="Risk mitigated" loading={roi.isLoading} value={roi.data ? plain(roi.data.roi.risk_mitigated) : "—"} />
                  <Stat label="Annual subscription" loading={roi.isLoading} value={roi.data ? plain(roi.data.roi.subscription_annual) : "—"} />
                </div>
              )}
            </Card>
          </details>
        </div>
      </div>
      {finding.drawer}
    </InsightFrame>
  );
}
