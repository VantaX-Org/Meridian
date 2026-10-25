"use client";

/** One discovery run (process-discovery spec §7.3): stages, tables read, the failure and its retry. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, useRouter } from "next/navigation";
import type { ColumnDef } from "@tanstack/react-table";
import { PageHeader, Card, DataTable, ErrorState, InsightHeader, Mono, Notice, Pill, Status, useBreadcrumbTitle } from "@/design";
import { useJobs } from "@/hooks/use-jobs";
import { useRole } from "@/hooks/use-role";
import { ACTIVE_RUN, getCatalogue, getRun, startRuns } from "@/lib/api/process-discovery";
import { apiErrorMessage, apiErrorState } from "@/lib/error";
import { relativeTime } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";
import { BodySkeleton, PROCESS_PURPOSE, ProcessFrame, processMeta } from "../../_components/process-header";
import { CoveragePill, RunStatusPill } from "../../_components/coverage-pill";
import { fitnessTone, fmtCount, fmtFitness, fmtSeconds, l1Href, stageLabel } from "../../_components/shared";


type TableRow = { table: string; rows: number; partial: boolean; truncated: boolean };

/** The cause category of a failed run, from its error text. */
const causeOf = (e: string | null) =>
  !e ? "The run failed" : /RFC|connect|timeout|refused|unreachable/i.test(e) ? "Connection to SAP failed"
    : /extract|read failed|table/i.test(e) ? "Extraction failed" : /licen[cs]e/i.test(e) ? "Licence refused the run" : "The run failed";

const TABLE_COLUMNS: ColumnDef<TableRow>[] = [
  { accessorKey: "table", header: "Table", cell: ({ row }) => <Mono>{row.original.table}</Mono> },
  { accessorKey: "rows", header: "Rows", cell: ({ row }) => fmtCount(row.original.rows) },
  { id: "state", header: "State", cell: ({ row }) => (
      <span className="flex gap-1">
        {row.original.partial && <Pill tone="at-risk">Partial</Pill>}
        {row.original.truncated && <Pill tone="at-risk">Truncated</Pill>}
        {!row.original.partial && !row.original.truncated && <Status kind="lifecycle" value="done" />}
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
  const sysId = run.data?.system_id;
  const catalogue = useQuery({
    queryKey: queryKeys.processCatalogue(sysId ?? ""),
    queryFn: () => getCatalogue(sysId!),
    enabled: !!sysId,
  });
  const retry = useMutation({
    mutationFn: () => startRuns(run.data!.system_id, { l1s: [run.data!.l1], mode: "full" }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["process"] });
      if (res.run_ids[0]) router.push(`/process/runs/${res.run_ids[0]}`);
    },
  });

  const runName = run.data ? catalogue.data?.find((c) => c.l1 === run.data!.l1)?.name ?? run.data.l1 : null;
  useBreadcrumbTitle(runName ? { label: `${runName} discovery run`, parent: { label: "Discovery runs", href: sysId ? `/process/runs?system=${encodeURIComponent(sysId)}` : "/process/runs" } } : null);
  if (run.isError) return <ProcessFrame><ErrorState {...apiErrorState(run.error)} onRetry={() => run.refetch()} /></ProcessFrame>;
  if (!run.data) return <ProcessFrame><PageHeader title="Discovery run" meta={processMeta(PROCESS_PURPOSE.run)} /><BodySkeleton rows={4} /></ProcessFrame>;
  const r = run.data;
  const name = catalogue.data?.find((c) => c.l1 === r.l1)?.name ?? r.l1;
  const job = jobs.find((j) => j.id === r.job_id);
  const s = r.stats;
  const truncated = new Set(s.truncated_tables ?? []);
  const tables: TableRow[] = Object.entries(s.tables ?? {})
    .map(([table, t]) => ({ table, rows: t.rows, partial: t.partial, truncated: truncated.has(table) }));
  const fitness = s.conformance?.fitness ?? null;
  const active = ACTIVE_RUN.has(r.status);
  const canRun = can("run_process_discovery");

  return (
    <ProcessFrame>
      <PageHeader title={name}
        meta={processMeta(PROCESS_PURPOSE.run, <><Mono>{r.l1}</Mono> {active && stageLabel(job)
          ? `${stageLabel(job)}, ${Math.round(job?.percent ?? 0)}%` : `started ${relativeTime(r.started_at)}`}</>)}
        status={<><RunStatusPill status={r.status} />{r.coverage && <CoveragePill coverage={r.coverage} />}</>} />
      <InsightHeader
        situation={{ sentence: `${name}, ${r.mode === "incremental" ? "incremental" : "full"} run, ${active ? "in progress" : r.status === "completed" ? "finished" : r.status}.`,
          tone: r.status === "failed" ? "no-go" : r.status === "completed" ? "go" : "neutral" }}
        changed={{ sentence: r.finished_at ? `Finished ${relativeTime(r.finished_at)}.` : `Started ${relativeTime(r.started_at)}.` }}
        why={r.status === "completed" && r.coverage !== "reference"
          ? { sentence: `${fmtCount(s.cases)} cases, ${fmtFitness(fitness)} fit with the SAP reference, a typical case takes ${fmtSeconds(s.throughput?.median_seconds)}.`,
              tone: fitnessTone(fitness) }
          : { sentence: r.status === "failed" ? "No model was produced." : "Figures appear once the run completes." }}
        next={r.status === "completed"
          ? { sentence: `Read how ${name} really runs.`,
              action: { label: `Open ${name}`, href: l1Href(r.l1, r.system_id, r.coverage === "reference" ? undefined : r.id) } }
          : r.status === "failed"
            ? (canRun
              ? { sentence: "Fix the cause, then run the process again.", action: { label: retry.isPending ? "Starting" : "Retry", onClick: () => { if (!retry.isPending) retry.mutate(); } } }
              : { sentence: "Ask a process analyst to run it again." })
            : { sentence: "Leave this page open or come back later; the run continues in the background." }}
      />
      {r.status === "failed" && (
        <ErrorState title={causeOf(r.error)} message={r.error ?? "The run failed without a message."} />
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
                <Status kind="lifecycle" value={st.status} />
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
    </ProcessFrame>
  );
}
