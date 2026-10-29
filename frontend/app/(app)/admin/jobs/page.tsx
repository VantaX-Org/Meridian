"use client";

/** Admin › Jobs: history of extractions, analyses, uploads and simulations. */

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";
import { DataTable, DisabledJobAction, ExplorerPage, PageHeader, RetryJobButton, Status, asyncStateOf, retryAction } from "@/design";
import { SettingsTabs } from "@/components/admin/settings-tabs";
import { actionColumn, RowLink } from "@/components/mdm/ledger";
import { JobError } from "@/components/job-error";
import { useRole } from "@/hooks/use-role";
import { DayOneAction, useDayOne } from "@/hooks/use-day-one";
import { JOBS_HISTORY_QUERY_KEY } from "@/hooks/use-jobs";
import { getJobs } from "@/lib/api/jobs";
import { getSystems } from "@/lib/api/connectivity";
import { formatDate, formatDuration, formatInt, labelOf, zoneName } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";
import { explainJobError } from "@/lib/job-error";
import { TENANT_TIMEZONE_HREF, useTenantTimezone } from "@/lib/tenant-zone";
import type { Job, JobKind, JobStatus } from "@/types/jobs";

/** Where each kind of job's result lives, without a system or run to open. */
const JOB_HREF: Record<Job["kind"], string> = {
  extraction: "/systems", config_sync: "/systems", config_load: "/systems", analysis: "/runs",
  upload: "/import", simulation: "/fix/what-if", process_discovery: "/process/runs",
};
const SYSTEM_JOBS = new Set<Job["kind"]>(["extraction", "config_sync", "config_load"]);
const ACTIVE = new Set<JobStatus>(["queued", "running"]);
/** The job registry keeps the newest 200 per tenant (api/services/jobs.py INDEX_KEEP), so this page loads all it holds. */
const JOBS_KEPT = 200;

/**
 * The job's own place: its discovery run, its extraction log or system Health tab, its run, else the page of its kind.
 * A discovery job (`pd-<first run id>`, api/routes/process_discovery.py) carries its queued run ids; its `version_id` is
 * the extraction it chained, not an analysis run, so it never opens `/runs`.
 */
function jobHref(j: Job): string {
  if (j.kind === "process_discovery") {
    const run = j.run_ids?.[0] ?? (j.id.startsWith("pd-") ? j.id.slice(3) : undefined);
    return run ? `/process/runs/${encodeURIComponent(run)}` : JOB_HREF.process_discovery;
  }
  if (j.kind === "extraction" && j.system_id && j.version_id) return `/systems/${j.system_id}/extractions/${j.version_id}`;
  if (SYSTEM_JOBS.has(j.kind) && j.system_id) return `/systems/${j.system_id}?tab=health${j.kind === "extraction" ? "" : "&part=config"}`;
  if (j.version_id) return `/runs/${j.version_id}`;
  return JOB_HREF[j.kind] ?? "/runs";
}
/** A failed extraction the retry endpoint cannot repeat (it carries no start request) is started again from its system's Extract drawer. */
const extractHref = (j: Job): string | null =>
  j.status === "failed" && j.kind === "extraction" && j.system_id && !retryAction(j) ? `/systems/${j.system_id}?extract=1` : null;

type StatusFilter = "all" | "failed" | "active" | "completed";
const STATUS_FILTERS: { value: StatusFilter; label: string; keep: (s: JobStatus) => boolean }[] = [
  { value: "all", label: "All", keep: () => true },
  { value: "failed", label: "Failed", keep: (s) => s === "failed" },
  { value: "active", label: "Running", keep: (s) => ACTIVE.has(s) },
  { value: "completed", label: "Succeeded", keep: (s) => s === "completed" },
];

/**
 * Rows the job read or checked: its own count, else (an extraction that only reported per table) the tables' sum.
 * A job that never reported a count shows an em dash, not a 0 that reads as "read nothing".
 */
function jobRows(j: Job): number | null {
  if (j.rows_done > 0) return j.rows_done;
  const tables = (j.tables ?? []).reduce((n, t) => n + (t.rows || 0), 0);
  if (tables > 0) return tables;
  return j.status === "completed" && j.kind === "extraction" ? 0 : null;
}

/** Wall time from start to finish, or to now while it runs, in ms; the job's times are unix seconds. */
function jobDuration(j: Job, now = Date.now() / 1000): number | null {
  const end = j.finished_at ?? (ACTIVE.has(j.status) ? now : null);
  return end != null && j.started_at ? Math.max(0, end - j.started_at) * 1000 : null;
}

function ExtractAgain({ job, href }: { job: Job; href: string }) {
  const { can, loading } = useRole();
  if (can("trigger_sync")) return <RowLink href={href} label={`Extract ${job.label} again`}>Extract again</RowLink>;
  if (loading) return null;
  return <DisabledJobAction action="trigger_sync" label={`Extract ${job.label} again`}>Extract again</DisabledJobAction>;
}

