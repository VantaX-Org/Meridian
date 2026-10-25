"use client";

/** Admin › Jobs: history of extractions, analyses, uploads and simulations. */

import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";
import { Button, DataTable, ExplorerPage, PageHeader, Status, asyncStateOf } from "@/design";
import { actionColumn, RowLink } from "@/components/mdm/ledger";
import { getJobs } from "@/lib/api/jobs";
import { formatDate, labelOf } from "@/lib/format";
import { apiErrorMessage } from "@/lib/error";
import type { Job } from "@/types/jobs";

const when = (s: number) => formatDate(s * 1000, "datetime");

/** Where each kind of job's result lives, without a system or run to open. */
const JOB_HREF: Record<Job["kind"], string> = {
  extraction: "/systems", config_sync: "/systems", config_load: "/systems", analysis: "/runs",
  upload: "/import", simulation: "/fix/what-if", process_discovery: "/insights/process",
};
const SYSTEM_JOBS = new Set<Job["kind"]>(["extraction", "config_sync", "config_load"]);

/** The job's own place: its extraction log or system Health tab, its run, else the page of its kind. */
function jobHref(j: Job): string {
  if (j.kind === "extraction" && j.system_id && j.version_id) return `/systems/${j.system_id}/extractions/${j.version_id}`;
  if (SYSTEM_JOBS.has(j.kind) && j.system_id) return `/systems/${j.system_id}?tab=health${j.kind === "extraction" ? "" : "&part=config"}`;
  if (j.version_id) return `/runs/${j.version_id}`;
  return JOB_HREF[j.kind] ?? "/runs";
}
/** There is no job retry endpoint: a failed extraction is started again from its system's Extract drawer. */
const retryHref = (j: Job): string | null => (j.status === "failed" && j.kind === "extraction" && j.system_id ? `/systems/${j.system_id}?extract=1` : null);

const columns: ColumnDef<Job>[] = [
  { accessorKey: "label", header: "Job" },
  { id: "kind", header: "Kind", accessorFn: (j) => j.kind, cell: ({ row }) => labelOf(row.original.kind) },
  { id: "status", header: "Status", cell: ({ row }) => <Status kind="lifecycle" value={row.original.status} /> },
  { id: "rows", header: "Rows", cell: ({ row }) => row.original.rows_done.toLocaleString() },
  { id: "start", header: "Started", cell: ({ row }) => when(row.original.started_at) },
  { id: "end", header: "Finished", cell: ({ row }) => (row.original.finished_at ? when(row.original.finished_at) : "—") },
  { id: "msg", header: "Detail", cell: ({ row }) => row.original.error ?? row.original.message },
  actionColumn((j) => {
    const again = retryHref(j);
    return (
      <span className="inline-flex gap-3">
        <RowLink href={jobHref(j)} label={`Open ${j.label}`}>Open</RowLink>
        {again ? <RowLink href={again} label={`Extract ${j.label} again`}>Extract again</RowLink> : null}
      </span>
    );
  }),
];

export default function JobsPage() {
  const q = useQuery({ queryKey: ["jobs", "history"], queryFn: () => getJobs({ limit: 200 }) });
  const jobs = q.data ?? [];
  return (
    <ExplorerPage
      header={<PageHeader title="Jobs" meta="Extractions, analyses, uploads and simulations" />}
      state={asyncStateOf(q, () => jobs.length === 0, true)}
      emptyProps={{ title: "No jobs have run yet", detail: "Extractions, analyses, uploads and simulations are listed here.", action: <Button render={<Link href="/import">Import data</Link>} /> }}
      errorProps={{ message: apiErrorMessage(q.error), onRetry: () => void q.refetch() }}
      table={<DataTable columns={columns} data={jobs} getRowId={(j) => j.id} />}
    />
  );
}
