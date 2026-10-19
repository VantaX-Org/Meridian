"use client";

import { toast } from "sonner";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Button, DataTable, EmptyState, EntityTabs, ErrorState, ExplorerPage, Skeleton, Mono, Notice, Pill, type ExportOption } from "@/design";
import {
  approveCleaning,
  bulkApprove,
  downloadCleaningExport,
  getCleaningAudit,
  getCleaningQueue,
  rejectCleaning,
  type AuditEntry,
  type CleaningQueueItem,
} from "@/lib/api/cleaning";
import { downloadAuthenticated } from "@/lib/api/download";
import { getCleaningReportUrl } from "@/lib/api/reports";
import { apiErrorMessage, isListFailure, apiErrorState } from "@/lib/error";
import { formatDate, labelOf } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";
import { useRole } from "@/hooks/use-role";
import { GatedPrimary } from "@/components/gated-primary";

const AUDIT_COLUMNS: ColumnDef<AuditEntry>[] = [
  { accessorKey: "created_at", header: "When", cell: (i) => formatDate(i.getValue<string>(), "datetime") },
  { accessorKey: "actor_name", header: "Who" },
  { accessorKey: "action", header: "Action", cell: (i) => labelOf(i.getValue<string>()) },
  { accessorKey: "record_key", header: "Record", meta: { mono: true } },
];

/** Every approve, reject, apply and rollback on this batch's items, from the cleaning audit log. */
function BatchAudit({ batchId }: { batchId: string }) {
  const q = useQuery({
    queryKey: ["cleaning-audit", "batch", batchId],
    queryFn: () => getCleaningAudit({ batch_id: batchId, per_page: 100 }),
    retry: false,
  });
  if (q.isLoading) return <Skeleton height={120} />;
  if (q.isError) return <ErrorState {...apiErrorState(q.error)} onRetry={() => void q.refetch()} />;
  const rows = q.data?.items ?? [];
  if (rows.length === 0) return <EmptyState title="No changes recorded" detail="Approvals, rejections and applied fixes on this batch are logged here." ghost="list" action={<Button variant="secondary" render={<Link href="/fix?tab=batches">Back to batches</Link>} />} />;
  return <DataTable columns={AUDIT_COLUMNS} data={rows} getRowId={(r) => r.id} tableId="batch-audit" exportName="batch-audit" height={360} />;
}

// Same bulk-approve confidence threshold as the legacy cleaning surface used (85%).
const HIGH_CONFIDENCE = 0.85;

