"use client";

import { isAxiosError } from "axios";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Button, DataTable, EmptyState, ErrorState, Pill, ReportPage, type PillTone } from "@/design";
import { getRunSteps, type RunStep } from "@/lib/api/v1/runs";
import { apiErrorMessage } from "@/lib/error";
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
  const { systemId, runId } = useParams<{ systemId: string; runId: string }>();

  const steps = useQuery({
    queryKey: [...queryKeys.run(runId), "steps"],
    queryFn: () => getRunSteps(runId),
  });

  if (steps.isError) {
    if (isAxiosError(steps.error) && steps.error.response?.status === 404) {
      return (
        <EmptyState
          title="Extraction not found."
          detail="This run id does not exist for this system."
          action={<Button render={<Link href={`/systems/${systemId}`}>Back to system</Link>} />}
        />
      );
    }
    return <ErrorState message={apiErrorMessage(steps.error)} onRetry={() => steps.refetch()} />;
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
