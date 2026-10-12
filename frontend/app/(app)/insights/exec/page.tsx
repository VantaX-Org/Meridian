// frontend/app/(app)/insights/exec/page.tsx
"use client";

import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Button, Card, DataTable, DrillLink, Delta, Pill, Skeleton, Stat, Waterfall, type PillTone } from "@/design";
import { getRoi } from "@/lib/api/analytics";
import { downloadAuthenticated } from "@/lib/api/download";
import { getExec, type ImpactRow, type OwnerCardResponse, type ReadinessCell } from "@/lib/api/insights";
import { labelOf } from "@/lib/format";
import { apiErrorMessage, isListFailure } from "@/lib/error";
import { queryKeys } from "@/lib/query-keys";
import { useDayOne, DayOneAction } from "@/hooks/use-day-one";
import { InsightFrame, useRunLabel } from "../_components/InsightFrame";

const VERDICT_TONE: Record<ReadinessCell["verdict"], PillTone> = {
  go: "go",
  at_risk: "at-risk",
  no_go: "no-go",
};

const VERDICT_LABEL: Record<ReadinessCell["verdict"], string> = { go: "Go", at_risk: "At risk", no_go: "No-go" };

const money = (n: number) => n.toLocaleString("en-ZA", { maximumFractionDigits: 0 });

const readinessColumns: ColumnDef<ReadinessCell>[] = [
  { accessorKey: "module", header: "Object" },
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
  { accessorKey: "feature", header: "Feature" },
  { accessorKey: "status", header: "Status", cell: ({ row }) => <Pill tone="no-go">{labelOf(row.original.status)}</Pill> },
  { accessorKey: "record_count", header: "Blocked records", cell: ({ row }) => <DrillLink href="/insights/impact">{row.original.record_count}</DrillLink> },
  { accessorKey: "value_at_risk", header: "Value at risk", cell: ({ row }) => money(row.original.value_at_risk) },
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
  const atRisk = data?.impact_rows.reduce((s, r) => s + r.value_at_risk, 0) ?? 0;

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
        situation: { sentence: data?.narrative || `${noGo} no-go cells across the waves` , tone: noGo ? "no-go" : "go" },
        changed: { sentence: `${data?.readiness_cells.length ?? 0} cells tracked this run` },
        why: { sentence: `${money(atRisk)} value at risk`, href: "/insights/impact" },
        next: { sentence: noGo ? "Clear the no-go cells first" : "Share the report", action: { label: "Open readiness", href: "/insights/readiness" } },
      }}
      state={state}
      emptyProps={{
        title: "No executive summary yet",
        detail: dayOne.step?.detail ?? "It appears once a run has finished analysing.",
        action: <DayOneAction step={dayOne.step} fallbackHref="/runs" fallbackLabel="Open runs" />,
      }}
      errorProps={{ message: apiErrorMessage(error), onRetry: () => void refetch() }}
    >
      <Card title="Readiness trend">
        <Waterfall data={data?.waterfall ?? []} />
        <p className="mt-2 text-[13px]" style={{ color: "var(--m-ink-2)" }}>Waterfall of score movement from the baseline to this run.</p>
      </Card>
      <Card title="Return on investment">
        {roi.isLoading ? (
          <Skeleton height={48} />
        ) : roi.isError ? (
          <div className="flex items-center gap-3 text-[13px]" role="alert">
            <span>Return on investment did not load. {apiErrorMessage(roi.error)}</span>
            <Button variant="secondary" onClick={() => void roi.refetch()}>Retry</Button>
          </div>
        ) : roi.data ? (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="ROI multiple" value={`${roi.data.roi.roi_multiple}x`} />
            <Stat label="Payback" value={`${roi.data.roi.payback_months} months`} />
            <Stat label="Risk mitigated" value={money(roi.data.roi.risk_mitigated)} />
            <Stat label="Annual subscription" value={money(roi.data.roi.subscription_annual)} />
          </div>
        ) : null}
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
