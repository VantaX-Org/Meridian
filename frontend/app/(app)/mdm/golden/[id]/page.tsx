// frontend/app/(app)/mdm/golden/[id]/page.tsx
"use client";

import Link from "next/link";
import { useState } from "react";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Dialog, EmptyState, ErrorState, Mono, Pill, RecordPage, Skeleton, toastManager, type RecordStatus } from "@/design";
import { getMasterRecord, getMasterRecordHistory, promoteMasterRecord, writebackMasterRecord } from "@/lib/api/master-records";
import { getRelationships } from "@/lib/api/relationships";
import { useRole } from "@/hooks/use-role";
import { formatModuleName } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";
import type { MasterRecordDetail } from "@/types/api";

export default function MasterRecordPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const canApprove = useRole().can("approve");
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
      toastManager.add({ title: error instanceof Error ? error.message : "Promote failed." });
    },
  });
  const writeback = useMutation({
    mutationFn: () => writebackMasterRecord(id),
    onError: (error) => {
      toastManager.add({ title: error instanceof Error ? error.message : "Writeback failed." });
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
          message={recordQuery.error instanceof Error ? recordQuery.error.message : "This master record could not be read."}
          onRetry={() => void recordQuery.refetch()}
        />
      </div>
    );
  }
  if (!record) {
    return <EmptyState title="This master record no longer exists." />;
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

  return (
    <RecordPage recordKey={record.sap_object_key} object={record.domain} status={status}>
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
        <Button
          variant="secondary"
          disabled={writeback.isPending || (writeback.data ? !writeback.data.writeback_supported : false)}
          onClick={() => writeback.mutate()}
        >
          {writeback.isPending ? "Writing back…" : "Writeback"}
        </Button>
      </section>
      {writeback.data ? (
        <p className="text-[13px]" style={{ color: "var(--m-ink-3)" }}>{writeback.data.message}</p>
      ) : null}

      <Dialog open={confirmPromote} onOpenChange={setConfirmPromote} title="Promote to golden record?">
        <p className="text-[13px] mb-4" style={{ color: "var(--m-ink-2)" }}>
          This replaces the current golden fields for {record.sap_object_key} with the merged values. This cannot be undone.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setConfirmPromote(false)}>Keep as is</Button>
          <Button disabled={promote.isPending} onClick={() => promote.mutate()}>
            {promote.isPending ? "Promoting…" : "Promote"}
          </Button>
        </div>
      </Dialog>

      <section className="flex flex-col gap-2">
        <h2 className="text-[14px] font-semibold" style={{ color: "var(--m-ink)" }}>Golden fields ({fields.length})</h2>
        {fields.length === 0 ? (
          <p className="text-[13px]" style={{ color: "var(--m-ink-3)" }}>No golden fields recorded.</p>
        ) : (
          <table className="text-[13px]">
            <thead><tr><th className="text-left pr-4">Field</th><th className="text-left">Value</th></tr></thead>
            <tbody>
              {fields.map(([field, value]) => (
                <tr key={field}>
                  <td className="pr-4"><Mono>{field}</Mono></td>
                  <td>{value == null ? "None" : String(value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-[14px] font-semibold" style={{ color: "var(--m-ink)" }}>Source contributions ({sources.length})</h2>
        {sources.length === 0 ? (
          <p className="text-[13px]" style={{ color: "var(--m-ink-3)" }}>No sources recorded.</p>
        ) : (
          <table className="text-[13px]">
            <thead>
              <tr><th className="text-left pr-4">System</th><th className="text-left pr-4">Value</th><th className="text-left pr-4">Confidence</th><th className="text-left">AI recommendation</th></tr>
            </thead>
            <tbody>
              {sources.map(([system, s]) => (
                <tr key={system}>
                  <td className="pr-4"><Mono>{system}</Mono></td>
                  <td className="pr-4">{s.value == null ? "None" : String(s.value)}</td>
                  <td className="pr-4">{Math.round(s.confidence * 100)}%</td>
                  <td>{s.ai_recommendation ?? "None"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-[14px] font-semibold" style={{ color: "var(--m-ink)" }}>Related records ({relationships.length})</h2>
        {relationships.length === 0 ? (
          <p className="text-[13px]" style={{ color: "var(--m-ink-3)" }}>No related records found.</p>
        ) : (
          <table className="text-[13px]">
            <thead><tr><th className="text-left pr-4">Relationship</th><th className="text-left pr-4">To</th><th className="text-left">Domain</th></tr></thead>
            <tbody>
              {relationships.map((r) => (
                <tr key={r.id}>
                  <td className="pr-4">{r.relationship_type.replace(/_/g, " ")}</td>
                  <td className="pr-4"><Mono>{r.to_key}</Mono></td>
                  <td>{formatModuleName(r.to_domain)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-[14px] font-semibold" style={{ color: "var(--m-ink)" }}>History ({history.length})</h2>
        {history.length === 0 ? (
          <p className="text-[13px]" style={{ color: "var(--m-ink-3)" }}>No changes recorded.</p>
        ) : (
          <table className="text-[13px]">
            <thead><tr><th className="text-left pr-4">When</th><th className="text-left pr-4">Type</th><th className="text-left">By</th></tr></thead>
            <tbody>
              {history.map((e) => (
                <tr key={e.id}>
                  <td className="pr-4">{e.changed_at}</td>
                  <td className="pr-4">{e.change_type}</td>
                  <td>{e.changed_by ?? "System"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section>
        <Link href="/insights/duplicates" className="text-[13px]" style={{ color: "var(--m-accent)" }}>
          Review merge candidates in duplicates
        </Link>
      </section>
    </RecordPage>
  );
}
