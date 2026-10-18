// frontend/app/(app)/mdm/golden/[id]/page.tsx
"use client";

import { toast } from "sonner";
import Link from "next/link";
import { useState } from "react";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card, DataTable, Dialog, EntityTabs, EmptyState, ErrorState, Mono, Pill, RecordPage, Skeleton, type RecordStatus } from "@/design";
import { getMasterRecord, getMasterRecordHistory, promoteMasterRecord, writebackMasterRecord } from "@/lib/api/master-records";
import { getRelationships } from "@/lib/api/relationships";
import { apiErrorMessage, apiErrorState } from "@/lib/error";
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

const show = (v: unknown) => (v == null ? "None" : String(v));

const relCols: ColumnDef<Rel>[] = [
  { id: "type", header: "Relationship", accessorFn: (r) => r.relationship_type.replace(/_/g, " ") },
  { id: "to", header: "To", cell: ({ row }) => <Mono>{row.original.to_key}</Mono> },
  { id: "domain", header: "Domain", accessorFn: (r) => formatModuleName(r.to_domain) },
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
  { id: "ai", header: "AI recommendation", accessorFn: (r) => r.ai ?? "None" },
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
      <div className="flex flex-col gap-2 p-6">
        <Skeleton height={32} />
        <Skeleton height={120} />
      </div>
    );
  }
  if (recordQuery.isError) {
    return (
      <div className="p-6">
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

  const status: RecordStatus = record.status === "golden"
    ? { label: "passing", tone: "go" }
    : record.status === "superseded"
      ? { label: "failing", tone: "no-go" }
      : { label: "in batch", tone: "at-risk" };

  const fields = Object.entries(record.golden_fields);
  const sources = Object.entries(record.source_contributions);
  const relationships = relationshipsQuery.data?.relationships ?? [];
  const history = historyQuery.data ?? [];
  const fieldRows: FieldRow[] = fields.map(([field, value]) => ({ field, value }));
  const sourceRows: SourceRow[] = sources.map(([system, c]) => ({ system, value: c.value, confidence: c.confidence, ai: c.ai_recommendation }));

  return (
    <RecordPage recordKey={record.sap_object_key} object={record.domain} status={status}>
      <EntityTabs entityType="master-records" entityId={id}
        related={<>
      <Card title="Related records" meta={String(relationships.length)}>
        {relationships.length === 0 ? (
          <p className="m-text-body" style={{ color: "var(--m-ink-3)" }}>No related records found</p>
        ) : (
          <DataTable columns={relCols} getRowId={(r) => r.id} data={relationships as Rel[]} height="auto" />
        )}
      </Card>
        </>}
        history={<>
      <Card title="History" meta={String(history.length)}>
        {history.length === 0 ? (
          <p className="m-text-body" style={{ color: "var(--m-ink-3)" }}>No changes recorded</p>
        ) : (
          <DataTable columns={histCols} getRowId={(r) => r.id} data={history as Hist[]} height="auto" />
        )}
      </Card>
        </>}
        overview={<>
      <section className="flex items-center gap-2">
        <Pill tone={record.status === "golden" ? "go" : record.status === "superseded" ? "no-go" : "at-risk"}>
          {record.status.replace("_", " ")}
        </Pill>
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
          onClick={() => writeback.mutate()}
        >
          {writeback.isPending ? "Writing back…" : "Write back"}
        </GatedPrimary>
      </section>
      {writeback.data ? (
        <p className="m-text-body" style={{ color: "var(--m-ink-3)" }}>{writeback.data.message}</p>
      ) : null}

      <Dialog open={confirmPromote} onOpenChange={setConfirmPromote} title="Promote to golden record?">
        <p className="m-text-body mb-4" style={{ color: "var(--m-ink-2)" }}>
          This replaces the current golden fields for {record.sap_object_key} with the merged values. This cannot be undone.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setConfirmPromote(false)}>Keep as is</Button>
          <Button disabled={promote.isPending} onClick={() => promote.mutate()}>
            {promote.isPending ? "Promoting…" : "Promote"}
          </Button>
        </div>
      </Dialog>

      <Card title="Golden fields" meta={String(fields.length)}>
        {fields.length === 0 ? (
          <p className="m-text-body" style={{ color: "var(--m-ink-3)" }}>No golden fields recorded</p>
        ) : (
          <DataTable columns={fieldCols} getRowId={(r) => r.field} data={fieldRows} height="auto" />
        )}
      </Card>

      <Card title="Source contributions" meta={String(sources.length)}>
        {sources.length === 0 ? (
          <p className="m-text-body" style={{ color: "var(--m-ink-3)" }}>No sources recorded</p>
        ) : (
          <DataTable columns={sourceCols} getRowId={(r) => r.system} data={sourceRows} height="auto" />
        )}
      </Card>

        </>}
      />

      <section>
        <Link href="/insights/duplicates" className="m-text-body" style={{ color: "var(--m-accent)" }}>
          Review merge candidates in duplicates
        </Link>
      </section>
    </RecordPage>
  );
}
