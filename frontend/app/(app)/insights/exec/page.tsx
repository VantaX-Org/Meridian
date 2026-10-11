// frontend/app/(app)/insights/exec/page.tsx
"use client";

import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Button, Card, DataTable, DrillLink, ExportMenu, Pill, ReportPage, Skeleton, Stat, Waterfall, type PillTone } from "@/design";
import { getRoi } from "@/lib/api/analytics";
import { downloadAuthenticated } from "@/lib/api/download";
import { getExec, type ImpactRow, type OwnerCardResponse, type ReadinessCell } from "@/lib/api/insights";
import { apiErrorMessage, isListFailure } from "@/lib/error";
import { queryKeys } from "@/lib/query-keys";
import { useDayOne, DayOneAction } from "@/hooks/use-day-one";

const VERDICT_TONE: Record<ReadinessCell["verdict"], PillTone> = {
  go: "go",
  at_risk: "at-risk",
  no_go: "no-go",
};

const readinessColumns: ColumnDef<ReadinessCell>[] = [
  { accessorKey: "module", header: "Object" },
  { accessorKey: "wave", header: "Wave" },
  {
    accessorKey: "verdict",
    header: "Verdict",
    cell: ({ row }) => <Pill tone={VERDICT_TONE[row.original.verdict]}>{row.original.verdict}</Pill>,
  },
  {
    accessorKey: "blocker_count",
    header: "Blockers",
    cell: ({ row }) => <DrillLink object={row.original.module} filters={{ blocking: "true" }}>{row.original.blocker_count}</DrillLink>,
  },
];

const impactColumns: ColumnDef<ImpactRow>[] = [
  { accessorKey: "feature", header: "Feature" },
  { accessorKey: "status", header: "Status" },
  { accessorKey: "record_count", header: "Blocked records", cell: ({ row }) => <DrillLink href="/insights/impact">{row.original.record_count}</DrillLink> },
  { accessorKey: "value_at_risk", header: "Value at risk", cell: ({ row }) => row.original.value_at_risk.toLocaleString() },
];

const ownerColumns: ColumnDef<OwnerCardResponse>[] = [
  { accessorKey: "owner", header: "Owner" },
  { accessorKey: "score", header: "Score", cell: ({ row }) => <DrillLink href="/insights/owners">{row.original.score}</DrillLink> },
  { accessorKey: "delta", header: "Delta" },
];

export default function ExecPage() {
  const search = useSearchParams();
  const run = search.get("run") ?? undefined;
  const dayOne = useDayOne();

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: queryKeys.insights("exec", run),
    queryFn: () => getExec({ version_id: run }),
  });

  const roi = useQuery({ queryKey: ["roi"], queryFn: getRoi });
  const state: "loading" | "empty" | "error" | undefined = isLoading || dayOne.status === "loading"
    ? "loading"
    : isListFailure({ isError, error })
      ? "error"
      : data && data.readiness_cells.length === 0 && data.impact_rows.length === 0 && data.owner_rows.length === 0
        ? "empty"
        : undefined;

  const exportHref = data?.version_id ? `/api/v1/reports/executive/${data.version_id}.pdf` : undefined;

  return (
    <ReportPage
      narrative={data?.narrative ?? ""}
      exportMenu={
        exportHref ? (
          <ExportMenu
            options={[{ format: "pdf", run: () => downloadAuthenticated(exportHref, `executive_${data?.version_id}.pdf`) }]}
          />
        ) : undefined
      }
      charts={<Waterfall data={data?.waterfall ?? []} />}
      tables={
        <div className="flex flex-col gap-6">
          {(roi.isLoading || roi.isError) && (
            <Card title="Return on investment">
              {roi.isLoading ? (
                <Skeleton height={48} />
              ) : (
                <div className="flex items-center gap-3 text-[13px]" role="alert">
                  <span>Return on investment did not load. {apiErrorMessage(roi.error)}</span>
                  <Button variant="secondary" onClick={() => void roi.refetch()}>Retry</Button>
                </div>
              )}
            </Card>
          )}
          {roi.data && (
            <Card title="Return on investment">
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <Stat label="ROI multiple" value={`${roi.data.roi.roi_multiple}x`} />
                <Stat label="Payback" value={`${roi.data.roi.payback_months} months`} />
                <Stat label="Risk mitigated" value={roi.data.roi.risk_mitigated.toLocaleString()} />
                <Stat label="Annual subscription" value={roi.data.roi.subscription_annual.toLocaleString()} />
              </div>
            </Card>
          )}
          <DataTable columns={readinessColumns} data={data?.readiness_cells ?? []} getRowId={(row) => `${row.module}-${row.wave}`} />
          <DataTable columns={impactColumns} data={data?.impact_rows ?? []} getRowId={(row) => row.feature} />
          <DataTable columns={ownerColumns} data={data?.owner_rows ?? []} getRowId={(row) => row.owner} />
        </div>
      }
      state={state}
      emptyProps={{
        title: "No executive summary data for this run yet.",
        detail: dayOne.step?.detail,
        action: <DayOneAction step={dayOne.step} fallbackHref="/runs" fallbackLabel="Open runs" />,
      }}
      errorProps={{
        message: apiErrorMessage(error),
        onRetry: () => refetch(),
      }}
    />
  );
}
