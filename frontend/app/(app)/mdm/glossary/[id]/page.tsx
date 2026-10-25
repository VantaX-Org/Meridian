// frontend/app/(app)/mdm/glossary/[id]/page.tsx
"use client";

import { toast } from "sonner";
import { useState } from "react";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { Button, Card, DataTable, DrillLink, EmptyState, EntityTabs, ErrorState, Field, Mono, Pill, RecordPage, Skeleton, Status, Textarea, buildDrillHref, type RecordStatus } from "@/design";
import { RowLink, actionColumn } from "@/components/mdm/ledger";
import { getGlossaryTerm, requestAIDraft, reviewGlossaryTerm, updateGlossaryTerm } from "@/lib/api/glossary";
import { LedgerHead } from "@/components/mdm/ledger";
import { useRole } from "@/hooks/use-role";
import { apiErrorMessage, apiErrorState } from "@/lib/error";
import { formatDate } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";
import type { ColumnDef } from "@tanstack/react-table";
import type { AIDraftResponse, GlossaryTermDetail } from "@/types/api";

const STATUS_LABEL: Record<string, string> = { active: "Active", under_review: "Under review", deprecated: "Deprecated" };
type Rule = GlossaryTermDetail["linked_rules"][number];
type Change = GlossaryTermDetail["change_history"][number];
type Approved = { code: string; label: string };

const approvedCols: ColumnDef<Approved>[] = [
  { id: "code", header: "Code", cell: ({ row }) => <Mono>{row.original.code}</Mono> },
  { id: "label", header: "Label", accessorFn: (r) => r.label || "None" },
];
const ruleCols: ColumnDef<Rule>[] = [
  { id: "rule", header: "Rule", cell: ({ row }) => <DrillLink href={`/rules/${encodeURIComponent(row.original.rule_id)}`}><Mono>{row.original.rule_id}</Mono></DrillLink> },
  { id: "sev", header: "Severity", cell: ({ row }) => (row.original.severity ? <Status kind="severity" value={row.original.severity} /> : "") },
  { id: "pass", header: "Pass rate", accessorFn: (r) => (r.pass_rate != null ? `${r.pass_rate.toFixed(1)}%` : "") },
  { id: "aff", header: "Records failing", accessorFn: (r) => `${(r.affected_count ?? 0).toLocaleString()}${r.total_count != null ? ` of ${r.total_count.toLocaleString()}` : ""}` },
  actionColumn((r) => <RowLink href={buildDrillHref({ object: r.domain, ruleId: r.rule_id })} label={`See records failing ${r.rule_id}`}>Fix</RowLink>),
];
const changeCols: ColumnDef<Change>[] = [
  { id: "when", header: "When", accessorFn: (e) => e.changed_at, cell: ({ row }) => formatDate(row.original.changed_at, "datetime") },
  { id: "field", header: "Field", accessorFn: (e) => e.field_changed },
  { id: "by", header: "By", accessorFn: (e) => e.changed_by || "Unknown user" },
  { id: "change", header: "Change", accessorFn: (e) => e.new_value ?? "" },
];

function daysSince(iso: string | null): number | null {
  return iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000) : null;
}

