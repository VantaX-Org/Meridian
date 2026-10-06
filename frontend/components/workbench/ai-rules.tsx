"use client";

/**
 * Workbench, AI rule review: match rules the AI proposes after stewards keep
 * correcting the same field. Each proposal shows its evidence (how many
 * corrections back it and the model's rationale), how strongly that evidence
 * supports it, and what it does to the domain's live rule set — then it is
 * approved or rejected in place.
 */

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import {
  Banner, Button, Chip, DataTable, DetailDrawer, EmptyState, KeyValue, PageHeader, Tabs, Tally, type AuroraColumnMeta,
} from "@/components/ui-core";
import type { ChipTone } from "@/components/aurora";
import { useRole } from "@/hooks/use-role";
import { useUrlState } from "@/hooks/use-url-state";
import { approveProposedRule, getMatchRules, getProposedRules, rejectProposedRule } from "@/lib/api/match-rules";
import { formatModuleName, formatDate } from "@/lib/format";
import type { AIProposedRule, MatchRule } from "@/types/api";

type Status = AIProposedRule["status"];
const STATUSES: { id: Status; label: string }[] = [
  { id: "pending", label: "Pending" }, { id: "approved", label: "Approved" }, { id: "rejected", label: "Rejected" },
];
const STATUS_TONE: Record<Status, ChipTone> = { pending: "warning", approved: "success", rejected: "neutral" };
const meta = (m: AuroraColumnMeta) => m;

/**
 * Confidence comes from the evidence, not the model: a proposal is raised at
 * 10 corrections in 7 days, so 10 is the floor.
 * ponytail: fixed bands; calibrate against approval rates once there is history.
 */
function confidence(n: number): { label: string; tone: ChipTone } {
  if (n >= 30) return { label: "High", tone: "success" };
  if (n >= 15) return { label: "Medium", tone: "info" };
  return { label: "Low", tone: "warning" };
}

/** What approving does to the live set: approval inserts a rule, it never edits one. */
function impact(p: AIProposedRule, live: MatchRule[]): string {
  const same = live.filter((r) => r.domain === p.domain && r.field === p.proposed_rule.field && r.active);
  if (!same.length) return `New field for ${formatModuleName(p.domain)}`;
  const r = same[0];
  return `Adds beside ${r.match_type} at ${Math.round(r.threshold * 100)}%${same.length > 1 ? ` (+${same.length - 1})` : ""}`;
}

