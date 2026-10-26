// frontend/app/(app)/mdm/golden/[id]/page.tsx
"use client";

import Link from "next/link";
import { useState } from "react";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, ConfirmDialog, DataTable, EntityTabs, EmptyState, ErrorState, Mono, Pill, RecordPage, Skeleton, toast } from "@/design";
import { getMasterRecord, getMasterRecordHistory, promoteMasterRecord } from "@/lib/api/master-records";
import { getRelationships } from "@/lib/api/relationships";
import { apiErrorMessage, apiErrorState } from "@/lib/error";
import { LedgerHead } from "@/components/mdm/ledger";
import { MergedRecords } from "@/components/mdm/merged-records";
import { GatedPrimary } from "@/components/gated-primary";
import { GoldenStatusPill, sourceSystems } from "@/components/mdm/golden-status";
import { GoldenWriteback } from "@/components/mdm/golden-writeback";
import { useRole } from "@/hooks/use-role";
import { formatDate, formatModuleName, labelOf } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";
import type { MasterRecordDetail } from "@/types/api";
import type { ColumnDef } from "@tanstack/react-table";

type Rel = { id: string; relationship_type: string; to_key: string; to_domain: string };
type Hist = { id: string; changed_at: string; change_type: string; changed_by?: string | null };
type FieldRow = { field: string; value: unknown };
/** One golden field and the source system its surviving value came from (source_contributions is keyed by field). */
type SourceRow = { field: string; system: string; value: unknown; confidence: number; ai: string | null | undefined };

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
  { id: "field", header: "Field", cell: ({ row }) => <Mono>{row.original.field}</Mono> },
  { id: "system", header: "Source system", cell: ({ row }) => <Mono>{row.original.system}</Mono> },
  { id: "value", header: "Value", accessorFn: (r) => show(r.value) },
  { id: "conf", header: "Confidence", accessorFn: (r) => `${Math.round(r.confidence * 100)}%` },
  { id: "ai", header: "Model recommendation", accessorFn: (r) => r.ai ?? "None" },
];

export default function MasterRecordPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const { can } = useRole();
  const canApprove = can("approve");
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

  // RecordPage's status speaks the record-quality vocabulary, so it is omitted; the lifecycle Pill is in the overview.
  const promotable = record.status !== "golden" && record.status !== "superseded";

  const fields = Object.entries(record.golden_fields);
  const contributions = Object.entries(record.source_contributions);
  const systems = sourceSystems(record.source_contributions);
  const relationships = relationshipsQuery.data?.relationships ?? [];
  const history = historyQuery.data ?? [];
  const fieldRows: FieldRow[] = fields.map(([field, value]) => ({ field, value }));
  const sourceRows: SourceRow[] = contributions.map(([field, c]) => ({ field, system: c.source_system, value: c.value, confidence: c.confidence, ai: c.ai_recommendation }));

  return (
    <RecordPage
      recordKey={record.sap_object_key}
      object={record.domain}
      meta={record.status === "superseded"
        ? "This record was merged into another golden record. Its own values are kept for an unmerge."
        : `The one trusted version of this record, built from ${systems.length.toLocaleString()} source ${systems.length === 1 ? "system" : "systems"}. ${promotable ? "Check the values, then promote it." : "It is the version other systems should use."}`}
      actions={promotable ? (
        <GatedPrimary kind="approve" allowed={canApprove} disabled={promote.isPending} onClick={() => setConfirmPromote(true)}>Promote</GatedPrimary>
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
        <GoldenStatusPill status={record.status} />
        <Pill tone="neutral">{Math.round(record.overall_confidence * 100)}% confidence</Pill>
        <GoldenWriteback recordId={record.id} status={record.status} />
        <Button variant="ghost" render={<Link href={`/mdm/golden/merge?id=${record.id}`}>Compare sources</Link>} />
      </section>

      <ConfirmDialog
        open={confirmPromote}
        onOpenChange={setConfirmPromote}
        title="Promote to golden record?"
        body={<p className="m-text-body m-ink-2">This replaces the current golden fields for <Mono>{record.sap_object_key}</Mono> with the merged values. This cannot be undone.</p>}
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
        <LedgerHead title="Source contributions" meta={`${contributions.length.toLocaleString()} ${contributions.length === 1 ? "field" : "fields"} from ${systems.length.toLocaleString()} ${systems.length === 1 ? "system" : "systems"}`} />
        {contributions.length === 0 ? (
          <EmptyState variant="inline" title="No sources recorded" detail="A source is added each time an extraction carries this key." action={<Link className="m-ink-accent-ink hover:underline" href="/systems">Open systems</Link>} />
        ) : (
          <DataTable columns={sourceCols} getRowId={(r) => r.field} data={sourceRows} height="auto" />
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
