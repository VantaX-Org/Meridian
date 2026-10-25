"use client";

/** Admin › Jobs: history of extractions, analyses, uploads and simulations. */

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";
import { Button, DataTable, DisabledJobAction, ExplorerPage, PageHeader, RetryJobButton, Status, asyncStateOf, retryAction } from "@/design";
import { actionColumn, RowLink } from "@/components/mdm/ledger";
import { JobError } from "@/components/job-error";
import { useRole } from "@/hooks/use-role";
import { JOBS_HISTORY_QUERY_KEY } from "@/hooks/use-jobs";
import { getJobs } from "@/lib/api/jobs";
import { formatDate, labelOf } from "@/lib/format";
import { apiErrorMessage } from "@/lib/error";
import { explainJobError } from "@/lib/job-error";
import { TENANT_TIMEZONE_HREF, useTenantTimezone } from "@/lib/tenant-zone";
import type { Job, JobKind, JobStatus } from "@/types/jobs";

/** Where each kind of job's result lives, without a system or run to open. */
const JOB_HREF: Record<Job["kind"], string> = {
  extraction: "/systems", config_sync: "/systems", config_load: "/systems", analysis: "/runs",
  upload: "/import", simulation: "/fix/what-if", process_discovery: "/insights/process",
};
const SYSTEM_JOBS = new Set<Job["kind"]>(["extraction", "config_sync", "config_load"]);
const ACTIVE = new Set<JobStatus>(["queued", "running"]);

/** The job's own place: its extraction log or system Health tab, its run, else the page of its kind. */
function jobHref(j: Job): string {
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
  const [status, setStatus] = useState<StatusFilter>("all");
  const [kind, setKind] = useState<JobKind | "all">("all");
  // The SSE stream patches this list too; the poll covers a dropped stream while anything is still queued or running.
  const q = useQuery({
    queryKey: JOBS_HISTORY_QUERY_KEY,
    queryFn: () => getJobs({ limit: 200 }),
    refetchInterval: (query) => (query.state.data?.some((j) => ACTIVE.has(j.status)) ? 5_000 : false),
  });
  const jobs = useMemo(() => q.data ?? [], [q.data]);
  const kinds = useMemo(() => [...new Set(jobs.map((j) => j.kind))].sort(), [jobs]);
  const keep = STATUS_FILTERS.find((f) => f.value === status)?.keep ?? (() => true);
  const shown = jobs.filter((j) => keep(j.status) && (kind === "all" || j.kind === kind));

  const columns = useMemo<ColumnDef<Job>[]>(() => {
    const when = (s: number) => formatDate(s * 1000, "datetime", tz);
    return [
      { accessorKey: "label", header: "Job" },
      { id: "kind", header: "Kind", accessorFn: (j) => j.kind, cell: ({ row }) => labelOf(row.original.kind) },
      { id: "status", header: "Status", cell: ({ row }) => <Status kind="lifecycle" value={row.original.status} /> },
      { id: "rows", header: "Rows", cell: ({ row }) => row.original.rows_done.toLocaleString() },
      { id: "start", header: "Started", cell: ({ row }) => when(row.original.started_at) },
      { id: "end", header: "Finished", cell: ({ row }) => (row.original.finished_at ? when(row.original.finished_at) : "—") },
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
  }, [tz]);

  return (
    <ExplorerPage
      header={
        <PageHeader
          title="Jobs"
          meta={<>Every extraction, analysis, upload and simulation that ran, newest first. Times are in the tenant time zone, <Link href={TENANT_TIMEZONE_HREF} className="m-ink-accent underline underline-offset-2">{tz.replace(/_/g, " ")}</Link>. Expand a failed job to read why it stopped and what to do next</>}
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
      emptyProps={{ title: "No jobs have run yet", detail: "Extractions, analyses, uploads and simulations are listed here.", action: <Button render={<Link href="/import">Import data</Link>} /> }}
      errorProps={{ message: apiErrorMessage(q.error), onRetry: () => void q.refetch() }}
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
