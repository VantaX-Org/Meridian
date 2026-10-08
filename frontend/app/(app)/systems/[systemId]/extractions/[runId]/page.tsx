"use client";

import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable, ErrorState, Pill, ReportPage, type PillTone } from "@/design";
import { getRunSteps, type RunStep } from "@/lib/api/v1/runs";
import { labelOf } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";

const STATUS_TONE: Record<string, PillTone> = {
  failed: "no-go",
  ok: "go",
  complete: "go",
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
];

export default function ExtractionPage() {
  const { runId } = useParams<{ systemId: string; runId: string }>();

  const steps = useQuery({
    queryKey: [...queryKeys.run(runId), "steps"],
    queryFn: () => getRunSteps(runId),
  });

  if (steps.isError) {
    return (
      <ErrorState
        message={`Couldn't load this extraction. ${steps.error?.message ?? ""}`.trim()}
        onRetry={() => steps.refetch()}
      />
    );
  }

  const stepRows = steps.data?.steps ?? [];
  const failedStep = stepRows.find((step) => step.status === "failed" && step.error_detail);

  const narrative = (
    <>
      Extraction run <code>{runId}</code>.
      {failedStep ? (
        <div
          role="alert"
          className="mt-2 rounded border px-3 py-2 text-[13px]"
          style={{ borderColor: "var(--m-critical)", color: "var(--m-critical)" }}
        >
          {failedStep.step_name} failed: {failedStep.error_detail}
        </div>
      ) : null}
    </>
  );

  return (
    <ReportPage
      narrative={narrative}
      charts={null}
      tables={<DataTable columns={columns} data={stepRows} getRowId={(row) => String(row.step_number)} />}
      state={steps.isLoading ? "loading" : stepRows.length === 0 ? "empty" : undefined}
      emptyProps={{ title: "No step history for this extraction yet." }}
    />
  );
}