export default function GlossaryTermPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  // Same permissions the API checks: PUT and /review need approve, /ai-draft needs trigger_ai.
  const { can } = useRole();
  const canApprove = can("approve");
  const canDraft = can("trigger_ai");
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
      <div className="flex flex-col gap-2">
        <Skeleton height={32} />
        <Skeleton height={120} />
      </div>
    );
  }
  if (termQuery.isError) {
    return (
      <div>
        <ErrorState
          {...apiErrorState(termQuery.error)}
          onRetry={() => void termQuery.refetch()}
        />
      </div>
    );
  }
  const term = termQuery.data;
  if (!term) {
    return (
      <EmptyState
        title="Term not found"
        detail="It may have been removed or you may not have access."
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
    <RecordPage
      recordKey={term.business_name}
      object={term.domain}
      status={status}
      mono={false}
      meta="What this field means to the business, where it lives in SAP, and the rules that check it"
    >
      <EntityTabs entityType="glossary" entityId={id} overview={<>
      <section className="flex items-center gap-2">
        <Pill tone={term.status === "active" ? "go" : term.status === "under_review" ? "at-risk" : "no-go"}>
          {STATUS_LABEL[term.status] ?? term.status.replace(/_/g, " ")}
        </Pill>
        {term.mandatory_for_s4hana ? <Pill tone="no-go">Mandatory for S/4HANA</Pill> : null}
        {term.ai_drafted ? <Pill tone="at-risk">Model draft</Pill> : null}
        {canApprove ? (
          <Button
            variant="secondary"
            disabled={!reviewDue || review.isPending}
            onClick={() => review.mutate()}
          >
            {review.isPending ? "Reviewing…" : reviewDue ? "Mark reviewed" : "Current"}
          </Button>
        ) : null}
      </section>

      <Card title="Definition of record">
        <div className="flex flex-col gap-2">
        {draft ? (
          <Card title="Auto-draft">
            <p className="m-text-body">{draft.business_definition}</p>
            {draft.why_it_matters_business ? (
              <p className="m-text-meta m-ink-3">{draft.why_it_matters_business}</p>
            ) : null}
            <div className="flex gap-2">
              {canApprove ? (
                <Button onClick={() => { setEditDef(draft.business_definition); setDraft(null); }}>
                  Use draft
                </Button>
              ) : null}
              <Button variant="ghost" onClick={() => setDraft(null)}>Discard</Button>
            </div>
          </Card>
        ) : null}
        <Field label="Business definition">
          <Textarea
            rows={4}
            value={currentDef}
            readOnly={!canApprove}
            onChange={(e) => setEditDef(e.target.value)}
            placeholder={canDraft ? "No business definition yet. Use Auto-draft to propose one." : "No business definition yet."}
          />
        </Field>
        <div className="flex gap-2">
          {canDraft ? (
            <Button variant="secondary" onClick={() => autoDraft.mutate()} disabled={autoDraft.isPending}>
              {autoDraft.isPending ? "Drafting…" : "Auto-draft"}
            </Button>
          ) : null}
          {dirty && canApprove ? (
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
        {term.why_it_matters ? <p className="m-text-body">Why it matters: {term.why_it_matters}</p> : null}
        {term.sap_impact ? <p className="m-text-body">SAP impact: {term.sap_impact}</p> : null}
      </div>
      </Card>

      <Card title="Where it lives in SAP">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-1 m-text-body">
          <dt className="m-ink-3">SAP table</dt>
          <dd><Mono>{term.sap_table}</Mono></dd>
          <dt className="m-ink-3">Field</dt>
          <dd><Mono>{term.sap_field}</Mono></dd>
          <dt className="m-ink-3">Technical name</dt>
          <dd><Mono>{term.technical_name}</Mono></dd>
          <dt className="m-ink-3">Steward</dt>
          <dd>{term.data_steward_id ?? "Unassigned"}</dd>
        </dl>
      </Card>

      <section aria-label="Approved values">
        <LedgerHead title="Approved values" meta={String(approved.length)} />
        {approved.length === 0 ? (
          <p className="m-text-body m-ink-3">No approved values are defined for this field, so any value passes the value checks</p>
        ) : (
          <DataTable columns={approvedCols} getRowId={(r) => r.code} data={approved.map(([code, label]) => ({ code, label }))} height="auto" />
        )}
      </section>

      <section aria-label="Linked rules failing">
        <LedgerHead title="Linked rules failing" meta={String(failing.length)} />
        {failing.length === 0 ? (
          <EmptyState variant="inline" title={term.linked_rules.length ? "Every linked rule passes in the latest analysis" : "No rules are linked to this term"} />
        ) : (
          <DataTable columns={ruleCols} getRowId={(r) => r.rule_id} data={failing} height="auto" />
        )}
      </section>

      <section aria-label="Change history">
        <LedgerHead title="Change history" meta={String(term.change_history.length)} />
        {term.change_history.length === 0 ? (
          <EmptyState variant="inline" title="No changes recorded" />
        ) : (
          <DataTable columns={changeCols} getRowId={(r) => r.id} data={term.change_history} height="auto" />
        )}
      </section>
      </>} />
    </RecordPage>
  );
}
