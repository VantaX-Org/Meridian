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

/** Where each kind of job's result lives. */
const JOB_HREF: Record<Job["kind"], string> = {
  extraction: "/systems", config_sync: "/systems", config_load: "/systems", analysis: "/runs",
  upload: "/import", simulation: "/fix/what-if", process_discovery: "/insights/process",
};

const columns: ColumnDef<Job>[] = [
  { accessorKey: "label", header: "Job" },
  { id: "kind", header: "Kind", accessorFn: (j) => j.kind, cell: ({ row }) => labelOf(row.original.kind) },
  { id: "status", header: "Status", cell: ({ row }) => <Status kind="lifecycle" value={row.original.status} /> },
  { id: "rows", header: "Rows", cell: ({ row }) => row.original.rows_done.toLocaleString() },
  { id: "start", header: "Started", cell: ({ row }) => when(row.original.started_at) },
  { id: "end", header: "Finished", cell: ({ row }) => (row.original.finished_at ? when(row.original.finished_at) : "—") },
  { id: "msg", header: "Detail", cell: ({ row }) => row.original.error ?? row.original.message },
  actionColumn((j) => <RowLink href={JOB_HREF[j.kind] ?? "/runs"} label={`Open ${j.label}`}>Open</RowLink>),
];

export default function JobsPage() {
  const q = useQuery({ queryKey: ["jobs", "history"], queryFn: () => getJobs({ limit: 200 }) });
  const jobs = q.data ?? [];
  return (
    <ExplorerPage
      header={<PageHeader title="Jobs" meta="Extractions, analyses, uploads and simulations" />}
      state={asyncStateOf(q, () => jobs.length === 0, true)}
      emptyProps={{ title: "No jobs have run yet", detail: "Extractions, analyses, uploads and simulations are listed here.", action: <Link href="/import"><Button>Import data</Button></Link> }}
      errorProps={{ message: apiErrorMessage(q.error), onRetry: () => void q.refetch() }}
      table={<DataTable columns={columns} data={jobs} getRowId={(j) => j.id} />}
    />
  );
}
