"use client";

import { toast } from "sonner";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Button, DataTable, EmptyState, EntityTabs, ErrorState, ExplorerPage, PageHeader, Pager, Skeleton, Mono, Notice, Stat, Status, type CellMeta, type ExportOption } from "@/design";
import { ProposalCell, proposalOf } from "@/components/fix/proposal";
import { ALL_RUNS, kindText } from "@/components/fix/kind";
import {
  approveCleaning,
  bulkApprove,
  downloadCleaningExport,
  getCleaningAudit,
  getCleaningGroups,
  getCleaningQueue,
  rejectCleaning,
  type AuditEntry,
  type CleaningQueueItem,
} from "@/lib/api/cleaning";
import { downloadAuthenticated } from "@/lib/api/download";
import { createBatchFromCleaning } from "@/lib/api/remediation";
import { getVersion } from "@/lib/api/versions";
import { getCleaningReportUrl } from "@/lib/api/reports";
import { apiErrorMessage, isListFailure, apiErrorState } from "@/lib/error";
import { formatDate, formatModuleName, labelOf } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";
import { useRole } from "@/hooks/use-role";
import { GatedPrimary } from "@/components/gated-primary";

const AUDIT_COLUMNS: ColumnDef<AuditEntry>[] = [
  { accessorKey: "created_at", header: "When", cell: (i) => formatDate(i.getValue<string>(), "datetime") },
  { accessorKey: "actor_name", header: "Who" },
  { accessorKey: "action", header: "Action", cell: (i) => labelOf(i.getValue<string>()) },
  { accessorKey: "record_key", header: "Record", meta: { mono: true } },
];

/** Every approve, reject, apply and rollback on the proposals this run found, from the cleaning audit log. */
function BatchAudit({ runId }: { runId: string | undefined }) {
  const q = useQuery({
    queryKey: ["cleaning-audit", "run", runId ?? ALL_RUNS],
    queryFn: () => getCleaningAudit({ version_id: runId, per_page: 100 }),
    retry: false,
  });
  if (q.isLoading) return <Skeleton height={120} />;
  if (q.isError) return <ErrorState {...apiErrorState(q.error)} onRetry={() => void q.refetch()} />;
  const rows = q.data?.items ?? [];
  if (rows.length === 0) return <EmptyState title="No changes recorded" detail="Approvals and rejections of these proposals are logged here." ghost="list" action={<Button variant="secondary" render={<Link href="/fix">Back to the cleaning queue</Link>} />} />;
  return <DataTable columns={AUDIT_COLUMNS} data={rows} getRowId={(r) => r.id} tableId="batch-audit" exportName="batch-audit" height={360} />;
}

// Same bulk-approve confidence threshold as the legacy cleaning surface used (85%).
const HIGH_CONFIDENCE = 0.85;
const PAGE_SIZE = 100;

/**
 * One decision from the cleaning queue: the proposals of one kind (a field fix or a cleaning
 * rule) that one run found. The route segment is the run (cleaning items carry the run that
 * found them, not a batch) and `?kind=` narrows it. Approved proposals go on to a fix batch for the
 * second person's approval and the export to SAP.
 */
