"use client";

import { isAxiosError } from "axios";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Bar, Button, DataTable, EmptyState, ErrorState, ExportMenu, Mono, Notice, Pill, ReportPage, type PillTone } from "@/design";
import { JobProgress } from "@/design/shell/JobProgress";
import { RunProgressBanner } from "@/components/run-progress-banner";
import { getJob } from "@/lib/api/jobs";
import { exportRunSteps, getRunSteps, type RunStep } from "@/lib/api/v1/runs";
import { apiErrorState } from "@/lib/error";
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
  const job = useQuery({
    queryKey: [...queryKeys.run(runId), "job"],
    queryFn: () => getJob(`dl-${runId}`),
    retry: false,
    refetchInterval: (q) => (q.state.data?.status === "queued" || q.state.data?.status === "running" ? 2000 : false),
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
    return <ErrorState {...apiErrorState(steps.error)} onRetry={() => steps.refetch()} />;
  }

  const stepRows = steps.data?.steps ?? [];
  const failedStep = stepRows.find((step) => step.status === "failed" && step.error_detail);

  const liveJob = job.data;
  const activeJob = liveJob && (liveJob.status === "queued" || liveJob.status === "running") ? liveJob : null;
  const runningStage = activeJob?.stages?.find((s) => s.status === "running")?.label;

  const narrative = (
    <>
      Extraction run <Mono>{runId}</Mono>
      {activeJob ? (
        <>
          <RunProgressBanner
            percent={activeJob.percent}
            label={activeJob.status === "queued" ? "Extraction queued" : "Extraction running"}
            step={runningStage ?? activeJob.message}
            detail={
              activeJob.rows_total > 0
                ? `${activeJob.rows_done.toLocaleString()} / ${activeJob.rows_total.toLocaleString()} rows`
                : activeJob.message
            }
          />
          <JobProgress job={activeJob} />
        </>
      ) : null}
      {failedStep ? (
        <Notice tone="danger">{failedStep.step_name} failed: {failedStep.error_detail}</Notice>
      ) : null}
    </>
  );

  return (
    <ReportPage
      narrative={narrative}
      exportMenu={stepRows.length > 0 ? <ExportMenu options={[{ format: "xlsx", run: () => exportRunSteps(runId, "xlsx") }]} /> : undefined}
      charts={
        stepRows.some((st) => st.duration_ms != null) ? (
          <Bar
            label="Step durations in seconds"
            height={Math.max(120, stepRows.length * 36)}
            data={stepRows.flatMap((st) => (st.duration_ms == null ? [] : [{ x: st.step_name, y: Number((st.duration_ms / 1000).toFixed(1)) }]))}
          />
        ) : null
      }
      tables={<DataTable columns={columns} data={stepRows} getRowId={(row) => String(row.step_number)} />}
      state={steps.isLoading ? "loading" : stepRows.length === 0 ? "empty" : undefined}
      emptyProps={{ title: "No step history for this extraction yet." }}
    />
  );
}