export default function BatchPage() {
  const { batchId } = useParams<{ batchId: string }>();
  const qc = useQueryClient();
  const canApprove = useRole().can("approve");
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: queryKeys.batch(batchId),
    // Filtered server-side: a client-side filter over one 100-item page missed
    // batches further back in the queue (review finding I11).
    queryFn: () => getCleaningQueue({ batch_id: batchId, per_page: 100 }),
  });
  const items = useMemo(() => data?.items ?? [], [data]);
  const confident = useMemo(() => items.filter((i) => i.confidence >= HIGH_CONFIDENCE), [items]);

  const invalidate = () => qc.invalidateQueries({ queryKey: queryKeys.batch(batchId) });

  const [failure, setFailure] = useState<string | null>(null);
  type Page = NonNullable<typeof data>;
  /** Optimistically set one item's status; the snapshot restores it if the call fails. */
  const markItem = async (id: string, status: string) => {
    setFailure(null);
    await qc.cancelQueries({ queryKey: queryKeys.batch(batchId) });
    const prev = qc.getQueryData<Page>(queryKeys.batch(batchId));
    if (prev) qc.setQueryData<Page>(queryKeys.batch(batchId), { ...prev, items: prev.items.map((i) => (i.id === id ? { ...i, status } : i)) });
    return { prev };
  };
  const restore = (prev: Page | undefined, verb: string, e: unknown) => {
    if (prev) qc.setQueryData(queryKeys.batch(batchId), prev);
    setFailure(`${verb}: ${apiErrorMessage(e)}`);
  };
  const approve = useMutation({
    mutationFn: (id: string) => approveCleaning(id),
    onMutate: (id: string) => markItem(id, "approved"),
    onSuccess: () => { toast("Approved"); },
    onError: (e, _id, ctx) => restore(ctx?.prev, "Not approved", e),
    onSettled: () => void invalidate(),
  });
  const reject = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => rejectCleaning(id, reason),
    onMutate: ({ id }: { id: string; reason: string }) => markItem(id, "rejected"),
    onSuccess: () => { toast("Rejected"); },
    onError: (e, _v, ctx) => restore(ctx?.prev, "Not rejected", e),
    onSettled: () => void invalidate(),
  });
  const acceptHighConfidence = useMutation({
    mutationFn: () => bulkApprove({ max_count: confident.length }),
    onSuccess: (r) => { toast(`Approved ${r.approved_count}`); invalidate(); },
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
          <GatedPrimary kind="approve" allowed={canApprove} variant="secondary" onClick={() => approve.mutate(row.original.id)}>Approve</GatedPrimary>
          {canApprove ? (
            <Button variant="ghost" onClick={() => reject.mutate({ id: row.original.id, reason: "steward rejected" })}>
              Reject
            </Button>
          ) : null}
        </div>
      ),
      enableSorting: false,
    },
  ];

  const exportOptions: ExportOption[] = [
    {
      format: "xlsx",
      label: "Approved fixes, this batch (.xlsx)",
      // N1: exportBatch() posts to /remediation/batches/{id}/export, which expects a
      // remediation_batches.id — batchId here is an unrelated cleaning_queue.batch_id
      // (no FK between the two tables), so that call 404ed on every click and would
      // also mutate the batch's status as a side effect of a read-only export menu.
      // downloadCleaningExport is a read-only GET scoped by batch_id instead.
      run: () => downloadCleaningExport("xlsx", "approved", items[0]?.object_type, batchId),
    },
    { format: "csv", run: () => downloadCleaningExport("csv", "approved", items[0]?.object_type) },
    {
      format: "csv",
      label: "Approved fixes, this batch (.csv)",
      run: () => downloadCleaningExport("csv", "approved", items[0]?.object_type, batchId),
    },
    {
      format: "pdf",
      label: "PDF cleaning report (all batches)",
      // N4: getCleaningReportUrl() has no batch/version scope — the report is
      // tenant-wide, not batch-specific — so neither the label nor the downloaded
      // filename should imply it covers only this batch.
      run: () => downloadAuthenticated(getCleaningReportUrl(), "cleaning-report.pdf"),
    },
  ];

  return (
    <EntityTabs entityType="cleaning" entityId={batchId} audit={<BatchAudit batchId={batchId} />} exportOptions={exportOptions} overview={
    <ExplorerPage
      state={isLoading ? "loading" : isListFailure({ isError, error }) ? "error" : items.length === 0 ? "empty" : undefined}
      emptyProps={{
        title: "Batch not found",
        detail: "It may have been removed or fully applied",
        action: <Button render={<Link href="/fix?tab=batches">All batches</Link>} />,
      }}
      errorProps={{ message: apiErrorMessage(error), onRetry: refetch }}
      summary={
        <div className="flex items-center gap-3">
          {canApprove ? (
            <Button
              variant="primary"
              disabled={confident.length === 0 || acceptHighConfidence.isPending}
              onClick={() => acceptHighConfidence.mutate()}
            >
              Accept {confident.length} at 85% or higher
            </Button>
          ) : null}
        </div>
      }
      table={
        <div className="flex flex-col gap-3">
          {failure ? <Notice tone="danger">{failure}</Notice> : null}
          {data && data.total > items.length ? (
            <p className="m-text-body m-ink-3">Showing the first {items.length.toLocaleString()} of {data.total.toLocaleString()} items in this batch.</p>
          ) : null}
          <DataTable columns={columns} data={items} getRowId={(row) => row.id} />
        </div>
      }
    />
    } />
  );
}
