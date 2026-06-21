"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PageHead } from "@/components/meridian/atoms";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  getProposedRules,
  approveProposedRule,
  rejectProposedRule,
} from "@/lib/api/match-rules";
import type { AIProposedRule } from "@/types/api";

export default function AIRulesPage() {
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState<AIProposedRule | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["ai-proposed-rules", "pending"],
    queryFn: () => getProposedRules("pending"),
  });

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ["ai-proposed-rules"] });

  const approve = useMutation({
    mutationFn: (id: string) => approveProposedRule(id),
    onSuccess: () => {
      toast.success("Rule approved — added to the match engine");
      setConfirm(null);
      invalidate();
    },
    onError: () => toast.error("Could not approve rule"),
  });

  const reject = useMutation({
    mutationFn: (id: string) => rejectProposedRule(id),
    onSuccess: () => {
      toast.success("Rule rejected");
      invalidate();
    },
    onError: () => toast.error("Could not reject rule"),
  });

  const rules = data?.rules ?? [];

  return (
    <div className="space-y-6">
      <PageHead
        title="AI Rules"
        route="/ai/rules"
        sub="Review match rules the AI proposes from accumulated steward corrections."
      />

      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      ) : rules.length === 0 ? (
        <div className="vx-card flex flex-col items-center justify-center gap-2 p-12 text-center">
          <p className="text-sm font-medium text-[var(--mn-ink-700)]">
            No AI-proposed rules awaiting review
          </p>
          <p className="text-xs text-[var(--mn-ink-400)]">
            Proposals appear here once enough steward corrections support a new
            match rule.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {rules.map((r) => (
            <div key={r.id} className="vx-card flex flex-col gap-3 p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs uppercase tracking-wide text-[var(--mn-ink-400)]">
                      {r.domain}
                    </span>
                    <span className="text-sm font-semibold text-[var(--mn-ink-700)]">
                      {r.proposed_rule.field} · {r.proposed_rule.match_type}
                    </span>
                  </div>
                  <p className="text-xs text-[var(--mn-ink-500)]">{r.rationale}</p>
                  <p className="text-[11px] text-[var(--mn-ink-400)]">
                    weight {r.proposed_rule.weight} · threshold{" "}
                    {r.proposed_rule.threshold} · backed by{" "}
                    {r.supporting_correction_count} steward corrections
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    className="rounded-md border border-[var(--mn-line)] px-3 py-1.5 text-xs font-medium text-[var(--mn-ink-600)] hover:bg-[var(--mn-surface-2)] disabled:opacity-50"
                    disabled={reject.isPending}
                    onClick={() => reject.mutate(r.id)}
                  >
                    Reject
                  </button>
                  <button
                    type="button"
                    className="rounded-md bg-[var(--mn-primary-700)] px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90"
                    onClick={() => setConfirm(r)}
                  >
                    Approve
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Approve proposed rule?</DialogTitle>
            <DialogDescription>
              This rule will be added to the match engine and applied to future
              matching runs.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button
              type="button"
              className="rounded-md border border-[var(--mn-line)] px-3 py-1.5 text-xs font-medium"
              onClick={() => setConfirm(null)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="rounded-md bg-[var(--mn-primary-700)] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
              disabled={approve.isPending}
              onClick={() => confirm && approve.mutate(confirm.id)}
            >
              Approve rule
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
