"use client";

/** Admin › Jobs: history of extractions, analyses, uploads and simulations. */

import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable, ExplorerPage, Pill, type PillTone } from "@/design";
import { getJobs } from "@/lib/api/jobs";
import { formatDate, formatModuleName } from "@/lib/format";
import { apiErrorMessage, isListFailure } from "@/lib/error";
import type { Job, JobStatus } from "@/types/jobs";

const TONE: Record<JobStatus, PillTone> = { queued: "at-risk", running: "at-risk", completed: "go", failed: "no-go" };
const when = (s: number) => formatDate(s * 1000, "datetime");

const columns: ColumnDef<Job>[] = [
  { accessorKey: "label", header: "Job" },
  { accessorKey: "kind", header: "Kind" },
  { id: "status", header: "Status", cell: ({ row }) => <Pill tone={TONE[row.original.status]}>{formatModuleName(row.original.status)}</Pill> },
  { id: "rows", header: "Rows", cell: ({ row }) => row.original.rows_done.toLocaleString() },
  { id: "start", header: "Started", cell: ({ row }) => when(row.original.started_at) },
  { id: "end", header: "Finished", cell: ({ row }) => (row.original.finished_at ? when(row.original.finished_at) : "—") },
  { id: "msg", header: "Detail", cell: ({ row }) => row.original.error ?? row.original.message },
];

export default function JobsPage() {
  const q = useQuery({ queryKey: ["jobs", "history"], queryFn: () => getJobs({ limit: 200 }) });
  const jobs = q.data ?? [];
  return (
    <ExplorerPage
      state={q.isLoading ? "loading" : isListFailure(q) ? "error" : jobs.length === 0 ? "empty" : undefined}
      emptyProps={{ title: "No jobs have run yet.", detail: "Extractions, analyses, uploads and simulations are listed here." }}
      errorProps={{ message: apiErrorMessage(q.error), onRetry: () => void q.refetch() }}
      table={<DataTable columns={columns} data={jobs} getRowId={(j) => j.id} />}
    />
  );
}
