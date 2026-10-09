"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable, ExplorerPage, Mono, Pill, Tabs } from "@/design";
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
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: queryKeys.batch("list"),
    queryFn: () => getCleaningQueue({ per_page: 500 }),
  });
  const batches = useMemo(() => groupIntoBatches(data?.items ?? []), [data]);

  return (
    <ExplorerPage
      state={isLoading ? "loading" : isError ? "error" : batches.length === 0 ? "empty" : undefined}
      emptyProps={{ title: "No batches yet" }}
      errorProps={{ message: "Could not load the fix queue.", onRetry: refetch }}
      table={
        <DataTable
          columns={columns}
          data={batches}
          getRowId={(row) => row.batch_id}
          onRowClick={(row) => router.push(`/fix/${row.batch_id}`)}
        />
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
