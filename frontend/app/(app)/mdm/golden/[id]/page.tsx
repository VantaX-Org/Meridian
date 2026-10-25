// frontend/app/(app)/mdm/golden/[id]/page.tsx
"use client";

import Link from "next/link";
import { useState } from "react";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, ConfirmDialog, DataTable, EntityTabs, EmptyState, ErrorState, Mono, Pill, RecordPage, Skeleton, Status, toast } from "@/design";
import { getMasterRecord, getMasterRecordHistory, promoteMasterRecord, writebackMasterRecord } from "@/lib/api/master-records";
import { getRelationships } from "@/lib/api/relationships";
import { apiErrorMessage, apiErrorState } from "@/lib/error";
import { LedgerHead } from "@/components/mdm/ledger";
import { GatedPrimary } from "@/components/gated-primary";
import { useRole } from "@/hooks/use-role";
import { formatDate, formatModuleName, labelOf } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";
import type { MasterRecordDetail } from "@/types/api";
import type { ColumnDef } from "@tanstack/react-table";

type Rel = { id: string; relationship_type: string; to_key: string; to_domain: string };
type Hist = { id: string; changed_at: string; change_type: string; changed_by?: string | null };
type FieldRow = { field: string; value: unknown };
type SourceRow = { system: string; value: unknown; confidence: number; ai: string | null | undefined };

const show = (v: unknown) => (v == null ? "None" : String(v));

const relCols: ColumnDef<Rel>[] = [
  { id: "type", header: "Relationship", accessorFn: (r) => r.relationship_type.replace(/_/g, " ") },
  { id: "to", header: "To", cell: ({ row }) => <Mono>{row.original.to_key}</Mono> },
  { id: "domain", header: "Object", accessorFn: (r) => formatModuleName(r.to_domain) },
];
const histCols: ColumnDef<Hist>[] = [
  { id: "when", header: "When", accessorFn: (e) => e.changed_at, cell: ({ row }) => formatDate(row.original.changed_at, "datetime") },
  { id: "type", header: "Change", accessorFn: (e) => labelOf(e.change_type) },
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
  const [confirmWriteback, setConfirmWriteback] = useState(false);

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
    onSuccess: (r) => {
      setConfirmWriteback(false);
      if (r.writeback_supported) toast.success(r.message); else toast(r.message);
    },
    onError: (error) => {
      setConfirmWriteback(false);
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

  const fields = Object.entries(record.golden_fields);
  const sources = Object.entries(record.source_contributions);
  const relationships = relationshipsQuery.data?.relationships ?? [];
  const history = historyQuery.data ?? [];
  const fieldRows: FieldRow[] = fields.map(([field, value]) => ({ field, value }));
  const sourceRows: SourceRow[] = sources.map(([system, c]) => ({ system, value: c.value, confidence: c.confidence, ai: c.ai_recommendation }));

  return (
    <RecordPage recordKey={record.sap_object_key} object={record.domain}>
      <EntityTabs entityType="master-records" entityId={id}
        related={<>
      <section aria-label="Related records">
        <LedgerHead title="Related records" meta={String(relationships.length)} />
        {relationships.length === 0 ? (
          <EmptyState variant="inline" title="No related records" />
        ) : (
          <DataTable columns={relCols} getRowId={(r) => r.id} data={relationships as Rel[]} height="auto" />
        )}
      </section>
        </>}
        history={<>
      <section aria-label="History">
        <LedgerHead title="History" meta={String(history.length)} />
        {history.length === 0 ? (
          <EmptyState variant="inline" title="No changes recorded" />
        ) : (
          <DataTable columns={histCols} getRowId={(r) => r.id} data={history as Hist[]} height="auto" />
        )}
      </section>
        </>}
        overview={<>
      <section className="flex items-center gap-2">
        <Status kind="lifecycle" value={record.status} />
        <Pill tone="neutral">{Math.round(record.overall_confidence * 100)}% confidence</Pill>
        {canApprove ? (
          <Button
            disabled={record.status === "golden" || record.status === "superseded" || promote.isPending}
            onClick={() => setConfirmPromote(true)}
          >
            {promote.isPending ? "Promoting…" : "Promote"}
          </Button>
        ) : null}
        <GatedPrimary
          kind="writeback"
          allowed={canApply}
          variant="secondary"
          disabled={writeback.isPending || (writeback.data ? !writeback.data.writeback_supported : false)}
          onClick={() => setConfirmWriteback(true)}
        >
          {writeback.isPending ? "Writing back…" : "Write back"}
        </GatedPrimary>
        <Button variant="ghost" render={<Link href={`/mdm/golden/merge?id=${record.id}`}>Compare sources</Link>} />
      </section>
      <ConfirmDialog
        open={confirmPromote}
        onOpenChange={setConfirmPromote}
        title="Promote to golden record?"
        body={<>This replaces the current golden fields for <Mono>{record.sap_object_key}</Mono> with the merged values. This cannot be undone.</>}
        confirmLabel="Promote"
        cancelLabel="Keep as is"
        pending={promote.isPending}
        onConfirm={() => promote.mutate()}
      />
      <ConfirmDialog
        open={confirmWriteback}
        onOpenChange={setConfirmWriteback}
        title={`Write back ${record.sap_object_key}?`}
        body={
          <div className="flex flex-col gap-2">
            <p>Fields: {fields.length ? fields.map(([f]) => f).join(", ") : "none"}</p>
            <p>Target system{sources.length === 1 ? "" : "s"}: {sources.length ? sources.map(([s]) => s).join(", ") : "none recorded"}</p>
          </div>
        }
        confirmLabel="Write back"
        cancelLabel="Keep"
        pending={writeback.isPending}
        onConfirm={() => writeback.mutate()}
      />

      <section aria-label="Golden fields">
        <LedgerHead title="Golden fields" meta={String(fields.length)} />
        {fields.length === 0 ? (
          <EmptyState variant="inline" title="No golden fields recorded" />
        ) : (
          <DataTable columns={fieldCols} getRowId={(r) => r.field} data={fieldRows} height="auto" />
        )}
      </section>

      <section aria-label="Source contributions">
        <LedgerHead title="Source contributions" meta={String(sources.length)} />
        {sources.length === 0 ? (
          <EmptyState variant="inline" title="No sources recorded" />
        ) : (
          <DataTable columns={sourceCols} getRowId={(r) => r.system} data={sourceRows} height="auto" />
        )}
      </section>

        </>}
      />

      <section>
        <Link href="/insights/duplicates" className="m-text-body m-ink-accent">
          Review merge candidates in duplicates
        </Link>
      </section>
    </RecordPage>
  );
}
