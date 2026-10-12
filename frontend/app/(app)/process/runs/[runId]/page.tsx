"use client";

/** One discovery run (process-discovery spec §7.3): stages, tables read, the failure and its retry. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { PageHeader, Card, DataTable, ErrorState, InsightHeader, Mono, Notice, Pill, type PillTone } from "@/design";
import { useJobs } from "@/hooks/use-jobs";
import { useRole } from "@/hooks/use-role";
import { ACTIVE_RUN, getRun, startRuns } from "@/lib/api/process-discovery";
import { apiErrorMessage } from "@/lib/error";
import { relativeTime } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";
import type { JobStageStatus } from "@/types/jobs";
import { ProcessSkeleton } from "../../_components/process-header";
import { CoveragePill, RunStatusPill } from "../../_components/coverage-pill";
import { fitnessTone, fmtCount, fmtFitness, fmtSeconds, l1Href, stageLabel } from "../../_components/shared";

const STAGE: Record<JobStageStatus, { tone: PillTone; label: string }> = {
  queued: { tone: "neutral", label: "Queued" },
  running: { tone: "info", label: "Running" },
  done: { tone: "go", label: "Done" },
  failed: { tone: "no-go", label: "Failed" },
  skipped: { tone: "neutral", label: "Skipped" },
};

type TableRow = { table: string; rows: number; partial: boolean; truncated: boolean };

const TABLE_COLUMNS: ColumnDef<TableRow>[] = [
  { accessorKey: "table", header: "Table", cell: ({ row }) => <Mono>{row.original.table}</Mono> },
  { accessorKey: "rows", header: "Rows", cell: ({ row }) => fmtCount(row.original.rows) },
  { id: "state", header: "State", cell: ({ row }) => (
      <span className="flex gap-1">
        {row.original.partial && <Pill tone="at-risk">Partial</Pill>}
        {row.original.truncated && <Pill tone="at-risk">Truncated</Pill>}
        {!row.original.partial && !row.original.truncated && <Pill tone="go">Complete</Pill>}
      </span>
    ) },
];

export default function ProcessRunPage() {
  const { runId } = useParams<{ runId: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const { jobs } = useJobs();
  const { can } = useRole();
  const run = useQuery({
    queryKey: queryKeys.processRun(runId),
    queryFn: () => getRun(runId),
    refetchInterval: (q) => (q.state.data && ACTIVE_RUN.has(q.state.data.status) ? 5_000 : false),
  });
  const retry = useMutation({
    mutationFn: () => startRuns(run.data!.system_id, { l1s: [run.data!.l1], mode: "full" }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["process"] });
      if (res.run_ids[0]) router.push(`/process/runs/${res.run_ids[0]}`);
    },
  });

  const frame = "mx-auto grid w-full gap-4";
  const pad = { padding: "var(--m-page-pad)", maxWidth: "var(--m-page-max)" };
  if (run.isError) return <div className={frame} style={pad}><ErrorState message={apiErrorMessage(run.error)} onRetry={() => run.refetch()} /></div>;
  if (!run.data) return <div className={frame} style={pad}><ProcessSkeleton rows={4} /></div>;
  const r = run.data;
  const job = jobs.find((j) => j.id === r.job_id);
  const s = r.stats;
  const truncated = new Set(s.truncated_tables ?? []);
  const tables: TableRow[] = Object.entries(s.tables ?? {})
    .map(([table, t]) => ({ table, rows: t.rows, partial: t.partial, truncated: truncated.has(table) }));
  const fitness = s.conformance?.fitness ?? null;
  const active = ACTIVE_RUN.has(r.status);
  const canRun = can("run_process_discovery");

  return (
    <div className={frame} style={pad}>
      <PageHeader title={`${r.l1} discovery run`} meta={active && stageLabel(job)
          ? `${stageLabel(job)}${job ? ` · ${Math.round(job.percent)}%` : ""}` : `Started ${relativeTime(r.started_at)}`}
        status={<><RunStatusPill status={r.status} />{r.coverage && <CoveragePill coverage={r.coverage} />}</>} />
      <InsightHeader
        situation={{ sentence: `${r.l1} ${r.mode === "incremental" ? "incremental" : "full"} run, ${active ? "in progress" : r.status}.`,
          tone: r.status === "failed" ? "no-go" : r.status === "completed" ? "go" : "neutral" }}
        changed={{ sentence: r.finished_at ? `Finished ${relativeTime(r.finished_at)}.` : `Started ${relativeTime(r.started_at)}.` }}
        why={r.status === "completed" && r.coverage !== "reference"
          ? { sentence: `${fmtCount(s.cases)} cases, fitness ${fmtFitness(fitness)}, median ${fmtSeconds(s.throughput?.median_seconds)}.`,
              tone: fitnessTone(fitness) }
          : { sentence: r.status === "failed" ? "No model was produced." : "Figures appear once the run completes." }}
        next={r.status === "completed"
          ? { sentence: `Read the as-is ${r.l1} flow.`,
              action: { label: `Open ${r.l1}`, href: l1Href(r.l1, r.system_id, r.coverage === "reference" ? undefined : r.id) } }
          : r.status === "failed"
            ? (canRun
              ? { sentence: "Fix the cause, then run the process again.", action: { label: "Retry", onClick: () => retry.mutate() } }
              : { sentence: "Ask a process analyst to run it again." })
            : { sentence: "Leave this page open or come back later; the run continues in the background." }}
      />
      {r.status === "failed" && (
        <ErrorState message={r.error ?? "The run failed without a message."} onRetry={canRun ? () => retry.mutate() : undefined} />
      )}
      {retry.isError && <Notice tone="danger" title="Could not start the retry">{apiErrorMessage(retry.error)}</Notice>}
      {r.coverage === "reference" && s.reason && (
        <Notice tone="info" title="Reference only, not discovered">{s.reason}</Notice>
      )}
      {job && (
        <Card title="Stages" padding="sm">
          <ol className="grid gap-1">
            {job.stages.map((st) => (
              <li key={st.id} className="flex items-center justify-between">
                <span>{st.label}</span>
                <Pill tone={STAGE[st.status].tone}>{STAGE[st.status].label}</Pill>
              </li>
            ))}
          </ol>
        </Card>
      )}
      {tables.length > 0 && (
        <Card title="Tables read" padding="sm">
          <DataTable columns={TABLE_COLUMNS} data={tables} getRowId={(t) => t.table} height="auto" hideToolbar
            tableId="process-run-tables" exportName={`process-run-${r.id}-tables`} />
        </Card>
      )}
    </div>
  );
}
