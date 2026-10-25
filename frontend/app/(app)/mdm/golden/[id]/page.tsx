// frontend/app/(app)/mdm/golden/[id]/page.tsx
"use client";

import { toast } from "sonner";
import Link from "next/link";
import { useState } from "react";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, ConfirmDialog, DataTable, EntityTabs, EmptyState, ErrorState, Mono, Pill, RecordPage, Skeleton, type RecordStatus } from "@/design";
import { getMasterRecord, getMasterRecordHistory, promoteMasterRecord, writebackMasterRecord } from "@/lib/api/master-records";
import { getRelationships } from "@/lib/api/relationships";
import { apiErrorMessage, apiErrorState } from "@/lib/error";
import { LedgerHead } from "@/components/mdm/ledger";
import { MergedRecords } from "@/components/mdm/merged-records";
import { GatedPrimary } from "@/components/gated-primary";
import { useRole } from "@/hooks/use-role";
import { formatModuleName } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";
import type { MasterRecordDetail } from "@/types/api";
import type { ColumnDef } from "@tanstack/react-table";

type Rel = { id: string; relationship_type: string; to_key: string; to_domain: string };
type Hist = { id: string; changed_at: string; change_type: string; changed_by?: string | null };
type FieldRow = { field: string; value: unknown };
type SourceRow = { system: string; value: unknown; confidence: number; ai: string | null | undefined };

const STATUS_LABEL: Record<string, string> = { candidate: "Candidate", pending_review: "Pending review", golden: "Golden", superseded: "Superseded" };
const show = (v: unknown) => (v == null ? "None" : String(v));

const relCols: ColumnDef<Rel>[] = [
  { id: "type", header: "Relationship", accessorFn: (r) => r.relationship_type.replace(/_/g, " ") },
  { id: "to", header: "To", cell: ({ row }) => <Mono>{row.original.to_key}</Mono> },
  { id: "domain", header: "Object", accessorFn: (r) => formatModuleName(r.to_domain) },
];
const histCols: ColumnDef<Hist>[] = [
  { id: "when", header: "When", accessorFn: (e) => e.changed_at },
  { id: "type", header: "Type", accessorFn: (e) => e.change_type },
  { id: "by", header: "By", accessorFn: (e) => e.changed_by ?? "System" },
];
const fieldCols: ColumnDef<FieldRow>[] = [
  { id: "field", header: "Field", cell: ({ row }) => <Mono>{row.original.field}</Mono> },
  { id: "value", header: "Value", accessorFn: (r) => show(r.value) },
];
const sourceCols: ColumnDef<SourceRow>[] = [
  { id: "system", header: "System", cell: ({ row }) => <Mono>{row.original.system}</Mono> },
  { id: "value", header: "Value", accessorFn: (r) => show(r.value) },
  { id: "conf", header: "Confidence", accessorFn: (r) => `${Math.round(r.confidence * 100)}%` },
  { id: "ai", header: "Model recommendation", accessorFn: (r) => r.ai ?? "None" },
];

