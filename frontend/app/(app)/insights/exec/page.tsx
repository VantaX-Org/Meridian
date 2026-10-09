// frontend/app/(app)/insights/exec/page.tsx
"use client";

import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable, Pill, ReportPage, Waterfall, type PillTone } from "@/design";
import { getExec, type ImpactRow, type OwnerCardResponse, type ReadinessCell } from "@/lib/api/insights";
import { apiErrorMessage } from "@/lib/error";
import { queryKeys } from "@/lib/query-keys";

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
  { accessorKey: "blocker_count", header: "Blockers" },
];

const impactColumns: ColumnDef<ImpactRow>[] = [
  { accessorKey: "feature", header: "Feature" },
  { accessorKey: "status", header: "Status" },
  { accessorKey: "record_count", header: "Blocked records" },
  { accessorKey: "value_at_risk", header: "Value at risk", cell: ({ row }) => row.original.value_at_risk.toLocaleString() },
];

const ownerColumns: ColumnDef<OwnerCardResponse>[] = [
  { accessorKey: "owner", header: "Owner" },
  { accessorKey: "score", header: "Score" },
  { accessorKey: "delta", header: "Delta" },
];

export default function ExecPage() {
  const search = useSearchParams();
  const run = search.get("run") ?? undefined;

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: queryKeys.insights("exec", run),
    queryFn: () => getExec({ version_id: run }),
  });

  const state: "loading" | "empty" | "error" | undefined = isLoading
    ? "loading"
    : isError
      ? "error"
      : data && data.readiness_cells.length === 0 && data.impact_rows.length === 0 && data.owner_rows.length === 0
        ? "empty"
        : undefined;

  // ReportPage's onExport is a callback with no href, so it cannot render a
  // link whose href the test can assert against. Rendering a plain anchor
  // here (in the charts slot) is a documented deviation from the brief's
  // exportAction={{label, href}} prop, which does not exist on ReportPage.
  const exportHref = data?.version_id ? `/api/v1/reports/executive/${data.version_id}.pdf` : undefined;

  return (
    <ReportPage
      narrative={data?.narrative ?? ""}
      charts={
        <div className="flex flex-col gap-3">
          {exportHref && (
            <a
              href={exportHref}
              className="self-end text-[13px] underline"
              style={{ color: "var(--m-accent)" }}
            >
              Export PDF
            </a>
          )}
          <Waterfall data={data?.waterfall ?? []} />
        </div>
      }
      tables={
        <div className="flex flex-col gap-6">
          <DataTable columns={readinessColumns} data={data?.readiness_cells ?? []} getRowId={(row) => `${row.module}-${row.wave}`} />
          <DataTable columns={impactColumns} data={data?.impact_rows ?? []} getRowId={(row) => row.feature} />
          <DataTable columns={ownerColumns} data={data?.owner_rows ?? []} getRowId={(row) => row.owner} />
        </div>
      }
      state={state}
      emptyProps={{ title: "No executive summary data for this run yet." }}
      errorProps={{
        message: apiErrorMessage(error),
        onRetry: () => refetch(),
      }}
    />
  );
}
