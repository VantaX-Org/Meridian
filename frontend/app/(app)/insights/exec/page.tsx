// frontend/app/(app)/insights/exec/page.tsx
"use client";

import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Button, Card, DataTable, DrillLink, Delta, Pill, Stat, Waterfall, type PillTone } from "@/design";
import { getRoi } from "@/lib/api/analytics";
import { downloadAuthenticated } from "@/lib/api/download";
import { getExec, getProvenCost, l1Label, largestValueAtRisk, valueAtRiskByL1, type ImpactRow, type OwnerCardResponse, type ReadinessCell } from "@/lib/api/insights";
import { formatModuleName, labelOf } from "@/lib/format";
import { apiErrorMessage, isListFailure } from "@/lib/error";
import { queryKeys } from "@/lib/query-keys";
import { useDayOne, DayOneAction } from "@/hooks/use-day-one";
import { CardSkeleton, InsightFrame, formatMoney, statusTone, useRunLabel } from "../_components/InsightFrame";

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

const impactColumns: ColumnDef<ImpactRow>[] = [
  { accessorKey: "feature", header: "Feature", cell: ({ row }) => <DrillLink object={row.original.feature}>{labelOf(row.original.feature)}</DrillLink> },
  { accessorKey: "status", header: "Status", cell: ({ row }) => <Pill tone={statusTone(row.original.status)}>{labelOf(row.original.status)}</Pill> },
  { accessorKey: "record_count", header: "Blocked records", cell: ({ row }) => <DrillLink href="/insights/impact">{row.original.record_count}</DrillLink> },
  { accessorKey: "value_at_risk", header: "Value at risk", cell: ({ row }) => plain(row.original.value_at_risk) },
];

const ownerColumns: ColumnDef<OwnerCardResponse>[] = [
  { accessorKey: "owner", header: "Owner" },
  { accessorKey: "score", header: "Score", cell: ({ row }) => <DrillLink href="/insights/owners">{row.original.score}</DrillLink> },
  { accessorKey: "delta", header: "Change", cell: ({ row }) => <Delta value={row.original.delta} /> },
];

export default function ExecPage() {
  const search = useSearchParams();
  const run = search.get("run") ?? undefined;
  const dayOne = useDayOne();

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: queryKeys.insights("exec", run),
    queryFn: () => getExec({ version_id: run }),
  });
  const runLabel = useRunLabel(data?.version_id);

  const cost = useQuery({ queryKey: queryKeys.insights("proven-cost", run), queryFn: () => getProvenCost({ version_id: run }) });
  const currency = cost.data?.currency;
  const roi = useQuery({ queryKey: ["roi"], queryFn: getRoi });
  const state: "loading" | "empty" | "error" | undefined = isLoading || dayOne.status === "loading"
    ? "loading"
    : isListFailure({ isError, error })
      ? "error"
      : data && data.readiness_cells.length === 0 && data.impact_rows.length === 0 && data.owner_rows.length === 0
        ? "empty"
        : undefined;

  const exportHref = data?.version_id ? `/api/v1/reports/executive/${data.version_id}.pdf` : undefined;
  const noGo = data?.readiness_cells.filter((c) => c.verdict === "no_go").length ?? 0;
  const owners = data?.owner_rows ?? [];
  const up = owners.filter((o) => o.delta > 0).length;
  const down = owners.filter((o) => o.delta < 0).length;
  const wf = data?.waterfall ?? [];
  const topRisk = data ? largestValueAtRisk(valueAtRiskByL1(data.impact_rows)) : null;

  return (
    <InsightFrame
      title="Executive summary"
      meta={runLabel}
      actions={
        exportHref ? (
          <Button variant="primary" onClick={() => void downloadAuthenticated(exportHref, `executive_${data?.version_id}.pdf`)}>
            Executive report (PDF)
          </Button>
        ) : undefined
      }
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
      {wf.length > 0 && (
        <Card title="Score movement">
          <Waterfall data={wf} label="Score movement" />
          <p className="mt-2 m-text-body" style={{ color: "var(--m-ink-2)" }}>{`From ${wf[0].x} to ${wf[wf.length - 1].x}.`}</p>
        </Card>
      )}
      <Card title="Return on investment">
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
      <Card title="Readiness by wave">
        <DataTable columns={readinessColumns} data={data?.readiness_cells ?? []} getRowId={(row) => `${row.module}-${row.wave}`} hideToolbar dense height="auto" />
      </Card>
      <Card title="Features at risk">
        <DataTable columns={impactColumns} data={data?.impact_rows ?? []} getRowId={(row) => row.feature} hideToolbar dense height="auto" />
      </Card>
      <Card title="Owners">
        <DataTable columns={ownerColumns} data={data?.owner_rows ?? []} getRowId={(row) => row.owner} hideToolbar dense height="auto" />
      </Card>
    </InsightFrame>
  );
}
