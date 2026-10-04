"use client";

/**
 * Workbench → AI rule review: match rules the AI proposes after stewards keep
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
  Button, Chip, DataTable, Drawer, EmptyState, KpiRail, Stack, Stat, Tabs, Text, type AuroraColumnMeta, type ChipTone,
} from "@/components/aurora";
import { useRole } from "@/hooks/use-role";
import { useUrlState } from "@/hooks/use-url-state";
import { approveProposedRule, getMatchRules, getProposedRules, rejectProposedRule } from "@/lib/api/match-rules";
import { formatModuleName } from "@/lib/format";
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
  return `Adds beside ${r.match_type} · ${Math.round(r.threshold * 100)}%${same.length > 1 ? ` (+${same.length - 1})` : ""}`;
}

export function AiRulesSurface() {
  const qc = useQueryClient();
  const { can } = useRole();
  const review = can("review_ai_rules");
  const [status, setStatus] = useUrlState("status", "pending");
  const [open, setOpen] = useState<AIProposedRule | null>(null);

  const proposals = useQuery({ queryKey: ["ai.proposed-rules", status], queryFn: () => getProposedRules(status) });
  const pending = useQuery({ queryKey: ["ai.proposed-rules", "pending"], queryFn: () => getProposedRules("pending") });
  const live = useQuery({ queryKey: ["match-rules", ""], queryFn: () => getMatchRules() });
  const list = proposals.data?.rules ?? [];
  const rules = live.data?.rules ?? [];

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["ai.proposed-rules"] });
    qc.invalidateQueries({ queryKey: ["match-rules"] });
    setOpen(null);
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
  const accept = (p: AIProposedRule) => {
    if (confirm(`A ${p.proposed_rule.match_type} rule on ${p.proposed_rule.field} will be added to the match engine for ${formatModuleName(p.domain)}. Approve?`)) approve.mutate(p);
  };

  const actions = (p: AIProposedRule) => review && p.status === "pending" ? (
    <Stack direction="row" gap={2}>
      <Button size="sm" disabled={busy} onClick={(e) => { e.stopPropagation(); accept(p); }}>Approve</Button>
      <Button size="sm" variant="ghost" disabled={busy} onClick={(e) => { e.stopPropagation(); reject.mutate(p); }}>Reject</Button>
    </Stack>
  ) : null;

  const columns = useMemo<ColumnDef<AIProposedRule, unknown>[]>(() => [
    { id: "domain", header: "Domain", meta: meta({ width: 160 }), cell: ({ row }) => formatModuleName(row.original.domain) },
    { id: "field", header: "Field", meta: meta({ width: 130 }),
      cell: ({ row }) => <span className="aurora-number">{row.original.proposed_rule.field}</span> },
    { id: "match", header: "Match", meta: meta({ width: 170 }), cell: ({ row }) => {
      const r = row.original.proposed_rule;
      return <span className="aurora-number">{r.match_type} · {Math.round(r.threshold * 100)}% · w{r.weight}</span>;
    } },
    { id: "evidence", header: "Corrections", meta: meta({ width: 110, numeric: true, align: "end" }),
      cell: ({ row }) => row.original.supporting_correction_count.toLocaleString() },
    { id: "confidence", header: "Confidence", meta: meta({ width: 110 }), cell: ({ row }) => {
      const c = confidence(row.original.supporting_correction_count);
      return <Chip tone={c.tone}>{c.label}</Chip>;
    } },
    { id: "impact", header: "If approved", meta: meta({ width: 220 }), cell: ({ row }) => impact(row.original, rules) },
    { id: "rationale", header: "Rationale", meta: meta({ width: 320 }),
      cell: ({ row }) => <Text variant="text-small" tone="secondary" className="line-clamp-2">{row.original.rationale}</Text> },
    { id: "status", header: "State", meta: meta({ width: 100 }),
      cell: ({ row }) => <Chip tone={STATUS_TONE[row.original.status]}>{row.original.status}</Chip> },
    { id: "actions", header: "", cell: ({ row }) => actions(row.original) },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [rules, review, busy]);

  const evidence = list.reduce((a, p) => a + p.supporting_correction_count, 0);
  const strong = list.filter((p) => confidence(p.supporting_correction_count).label === "High").length;

  return (
    <Stack gap={6} className="aurora-page">
      <KpiRail>
        <Stat label="Awaiting review" value={pending.data?.rules.length ?? "—"} tone={pending.data?.rules.length ? "warning" : "neutral"} />
        <Stat label={`${STATUSES.find((s) => s.id === status)?.label ?? ""} proposals`} value={list.length} />
        <Stat label="High confidence" value={strong} tone={strong ? "success" : "neutral"} />
        <Stat label="Supporting corrections" value={evidence.toLocaleString()} />
      </KpiRail>

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

      <Drawer open={!!open} onClose={() => setOpen(null)} ariaLabel="Proposed rule"
        header={open ? <Text variant="text-lead">{formatModuleName(open.domain)} · {open.proposed_rule.field}</Text> : null}
        footer={open ? actions(open) : null}>
        {open ? (
          <Stack gap={4}>
            <KpiRail>
              <Stat label="Match type" value={open.proposed_rule.match_type} />
              <Stat label="Threshold" value={`${Math.round(open.proposed_rule.threshold * 100)}%`} />
              <Stat label="Weight" value={open.proposed_rule.weight} />
              <Stat label="Corrections" value={open.supporting_correction_count} tone={confidence(open.supporting_correction_count).tone} />
            </KpiRail>
            <Stack gap={1}>
              <Text variant="text-micro" tone="secondary">Rationale</Text>
              <Text>{open.rationale || "No rationale recorded."}</Text>
            </Stack>
            <Stack gap={1}>
              <Text variant="text-micro" tone="secondary">If approved</Text>
              <Text>{impact(open, rules)}</Text>
            </Stack>
            <Text variant="text-small" tone="secondary">
              Proposed {new Date(open.created_at).toLocaleString()}
              {open.reviewed_at ? ` · ${open.status} ${new Date(open.reviewed_at).toLocaleString()}` : ""}
            </Text>
          </Stack>
        ) : null}
      </Drawer>
      {!review ? <EmptyState title="You can view proposals; AI reviewers approve or reject them." /> : null}
    </Stack>
  );
}
