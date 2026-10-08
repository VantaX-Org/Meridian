"use client";

import { useMemo } from "react";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Button, DataTable, ExplorerPage, Mono, Pill, toastManager } from "@/design";
import {
  approveCleaning,
  bulkApprove,
  downloadCleaningExport,
  getCleaningQueue,
  rejectCleaning,
  type CleaningQueueItem,
} from "@/lib/api/cleaning";
import { labelOf } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";

// Same bulk-approve confidence threshold as components/workbench/cleaning.tsx's BULK_CONFIDENCE (85%).
const HIGH_CONFIDENCE = 0.85;

export default function BatchPage() {
  const { batchId } = useParams<{ batchId: string }>();
  const qc = useQueryClient();
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: queryKeys.batch(batchId),
    queryFn: () => getCleaningQueue({ per_page: 500 }),
  });
  const items = useMemo(() => (data?.items ?? []).filter((i) => i.batch_id === batchId), [data, batchId]);
  const confident = useMemo(() => items.filter((i) => i.confidence >= HIGH_CONFIDENCE), [items]);

  const invalidate = () => qc.invalidateQueries({ queryKey: queryKeys.batch(batchId) });

  const approve = useMutation({
    mutationFn: (id: string) => approveCleaning(id),
    onSuccess: () => { toastManager.add({ title: "Approved" }); invalidate(); },
  });
  const reject = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => rejectCleaning(id, reason),
    onSuccess: () => { toastManager.add({ title: "Rejected" }); invalidate(); },
  });
  const acceptHighConfidence = useMutation({
    mutationFn: () => bulkApprove({ max_count: confident.length }),
    onSuccess: (r) => { toastManager.add({ title: `Approved ${r.approved_count}` }); invalidate(); },
  });
  const exportBatch = useMutation({
    mutationFn: () => downloadCleaningExport("csv", "approved", items[0]?.object_type),
  });

  const columns: ColumnDef<CleaningQueueItem>[] = [
    { accessorKey: "record_key", header: "Record", cell: ({ row }) => <Mono>{row.original.record_key}</Mono> },
    { accessorKey: "rule_id", header: "Rule", cell: ({ row }) => row.original.rule_id ?? "—" },
    {
      accessorKey: "confidence",
      header: "Confidence",
      cell: ({ row }) => `${Math.round(row.original.confidence * 100)}%`,
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => <Pill tone="neutral">{labelOf(row.original.status)}</Pill>,
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => (
        <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
          <Button variant="secondary" onClick={() => approve.mutate(row.original.id)}>Approve</Button>
          <Button variant="ghost" onClick={() => reject.mutate({ id: row.original.id, reason: "steward rejected" })}>
            Reject
          </Button>
        </div>
      ),
      enableSorting: false,
    },
  ];

  return (
    <ExplorerPage
      state={isLoading ? "loading" : isError ? "error" : items.length === 0 ? "empty" : undefined}
      emptyProps={{ title: "No items in this batch" }}
      errorProps={{ message: "Could not load this batch.", onRetry: refetch }}
      summary={
        <div className="flex items-center gap-3">
          <Button
            variant="primary"
            disabled={confident.length === 0 || acceptHighConfidence.isPending}
            onClick={() => acceptHighConfidence.mutate()}
          >
            Accept {confident.length} at 85% or higher
          </Button>
          <Button variant="secondary" disabled={items.length === 0} onClick={() => exportBatch.mutate()}>
            Export
          </Button>
        </div>
      }
      table={<DataTable columns={columns} data={items} getRowId={(row) => row.id} />}
    />
  );
}
