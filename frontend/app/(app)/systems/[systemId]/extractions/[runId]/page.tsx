"use client";

import { isAxiosError } from "axios";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Bar, Button, DataTable, EmptyState, ErrorState, ExportMenu, Notice, ReportPage, Skeleton, Status } from "@/design";
import { runName } from "@/lib/run-scope";
import { JobProgress } from "@/design/shell/JobProgress";
import { RunProgressBanner } from "@/components/run-progress-banner";
import { getJob } from "@/lib/api/jobs";
import { exportRunSteps, getRunSteps, type RunStep } from "@/lib/api/v1/runs";
import { getVersion } from "@/lib/api/versions";
import { apiErrorState } from "@/lib/error";
import { formatDate } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";

// A run repeats a step per object, so a step is named by its number and when it started.
const stepId = (st: RunStep, i: number) => `${st.step_number}-${st.started_at}-${i}`;
/** Chart labels: a step that repeats (once per object) is numbered, "Running data quality checks 2". */
const stepLabels = (steps: RunStep[]): string[] => {
  const total = new Map<string, number>(), seen = new Map<string, number>();
  for (const st of steps) total.set(st.step_name, (total.get(st.step_name) ?? 0) + 1);
  return steps.map((st) => {
    const n = (seen.get(st.step_name) ?? 0) + 1;
    seen.set(st.step_name, n);
    return (total.get(st.step_name) ?? 0) > 1 ? `${st.step_name} ${n}` : st.step_name;
  });
};

const columns: ColumnDef<RunStep>[] = [
  { accessorKey: "started_at", header: "Started", cell: ({ row }) => formatDate(row.original.started_at, "seconds") },
  { accessorKey: "step_name", header: "Step" },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => <Status kind="lifecycle" value={row.original.status} />,
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
  const version = useQuery({ queryKey: ["version", runId], queryFn: () => getVersion(runId), retry: false });
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
          title="Extraction not found"
          detail="This run does not exist for this system."
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

  const v = version.data;
  const narrative = (
    <>
      {v ? <>Extracted {formatDate(v.run_at, "datetime")}, run {runName(v)}.</> : version.isPending ? <Skeleton width={240} height={20} /> : <>The run of this extraction could not be read.</>}
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
        <Notice
          tone="danger"
          action={
            <>
              <Button variant="secondary" render={<Link href={`/systems/${systemId}?tab=health`}>Test connection</Link>} />
              <Button variant="secondary" render={<Link href={`/systems/${systemId}?extract=1`}>Extract again</Link>} />
            </>
          }
        >
          {failedStep.step_name} failed: {failedStep.error_detail}
        </Notice>
      ) : null}
    </>
  );

  return (
    <ReportPage
      title="Extraction"
      meta={v ? <Status kind="lifecycle" value={v.status} /> : undefined}
      narrative={narrative}
      exportMenu={stepRows.length > 0 ? <ExportMenu options={[{ format: "xlsx", run: () => exportRunSteps(runId, "xlsx") }]} /> : undefined}
      charts={
        stepRows.some((st) => st.duration_ms != null) ? (
          <Bar
            label="Step durations in seconds"
            height={Math.max(120, stepRows.length * 36)}
            data={stepRows.flatMap((st, i) => (st.duration_ms == null ? [] : [{ x: stepLabels(stepRows)[i], y: Number((st.duration_ms / 1000).toFixed(1)) }]))}
          />
        ) : null
      }
      tables={<DataTable columns={columns} data={stepRows} getRowId={(row) => stepId(row, stepRows.indexOf(row))} />}
      state={steps.isLoading ? "loading" : stepRows.length === 0 ? "empty" : undefined}
      emptyProps={{
        title: "No step history yet",
        detail: "Steps appear here as the extraction runs.",
        action: <Button variant="secondary" render={<Link href={`/systems/${systemId}`}>Back to system</Link>} />,
      }}
    />
  );
}
