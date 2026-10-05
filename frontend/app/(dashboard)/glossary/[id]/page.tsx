"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Textarea, type ChipTone } from "@/components/aurora";
import {
  Banner, Button, Chip, EmptyState, KeyValue, Mono, PageHeader, SectionCard, TableSkeleton, Tally,
} from "@/components/ui-core";
import { PageCrumb } from "@/components/shell/page-crumb";
import { useRole } from "@/hooks/use-role";
import { getGlossaryTerm, requestAIDraft, updateGlossaryTerm, reviewGlossaryTerm } from "@/lib/api/glossary";
import { formatModuleName, relativeTime } from "@/lib/format";
import type { AIDraftResponse, GlossaryStatus, GlossaryTermDetail } from "@/types/api";

const STATUS_TONE: Record<GlossaryStatus, ChipTone> = { active: "success", under_review: "warning", deprecated: "danger" };
const sevTone = (s: string | null): ChipTone => (s === "critical" || s === "high" ? "danger" : s === "medium" ? "warning" : "neutral");
const scroll = { overflowX: "auto" } as const;
const NONE = "None";

function daysSince(iso: string | null): number | null {
  return iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000) : null;
}

export default function GlossaryDetailPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const { can } = useRole();
  const [editDef, setEditDef] = useState<string | null>(null);
  const [draft, setDraft] = useState<AIDraftResponse | null>(null);

  const { data: term, isLoading } = useQuery<GlossaryTermDetail>({
    queryKey: ["glossary", id],
    queryFn: () => getGlossaryTerm(id),
  });

  const save = useMutation({
    mutationFn: (body: Parameters<typeof updateGlossaryTerm>[1]) => updateGlossaryTerm(id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["glossary", id] });
      setEditDef(null);
    },
    onError: () => toast.error("Could not save the definition. Try again."),
  });
  const review = useMutation({
    mutationFn: () => reviewGlossaryTerm(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["glossary", id] }),
    onError: () => toast.error("Could not mark the term as reviewed. Try again."),
  });
  const autoDraft = useMutation({
    mutationFn: () => requestAIDraft(id),
    onSuccess: setDraft,
    onError: () => toast.error("Could not draft a definition. Try again."),
  });

  if (isLoading) return <div className="ui-page"><TableSkeleton rows={6} label="Loading term" /></div>;
  if (!term) {
    return (
      <div className="ui-page">
        <EmptyState action={<Link className="ui-link" href="/glossary">Open the glossary</Link>}>This glossary term no longer exists.</EmptyState>
      </div>
    );
  }

  const reviewDays = daysSince(term.last_reviewed_at);
  const reviewDue = reviewDays === null || reviewDays >= term.review_cycle_days;
  const currentDef = editDef ?? term.business_definition ?? "";
  const dirty = editDef !== null && editDef !== (term.business_definition ?? "");
  const failing = term.linked_rules.filter((r) => (r.affected_count ?? 0) > 0);
  const approved = term.approved_values == null ? []
    : Array.isArray(term.approved_values) ? term.approved_values.map((v) => [v, ""] as const)
    : Object.entries(term.approved_values);
  const self = `/glossary/${id}`;

  return (
    <div className="ui-page">
      <PageCrumb segments={[
        { level: "portfolio", label: "Portfolio", href: "/" },
        { level: "object", label: "Glossary", href: "/glossary" },
        { level: "record", label: term.business_name },
      ]} />
      <Tally level={4} label="This term" figures={[
        { label: "Linked rules", value: term.linked_rules.length, verdict: term.linked_rules.length ? "Checks that read this field." : "None.", href: self },
        { label: "Rules failing", value: failing.length, tone: failing.length ? "high" : undefined,
          verdict: failing.length ? "Linked checks that find records failing." : "None.", href: self },
        { label: "Approved values", value: approved.length, verdict: approved.length ? "Codes the field may hold." : "None.", href: self },
        { label: "Review", value: reviewDue ? "Due" : "Current", tone: reviewDue ? "warning" : undefined,
          verdict: reviewDays === null ? "Never reviewed." : `Last reviewed ${reviewDays} day${reviewDays === 1 ? "" : "s"} ago.`, href: self },
      ]} />
      <PageHeader
        title={term.business_name}
        summary={`${formatModuleName(term.domain)}. ${term.technical_name}, reviewed every ${term.review_cycle_days} days.`}
        actions={
          <>
            <Chip tone={STATUS_TONE[term.status] ?? "neutral"}>{term.status.replace("_", " ")}</Chip>
            {term.mandatory_for_s4hana ? <Chip tone="danger">Mandatory for S/4HANA</Chip> : null}
            {term.ai_drafted ? <Chip tone="info">Auto-drafted</Chip> : null}
            {term.rule_authority ? <Chip>{term.rule_authority}</Chip> : null}
            {can("approve") ? (
              <Button variant="secondary" disabled={!reviewDue || review.isPending} onClick={() => review.mutate()}>
                {review.isPending ? "Reviewing…" : "Mark reviewed"}
              </Button>
            ) : null}
          </>
        }
      />

      {draft ? (
        <Banner tone="info" title="Auto-drafted definition"
          action={
            <div className="ui-page-header__actions">
              <Button size="sm" onClick={() => { setEditDef(draft.business_definition); setDraft(null); }}>Use draft</Button>
              <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>Discard</Button>
            </div>}>
          <p>{draft.business_definition}</p>
          {draft.why_it_matters_business ? <p className="ui-micro">{draft.why_it_matters_business}</p> : null}
        </Banner>
      ) : null}

      <SectionCard title="Definition of record"
        action={
          <div className="ui-page-header__actions">
            {can("trigger_ai") ? (
              <Button size="sm" variant="secondary" onClick={() => autoDraft.mutate()} disabled={autoDraft.isPending}>
                {autoDraft.isPending ? "Drafting…" : "Auto-draft"}
              </Button>
            ) : null}
            {dirty ? (
              <>
                <Button size="sm" onClick={() => save.mutate({ business_definition: editDef })} disabled={save.isPending}>
                  {save.isPending ? "Saving…" : "Save"}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setEditDef(null)}>Discard</Button>
              </>
            ) : null}
          </div>}>
        <div className="ui-stack">
          <Textarea
            aria-label="Business definition"
            value={currentDef}
            onChange={(e) => setEditDef(e.target.value)}
            readOnly={!can("approve")}
            placeholder="No business definition yet. Use Auto-draft to propose one."
          />
          {term.why_it_matters ? <KeyValue rows={[{ k: "Why it matters", v: term.why_it_matters }]} /> : null}
          {term.sap_impact ? <KeyValue rows={[{ k: "SAP impact", v: term.sap_impact }]} /> : null}
        </div>
      </SectionCard>

      <SectionCard title="Where it lives in SAP">
        <KeyValue rows={[
          { k: "SAP table", v: term.sap_table, mono: true },
          { k: "Field", v: term.sap_field, mono: true },
          { k: "Technical name", v: term.technical_name, mono: true },
          { k: "Object", v: formatModuleName(term.domain) },
          { k: "Steward", v: term.data_steward_id ?? "Unassigned" },
        ]} />
      </SectionCard>

      <SectionCard title="Approved values" meta={String(approved.length)} flush={approved.length > 0}>
        {approved.length === 0 ? <p className="ui-note">No approved values are defined for this field.</p> : (
          <div style={scroll}>
            <table className="ui-mini-table">
              <thead><tr><th>Code</th><th>Label</th></tr></thead>
              <tbody>
                {approved.map(([code, label]) => (
                  <tr key={code}><td><Mono>{code}</Mono></td><td>{label || NONE}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      <SectionCard title="Linked rules failing" meta={String(failing.length)} flush={failing.length > 0}>
        {failing.length === 0 ? (
          <p className="ui-note">{term.linked_rules.length ? "Every linked rule passes in the latest analysis." : "No rules are linked to this term."}</p>
        ) : (
          <div style={scroll}>
            <table className="ui-mini-table">
              <thead><tr><th>Rule</th><th>Severity</th><th>Pass rate</th><th>Affected of total</th></tr></thead>
              <tbody>
                {failing.map((r) => (
                  <tr key={r.rule_id}>
                    <td><Mono>{r.rule_id}</Mono></td>
                    <td>{r.severity ? <Chip tone={sevTone(r.severity)}>{r.severity}</Chip> : NONE}</td>
                    <td className="aurora-number">{r.pass_rate != null ? `${r.pass_rate.toFixed(1)}%` : NONE}</td>
                    <td className="aurora-number">{r.affected_count} of {r.total_count ?? NONE}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      <SectionCard title="Change history" meta={String(term.change_history.length)} flush={term.change_history.length > 0}>
        {term.change_history.length === 0 ? <p className="ui-note">No changes recorded.</p> : (
          <div style={scroll}>
            <table className="ui-mini-table">
              <thead><tr><th>When</th><th>Field</th><th>By</th><th>Change</th></tr></thead>
              <tbody>
                {term.change_history.map((e) => (
                  <tr key={e.id}>
                    <td>{relativeTime(e.changed_at)}</td>
                    <td>{e.field_changed}</td>
                    <td>{e.changed_by}</td>
                    <td style={{ whiteSpace: "normal" }}>
                      {e.old_value ? <div className="ui-micro">Was: {e.old_value.substring(0, 100)}</div> : null}
                      {e.new_value ? <div>{e.new_value.substring(0, 200)}</div> : null}
                      {e.change_reason ? <div className="ui-micro">{e.change_reason}</div> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </div>
  );
}
