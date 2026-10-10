// frontend/app/(app)/mdm/glossary/[id]/page.tsx
"use client";

import { toast } from "sonner";
import { useState } from "react";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { Button, EmptyState, ErrorState, Field, Mono, Pill, RecordPage, Skeleton, type RecordStatus } from "@/design";
import { getGlossaryTerm, requestAIDraft, reviewGlossaryTerm, updateGlossaryTerm } from "@/lib/api/glossary";
import { apiErrorMessage } from "@/lib/error";
import { queryKeys } from "@/lib/query-keys";
import type { AIDraftResponse, GlossaryTermDetail } from "@/types/api";

function daysSince(iso: string | null): number | null {
  return iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000) : null;
}

export default function GlossaryTermPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const [editDef, setEditDef] = useState<string | null>(null);
  const [draft, setDraft] = useState<AIDraftResponse | null>(null);

  const termQuery = useQuery<GlossaryTermDetail>({
    queryKey: queryKeys.glossaryTerm(id),
    queryFn: () => getGlossaryTerm(id),
  });

  const onMutationError = (error: unknown) => {
    toast.error(apiErrorMessage(error));
  };
  const save = useMutation({
    mutationFn: (body: Parameters<typeof updateGlossaryTerm>[1]) => updateGlossaryTerm(id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.glossaryTerm(id) });
      setEditDef(null);
    },
    onError: onMutationError,
  });
  const review = useMutation({
    mutationFn: () => reviewGlossaryTerm(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.glossaryTerm(id) }),
    onError: onMutationError,
  });
  const autoDraft = useMutation({
    mutationFn: () => requestAIDraft(id),
    onSuccess: setDraft,
    onError: onMutationError,
  });

  if (termQuery.isLoading) {
    return (
      <div className="flex flex-col gap-2 p-6">
        <Skeleton height={32} />
        <Skeleton height={120} />
      </div>
    );
  }
  if (termQuery.isError) {
    return (
      <div className="p-6">
        <ErrorState
          message={apiErrorMessage(termQuery.error)}
          onRetry={() => void termQuery.refetch()}
        />
      </div>
    );
  }
  const term = termQuery.data;
  if (!term) {
    return (
      <EmptyState
        title="Term not found."
        action={<Button render={<Link href="/mdm/glossary">All terms</Link>} />}
      />
    );
  }

  const reviewDays = daysSince(term.last_reviewed_at);
  const reviewDue = reviewDays === null || reviewDays >= term.review_cycle_days;
  const currentDef = editDef ?? term.business_definition ?? "";
  const dirty = editDef !== null && editDef !== (term.business_definition ?? "");
  const failing = term.linked_rules.filter((r) => (r.affected_count ?? 0) > 0);
  const approved = term.approved_values == null
    ? []
    : Array.isArray(term.approved_values)
      ? term.approved_values.map((v) => [v, ""] as const)
      : Object.entries(term.approved_values);

  const status: RecordStatus = failing.length > 0
    ? { label: "failing", tone: "no-go" }
    : { label: "passing", tone: "go" };

  return (
    <RecordPage recordKey={term.business_name} object={term.domain} status={status}>
      <section className="flex items-center gap-2">
        <Pill tone={term.status === "active" ? "go" : term.status === "under_review" ? "at-risk" : "no-go"}>
          {term.status.replace("_", " ")}
        </Pill>
        {term.mandatory_for_s4hana ? <Pill tone="no-go">Mandatory for S/4HANA</Pill> : null}
        {term.ai_drafted ? <Pill tone="at-risk">Auto-drafted</Pill> : null}
        <Button
          variant="secondary"
          disabled={!reviewDue || review.isPending}
          onClick={() => review.mutate()}
        >
          {review.isPending ? "Reviewing…" : reviewDue ? "Mark reviewed" : "Current"}
        </Button>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-[14px] font-semibold" style={{ color: "var(--m-ink)" }}>Definition of record</h2>
        {draft ? (
          <div className="flex flex-col gap-2 rounded border p-3" style={{ borderColor: "var(--m-line)" }}>
            <p className="text-[13px]">{draft.business_definition}</p>
            {draft.why_it_matters_business ? (
              <p className="text-[12px]" style={{ color: "var(--m-ink-3)" }}>{draft.why_it_matters_business}</p>
            ) : null}
            <div className="flex gap-2">
              <Button onClick={() => { setEditDef(draft.business_definition); setDraft(null); }}>
                Use draft
              </Button>
              <Button variant="ghost" onClick={() => setDraft(null)}>Discard</Button>
            </div>
          </div>
        ) : null}
        <Field label="Business definition">
          <textarea
            value={currentDef}
            onChange={(e) => setEditDef(e.target.value)}
            placeholder="No business definition yet. Use Auto-draft to propose one."
            className="rounded border px-3 py-1.5 text-[13px]"
            style={{ borderColor: "var(--m-line)", minHeight: 96 }}
          />
        </Field>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => autoDraft.mutate()} disabled={autoDraft.isPending}>
            {autoDraft.isPending ? "Drafting…" : "Auto-draft"}
          </Button>
          {dirty ? (
            <>
              <Button
                onClick={() => save.mutate({ business_definition: editDef ?? "" })}
                disabled={save.isPending}
              >
                {save.isPending ? "Saving…" : "Save"}
              </Button>
              <Button variant="ghost" onClick={() => setEditDef(null)}>Discard</Button>
            </>
          ) : null}
        </div>
        {term.why_it_matters ? <p className="text-[13px]">Why it matters: {term.why_it_matters}</p> : null}
        {term.sap_impact ? <p className="text-[13px]">SAP impact: {term.sap_impact}</p> : null}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-[14px] font-semibold" style={{ color: "var(--m-ink)" }}>Where it lives in SAP</h2>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-[13px]">
          <dt style={{ color: "var(--m-ink-3)" }}>SAP table</dt>
          <dd><Mono>{term.sap_table}</Mono></dd>
          <dt style={{ color: "var(--m-ink-3)" }}>Field</dt>
          <dd><Mono>{term.sap_field}</Mono></dd>
          <dt style={{ color: "var(--m-ink-3)" }}>Technical name</dt>
          <dd><Mono>{term.technical_name}</Mono></dd>
          <dt style={{ color: "var(--m-ink-3)" }}>Steward</dt>
          <dd>{term.data_steward_id ?? "Unassigned"}</dd>
        </dl>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-[14px] font-semibold" style={{ color: "var(--m-ink)" }}>
          Approved values ({approved.length})
        </h2>
        {approved.length === 0 ? (
          <p className="text-[13px]" style={{ color: "var(--m-ink-3)" }}>No approved values are defined for this field.</p>
        ) : (
          <table className="text-[13px]">
            <thead><tr><th className="text-left pr-4">Code</th><th className="text-left">Label</th></tr></thead>
            <tbody>
              {approved.map(([code, label]) => (
                <tr key={code}>
                  <td className="pr-4"><Mono>{code}</Mono></td>
                  <td>{label || "None"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-[14px] font-semibold" style={{ color: "var(--m-ink)" }}>
          Linked rules failing ({failing.length})
        </h2>
        {failing.length === 0 ? (
          <p className="text-[13px]" style={{ color: "var(--m-ink-3)" }}>
            {term.linked_rules.length ? "Every linked rule passes in the latest analysis." : "No rules are linked to this term."}
          </p>
        ) : (
          <table className="text-[13px]">
            <thead>
              <tr>
                <th className="text-left pr-4">Rule</th><th className="text-left pr-4">Severity</th>
                <th className="text-left pr-4">Pass rate</th><th className="text-left">Affected of total</th>
              </tr>
            </thead>
            <tbody>
              {failing.map((r) => (
                <tr key={r.rule_id}>
                  <td className="pr-4"><Mono>{r.rule_id}</Mono></td>
                  <td className="pr-4">{r.severity ?? "None"}</td>
                  <td className="pr-4">{r.pass_rate != null ? `${r.pass_rate.toFixed(1)}%` : "None"}</td>
                  <td>{r.affected_count} of {r.total_count ?? "None"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-[14px] font-semibold" style={{ color: "var(--m-ink)" }}>
          Change history ({term.change_history.length})
        </h2>
        {term.change_history.length === 0 ? (
          <p className="text-[13px]" style={{ color: "var(--m-ink-3)" }}>No changes recorded.</p>
        ) : (
          <table className="text-[13px]">
            <thead><tr><th className="text-left pr-4">Field</th><th className="text-left pr-4">By</th><th className="text-left">Change</th></tr></thead>
            <tbody>
              {term.change_history.map((e) => (
                <tr key={e.id}>
                  <td className="pr-4">{e.field_changed}</td>
                  <td className="pr-4">{e.changed_by}</td>
                  <td>{e.new_value ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </RecordPage>
  );
}
