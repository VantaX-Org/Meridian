"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Banner, Button, Chip, EmptyState, Stat, Text, Textarea, type ChipTone } from "@/components/aurora";
import { Record360, Record360Loading, Record360Table, td } from "@/components/meridian/record-360";
import { useRole } from "@/hooks/use-role";
import { getGlossaryTerm, requestAIDraft, updateGlossaryTerm, reviewGlossaryTerm } from "@/lib/api/glossary";
import { formatModuleName, relativeTime } from "@/lib/format";
import type { AIDraftResponse, GlossaryStatus, GlossaryTermDetail } from "@/types/api";

const STATUS_TONE: Record<GlossaryStatus, ChipTone> = { active: "success", under_review: "warning", deprecated: "danger" };
const sevTone = (s: string | null): ChipTone => (s === "critical" || s === "high" ? "danger" : s === "medium" ? "warning" : "neutral");

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
    onError: () => toast.error("Could not save definition — please try again"),
  });
  const review = useMutation({
    mutationFn: () => reviewGlossaryTerm(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["glossary", id] }),
    onError: () => toast.error("Could not mark term as reviewed — please try again"),
  });
  const autoDraft = useMutation({
    mutationFn: () => requestAIDraft(id),
    onSuccess: setDraft,
    onError: () => toast.error("Could not draft a definition — please try again"),
  });

  if (isLoading) return <Record360Loading what="term" />;
  if (!term) {
    return <EmptyState title="Glossary term not found" actions={<Link className="aurora-link" href="/glossary">Back to glossary</Link>} />;
  }

  const reviewDays = daysSince(term.last_reviewed_at);
  const reviewDue = reviewDays === null || reviewDays >= term.review_cycle_days;
  const currentDef = editDef ?? term.business_definition ?? "";
  const dirty = editDef !== null && editDef !== (term.business_definition ?? "");
  const failing = term.linked_rules.filter((r) => (r.affected_count ?? 0) > 0);
  const approved = term.approved_values == null ? []
    : Array.isArray(term.approved_values) ? term.approved_values.map((v) => [v, ""] as const)
    : Object.entries(term.approved_values);

  return (
    <Record360
      backHref="/glossary"
      backLabel="Glossary"
      eyebrow={`GLOSSARY TERM · ${formatModuleName(term.domain).toUpperCase()}`}
      title={term.business_name}
      support={`${term.technical_name} · review every ${term.review_cycle_days} days · ${reviewDays === null ? "never reviewed" : `last reviewed ${reviewDays} day${reviewDays === 1 ? "" : "s"} ago`}`}
      chips={
        <>
          <Chip tone={STATUS_TONE[term.status] ?? "neutral"}>{term.status.replace("_", " ")}</Chip>
          {term.mandatory_for_s4hana ? <Chip tone="danger">Mandatory for S/4HANA</Chip> : null}
          {term.ai_drafted ? <Chip tone="info">Auto-drafted</Chip> : null}
          {term.rule_authority ? <Chip>{term.rule_authority}</Chip> : null}
        </>
      }
      actions={can("approve") ? (
        <Button variant="secondary" disabled={!reviewDue || review.isPending} onClick={() => review.mutate()}>
          {review.isPending ? "Reviewing…" : "Mark reviewed"}
        </Button>
      ) : null}
      notice={draft ? (
        <Banner
          tone="info"
          title="Auto-drafted definition"
          action={
            <>
              <Button size="sm" onClick={() => { setEditDef(draft.business_definition); setDraft(null); }}>Use draft</Button>
              <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>Discard</Button>
            </>
          }
        >
          <p>{draft.business_definition}</p>
          {draft.why_it_matters_business ? <p className="mt-2 text-[var(--aurora-fg-tertiary)]">{draft.why_it_matters_business}</p> : null}
        </Banner>
      ) : null}
      kpis={
        <>
          <Stat label="Linked rules" value={term.linked_rules.length} />
          <Stat label="Rules failing" value={failing.length} tone={failing.length ? "danger" : "success"} />
          <Stat label="Approved values" value={approved.length} />
          <Stat label="Review" value={reviewDue ? "Due" : "Current"} tone={reviewDue ? "warning" : "success"} />
        </>
      }
      sources={{
        count: 1,
        body: (
          <>
            <Record360Table head={["SAP table", "Field", "Technical name", "Domain", "Steward"]}>
              <tr>
                <td className={`${td} font-mono`}>{term.sap_table}</td>
                <td className={`${td} font-mono`}>{term.sap_field}</td>
                <td className={`${td} font-mono`}>{term.technical_name}</td>
                <td className={td}>{formatModuleName(term.domain)}</td>
                <td className={td}>{term.data_steward_id ?? "Unassigned"}</td>
              </tr>
            </Record360Table>
            {approved.length ? (
              <div className="mt-4">
                <Text variant="text-micro" tone="tertiary" as="h3">APPROVED VALUES</Text>
                <Record360Table head={["Code", "Label"]}>
                  {approved.map(([code, label]) => (
                    <tr key={code}>
                      <td className={`${td} font-mono`}>{code}</td>
                      <td className={td}>{label || "—"}</td>
                    </tr>
                  ))}
                </Record360Table>
              </div>
            ) : null}
          </>
        ),
      }}
      survivorship={{
        label: "Definition of record",
        count: 1,
        body: (
          <div className="flex flex-col gap-3">
            <Textarea
              aria-label="Business definition"
              value={currentDef}
              onChange={(e) => setEditDef(e.target.value)}
              readOnly={!can("approve")}
              placeholder="No business definition yet. Use Auto-draft to propose one."
            />
            <div className="flex flex-wrap gap-2">
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
            </div>
            {term.why_it_matters ? (
              <div>
                <Text variant="text-micro" tone="tertiary" as="h3">WHY IT MATTERS</Text>
                <Text variant="text-small">{term.why_it_matters}</Text>
              </div>
            ) : null}
            {term.sap_impact ? (
              <div>
                <Text variant="text-micro" tone="tertiary" as="h3">SAP IMPACT</Text>
                <Text variant="text-small">{term.sap_impact}</Text>
              </div>
            ) : null}
          </div>
        ),
      }}
      findings={{
        count: failing.length,
        empty: term.linked_rules.length ? "Every linked rule passes in the latest analysis." : "No rules linked to this term.",
        body: (
          <Record360Table head={["Rule", "Severity", "Pass rate", "Affected / total"]}>
            {failing.map((r) => (
              <tr key={r.rule_id}>
                <td className={`${td} font-mono`}>{r.rule_id}</td>
                <td className={td}>{r.severity ? <Chip tone={sevTone(r.severity)}>{r.severity}</Chip> : "—"}</td>
                <td className={`${td} aurora-number`}>{r.pass_rate != null ? `${r.pass_rate.toFixed(1)}%` : "—"}</td>
                <td className={`${td} aurora-number`}>{r.affected_count} / {r.total_count ?? "—"}</td>
              </tr>
            ))}
          </Record360Table>
        ),
      }}
      history={{
        count: term.change_history.length,
        empty: "No changes recorded.",
        body: (
          <Record360Table head={["When", "Field", "By", "Change"]}>
            {term.change_history.map((e) => (
              <tr key={e.id}>
                <td className={td}>{relativeTime(e.changed_at)}</td>
                <td className={td}>{e.field_changed}</td>
                <td className={td}>{e.changed_by}</td>
                <td className={td}>
                  {e.old_value ? <div className="line-through text-[var(--aurora-fg-tertiary)]">{e.old_value.substring(0, 100)}</div> : null}
                  {e.new_value ? <div>{e.new_value.substring(0, 200)}</div> : null}
                  {e.change_reason ? <div className="italic text-[var(--aurora-fg-tertiary)]">{e.change_reason}</div> : null}
                </td>
              </tr>
            ))}
          </Record360Table>
        ),
      }}
    />
  );
}