function Chips<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap items-center gap-2">
      <span className="m-text-meta m-ink-3">{label}</span>
      {options.map((o) => (
        <button key={o.value} type="button" className="m-choice" aria-pressed={value === o.value} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

export default function JobsPage() {
  const tz = useTenantTimezone();
  // No job yet: the empty state offers the tenant's next day-one step (connect, configure, extract), not one fixed link.
  const dayOne = useDayOne();
  const [status, setStatus] = useState<StatusFilter>("all");
  const [kind, setKind] = useState<JobKind | "all">("all");
  // The SSE stream patches this list too; the poll covers a dropped stream while anything is still queued or running.
  const q = useQuery({
    queryKey: JOBS_HISTORY_QUERY_KEY,
    queryFn: () => getJobs({ limit: JOBS_KEPT }),
    refetchInterval: (query) => (query.state.data?.some((j) => ACTIVE.has(j.status)) ? 5_000 : false),
  });
  const systemsQ = useQuery({ queryKey: queryKeys.systems(), queryFn: getSystems, meta: { ignoreError: true } });
  const systemName = useMemo(() => new Map((systemsQ.data ?? []).map((s) => [s.id, s.name])), [systemsQ.data]);
  const jobs = useMemo(() => q.data ?? [], [q.data]);
  const kinds = useMemo(() => [...new Set(jobs.map((j) => j.kind))].sort(), [jobs]);
  const keep = STATUS_FILTERS.find((f) => f.value === status)?.keep ?? (() => true);
  const shown = jobs.filter((j) => keep(j.status) && (kind === "all" || j.kind === kind));

  const columns = useMemo<ColumnDef<Job>[]>(() => {
    // The zone is named once in the header, so a cell is one line ("2 Oct 2026, 07:09"), not a wrapped "UTC".
    const when = (s: number) => formatDate(s * 1000, "datetime", tz, false);
    const zone = zoneName(tz);
    return [
      { accessorKey: "label", header: "Job" },
      { id: "system", header: "System", accessorFn: (j) => (j.system_id ? systemName.get(j.system_id) ?? "" : ""), cell: ({ getValue }) => getValue<string>() || "—" },
      { id: "kind", header: "Kind", accessorFn: (j) => j.kind, cell: ({ row }) => labelOf(row.original.kind) },
      { id: "status", header: "Status", cell: ({ row }) => <Status kind="lifecycle" value={row.original.status} /> },
      { id: "start", header: `Started (${zone})`, accessorFn: (j) => j.started_at, cell: ({ row }) => <span className="whitespace-nowrap">{when(row.original.started_at)}</span> },
      { id: "duration", header: "Duration", meta: { numeric: true }, accessorFn: (j) => jobDuration(j) ?? -1, cell: ({ row }) => formatDuration(jobDuration(row.original)) },
      { id: "rows", header: "Rows", meta: { numeric: true }, accessorFn: (j) => jobRows(j) ?? -1, cell: ({ row }) => formatInt(jobRows(row.original)) },
      {
        id: "msg", header: "Detail",
        cell: ({ row }) => explainJobError(row.original.status === "failed" ? row.original.error : null)?.summary ?? row.original.message ?? "—",
      },
      actionColumn((j) => {
        const again = extractHref(j);
        return (
          <span className="inline-flex items-center gap-3">
            <RowLink href={jobHref(j)} label={`Open ${j.label}`}>Open</RowLink>
            {again ? <ExtractAgain job={j} href={again} /> : <RetryJobButton job={j} />}
          </span>
        );
      }),
    ];
  }, [tz, systemName]);

  return (
    <ExplorerPage
      header={
        <PageHeader
          tabs={<SettingsTabs />}
          title="Jobs"
          meta={<>The newest {JOBS_KEPT} extractions, analyses, uploads and simulations, latest first; older jobs are not kept, and the filters apply to these. Times are in the tenant time zone, <Link href={TENANT_TIMEZONE_HREF} className="m-ink-accent underline underline-offset-2">{tz.replace(/_/g, " ")}</Link>. Expand a failed job to read why it stopped and what to do next</>}
        />
      }
      filterBar={jobs.length ? (
        <div className="flex flex-wrap items-center gap-4">
          <Chips label="Status" value={status} options={STATUS_FILTERS} onChange={setStatus} />
          {kinds.length > 1 ? (
            <Chips label="Kind" value={kind} options={[{ value: "all" as const, label: "All" }, ...kinds.map((k) => ({ value: k, label: labelOf(k) }))]} onChange={setKind} />
          ) : null}
        </div>
      ) : undefined}
      state={asyncStateOf(q, () => jobs.length === 0, true)}
      emptyProps={{
        title: "No jobs have run yet",
        detail: dayOne.step ? `Extractions, analyses, uploads and simulations are listed here. ${dayOne.step.detail}` : "Extractions, analyses, uploads and simulations are listed here.",
        action: <DayOneAction step={dayOne.step} fallbackHref="/systems" fallbackLabel="Open systems" />,
      }}
      errorProps={{ error: q.error, onRetry: () => void q.refetch() }}
      table={
        <DataTable
          columns={columns}
          data={shown}
          getRowId={(j) => j.id}
          emptyMessage="No job matches these filters"
          renderExpanded={(j) => (j.status === "failed" && j.error
            ? <JobError error={j.error} />
            : <p className="m-text-body m-ink-2">{j.message || "No detail recorded"}</p>)}
        />
      }
    />
  );
}
