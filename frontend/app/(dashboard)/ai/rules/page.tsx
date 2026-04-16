"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { BrainCircuit, Check, X, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  getProposedRules,
  approveProposedRule,
  rejectProposedRule,
} from "@/lib/api/match-rules";
import { formatModuleName } from "@/lib/format";
import type { AIProposedRule } from "@/types/api";

const MATCH_TYPE_LABELS: Record<string, string> = {
  exact: "Exact",
  fuzzy: "Fuzzy",
  phonetic: "Phonetic",
  numeric_range: "Numeric Range",
  semantic: "Semantic",
};

export default function AIRulesPage() {
  const qc = useQueryClient();
  const [approveTarget, setApproveTarget] = useState<AIProposedRule | null>(null);
  const [rejectTarget, setRejectTarget] = useState<AIProposedRule | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["ai-proposed-rules", "pending"],
    queryFn: () => getProposedRules("pending"),
  });

  const approveMutation = useMutation({
    mutationFn: (id: string) => approveProposedRule(id),
    onSuccess: () => {
      toast.success("Rule approved and added to match engine");
      setApproveTarget(null);
      qc.invalidateQueries({ queryKey: ["ai-proposed-rules"] });
      qc.invalidateQueries({ queryKey: ["match-rules"] });
    },
    onError: () => toast.error("Failed to approve rule"),
  });

  const rejectMutation = useMutation({
    mutationFn: (id: string) => rejectProposedRule(id),
    onSuccess: () => {
      toast.success("Rule rejected");
      setRejectTarget(null);
      setRejectReason("");
      qc.invalidateQueries({ queryKey: ["ai-proposed-rules"] });
    },
    onError: () => toast.error("Failed to reject rule"),
  });

  if (isLoading) return <Skeleton className="h-96" />;

  const rules = data?.rules ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">AI Proposed Rules</h1>
        <p className="text-sm text-muted-foreground">
          Review match rules proposed by AI based on steward correction patterns
        </p>
      </div>

      {rules.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <BrainCircuit className="mb-4 h-10 w-10 text-muted-foreground" />
            <h2 className="mb-2 text-lg font-semibold text-foreground">
              No AI-proposed rules awaiting review
            </h2>
            <p className="max-w-md text-sm text-muted-foreground">
              Rules are generated automatically when steward corrections identify
              consistent patterns.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-black/[0.08] text-left text-xs font-medium text-muted-foreground">
                    <th className="px-4 py-3">Domain</th>
                    <th className="px-4 py-3">Field</th>
                    <th className="px-4 py-3">Match Type</th>
                    <th className="px-4 py-3">Weight</th>
                    <th className="px-4 py-3">Threshold</th>
                    <th className="px-4 py-3">Rationale</th>
                    <th className="px-4 py-3">Corrections</th>
                    <th className="px-4 py-3">Created</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rules.map((rule) => (
                    <tr
                      key={rule.id}
                      className="border-b border-black/[0.04] last:border-b-0"
                    >
                      <td className="px-4 py-3 text-sm font-medium">
                        {formatModuleName(rule.domain)}
                      </td>
                      <td className="px-4 py-3">
                        <code className="rounded bg-white/[0.60] px-1.5 py-0.5 text-xs text-foreground">
                          {rule.proposed_rule.field}
                        </code>
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant="secondary" className="text-xs">
                          {MATCH_TYPE_LABELS[rule.proposed_rule.match_type] ??
                            rule.proposed_rule.match_type}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-sm">
                        {rule.proposed_rule.weight}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        {rule.proposed_rule.threshold}
                      </td>
                      <td className="max-w-xs px-4 py-3 text-xs text-[#6B7280]">
                        <span className="line-clamp-2">{rule.rationale}</span>
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant="outline" className="text-xs">
                          {rule.supporting_correction_count}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {new Date(rule.created_at).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-1">
                          <Button
                            size="xs"
                            onClick={() => setApproveTarget(rule)}
                            className="bg-[#16A34A] hover:bg-[#16A34A]/80 text-black"
                          >
                            <Check className="mr-1 h-3 w-3" />
                            Approve
                          </Button>
                          <Button
                            size="xs"
                            variant="outline"
                            onClick={() => setRejectTarget(rule)}
                            className="text-destructive hover:bg-[#DC2626]/10"
                          >
                            <X className="mr-1 h-3 w-3" />
                            Reject
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Approve confirmation dialog */}
      <Dialog open={!!approveTarget} onOpenChange={() => setApproveTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Approve AI Rule</DialogTitle>
          </DialogHeader>
          {approveTarget && (
            <div className="space-y-4 pt-2">
              <p className="text-sm text-[#6B7280]">
                This rule will be added to the match engine for{" "}
                <strong>{formatModuleName(approveTarget.domain)}</strong>.
                Continue?
              </p>
              <div className="rounded-lg bg-white/[0.60] p-3 text-sm">
                <div className="grid grid-cols-2 gap-2">
                  <span className="text-muted-foreground">Field:</span>
                  <span>{approveTarget.proposed_rule.field}</span>
                  <span className="text-muted-foreground">Match Type:</span>
                  <span>
                    {MATCH_TYPE_LABELS[approveTarget.proposed_rule.match_type] ??
                      approveTarget.proposed_rule.match_type}
                  </span>
                  <span className="text-muted-foreground">Weight:</span>
                  <span>{approveTarget.proposed_rule.weight}</span>
                  <span className="text-muted-foreground">Threshold:</span>
                  <span>{approveTarget.proposed_rule.threshold}</span>
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => setApproveTarget(null)}
                >
                  Cancel
                </Button>
                <Button
                  onClick={() => approveMutation.mutate(approveTarget.id)}
                  disabled={approveMutation.isPending}
                  className="bg-[#16A34A] hover:bg-[#16A34A]/80 text-black"
                >
                  {approveMutation.isPending && (
                    <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                  )}
                  Approve Rule
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Reject dialog with optional reason */}
      <Dialog open={!!rejectTarget} onOpenChange={() => setRejectTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject AI Rule</DialogTitle>
          </DialogHeader>
          {rejectTarget && (
            <div className="space-y-4 pt-2">
              <p className="text-sm text-[#6B7280]">
                Reject the proposed{" "}
                <strong>{rejectTarget.proposed_rule.field}</strong> rule for{" "}
                {formatModuleName(rejectTarget.domain)}?
              </p>
              <div className="space-y-2">
                <label className="block text-sm font-medium text-foreground">
                  Reason (optional)
                </label>
                <textarea
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  placeholder="Why is this rule not appropriate?"
                  rows={3}
                  className="w-full rounded-md border border-black/[0.08] px-3 py-2 text-sm placeholder-muted-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setRejectTarget(null);
                    setRejectReason("");
                  }}
                >
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => rejectMutation.mutate(rejectTarget.id)}
                  disabled={rejectMutation.isPending}
                >
                  {rejectMutation.isPending && (
                    <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                  )}
                  Reject Rule
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
