"use client";

/**
 * One golden record: the consolidated value of every field, which source it
 * came from and how sure the merge is, plus related records and the audit
 * trail. Promote makes it golden; write-back explains the route to SAP.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import {
  Banner, Button, DataTable, DetailDrawer, EmptyState, KeyValue, Metric, MetricStrip, Mono, PageHeader, SectionCard,
  StatusBadge, TableSkeleton, type AuroraColumnMeta, type Status,
} from "@/components/ui-core";
import { batchLookupGlossary } from "@/lib/api/glossary";
import { getMasterRecord, getMasterRecordHistory, promoteMasterRecord, writebackMasterRecord } from "@/lib/api/master-records";
import { getRelationships } from "@/lib/api/relationships";
import { formatModuleName, relativeTime } from "@/lib/format";
import type { SourceContribution } from "@/types/api";

const meta = (m: AuroraColumnMeta) => m;
const pct = (c: number) => Math.round(c * 100);
const STATUS: Record<string, { badge: Status; label: string }> = {
  candidate: { badge: "idle", label: "Candidate" },
  pending_review: { badge: "medium", label: "Pending review" },
  golden: { badge: "ok", label: "Golden" },
  superseded: { badge: "idle", label: "Superseded" },
};
const CHANGE: Record<string, string> = { created: "Record created", updated: "Fields updated", promoted: "Promoted to golden" };
const show = (v: unknown) => (v == null || v === "" ? "" : typeof v === "object" ? JSON.stringify(v) : String(v));

interface FieldRow { field: string; name: string | null; value: unknown; source?: SourceContribution }

const columns: ColumnDef<FieldRow, unknown>[] = [
  {
    id: "field", header: "Field", meta: meta({ sticky: "start", width: 260 }),
    cell: ({ row }) => row.original.name ? (
      <span className="ui-cell-stack">
        <span className="ui-cell-stack__main">{row.original.name}</span>
        <span className="ui-cell-stack__sub"><Mono>{row.original.field}</Mono></span>
      </span>
    ) : <Mono>{row.original.field}</Mono>,
  },
  { id: "value", header: "Golden value", meta: meta({ minWidth: 220 }), cell: ({ row }) => <Mono>{show(row.original.value)}</Mono> },
  { id: "source", header: "Source", meta: meta({ width: 160 }), cell: ({ row }) => row.original.source?.source_system ?? <span className="ui-micro">No source</span> },
  { id: "extracted", header: "Extracted", meta: meta({ width: 130 }), cell: ({ row }) => (row.original.source ? relativeTime(row.original.source.extracted_at) : "") },
  { id: "conf", header: "Confidence", meta: meta({ width: 110, align: "end", numeric: true }), cell: ({ row }) => (row.original.source ? `${pct(row.original.source.confidence)}%` : "") },
  { id: "suggest", header: "Suggestion", meta: meta({ width: 170 }), cell: ({ row }) => (row.original.source?.ai_recommendation ? `Use ${row.original.source.ai_recommendation}` : "") },
];

export default function GoldenRecordDetailPage() {
  const recordId = useParams().id as string;
  const qc = useQueryClient();
  const [openField, setOpenField] = useState<string | null>(null);

  const { data: record, isLoading, error } = useQuery({ queryKey: ["master-record", recordId], queryFn: () => getMasterRecord(recordId) });
  const fieldKeys = useMemo(() => (record ? Object.keys(record.golden_fields) : []), [record]);
  const { data: glossary } = useQuery({
    queryKey: ["glossary-lookup", fieldKeys], queryFn: () => batchLookupGlossary(fieldKeys), enabled: fieldKeys.length > 0, staleTime: 5 * 60_000,
  });

  const promote = useMutation({
    mutationFn: () => promoteMasterRecord(recordId, true),
    onSuccess: () => {
      toast.success("Promoted to golden");
      qc.invalidateQueries({ queryKey: ["master-record", recordId] });
      qc.invalidateQueries({ queryKey: ["master-records.list"] });
    },
    onError: (e) => toast.error((e as Error).message || "The record was not promoted"),
  });
  const writeback = useMutation({
    mutationFn: () => writebackMasterRecord(recordId),
    onError: (e) => toast.error((e as Error).message || "The write-back route could not be read"),
  });

  if (isLoading) return <div className="ui-page"><TableSkeleton rows={10} label="Loading the record" /></div>;
  if (error || !record) {
    return (
      <div className="ui-page">
        <PageHeader title="Golden record" />
        {error ? <Banner tone="danger" title="The record could not be read">{(error as Error).message}</Banner>
          : <EmptyState action={<Link className="ui-link" href="/golden-records">Back to golden records</Link>}>No master record has this ID.</EmptyState>}
      </div>
    );
  }

  const contributions = record.source_contributions ?? {};
  const rows: FieldRow[] = fieldKeys.map((f) => ({
    field: f, name: glossary?.lookup?.[f]?.business_name ?? null, value: record.golden_fields[f], source: contributions[f],
  }));
  const sources = Array.from(new Set(Object.values(contributions).map((c) => c?.source_system).filter(Boolean)));
  const suggestions = rows.filter((r) => r.source?.ai_recommendation).length;
  const status = STATUS[record.status] ?? { badge: "idle" as Status, label: record.status.replace(/_/g, " ") };
  const open = rows.find((r) => r.field === openField) ?? null;

  return (
    <div className="ui-page">
      <Link href="/golden-records" className="ui-link">Golden records</Link>
      <PageHeader
        title={<Mono>{record.sap_object_key}</Mono>}
        summary={`${formatModuleName(record.domain)}, consolidated from ${sources.length} source system${sources.length === 1 ? "" : "s"}${sources.length ? `: ${sources.join(", ")}` : ""}.`}
        actions={
          <>
            <StatusBadge status={status.badge}>{status.label}</StatusBadge>
            {record.status !== "golden" && record.status !== "superseded" ? (
              <Button onClick={() => promote.mutate()} disabled={promote.isPending}>{promote.isPending ? "Promoting" : "Promote to golden"}</Button>
            ) : null}
            {record.status === "golden" ? (
              <Button variant="secondary" onClick={() => writeback.mutate()} disabled={writeback.isPending}>Write back to SAP</Button>
            ) : null}
          </>
        }
      />

      {/* Write-back does not write to SAP: changes reach SAP through the
          finding-driven four-eyes flow, so the message routes the steward there. */}
      {writeback.data ? (
        <Banner tone="warning" title="Changes reach SAP through findings">
          {writeback.data.message} <Link href="/findings" className="ui-link">Open findings</Link>
        </Banner>
      ) : null}

      <MetricStrip label="Record">
        <Metric label="Overall confidence" value={pct(record.overall_confidence)} unit="%" tone={pct(record.overall_confidence) < 60 ? "warning" : "default"} />
        <Metric label="Fields" value={rows.length} />
        <Metric label="Source systems" value={sources.length} />
        <Metric label="Suggestions" value={suggestions} />
        <Metric label={record.promoted_at ? "Promoted" : "Updated"} value={relativeTime(record.promoted_at ?? record.updated_at)} />
      </MetricStrip>

      <SectionCard title="Field values" meta={rows.length} flush>
        {rows.length ? (
          <DataTable columns={columns} data={rows} getRowId={(r) => r.field} onRowActivate={(r) => setOpenField(r.field)}
            ariaLabel="Field values. Enter opens the field's source and suggestion." maxHeight="56vh" />
        ) : <EmptyState>This record has no fields yet.</EmptyState>}
      </SectionCard>

      <div className="ui-columns">
        <SectionCard title="Related records">
          <Relationships domain={record.domain} objectKey={record.sap_object_key} />
        </SectionCard>
        <SectionCard title="Audit history">
          <History recordId={recordId} />
        </SectionCard>
      </div>

      <DetailDrawer open={Boolean(open)} onClose={() => setOpenField(null)} ariaLabel="Field detail"
        header={open ? <div className="ui-drawer-head"><h2 className="ui-drawer-head__title">{open.name ?? <Mono>{open.field}</Mono>}</h2></div> : null}>
        {open ? (
          <div className="ui-detail">
            <KeyValue rows={[
              { k: "Field", v: open.field, mono: true },
              { k: "Golden value", v: show(open.value), mono: true },
              { k: "Source", v: open.source?.source_system ?? "No source" },
              ...(open.source ? [
                { k: "Source value", v: show(open.source.value), mono: true },
                { k: "Extracted", v: relativeTime(open.source.extracted_at) },
                { k: "Confidence", v: `${pct(open.source.confidence)}%` },
              ] : []),
            ]} />
            {open.source?.ai_recommendation ? (
              <section className="ui-detail-part">
                <h3 className="ui-detail-part__title">Suggested merge</h3>
                <KeyValue rows={[
                  { k: "Use the value from", v: open.source.ai_recommendation },
                  { k: "Confidence", v: `${pct(open.source.ai_confidence ?? 0)}%` },
                ]} />
                {open.source.ai_reasoning ? <p className="ui-note">{open.source.ai_reasoning}</p> : null}
                <p className="ui-micro">A suggestion, not a confirmed value. A steward decides.</p>
              </section>
            ) : null}
          </div>
        ) : null}
      </DetailDrawer>
    </div>
  );
}