export default function BatchPage() {
  const { batchId } = useParams<{ batchId: string }>();
  // "all": every run, for proposals that carry none (the match engine's review pairs).
  const runId = batchId === ALL_RUNS ? undefined : batchId;
  const kind = useSearchParams().get("kind") ?? undefined;
  const router = useRouter();
  const qc = useQueryClient();
  const canApprove = useRole().can("approve");
  const [page, setPage] = useState(1);
  const key = [...queryKeys.batch(batchId), kind ?? "", page];
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: key,
    queryFn: () => getCleaningQueue({ version_id: runId, kind, per_page: PAGE_SIZE, page }),
  });
  const version = useQuery({ queryKey: ["version", runId], queryFn: () => getVersion(runId as string), enabled: !!runId, retry: false });
  const groups = useQuery({ queryKey: ["cleaning", "groups"], queryFn: getCleaningGroups });
  const approvedQ = useQuery({
    queryKey: [...queryKeys.batch(batchId), kind ?? "", "approved"],
    queryFn: () => getCleaningQueue({ version_id: runId, kind, status: "approved", per_page: 1 }),
  });
  const items = useMemo(() => data?.items ?? [], [data]);
  const ranked = useMemo(() => [...items].sort((x, y) => y.confidence - x.confidence), [items]);
  // Waiting proposals of this run and kind at or above the threshold, across every page: what "Accept N" approves.
  const mine = (groups.data?.groups ?? []).filter((g) => (runId ? g.version_id === runId : true) && (!kind || g.kind === kind));
  const what = kind ? kindText(kind, mine[0]?.rule_name) : "Proposals";
  const waiting = mine.reduce((n, g) => n + g.records, 0);
  const confidentCount = mine.reduce((n, g) => n + g.confident, 0);
  const approvedCount = approvedQ.data?.total ?? 0;
  const runName = !runId ? "every run" : version.data?.label ?? (version.data?.run_at ? formatDate(version.data.run_at, "datetime") : "this run");
  // A match to review changes no value, so there is nothing to load into SAP from a fix batch.
  const draftable = kind !== "match";

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: queryKeys.batch(batchId) });
    void qc.invalidateQueries({ queryKey: ["cleaning", "groups"] });
  };

  const [failure, setFailure] = useState<string | null>(null);
  type Page = NonNullable<typeof data>;
  /** Optimistically set one item's status; the snapshot restores it if the call fails. */
  const markItem = async (id: string, status: string) => {
    setFailure(null);
    await qc.cancelQueries({ queryKey: key });
    const prev = qc.getQueryData<Page>(key);
    if (prev) qc.setQueryData<Page>(key, { ...prev, items: prev.items.map((i) => (i.id === id ? { ...i, status } : i)) });
    return { prev };
  };
  const restore = (prev: Page | undefined, verb: string, e: unknown) => {
    if (prev) qc.setQueryData(key, prev);
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
    mutationFn: () => bulkApprove({ version_id: runId, kind, min_confidence: HIGH_CONFIDENCE, max_count: 5000 }),
    onSuccess: (r) => { toast(`Approved ${r.approved_count.toLocaleString()}`); invalidate(); },
    onError: (e) => setFailure(`Not approved: ${apiErrorMessage(e)}`),
  });
  const toBatch = useMutation({
    mutationFn: () => createBatchFromCleaning(`${what} from ${runName}`, { ...(runId ? { version_id: runId } : {}), kind }),
    onSuccess: (b) => {
      toast.success(`Fix batch drafted with ${b.items.toLocaleString()} change${b.items === 1 ? "" : "s"}`, {
        action: { label: "Open batch", onClick: () => router.push(`/fix?tab=batches&batch=${b.id}`) },
      });
      invalidate();
    },
    onError: (e) => setFailure(`No batch drafted: ${apiErrorMessage(e)}`),
  });
  const columns: ColumnDef<CleaningQueueItem>[] = [
    { accessorKey: "record_key", header: "Record", cell: ({ row }) => <Mono>{row.original.record_key}</Mono> },
    { id: "proposed", header: "Proposed value", enableSorting: false, cell: ({ row }) => <ProposalCell proposal={proposalOf(row.original)} /> },
    {
      accessorKey: "confidence",
      header: "Confidence",
      meta: { numeric: true } satisfies CellMeta,
      cell: ({ row }) => `${Math.round(row.original.confidence * 100)}%`,
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => <Status kind="lifecycle" value={row.original.status} />,
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => (
        <div className="flex justify-end gap-2" onClick={(e) => e.stopPropagation()}>
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
      label: "Approved fixes, these proposals (.xlsx)",
      // N1: exportBatch() posts to /remediation/batches/{id}/export, which expects a
      // remediation_batches.id — batchId here is an unrelated cleaning_queue.batch_id
      // (no FK between the two tables), so that call 404ed on every click and would
      // also mutate the batch's status as a side effect of a read-only export menu.
      // downloadCleaningExport is a read-only GET scoped by batch_id instead.
      run: () => downloadCleaningExport("xlsx", "approved", items[0]?.object_type, undefined, { version_id: runId, kind }),
    },
    {
      format: "csv",
      label: "Approved fixes, these proposals (.csv)",
      run: () => downloadCleaningExport("csv", "approved", items[0]?.object_type, undefined, { version_id: runId, kind }),
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

  const objectName = items[0] ? formatModuleName(items[0].object_type) : null;
  const total = data?.total ?? 0;

  return (
    <div className="flex flex-col gap-4">
    <PageHeader
      title={what}
      meta={`${objectName ? `${objectName}, ` : ""}${runId ? `found by ${runName}` : "across every run"}`}
      actions={canApprove ? (
        <>
          <Button
            variant="secondary"
            disabled={confidentCount === 0 || acceptHighConfidence.isPending}
            onClick={() => acceptHighConfidence.mutate()}
          >
            Accept {confidentCount.toLocaleString()} at 85% or higher
          </Button>
          {draftable ? (
            <Button
              variant="primary"
              disabled={approvedCount === 0 || toBatch.isPending}
              onClick={() => toBatch.mutate()}
            >
              Draft fix batch from {approvedCount.toLocaleString()} approved
            </Button>
          ) : null}
        </>
      ) : undefined}
    />
    <EntityTabs entityType="cleaning" entityId={batchId} audit={<BatchAudit runId={runId} />} exportOptions={exportOptions} overview={
    <ExplorerPage
      state={isLoading ? "loading" : isListFailure({ isError, error }) ? "error" : items.length === 0 ? "empty" : undefined}
      emptyProps={{
        title: "No proposals here",
        detail: "They may all have been approved, rejected or drafted into a fix batch.",
        action: <Button render={<Link href="/fix">Back to the cleaning queue</Link>} />,
      }}
      errorProps={{ message: apiErrorMessage(error), onRetry: refetch }}
      summary={items.length > 0 ? (
        <div className="m-stat-grid @5xl:[grid-template-columns:repeat(3,minmax(0,360px))]">
          <Stat label="Waiting for review" value={waiting.toLocaleString()} hint={`${total.toLocaleString()} proposal${total === 1 ? "" : "s"} in all`} />
          <Stat label="At 85% or higher" value={confidentCount.toLocaleString()} tone={confidentCount > 0 ? "go" : undefined} hint="accept them in one step" />
          <Stat label="Approved" value={approvedCount.toLocaleString()} hint="ready to draft into a fix batch" />
        </div>
      ) : undefined}
      table={
        <div className="flex flex-col gap-3">
          {failure ? <Notice tone="danger">{failure}</Notice> : null}
          <DataTable columns={columns} data={ranked} getRowId={(row) => row.id} />
          {total > PAGE_SIZE ? <Pager page={page} pageCount={Math.ceil(total / PAGE_SIZE)} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} /> : null}
        </div>
      }
    />
    } />
    </div>
  );
}
