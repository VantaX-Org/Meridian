"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PageHead, KPI, SectionHeader } from "@/components/meridian/atoms";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  getProposedRules,
  approveProposedRule,
  rejectProposedRule,
} from "@/lib/api/match-rules";
import { relativeTime } from "@/lib/format";
import type { AIProposedRule } from "@/types/api";

/**
 * AI Rules — steward review queue for match rules the engine proposes from
 * accepted steward corrections. Approving a rule promotes it into the live
 * match engine; rejecting drops it. Pure review surface over
 * ``/api/v1/ai/proposed-rules`` — no rule logic lives here.
 */
export default function AiRulesPage() {
  const qc = useQueryClient();
  const [confirmApprove, setConfirmApprove] = useState<AIProposedRule | null>(null);

  const rulesQ = useQuery({
    queryKey: ["ai.proposed-rules", "pending"],
    queryFn: () => getProposedRules("pending"),
  });

  const approve = useMutation({
    mutationFn: approveProposedRule,
    onSuccess: () => {
      toast.success("Rule approved — added to the match engine");
      qc.invalidateQueries({ queryKey: ["ai.proposed-rules"] });
      setConfirmApprove(null);
    },
    onError: () => toast.error("Could not approve rule"),
  });

  const reject = useMutation({
    mutationFn: rejectProposedRule,
    onSuccess: () => {
      toast.success("Rule rejected");
      qc.invalidateQueries({ queryKey: ["ai.proposed-rules"] });
    },
    onError: () => toast.error("Could not reject rule"),
  });

  const rules = useMemo(() => rulesQ.data?.rules ?? [], [rulesQ.data]);
  const corrections = useMemo(
    () => rules.reduce((n, r) => n + r.supporting_correction_count, 0),
    [rules],
  );
  const domains = useMemo(
    () => new Set(rules.map((r) => r.domain)).size,
    [rules],
  );

  if (rulesQ.isLoading) {
    return (
      <>
        <PageHead title="AI Rules" route="Steward · /ai/rules" sub="Loading proposals…" />
        <Skeleton className="h-[420px] rounded-[10px]" />
      </>
    );
  }
  if (rulesQ.error) {
    return (
      <>
        <PageHead title="AI Rules" route="Steward · /ai/rules" sub="Failed to load." />
        <div className="mn-card mn-card-pad" style={{ color: "var(--mn-neg)" }}>
          Could not reach <code>/api/v1/ai/proposed-rules</code>.
        </div>
      </>
    );
  }

  return (
    <>
      <PageHead
        title="AI Rules"
        route="Steward · /ai/rules"
        sub="Match rules proposed by the engine from accepted steward corrections. Approve to promote into the live match engine."
      />

      <div
        className="mn-row mn-stagger"
        style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))", marginBottom: 18 }}
      >
        <KPI label="Awaiting review" value={rules.length} tone={rules.length > 0 ? "warn" : "pos"} />
        <KPI label="Domains" value={domains} />
        <KPI label="Supporting corrections" value={corrections} hint="steward corrections behind these proposals" />
      </div>

      {rules.length === 0 ? (
        <div className="mn-card mn-card-pad" style={{ textAlign: "center", padding: 48 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: "var(--mn-ink-700)" }}>
            No AI-proposed rules awaiting review
          </div>
          <div style={{ marginTop: 6, fontSize: 13, color: "var(--mn-ink-400)", maxWidth: 460, marginInline: "auto" }}>
            The engine proposes new match rules once enough steward corrections
            accumulate. Keep reviewing the stewardship queue and proposals will
            appear here.
          </div>
        </div>
      ) : (
        <div className="mn-card" style={{ padding: 0, overflow: "hidden" }}>
          <SectionHeader title="Proposed rules" caption="Pending steward decision" />
          <div className="mn-table-wrap">
            <table className="mn-table">
              <thead>
                <tr>
                  <th style={{ paddingLeft: 20 }}>Domain</th>
                  <th>Field</th>
                  <th>Match</th>
                  <th>Weight</th>
                  <th>Threshold</th>
                  <th>Corrections</th>
                  <th>Rationale</th>
                  <th>Proposed</th>
                  <th style={{ width: 160 }} aria-label="Actions"></th>
                </tr>
              </thead>
              <tbody>
                {rules.map((r) => (
                  <tr key={r.id}>
                    <td style={{ paddingLeft: 20, textTransform: "capitalize" }}>
                      {r.domain.replace(/_/g, " ")}
                    </td>
                    <td className="mn-tabular" style={{ font: "500 12px/1 'JetBrains Mono', monospace" }}>
                      {r.proposed_rule.field}
                    </td>
                    <td>{r.proposed_rule.match_type}</td>
                    <td className="mn-tabular">{r.proposed_rule.weight}</td>
                    <td className="mn-tabular">{r.proposed_rule.threshold}</td>
                    <td className="mn-tabular">{r.supporting_correction_count}</td>
                    <td style={{ maxWidth: 280, color: "var(--mn-ink-500)", fontSize: 12.5 }}>
                      {r.rationale}
                    </td>
                    <td
                      className="mn-tabular"
                      style={{ font: "500 11.5px/1 'JetBrains Mono', monospace", color: "var(--mn-ink-500)" }}
                    >
                      {relativeTime(r.created_at)}
                    </td>
                    <td>
                      <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                        <button
                          type="button"
                          className="mn-btn mn-btn-primary"
                          style={{ padding: "5px 10px", fontSize: 12 }}
                          onClick={() => setConfirmApprove(r)}
                        >
                          Approve
                        </button>
                        <button
                          type="button"
                          className="mn-btn mn-btn-ghost"
                          style={{ padding: "5px 10px", fontSize: 12, color: "var(--mn-neg)" }}
                          disabled={reject.isPending}
                          onClick={() => reject.mutate(r.id)}
                        >
                          Reject
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Approve confirmation — promotes the proposal into the live match engine. */}
      <Dialog open={!!confirmApprove} onOpenChange={(o) => !o && setConfirmApprove(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Approve proposed rule</DialogTitle>
          </DialogHeader>
          {confirmApprove && (
            <p style={{ fontSize: 13, color: "var(--mn-ink-700)", padding: "8px 0" }}>
              Approve the <strong>{confirmApprove.proposed_rule.match_type}</strong> rule on{" "}
              <strong>{confirmApprove.proposed_rule.field}</strong> for{" "}
              <strong style={{ textTransform: "capitalize" }}>
                {confirmApprove.domain.replace(/_/g, " ")}
              </strong>
              ? It will be added to the match engine and applied to future
              match runs immediately.
            </p>
          )}
          <DialogFooter>
            <button type="button" className="mn-btn mn-btn-ghost" onClick={() => setConfirmApprove(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="mn-btn mn-btn-primary"
              disabled={approve.isPending}
              onClick={() => confirmApprove && approve.mutate(confirmApprove.id)}
            >
              {approve.isPending ? "Approving…" : "Approve & promote"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
