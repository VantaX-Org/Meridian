"use client";

/**
 * AI rules. Two jobs on one page:
 *  - Draft a check: describe a rule in words, let the model write the YAML,
 *    dry-run it against the latest extraction, then save it as a draft that
 *    goes through the normal four-eyes review in Settings, Rules.
 *  - Match rule proposals: match rules the engine proposes from accepted
 *    steward corrections. Approving promotes one into the live match engine.
 * The model sees field names and aggregate statistics only.
 */

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Banner, Button, EmptyState, Field, Input, KeyValue, Metric, MetricStrip, Mono, PageHeader, SectionCard, Select,
  TableSkeleton, Tabs, Textarea,
} from "@/components/ui-core";
import { useRole } from "@/hooks/use-role";
import { approveProposedRule, getProposedRules, rejectProposedRule } from "@/lib/api/match-rules";
import { apiErrorMessage } from "@/lib/api/optional";
import { dryRunRule, generateRule, getRuleDrafts, saveRuleDraft, type DryRun } from "@/lib/api/rule-authoring";
import { getRules } from "@/lib/api/rules";
import { formatModuleName, relativeTime } from "@/lib/format";
import type { AIProposedRule } from "@/types/api";

type TabId = "draft" | "proposals";

export default function AiRulesPage() {
  const params = useSearchParams();
  const router = useRouter();
  const tab: TabId = params.get("view") === "proposals" ? "proposals" : "draft";
  const proposals = useQuery({ queryKey: ["ai.proposed-rules", "pending"], queryFn: () => getProposedRules("pending") });
  const pending = proposals.data?.rules.length;

  return (
    <div className="ui-page">
      <PageHeader title="AI rules"
        summary="Draft a data quality check from a plain description, or review match rules the engine proposes from steward corrections." />
      <Tabs ariaLabel="AI rules" value={tab} onValueChange={(v) => {
          // The workspace hub owns ?tab=; this page keeps its own view in ?view=.
          const next = new URLSearchParams(params.toString());
          if (v === "draft") next.delete("view"); else next.set("view", v);
          router.replace(`?${next.toString()}`, { scroll: false });
        }}
        items={[{ id: "draft", label: "Draft a check" }, { id: "proposals", label: "Match rule proposals", count: pending }]} />
      {tab === "draft" ? <Authoring /> : <Proposals q={proposals} />}
    </div>
  );
}

/* ── Draft a check (PR 275) ──────────────────────────────────────────── */

