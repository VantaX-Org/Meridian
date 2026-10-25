"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Button, ConfirmDialog, DataTable, Drawer, EmptyState, EntityTabs, ErrorState, ExplorerPage, Field, PageHeader, Pager, Skeleton, Mono, Notice, Stat, Status, Textarea, toast, type CellMeta, type ExportOption } from "@/design";
import { ProposalCell, proposalOf } from "@/components/fix/proposal";
import { kindText } from "@/components/fix/kind";
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
import { createBatchFromCleaning, HIGH_CONFIDENCE_LABEL } from "@/lib/api/remediation";
import { getVersion } from "@/lib/api/versions";
import { getCleaningReportUrl } from "@/lib/api/reports";
import { apiErrorMessage, isListFailure, apiErrorState } from "@/lib/error";
import { formatDate, formatModuleName, labelOf } from "@/lib/format";
import { runName } from "@/lib/run-scope";
import { queryKeys } from "@/lib/query-keys";
import { useRole } from "@/hooks/use-role";
import { GatedPrimary } from "@/components/gated-primary";

const AUDIT_COLUMNS: ColumnDef<AuditEntry>[] = [
  { accessorKey: "created_at", header: "When", cell: (i) => formatDate(i.getValue<string>(), "datetime") },
  { accessorKey: "actor_name", header: "Who" },
  { accessorKey: "action", header: "Action", cell: (i) => labelOf(i.getValue<string>()) },
  { accessorKey: "record_key", header: "Record", meta: { mono: true } },
];

/** The fix path, with the step this page is on marked. The same four words on every fix page. */
const STEPS = ["Proposal", "Batch", "Second approval", "Export"] as const;
export function FixSteps({ current }: { current: (typeof STEPS)[number] }) {
  return (
    <ol aria-label="Fix steps" className="flex flex-wrap items-center m-text-meta m-ink-3 [&>li+li]:[border-left:1px_solid_var(--m-line)]">
      {STEPS.map((step, i) => (
        <li key={step} className="inline-flex items-center gap-1 px-3 first:pl-0">
          <span className="m-numeric">{i + 1}</span>
          <span aria-current={step === current ? "step" : undefined} className={step === current ? "m-ink font-medium" : undefined}>{step}</span>
        </li>
      ))}
    </ol>
  );
}

