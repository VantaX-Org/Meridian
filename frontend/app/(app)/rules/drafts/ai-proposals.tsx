"use client";

/** Rules › Drafts › Proposed by AI: match rules the rule-proposal task wrote from steward corrections
 * (api/routes/ai_feedback.py). Each row shows its evidence; a person with review_ai_rules approves it into
 * the match rules or rejects it with a reason, which the audit log keeps. */

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { Async, ConfirmDialog, DataTable, Field, Mono, Textarea } from "@/design";
import { actionColumn, RowButton } from "@/components/mdm/ledger";
import { approveProposedRule, getProposedRules, rejectProposedRule } from "@/lib/api/match-rules";
import { apiErrorMessage } from "@/lib/error";
import { formatDate, formatModuleName, labelOf, plural } from "@/lib/format";
import type { AIProposedRule } from "@/types/api";

/** Shared with the home page's "Review N proposals" action, so both read one request. */
export const AI_PROPOSALS_KEY = ["ai-proposed-rules", "pending"] as const;
export const getPendingProposals = () => getProposedRules("pending");

export function useAiProposals(enabled: boolean) {
  return useQuery({ queryKey: AI_PROPOSALS_KEY, queryFn: getPendingProposals, enabled });
}

export function AiProposals() {
  const qc = useQueryClient();
  const q = useAiProposals(true);
  const [rejecting, setRejecting] = useState<AIProposedRule | null>(null);
  const [reason, setReason] = useState("");
  const refresh = () => qc.invalidateQueries({ queryKey: AI_PROPOSALS_KEY });
  const approve = useMutation({
    mutationFn: (id: string) => approveProposedRule(id),
    onSuccess: () => { toast.success("Proposal approved. The match rule applies from the next match run"); refresh(); },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });
  const reject = useMutation({
    mutationFn: (v: { id: string; reason: string }) => rejectProposedRule(v.id, v.reason),
    onSuccess: () => { toast.success("Proposal rejected"); setRejecting(null); setReason(""); refresh(); },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  const columns = useMemo<ColumnDef<AIProposedRule>[]>(() => [
    { id: "object", header: "Object", cell: ({ row }) => formatModuleName(row.original.domain) },
    { id: "field", header: "Field", cell: ({ row }) => <Mono>{row.original.proposed_rule.field || "—"}</Mono> },
    {
      id: "match", header: "Match",
      cell: ({ row: { original: { proposed_rule: r } } }) => `${labelOf(r.match_type)}, weight ${r.weight}, threshold ${r.threshold}`,
    },
    {
      id: "evidence", header: "Evidence",
      cell: ({ row: { original: p } }) => (
        <span className="flex flex-col">
          <span>{plural(p.supporting_correction_count, "steward correction")}</span>
          <span className="m-ink-3">{p.rationale}</span>
        </span>
      ),
    },
    { id: "at", header: "Proposed", cell: ({ row }) => formatDate(row.original.created_at, "date") },
    actionColumn((p) => (
      <span className="flex gap-3">
        <RowButton label={`Approve ${p.proposed_rule.field}`} onClick={() => approve.mutate(p.id)} disabled={approve.isPending}>Approve</RowButton>
        <RowButton label={`Reject ${p.proposed_rule.field}`} onClick={() => { setReason(""); setRejecting(p); }} disabled={reject.isPending}>Reject</RowButton>
      </span>
    )),
  ], [approve, reject.isPending]);

  return (
    <>
      <Async
        query={q}
        skeleton="table"
        isEmpty={(d) => d.rules.length === 0}
        empty={{ title: "No proposals waiting", detail: "The AI proposes a match rule after stewards correct ten of its recommendations for one object in a week.", ghost: "table" }}
      >
        {(d) => <DataTable columns={columns} data={d.rules} getRowId={(r) => r.id} tableId="ai-proposed-rules" />}
      </Async>
      <ConfirmDialog
        open={rejecting !== null}
        onOpenChange={(o) => { if (!o) { setRejecting(null); setReason(""); } }}
        title={rejecting ? `Reject the proposed rule on ${rejecting.proposed_rule.field}` : "Reject the proposed rule"}
        confirmLabel="Reject proposal"
        cancelLabel="Keep proposal"
        tone="danger"
        pending={reject.isPending}
        confirmDisabled={!reason.trim()}
        onConfirm={() => { if (rejecting && reason.trim()) reject.mutate({ id: rejecting.id, reason: reason.trim() }); }}
        body={
          <div className="flex flex-col gap-3 m-text-body">
            <p className="m-ink-2">The matcher never uses it. The reason is kept in the audit log.</p>
            <Field label="Reason (required)">
              <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="Field is too sparse to match on" aria-required="true" />
            </Field>
          </div>
        }
      />
    </>
  );
}
