"use client";

/**
 * One glossary term: the business definition stewards maintain for an SAP
 * field, its approved values, the rules that depend on it and its change
 * history. A suggested definition is shown beside the field, never saved
 * until a steward uses and saves it.
 */

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Textarea } from "@/components/aurora";
import {
  Banner, Button, EmptyState, FieldChip, KeyValue, Mono, PageHeader, SectionCard, StatusBadge, TableSkeleton, type Status,
} from "@/components/ui-core";
import { getGlossaryTerm, requestAIDraft, reviewGlossaryTerm, updateGlossaryTerm } from "@/lib/api/glossary";
import { formatModuleName } from "@/lib/format";
import type { AIDraftResponse, GlossaryTermDetail } from "@/types/api";

const TERM_STATUS: Record<string, { badge: Status; label: string }> = {
  active: { badge: "ok", label: "Approved" },
  under_review: { badge: "medium", label: "Under review" },
  deprecated: { badge: "idle", label: "Deprecated" },
};
const SEVERITIES = ["critical", "high", "medium", "low"];
const daysSince = (iso: string | null) => (iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000) : null);

export default function GlossaryDetailPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const { data: term, isLoading, error } = useQuery<GlossaryTermDetail>({ queryKey: ["glossary", id], queryFn: () => getGlossaryTerm(id) });
  const [editDef, setEditDef] = useState<string | null>(null);
  const [draft, setDraft] = useState<AIDraftResponse | null>(null);

  const save = useMutation({
    mutationFn: (body: Parameters<typeof updateGlossaryTerm>[1]) => updateGlossaryTerm(id, body),
    onSuccess: () => { toast.success("Definition saved"); qc.invalidateQueries({ queryKey: ["glossary", id] }); setEditDef(null); },
    onError: (e) => toast.error((e as Error).message || "The definition was not saved"),
  });
  const review = useMutation({
    mutationFn: () => reviewGlossaryTerm(id),
    onSuccess: () => { toast.success("Marked reviewed"); qc.invalidateQueries({ queryKey: ["glossary", id] }); },
    onError: (e) => toast.error((e as Error).message || "The review was not recorded"),
  });
  const drafting = useMutation({
    mutationFn: () => requestAIDraft(id),
    onSuccess: setDraft,
    onError: (e) => toast.error((e as Error).message || "No definition could be suggested"),
  });

  if (isLoading) return <div className="ui-page"><TableSkeleton rows={8} label="Loading the term" /></div>;
  if (error || !term) {
    return (
      <div className="ui-page">
        <PageHeader title="Glossary term" />
        {error ? <Banner tone="danger" title="The term could not be read">{(error as Error).message}</Banner>
          : <EmptyState action={<Link className="ui-link" href="/glossary">Back to the glossary</Link>}>No glossary term has this ID.</EmptyState>}
      </div>
    );
  }

  const reviewDays = daysSince(term.last_reviewed_at);
  const reviewDue = reviewDays === null || reviewDays >= term.review_cycle_days;
  const current = editDef ?? term.business_definition ?? "";
  const dirty = editDef !== null && editDef !== (term.business_definition ?? "");
  const status = TERM_STATUS[term.status] ?? { badge: "idle" as Status, label: term.status.replace(/_/g, " ") };
  const values = term.approved_values;

  return (
    <div className="ui-page">
      <Link href="/glossary" className="ui-link">Glossary</Link>
      <PageHeader
        title={term.business_name}
        summary={<>{formatModuleName(term.domain)} term for <FieldChip table={term.sap_table} field={term.sap_field} />{term.mandatory_for_s4hana ? ", mandatory for S/4HANA." : "."}</>}
        actions={
          <>
            <StatusBadge status={status.badge}>{status.label}</StatusBadge>
            <Button variant="secondary" disabled={!reviewDue || review.isPending} onClick={() => review.mutate()}
              title={reviewDue ? undefined : `Next review is due in ${term.review_cycle_days - (reviewDays ?? 0)} days`}>
              Mark reviewed
            </Button>
          </>
        }
      />

      <div className="ui-columns">
        <div className="ui-stack">
          <SectionCard title="Business definition"
            action={<Button size="sm" variant="ghost" disabled={drafting.isPending} onClick={() => drafting.mutate()}>{drafting.isPending ? "Drafting" : "Suggest a definition"}</Button>}>
            <div className="ui-stack" style={{ gap: "var(--aurora-space-3)" }}>
              <Textarea rows={4} aria-label="Business definition" value={current} onChange={(e) => setEditDef(e.target.value)}
                placeholder="No business definition yet. Write one, or ask for a suggestion." />
              {dirty ? (
                <div className="ui-page-header__actions">
                  <Button size="sm" disabled={save.isPending} onClick={() => save.mutate({ business_definition: editDef ?? "" })}>
                    {save.isPending ? "Saving" : "Save definition"}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditDef(null)}>Discard changes</Button>
                </div>
              ) : null}
              {draft ? (
                <div className="ui-notice" role="region" aria-label="Suggested definition">
                  <span>
                    <strong>Suggested definition.</strong> {draft.business_definition}
                    {draft.why_it_matters_business ? <span className="ui-micro"> Why it matters: {draft.why_it_matters_business}</span> : null}
                  </span>
                  <Button size="sm" onClick={() => { setEditDef(draft.business_definition); setDraft(null); }}>Use this definition</Button>
                  <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>Discard</Button>
                </div>
              ) : null}
              {term.why_it_matters ? <p className="ui-note"><strong>Why it matters.</strong> {term.why_it_matters}</p> : null}
              {term.sap_impact ? <p className="ui-note"><strong>Impact in SAP.</strong> {term.sap_impact}</p> : null}
            </div>
          </SectionCard>

          <SectionCard title="Linked rules" meta={term.linked_rules.length}>
            {term.linked_rules.length === 0 ? <p className="ui-note">No rules check this field yet.</p> : (
              <div className="ui-matrix-scroll">
                <table className="ui-mini-table">
                  <thead><tr><th scope="col">Rule</th><th scope="col">Domain</th><th scope="col">Severity</th><th scope="col">Pass rate</th><th scope="col">Failing records</th></tr></thead>
                  <tbody>
                    {term.linked_rules.map((r) => (
                      <tr key={r.rule_id}>
                        <td><Link className="ui-link" href={`/findings?check_id=${encodeURIComponent(r.rule_id)}`}><Mono>{r.rule_id}</Mono></Link></td>
                        <td>{formatModuleName(r.domain)}</td>
                        <td>{r.severity && SEVERITIES.includes(r.severity) ? <StatusBadge status={r.severity as Status}>{r.severity.charAt(0).toUpperCase() + r.severity.slice(1)}</StatusBadge> : r.severity ?? ""}</td>
                        <td className="aurora-number">{r.pass_rate !== null ? `${r.pass_rate.toFixed(1)}%` : <span className="ui-micro">Not run</span>}</td>
                        <td className="aurora-number">
                          {r.affected_count !== null && r.total_count !== null ? `${r.affected_count.toLocaleString()} of ${r.total_count.toLocaleString()}` : ""}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>
        </div>

        <div className="ui-stack">
          <SectionCard title="Term">
            <KeyValue rows={[
              { k: "Technical name", v: term.technical_name, mono: true },
              { k: "Domain", v: formatModuleName(term.domain) },
              { k: "Mandatory for S/4HANA", v: term.mandatory_for_s4hana ? "Yes" : "No" },
              { k: "Definition", v: term.ai_drafted ? "Suggested, not yet confirmed by a steward" : "Written by a steward" },
              ...(term.rule_authority ? [{ k: "Authority", v: term.rule_authority }] : []),
              ...(term.data_steward_id ? [{ k: "Steward", v: term.data_steward_id }] : []),
              { k: "Review cycle", v: `Every ${term.review_cycle_days} days` },
              { k: "Last reviewed", v: reviewDays === null ? "Never" : `${reviewDays} day${reviewDays === 1 ? "" : "s"} ago` },
            ]} />
          </SectionCard>

          {values ? (
            <SectionCard title="Approved values" meta={Array.isArray(values) ? values.length : Object.keys(values).length}>
              {Array.isArray(values) ? (
                <ul className="ui-keys">{values.map((v) => <li key={v}><Mono>{v}</Mono></li>)}</ul>
              ) : (
                <table className="ui-mini-table">
                  <thead><tr><th scope="col">Code</th><th scope="col">Meaning</th></tr></thead>
                  <tbody>{Object.entries(values).map(([code, l]) => <tr key={code}><td><Mono>{code}</Mono></td><td>{l}</td></tr>)}</tbody>
                </table>
              )}
            </SectionCard>
          ) : null}

          <SectionCard title="Change history" meta={term.change_history.length}>
            {term.change_history.length === 0 ? <p className="ui-note">No changes recorded.</p> : (
              <ol className="ui-plain-list">
                {term.change_history.map((e) => (
                  <li key={e.id}>
                    {e.field_changed.replace(/_/g, " ")} changed by {e.changed_by}, {new Date(e.changed_at).toLocaleDateString()}
                    {e.new_value ? <div className="ui-micro">Now: {e.new_value.substring(0, 200)}</div> : null}
                    {e.old_value ? <div className="ui-micro">Was: {e.old_value.substring(0, 100)}</div> : null}
                    {e.change_reason ? <div className="ui-micro">Reason: {e.change_reason}</div> : null}
                  </li>
                ))}
              </ol>
            )}
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