function Relationships({ domain, objectKey }: { domain: string; objectKey: string }) {
  const { data, isLoading, error } = useQuery({ queryKey: ["relationships", domain, objectKey], queryFn: () => getRelationships({ domain, key: objectKey }) });
  if (isLoading) return <TableSkeleton rows={3} label="Loading related records" />;
  if (error) return <p className="ui-note">Related records could not be read: {(error as Error).message}</p>;
  const rels = data?.relationships ?? [];
  if (!rels.length) return <p className="ui-note">No related records in other domains.</p>;
  return (
    <table className="ui-mini-table">
      <thead><tr><th scope="col">Record</th><th scope="col">Relationship</th><th scope="col">Impact</th></tr></thead>
      <tbody>
        {rels.map((r) => {
          const from = r.from_domain === domain && r.from_key === objectKey;
          const d = from ? r.to_domain : r.from_domain;
          const k = from ? r.to_key : r.from_key;
          return (
            <tr key={r.id}>
              <td>
                <Link className="ui-link" href={`/golden-records?domain=${encodeURIComponent(d)}`}>{formatModuleName(d)}</Link>{" "}
                <Mono>{k}</Mono>
              </td>
              <td>
                {r.relationship_type.replace(/_/g, " ")}
                {r.sap_link_table ? <> via <Mono>{r.sap_link_table}</Mono></> : null}
                {r.ai_inferred ? (
                  <div className="ui-micro">
                    Probable, not confirmed in SAP{r.ai_confidence != null ? ` (${pct(r.ai_confidence)}% confidence)` : ""}
                  </div>
                ) : null}
              </td>
              <td className="aurora-number">{r.impact_score != null ? `${pct(r.impact_score)}%` : ""}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function History({ recordId }: { recordId: string }) {
  const { data, isLoading, error } = useQuery({ queryKey: ["master-record-history", recordId], queryFn: () => getMasterRecordHistory(recordId) });
  if (isLoading) return <TableSkeleton rows={3} label="Loading the audit history" />;
  if (error) return <p className="ui-note">The audit history could not be read: {(error as Error).message}</p>;
  if (!data?.length) return <p className="ui-note">No changes recorded yet.</p>;
  return (
    <ol className="ui-plain-list">
      {data.map((e) => (
        <li key={e.id}>
          {CHANGE[e.change_type] ?? e.change_type.replace(/_/g, " ")}
          {e.changed_by ? ` by ${e.changed_by}` : ""}, {relativeTime(e.changed_at)}
          {e.ai_was_involved ? (
            <div className="ui-micro">
              {e.ai_recommendation_accepted == null ? "A suggestion was involved."
                : e.ai_recommendation_accepted ? "The suggestion was accepted." : "The suggestion was rejected."}
            </div>
          ) : null}
        </li>
      ))}
    </ol>
  );
}
