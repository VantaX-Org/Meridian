"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable, ExplorerPage, Mono, Pager, Pill, Tabs } from "@/design";
import { getCleaningQueue, groupIntoBatches, type CleaningBatchSummary } from "@/lib/api/cleaning";
import { labelOf } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";
import { useUrlState } from "@/hooks/use-url-state";
import { BatchesTab } from "./batches-tab";

const columns: ColumnDef<CleaningBatchSummary>[] = [
  { accessorKey: "batch_id", header: "Batch", cell: ({ row }) => <Mono>{row.original.batch_id}</Mono> },
  { accessorKey: "object_type", header: "Object", cell: ({ row }) => labelOf(row.original.object_type) },
  { accessorKey: "items", header: "Items" },
  {
    accessorKey: "avg_confidence",
    header: "Confidence",
    cell: ({ row }) => `${Math.round(row.original.avg_confidence * 100)}%`,
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => (
      <Pill tone={row.original.status === "mixed" ? "at-risk" : "neutral"}>{labelOf(row.original.status)}</Pill>
    ),
  },
];

function CleaningQueueTab() {
  const router = useRouter();
  const [page, setPage] = useState(1);
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: [...queryKeys.batch("list"), page],
    queryFn: () => getCleaningQueue({ per_page: 100, page }),
  });
  const batches = useMemo(() => groupIntoBatches(data?.items ?? []), [data]);
  const pageCount = Math.max(1, Math.ceil((data?.total ?? 0) / 100));

  return (
    <ExplorerPage
      state={isLoading ? "loading" : isError ? "error" : batches.length === 0 ? "empty" : undefined}
      emptyProps={{ title: "No batches yet" }}
      errorProps={{ message: "Could not load the fix queue.", onRetry: refetch }}
      table={
        <div className="flex flex-col gap-3">
          <DataTable
            columns={columns}
            data={batches}
            getRowId={(row) => row.batch_id}
            onRowClick={(row) => router.push(`/fix/${row.batch_id}`)}
          />
          {pageCount > 1 && <Pager page={page} pageCount={pageCount} onPageChange={setPage} />}
        </div>
      }
    />
  );
}

export default function FixPage() {
  const [tab, setTab] = useUrlState("tab", "cleaning");

  return (
    <Tabs
      value={tab}
      onValueChange={setTab}
      items={[
        { value: "cleaning", label: "Cleaning queue", content: <CleaningQueueTab /> },
        { value: "batches", label: "Batches", content: <BatchesTab /> },
      ]}
    />
  );
}
