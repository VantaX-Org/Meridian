// frontend/app/(app)/runs/[versionId]/page.tsx
"use client";

import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable, ErrorState, Pill, ReportPage, type PillTone } from "@/design";
import { getRunSteps, type RunStep } from "@/lib/api/v1/runs";
import { getVersion } from "@/lib/api/versions";
import { formatDate, labelOf } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";

const STATUS_TONE: Record<string, PillTone> = {
  failed: "no-go",
  agents_failed: "no-go",
  complete: "go",
  agents_complete: "go",
  ai_enriched: "go",
};

const statusTone = (status: string): PillTone => STATUS_TONE[status] ?? "at-risk";

const columns: ColumnDef<RunStep>[] = [
  { accessorKey: "step_number", header: "#" },
  { accessorKey: "step_name", header: "Step" },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => <Pill tone={statusTone(row.original.status)}>{labelOf(row.original.status)}</Pill>,
  },
  {
    accessorKey: "duration_ms",
    header: "Duration",
    cell: ({ row }) => (row.original.duration_ms == null ? "—" : `${(row.original.duration_ms / 1000).toFixed(1)}s`),
  },
  {
    id: "error",
    header: "Error",
    cell: ({ row }) => (row.original.error_detail ? <p role="alert">{row.original.error_detail}</p> : "—"),
  },
];

export default function RunDetailPage() {
  const { versionId } = useParams<{ versionId: string }>();

  const version = useQuery({ queryKey: queryKeys.run(versionId), queryFn: () => getVersion(versionId) });
  const steps = useQuery({
    queryKey: [...queryKeys.run(versionId), "steps"],
    queryFn: () => getRunSteps(versionId),
  });

  if (version.isError || steps.isError) {
    const failed = version.isError ? version : steps;
    return (
      <ErrorState
        message={`Couldn't load this run. ${failed.error?.message ?? ""}`.trim()}
        onRetry={() => {
          if (version.isError) version.refetch();
          if (steps.isError) steps.refetch();
        }}
      />
    );
  }

  const isLoading = version.isLoading || steps.isLoading;
  const stepRows = steps.data?.steps ?? [];
  const narrative = version.data ? (
    <>
      {version.data.label ?? versionId} — started {formatDate(version.data.run_at, "datetime")}.{" "}
      <Pill tone={statusTone(version.data.status)}>{labelOf(version.data.status)}</Pill>
    </>
  ) : (
    "Loading this run..."
  );

  return (
    <ReportPage
      narrative={narrative}
      charts={null}
      tables={<DataTable columns={columns} data={stepRows} getRowId={(row) => String(row.step_number)} />}
      state={isLoading ? "loading" : stepRows.length === 0 ? "empty" : undefined}
      emptyProps={{ title: "No step history for this run yet." }}
    />
  );
}