export function AiRulesSurface() {
  const qc = useQueryClient();
  const { can } = useRole();
  const review = can("review_ai_rules");
  const [status, setStatus] = useUrlState("status", "pending");
  const [open, setOpen] = useState<AIProposedRule | null>(null);
  const [ask, setAsk] = useState<{ p: AIProposedRule; what: "approve" | "reject" } | null>(null);

  const proposals = useQuery({ queryKey: ["ai.proposed-rules", status], queryFn: () => getProposedRules(status) });
  const pending = useQuery({ queryKey: ["ai.proposed-rules", "pending"], queryFn: () => getProposedRules("pending") });
  const live = useQuery({ queryKey: ["match-rules", ""], queryFn: () => getMatchRules() });
  const approved = useQuery({ queryKey: ["ai.proposed-rules", "approved"], queryFn: () => getProposedRules("approved") });
  const rejected = useQuery({ queryKey: ["ai.proposed-rules", "rejected"], queryFn: () => getProposedRules("rejected") });
  const list = proposals.data?.rules ?? [];
  const rules = live.data?.rules ?? [];

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["ai.proposed-rules"] });
    qc.invalidateQueries({ queryKey: ["match-rules"] });
    setOpen(null);
    setAsk(null);
  };
  const approve = useMutation({
    mutationFn: (p: AIProposedRule) => approveProposedRule(p.id),
    onSuccess: (_, p) => { refresh(); toast.success(`${p.proposed_rule.field} rule is live`); },
    onError: (e) => toast.error((e as Error).message || "Not approved"),
  });
  const reject = useMutation({
    mutationFn: (p: AIProposedRule) => rejectProposedRule(p.id),
    onSuccess: (_, p) => { refresh(); toast.success(`${p.proposed_rule.field} proposal rejected`); },
    onError: (e) => toast.error((e as Error).message || "Not rejected"),
  });
  const busy = approve.isPending || reject.isPending;
  const actions = (p: AIProposedRule) => review && p.status === "pending" ? (
    <div className="ui-page-header__actions">
      <Button size="sm" disabled={busy} onClick={(e) => { e.stopPropagation(); setAsk({ p, what: "approve" }); }}>Approve</Button>
      <Button size="sm" variant="ghost" disabled={busy} onClick={(e) => { e.stopPropagation(); setAsk({ p, what: "reject" }); }}>Reject</Button>
    </div>
  ) : null;

  const columns = useMemo<ColumnDef<AIProposedRule, unknown>[]>(() => [
    { id: "domain", header: "Domain", meta: meta({ width: 160 }), cell: ({ row }) => formatModuleName(row.original.domain) },
    { id: "field", header: "Field", meta: meta({ width: 130 }),
      cell: ({ row }) => <span className="aurora-number">{row.original.proposed_rule.field}</span> },
    { id: "match", header: "Match", meta: meta({ width: 170 }), cell: ({ row }) => {
      const r = row.original.proposed_rule;
      return <span className="aurora-number">{r.match_type}, {Math.round(r.threshold * 100)}%, weight {r.weight}</span>;
    } },
    { id: "evidence", header: "Corrections", meta: meta({ width: 110, numeric: true, align: "end" }),
      cell: ({ row }) => row.original.supporting_correction_count.toLocaleString() },
    { id: "confidence", header: "Confidence", meta: meta({ width: 110 }), cell: ({ row }) => {
      const c = confidence(row.original.supporting_correction_count);
      return <Chip tone={c.tone}>{c.label}</Chip>;
    } },
    { id: "impact", header: "If approved", meta: meta({ width: 220 }), cell: ({ row }) => impact(row.original, rules) },
    { id: "rationale", header: "Rationale", meta: meta({ width: 320 }),
      cell: ({ row }) => <span className="ui-micro">{row.original.rationale}</span> },
    { id: "status", header: "State", meta: meta({ width: 100 }),
      cell: ({ row }) => <Chip tone={STATUS_TONE[row.original.status]}>{row.original.status}</Chip> },
    { id: "actions", header: "", cell: ({ row }) => actions(row.original) },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [rules, review, busy]);

  const nPending = pending.data?.rules.length ?? null;
  const nOk = approved.data?.rules.length ?? null;
  const nNo = rejected.data?.rules.length ?? null;
  const decided = (nOk ?? 0) + (nNo ?? 0);
  const rate = nOk === null || nNo === null ? null : decided ? Math.round((nOk / decided) * 100) : null;
  const loading = pending.isLoading || approved.isLoading || rejected.isLoading;

  return (
    <div className="ui-page">
      <PageHeader title="AI rule review" summary="Match rules the AI proposes after stewards keep correcting the same field." />
      <Tally level={2} label="AI rule proposals" figures={[
        { label: "Proposed", value: nPending, loading, tone: nPending ? "warning" : undefined, verdict: nPending ? "Waiting for a reviewer." : "No rules waiting for review.", href: "/ai/rules?status=pending" },
        { label: "Accepted", value: nOk, loading, verdict: nOk ? "Live in the match engine." : "No AI rules in use yet.", href: "/ai/rules?status=approved" },
        { label: "Rejected", value: nNo, loading, verdict: nNo ? "Turned down by a reviewer." : "Nothing turned down.", href: "/ai/rules?status=rejected" },
        { label: "Acceptance rate", value: rate, unit: typeof rate === "number" ? "%" : undefined, loading, verdict: typeof rate === "number" ? "Of decided proposals." : "Nothing decided yet.", href: "/ai/rules?status=approved" },
      ]} />

      {ask ? (
        <Banner tone={ask.what === "approve" ? "info" : "danger"}
          title={ask.what === "approve" ? `Add a ${ask.p.proposed_rule.match_type} rule on ${ask.p.proposed_rule.field}?` : `Reject the ${ask.p.proposed_rule.field} proposal?`}
          action={
            <div className="ui-page-header__actions">
              <Button size="sm" variant={ask.what === "approve" ? "primary" : "danger"} disabled={busy}
                onClick={() => (ask.what === "approve" ? approve : reject).mutate(ask.p)}>{ask.what === "approve" ? "Approve rule" : "Reject proposal"}</Button>
              <Button size="sm" variant="ghost" onClick={() => setAsk(null)}>Not now</Button>
            </div>}>
          {ask.what === "approve" ? `The rule will be added to the match engine for ${formatModuleName(ask.p.domain)}. It changes Meridian's matching only, nothing is written to SAP.` : "The AI will not propose it again until new corrections arrive."}
        </Banner>
      ) : null}

      <Tabs ariaLabel="Proposal state" value={status} onValueChange={setStatus}
        items={STATUSES.map((s) => ({ id: s.id, label: s.label, count: s.id === "pending" ? pending.data?.rules.length : undefined }))} />

      <DataTable<AIProposedRule>
        ariaLabel="AI-proposed match rules"
        columns={columns}
        data={list}
        getRowId={(p) => p.id}
        onRowActivate={setOpen}
        maxHeight={560}
        empty={proposals.isLoading ? "Loading…" : status === "pending"
          ? "No AI-proposed rules awaiting review. The AI proposes one after 10 steward corrections on a field within 7 days."
          : `No ${status} proposals.`}
      />

      <DetailDrawer open={!!open} onClose={() => setOpen(null)} ariaLabel="Proposed rule"
        header={open ? <div className="ui-drawer-head"><h2 className="ui-drawer-head__title">{formatModuleName(open.domain)}, {open.proposed_rule.field}</h2></div> : null}
        footer={open ? actions(open) : null}>
        {open ? (
          <div className="ui-detail">
            <KeyValue rows={[
              { k: "Match type", v: open.proposed_rule.match_type },
              { k: "Threshold", v: `${Math.round(open.proposed_rule.threshold * 100)}%` },
              { k: "Weight", v: String(open.proposed_rule.weight) },
              { k: "Corrections", v: `${open.supporting_correction_count} (${confidence(open.supporting_correction_count).label.toLowerCase()} confidence)` },
              { k: "Rationale", v: open.rationale || "No rationale recorded." },
              { k: "If approved", v: impact(open, rules) },
              { k: "Proposed", v: formatDate(open.created_at, "datetime") },
              ...(open.reviewed_at ? [{ k: `Reviewed (${open.status})`, v: formatDate(open.reviewed_at, "datetime") }] : []),
            ]} />
          </div>
        ) : null}
      </DetailDrawer>
      {!review ? <EmptyState>You can view proposals. AI reviewers approve or reject them.</EmptyState> : null}
    </div>
  );
}