export default function MasterRecordPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const { can } = useRole();
  const canApprove = can("approve");
  const canApply = can("apply");
  const [confirmPromote, setConfirmPromote] = useState(false);

  const recordQuery = useQuery<MasterRecordDetail>({
    queryKey: queryKeys.masterRecord(id),
    queryFn: () => getMasterRecord(id),
  });
  const historyQuery = useQuery({
    queryKey: queryKeys.masterRecordHistory(id),
    queryFn: () => getMasterRecordHistory(id),
  });
  const record = recordQuery.data;
  const relationshipsQuery = useQuery({
    queryKey: queryKeys.relationships({ key: record?.sap_object_key }),
    queryFn: () => getRelationships({ key: record?.sap_object_key, domain: record?.domain }),
    enabled: !!record,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: queryKeys.masterRecord(id) });
    qc.invalidateQueries({ queryKey: queryKeys.masterRecordHistory(id) });
  };
  const promote = useMutation({
    mutationFn: () => promoteMasterRecord(id, true),
    onSuccess: () => { invalidate(); setConfirmPromote(false); },
    onError: (error) => {
      toast.error(apiErrorMessage(error));
    },
  });
  const writeback = useMutation({
    mutationFn: () => writebackMasterRecord(id),
    onError: (error) => {
      toast.error(apiErrorMessage(error));
    },
  });

  if (recordQuery.isLoading) {
    return (
      <div className="flex flex-col gap-2">
        <Skeleton height={32} />
        <Skeleton height={120} />
      </div>
    );
  }
  if (recordQuery.isError) {
    return (
      <div>
        <ErrorState
          {...apiErrorState(recordQuery.error)}
          onRetry={() => void recordQuery.refetch()}
        />
      </div>
    );
  }
  if (!record) {
    return (
      <EmptyState
        title="Record not found"
        detail="It may have been removed or you may not have access."
        action={<Button render={<Link href="/mdm/golden">All golden records</Link>} />}
      />
    );
  }

  // RecordPage only speaks the record-quality vocabulary; the golden-record status is the Pill in the overview.
  const status: RecordStatus = record.status === "golden"
    ? { label: "passing", tone: "go" }
    : { label: "in batch", tone: record.status === "superseded" ? "neutral" : "at-risk" };
  const promotable = record.status !== "golden" && record.status !== "superseded";

  const fields = Object.entries(record.golden_fields);
  const sources = Object.entries(record.source_contributions);
  const relationships = relationshipsQuery.data?.relationships ?? [];
  const history = historyQuery.data ?? [];
  const fieldRows: FieldRow[] = fields.map(([field, value]) => ({ field, value }));
  const sourceRows: SourceRow[] = sources.map(([system, c]) => ({ system, value: c.value, confidence: c.confidence, ai: c.ai_recommendation }));

  return (
    <RecordPage
      recordKey={record.sap_object_key}
      object={record.domain}
      status={status}
      meta={record.status === "superseded"
        ? "This record was merged into another golden record. Its own values are kept for an unmerge."
        : `The one trusted version of this record, built from ${sources.length.toLocaleString()} ${sources.length === 1 ? "source" : "sources"}. ${promotable ? "Check the values, then promote it." : "It is the version other systems should use."}`}
      actions={canApprove && promotable ? (
        <Button disabled={promote.isPending} onClick={() => setConfirmPromote(true)}>Promote</Button>
      ) : undefined}
    >
      <EntityTabs entityType="master-records" entityId={id}
        related={<>
      <section aria-label="Related records">
        <LedgerHead title="Related records" meta={String(relationships.length)} />
        {relationshipsQuery.isLoading ? <Skeleton height={80} /> : relationshipsQuery.isError ? (
          <ErrorState {...apiErrorState(relationshipsQuery.error)} onRetry={() => void relationshipsQuery.refetch()} />
        ) : relationships.length === 0 ? (
          <EmptyState variant="inline" title="No related records found" detail="Links appear when another object refers to this key." action={<Link className="m-ink-accent-ink hover:underline" href={`/objects/${record.domain}`}>Open the object</Link>} />
        ) : (
          <DataTable columns={relCols} getRowId={(r) => r.id} data={relationships as Rel[]} height="auto" />
        )}
      </section>
        </>}
        history={<>
      <section aria-label="History">
        <LedgerHead title="History" meta={String(history.length)} />
        {historyQuery.isLoading ? <Skeleton height={80} /> : historyQuery.isError ? (
          <ErrorState {...apiErrorState(historyQuery.error)} onRetry={() => void historyQuery.refetch()} />
        ) : history.length === 0 ? (
          <EmptyState variant="inline" title="No changes recorded" detail="Promotions, merges and steward picks are listed here." action={<Link className="m-ink-accent-ink hover:underline" href={`/mdm/golden/merge?id=${record.id}`}>Compare sources</Link>} />
        ) : (
          <DataTable columns={histCols} getRowId={(r) => r.id} data={history as Hist[]} height="auto" />
        )}
      </section>
        </>}
        overview={<>
      <section className="flex items-center gap-2">
        <Pill tone={record.status === "golden" ? "go" : record.status === "superseded" ? "no-go" : "at-risk"}>
          {STATUS_LABEL[record.status] ?? record.status.replace(/_/g, " ")}
        </Pill>
        <Pill tone="neutral">{Math.round(record.overall_confidence * 100)}% confidence</Pill>
        <GatedPrimary
          kind="writeback"
          allowed={canApply}
          variant="secondary"
          disabled={writeback.isPending || (writeback.data ? !writeback.data.writeback_supported : false)}
          onClick={() => writeback.mutate()}
        >
          {writeback.isPending ? "Writing back…" : "Write back"}
        </GatedPrimary>
        <Button variant="ghost" render={<Link href={`/mdm/golden/merge?id=${record.id}`}>Compare sources</Link>} />
      </section>
      {writeback.data ? (
        <p className="m-text-body m-ink-3">{writeback.data.message}</p>
      ) : null}

      <ConfirmDialog
        open={confirmPromote}
        onOpenChange={setConfirmPromote}
        title="Promote to golden record?"
        body={<p className="m-text-body m-ink-2">This replaces the current golden fields for {record.sap_object_key} with the merged values. This cannot be undone.</p>}
        confirmLabel="Promote"
        cancelLabel="Keep as is"
        pending={promote.isPending}
        onConfirm={() => promote.mutate()}
      />

      <section aria-label="Golden fields">
        <LedgerHead title="Golden fields" meta={String(fields.length)} />
        {fields.length === 0 ? (
          <EmptyState variant="inline" title="No golden fields recorded" detail="Fields fill in when the golden record is built from its sources." action={<Link className="m-ink-accent-ink hover:underline" href="/mdm/survivorship">Survivorship rules</Link>} />
        ) : (
          <DataTable columns={fieldCols} getRowId={(r) => r.field} data={fieldRows} height="auto" />
        )}
      </section>

      <section aria-label="Source contributions">
        <LedgerHead title="Source contributions" meta={String(sources.length)} />
        {sources.length === 0 ? (
          <EmptyState variant="inline" title="No sources recorded" detail="A source is added each time an extraction carries this key." action={<Link className="m-ink-accent-ink hover:underline" href="/systems">Open systems</Link>} />
        ) : (
          <DataTable columns={sourceCols} getRowId={(r) => r.system} data={sourceRows} height="auto" />
        )}
      </section>

      <MergedRecords id={record.id} onChanged={invalidate} />

        </>}
      />

      <section>
        <Link href={`/mdm/golden/merge?domain=${encodeURIComponent(record.domain)}`} className="m-text-body m-ink-accent">
          Review match pairs for {formatModuleName(record.domain)}
        </Link>
      </section>
    </RecordPage>
  );
}