/** Every approve, reject, apply and rollback on the proposals this run found, from the cleaning audit log. */
function BatchAudit({ runId }: { runId: string }) {
  const q = useQuery({
    queryKey: ["cleaning-audit", "run", runId],
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
export default function ProposalsPage() {
  const { runId } = useParams<{ runId: string }>();
  const kind = useSearchParams().get("kind") ?? undefined;
  const router = useRouter();
  const qc = useQueryClient();
  const canApprove = useRole().can("approve");
  const [page, setPage] = useState(1);
  const key = [...queryKeys.batch(runId), kind ?? "", page];
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: key,
    queryFn: () => getCleaningQueue({ version_id: runId, kind, per_page: PAGE_SIZE, page }),
  });
  const version = useQuery({ queryKey: ["version", runId], queryFn: () => getVersion(runId), retry: false });
  const groups = useQuery({ queryKey: ["cleaning", "groups"], queryFn: getCleaningGroups });
  const approvedQ = useQuery({
    queryKey: [...queryKeys.batch(runId), kind ?? "", "approved"],
    queryFn: () => getCleaningQueue({ version_id: runId, kind, status: "approved", per_page: 1 }),
  });
  const items = useMemo(() => data?.items ?? [], [data]);
  const ranked = useMemo(() => [...items].sort((x, y) => y.confidence - x.confidence), [items]);
  // Waiting proposals of this run and kind at or above the threshold, across every page: what "Accept N" approves.
  const mine = (groups.data?.groups ?? []).filter((g) => g.version_id === runId && (!kind || g.kind === kind));
  const what = kind ? kindText(kind, mine[0]?.rule_name) : "Proposals";
  const waiting = mine.reduce((n, g) => n + g.records, 0);
  const confidentCount = mine.reduce((n, g) => n + g.confident, 0);
  const approvedCount = approvedQ.data?.total ?? 0;
  const run = version.data ? runName(version.data) : "this run";

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: queryKeys.batch(runId) });
    void qc.invalidateQueries({ queryKey: ["cleaning", "groups"] });
  };

  const [failure, setFailure] = useState<string | null>(null);
  const [askAccept, setAskAccept] = useState(false);
  /** The proposals a reason is being written for; null closes the drawer. */
  const [rejecting, setRejecting] = useState<string[] | null>(null);
  const [reason, setReason] = useState("");
  type Page = NonNullable<typeof data>;
  /** Optimistically set some items' status; the snapshot restores them if the call fails. */
  const markItems = async (ids: string[], status: string) => {
    setFailure(null);
    await qc.cancelQueries({ queryKey: key });
    const prev = qc.getQueryData<Page>(key);
    if (prev) qc.setQueryData<Page>(key, { ...prev, items: prev.items.map((i) => (ids.includes(i.id) ? { ...i, status } : i)) });
    return { prev };
  };
  const restore = (prev: Page | undefined, verb: string, e: unknown) => {
    if (prev) qc.setQueryData(key, prev);
    setFailure(`${verb}: ${apiErrorMessage(e)}`);
  };
  const approve = useMutation({
    mutationFn: (ids: string[]) => Promise.all(ids.map((id) => approveCleaning(id))),
    onMutate: (ids: string[]) => markItems(ids, "approved"),
    onSuccess: (_r, ids) => { toast(ids.length === 1 ? "Approved" : `Approved ${ids.length.toLocaleString()}`); },
    onError: (e, _ids, ctx) => restore(ctx?.prev, "Not approved", e),
    onSettled: () => void invalidate(),
  });
  const reject = useMutation({
    mutationFn: ({ ids, reason: why }: { ids: string[]; reason: string }) => Promise.all(ids.map((id) => rejectCleaning(id, why))),
    onMutate: ({ ids }: { ids: string[]; reason: string }) => markItems(ids, "rejected"),
    onSuccess: (_r, { ids }) => { setRejecting(null); setReason(""); toast(ids.length === 1 ? "Rejected" : `Rejected ${ids.length.toLocaleString()}`); },
    onError: (e, _v, ctx) => restore(ctx?.prev, "Not rejected", e),
    onSettled: () => void invalidate(),
  });
  const acceptHighConfidence = useMutation({
    mutationFn: () => bulkApprove({ version_id: runId, kind, min_confidence: HIGH_CONFIDENCE, max_count: 5000 }),
    onSuccess: (r) => { setAskAccept(false); toast(`Approved ${r.approved_count.toLocaleString()}`); invalidate(); },
    onError: (e) => { setAskAccept(false); setFailure(`Not approved: ${apiErrorMessage(e)}`); },
  });
  const toBatch = useMutation({
    mutationFn: () => createBatchFromCleaning(`${what} from ${run}`, { version_id: runId, kind }),
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
          <GatedPrimary kind="approve" allowed={canApprove} variant="secondary" onClick={() => approve.mutate([row.original.id])}>Approve</GatedPrimary>
          {canApprove ? (
            <Button variant="ghost" onClick={() => setRejecting([row.original.id])}>
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
      // exportBatch() posts to /remediation/batches/{id}/export, which expects a remediation batch id; the run
      // here is not one. downloadCleaningExport is a read-only GET scoped by run and kind instead.
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
      // getCleaningReportUrl() has no batch or run scope: the report is tenant-wide.
      run: () => downloadAuthenticated(getCleaningReportUrl(), "cleaning-report.pdf"),
    },
  ];

  const objectName = items[0] ? formatModuleName(items[0].object_type) : null;
  const total = data?.total ?? 0;
  const busy = approve.isPending || reject.isPending;

  return (
    <div className="flex flex-col gap-4">
    <FixSteps current="Proposal" />
    <PageHeader
      title={what}
      meta={`${objectName ? `${objectName}, ` : ""}found by ${run}`}
      actions={canApprove ? (
        <>
          <Button
            variant="secondary"
            disabled={confidentCount === 0 || acceptHighConfidence.isPending}
            onClick={() => setAskAccept(true)}
          >
            Accept {confidentCount.toLocaleString()} at {HIGH_CONFIDENCE_LABEL}
          </Button>
          <Button
            variant="primary"
            disabled={approvedCount === 0 || toBatch.isPending}
            onClick={() => toBatch.mutate()}
          >
            Draft fix batch from {approvedCount.toLocaleString()} approved
          </Button>
        </>
      ) : undefined}
    />
    <EntityTabs entityType="cleaning" entityId={runId} audit={<BatchAudit runId={runId} />} exportOptions={exportOptions} overview={
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
          <Stat label={`At ${HIGH_CONFIDENCE_LABEL}`} value={confidentCount.toLocaleString()} tone={confidentCount > 0 ? "go" : undefined} hint="accept them in one step" />
          <Stat label="Approved" value={approvedCount.toLocaleString()} hint="ready to draft into a fix batch" />
        </div>
      ) : undefined}
      table={
        <div className="flex flex-col gap-3">
          {failure ? <Notice tone="danger">{failure}</Notice> : null}
          <DataTable
            columns={columns}
            data={ranked}
            getRowId={(row) => row.id}
            bulkActions={canApprove ? (selected) => (
              <>
                <Button variant="secondary" disabled={busy} onClick={() => approve.mutate(selected.map((i) => i.id))}>Approve selected</Button>
                <Button variant="secondary" disabled={busy} onClick={() => setRejecting(selected.map((i) => i.id))}>Reject selected</Button>
              </>
            ) : undefined}
          />
          {total > PAGE_SIZE ? <Pager page={page} pageCount={Math.ceil(total / PAGE_SIZE)} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} /> : null}
        </div>
      }
    />
    } />
    <ConfirmDialog
      open={askAccept}
      onOpenChange={setAskAccept}
      title={`Accept ${confidentCount.toLocaleString()} proposal${confidentCount === 1 ? "" : "s"}?`}
      body={`Every waiting proposal of ${what} at ${HIGH_CONFIDENCE_LABEL} is approved in one step. Nothing is written to SAP until a second person approves the batch and exports it.`}
      confirmLabel={`Accept ${confidentCount.toLocaleString()}`}
      cancelLabel="Not now"
      pending={acceptHighConfidence.isPending}
      onConfirm={() => acceptHighConfidence.mutate()}
    />
    <Drawer
      open={rejecting !== null}
      onOpenChange={(open) => { if (!open) { setRejecting(null); setReason(""); } }}
      title={rejecting && rejecting.length > 1 ? `Reject ${rejecting.length.toLocaleString()} proposals` : "Reject proposal"}
      footer={
        <>
          <Button variant="ghost" onClick={() => { setRejecting(null); setReason(""); }}>Keep</Button>
          <Button disabled={!reason.trim() || reject.isPending} onClick={() => rejecting && reject.mutate({ ids: rejecting, reason: reason.trim() })}>Reject</Button>
        </>
      }
    >
      <Field label="Reason">
        <Textarea rows={4} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
    </Drawer>
    </div>
  );
}