function Authoring() {
  const qc = useQueryClient();
  const can = useRole().can("manage_rules");
  const modulesQ = useQuery({ queryKey: ["rules.list", { all: true }], queryFn: () => getRules({ limit: 1000 }) });
  const modules = useMemo(() => Array.from(new Set((modulesQ.data?.rules ?? []).map((r) => r.module))).sort()
    .map((m) => ({ value: m, label: formatModuleName(m) })), [modulesQ.data]);
  const [module, setModule] = useState("");
  const [description, setDescription] = useState("");
  const [yaml, setYaml] = useState("");
  const [rationale, setRationale] = useState("");
  const [genErrors, setGenErrors] = useState<string[]>([]);
  const [run, setRun] = useState<DryRun | null>(null);
  const drafts = useQuery({ queryKey: ["rule-drafts", module], queryFn: () => getRuleDrafts(module || undefined), retry: false, meta: { ignoreError: true } });

  const generate = useMutation({
    mutationFn: () => generateRule({ module, description: description.trim() }),
    onSuccess: (r) => {
      setYaml(r.rule_yaml ?? ""); setGenErrors(r.errors ?? []); setRun(null);
      if (!r.rule_yaml) toast.error("The model returned no rule. Rephrase the description and try again.");
    },
    onError: (e) => toast.error(statusOf(e) === 503 ? "AI is not configured or not reachable. Set it up in Settings, AI." : `Rule not generated. ${apiErrorMessage(e)}`),
  });
  const dry = useMutation({
    mutationFn: () => dryRunRule({ module, rule_yaml: yaml }),
    onSuccess: (r) => setRun(r),
    onError: (e) => {
      setRun(null);
      toast.error(statusOf(e) === 404 ? "No extraction for this object yet. Run an extraction, then dry-run again." : `Dry run failed. ${apiErrorMessage(e)}`);
    },
  });
  const save = useMutation({
    mutationFn: () => saveRuleDraft({ module, rule_yaml: yaml, rationale: rationale.trim() || undefined }),
    onSuccess: () => {
      toast.success("Draft saved. A second person reviews it in Settings, Rules.");
      qc.invalidateQueries({ queryKey: ["rule-drafts"] });
    },
    onError: (e) => toast.error(`Draft not saved. ${apiErrorMessage(e)}`),
  });

  if (drafts.data === null) {
    return <EmptyState>Rule drafting is not available on this server.</EmptyState>;
  }

  return (
    <div className="ui-columns">
      <div className="ui-stack">
        <SectionCard title="Describe the check">
          <form className="ui-form" onSubmit={(e) => { e.preventDefault(); generate.mutate(); }}>
            <p className="ui-note">The model sees field names and aggregate statistics only. No record values leave this server.</p>
            <Field label="Object" required>
              {({ controlId }) => <Select id={controlId} options={modules} value={module} onValueChange={(v) => { setModule(v); setRun(null); }}
                placeholder={modulesQ.isLoading ? "Loading objects" : "Choose an object"} />}
            </Field>
            <Field label="What should the check catch?" required helper="For example: purchase order items with a net price of zero that are not free-of-charge items.">
              {({ controlId, helperId }) => <Textarea id={controlId} aria-describedby={helperId} rows={4} maxLength={2000}
                value={description} onChange={(e) => setDescription(e.target.value)} />}
            </Field>
            <div className="ui-form__actions">
              <Button type="submit" disabled={!can || !module || description.trim().length < 10 || generate.isPending}>
                {generate.isPending ? "Generating" : "Generate rule"}
              </Button>
              {!can ? <span className="ui-micro">You need rule management rights to draft rules.</span> : null}
            </div>
          </form>
        </SectionCard>

        <SectionCard title="Rule" meta="YAML, editable">
          <div className="ui-form">
            {genErrors.length ? (
              <Banner tone="warning" title="The generated rule has problems">
                <ul>{genErrors.map((e) => <li key={e}>{e}</li>)}</ul>
              </Banner>
            ) : null}
            <Field label="Rule YAML" helper="Edit freely. Dry-run again after any change.">
              {({ controlId, helperId }) => <Textarea id={controlId} aria-describedby={helperId} rows={14} spellCheck={false}
                className="ui-mono" value={yaml} placeholder="Generate a rule, or paste YAML here."
                onChange={(e) => { setYaml(e.target.value); setRun(null); }} />}
            </Field>
            <Field label="Why this rule" helper="Optional. Shown to the reviewer.">
              {({ controlId, helperId }) => <Input id={controlId} aria-describedby={helperId} maxLength={500} value={rationale} onChange={(e) => setRationale(e.target.value)} />}
            </Field>
            <div className="ui-form__actions">
              <Button variant="secondary" disabled={!can || !module || !yaml.trim() || dry.isPending} onClick={() => dry.mutate()}>
                {dry.isPending ? "Running" : "Dry run"}
              </Button>
              <Button disabled={!can || !module || !yaml.trim() || !run || save.isPending} onClick={() => save.mutate()}
                title={!run ? "Dry-run the rule before saving it" : undefined}>Save draft</Button>
            </div>
          </div>
        </SectionCard>
      </div>

      <div className="ui-stack">
        <SectionCard title="Dry run" meta="Latest extraction, nothing is written">
          {dry.isPending ? <TableSkeleton rows={4} label="Running the rule" />
            : !run ? <p className="ui-note">Dry-run the rule to see how many records it would flag.</p>
            : run.evaluated === false ? <Banner tone="warning" title="Rule not evaluated">{run.reason ?? "The rule could not be evaluated against this extraction."}</Banner>
            : <DryRunResult run={run} />}
        </SectionCard>
        <SectionCard title="Drafts" meta={module ? formatModuleName(module) : "All objects"}>
          {drafts.isLoading ? <TableSkeleton rows={3} label="Loading drafts" />
            : !(drafts.data?.items ?? []).length ? <p className="ui-note">No drafts yet.</p>
            : (
              <table className="ui-mini-table">
                <thead><tr><th>Object</th><th>Rule</th><th>Status</th><th>Saved</th></tr></thead>
                <tbody>
                  {drafts.data!.items!.map((d) => (
                    <tr key={d.id}>
                      <td>{d.domain ? formatModuleName(d.domain) : "—"}</td>
                      <td><Mono>{String(d.proposed_rule?.id ?? d.proposed_rule?.name ?? d.id.slice(0, 8))}</Mono></td>
                      <td>{d.status ? d.status.replace(/_/g, " ") : "—"}</td>
                      <td>{d.created_at ? relativeTime(d.created_at) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          <p className="ui-micro" style={{ marginTop: "var(--aurora-space-3)" }}>
            Saved drafts go live only after review in <Link className="ui-link" href="/settings/rules">Settings, Rules</Link>.
          </p>
        </SectionCard>
      </div>
    </div>
  );
}

function DryRunResult({ run }: { run: DryRun }) {
  const sample = run.sample ?? [];
  const cols = Array.from(new Set(sample.flatMap((r) => Object.keys(r)))).slice(0, 6);
  return (
    <div className="ui-stack" style={{ gap: "var(--aurora-space-4)" }}>
      <KeyValue rows={[
        { k: "Records checked", v: run.population != null ? run.population.toLocaleString() : "—" },
        { k: "Would flag", v: run.hits != null ? run.hits.toLocaleString() : "—" },
        { k: "Pass rate", v: run.pass_rate != null ? `${(run.pass_rate * 100).toFixed(1)}%` : "—" },
      ]} />
      {sample.length ? (
        <>
          <p className="ui-micro">Sample of flagged records. Values are masked.</p>
          <div style={{ overflowX: "auto" }}>
            <table className="ui-mini-table">
              <thead><tr>{cols.map((c) => <th key={c} className="ui-mono">{c}</th>)}</tr></thead>
              <tbody>
                {sample.map((r, i) => <tr key={i}>{cols.map((c) => <td key={c} className="ui-mono">{r[c] == null ? "—" : String(r[c])}</td>)}</tr>)}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </div>
  );
}

function statusOf(e: unknown): number | undefined {
  return (e as { response?: { status?: number } })?.response?.status;
}

/* ── Match rule proposals ──────────────────────────────────────────── */

function Proposals({ q }: { q: UseQueryResult<{ rules: AIProposedRule[] }> }) {
  const qc = useQueryClient();
  const can = useRole().can("approve");
  const [confirm, setConfirm] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["ai.proposed-rules"] });
  const approve = useMutation({
    mutationFn: approveProposedRule,
    onSuccess: () => { toast.success("Rule approved and added to the match engine"); setConfirm(null); refresh(); },
    onError: (e) => toast.error(`Rule not approved. ${apiErrorMessage(e)}`),
  });
  const reject = useMutation({
    mutationFn: rejectProposedRule,
    onSuccess: () => { toast.success("Rule rejected"); refresh(); },
    onError: (e) => toast.error(`Rule not rejected. ${apiErrorMessage(e)}`),
  });

  const rules = q.data?.rules ?? [];
  if (q.isLoading) return <TableSkeleton rows={6} label="Loading proposals" />;
  if (q.error) return <Banner tone="danger" title="Proposals could not be read">{apiErrorMessage(q.error)}</Banner>;

  return (
    <>
      <MetricStrip label="Proposals">
        <Metric label="Awaiting review" value={rules.length} tone={rules.length ? "warning" : "default"} />
        <Metric label="Objects" value={new Set(rules.map((r) => r.domain)).size} />
        <Metric label="Steward corrections behind them" value={rules.reduce((n, r) => n + r.supporting_correction_count, 0)} />
      </MetricStrip>
      <SectionCard title="Proposed match rules" meta="Approving applies the rule to future match runs" flush>
        {!rules.length ? (
          <EmptyState>No proposals to review. The engine proposes a match rule once enough steward corrections agree.</EmptyState>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="ui-mini-table">
              <thead><tr><th>Object</th><th>Field</th><th>Match</th><th className="ui-num">Weight</th><th className="ui-num">Threshold</th>
                <th className="ui-num">Corrections</th><th>Why</th><th>Proposed</th><th><span className="ui-visually-hidden">Actions</span></th></tr></thead>
              <tbody>
                {rules.map((r) => (
                  <tr key={r.id}>
                    <td>{formatModuleName(r.domain)}</td>
                    <td><Mono>{r.proposed_rule.field}</Mono></td>
                    <td>{r.proposed_rule.match_type}</td>
                    <td className="ui-num">{r.proposed_rule.weight}</td>
                    <td className="ui-num">{r.proposed_rule.threshold}</td>
                    <td className="ui-num">{r.supporting_correction_count}</td>
                    <td style={{ maxWidth: 320 }}>{r.rationale}</td>
                    <td>{relativeTime(r.created_at)}</td>
                    <td>
                      {!can ? null : confirm === r.id ? (
                        <div className="ui-form__actions" style={{ flexWrap: "nowrap" }}>
                          <Button size="sm" disabled={approve.isPending} onClick={() => approve.mutate(r.id)}>Add to match engine</Button>
                          <Button size="sm" variant="ghost" onClick={() => setConfirm(null)}>Cancel</Button>
                        </div>
                      ) : (
                        <div className="ui-form__actions" style={{ flexWrap: "nowrap" }}>
                          <Button size="sm" variant="secondary" onClick={() => setConfirm(r.id)}>Approve</Button>
                          <Button size="sm" variant="ghost" disabled={reject.isPending} onClick={() => reject.mutate(r.id)}>Reject</Button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </>
  );
}
