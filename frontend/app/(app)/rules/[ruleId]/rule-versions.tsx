"use client";

/** Rules › one rule: the version lifecycle (draft, in review, active, retired) with a Transition menu per version. */

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { Button, Card, ConfirmDialog, DataTable, EmptyState, Menu, Pill, type PillTone, Async } from "@/design";
import { useRole } from "@/hooks/use-role";
import { allowedVersionTargets, transitionRuleVersion, type RuleVersionState } from "@/lib/api/rule-authoring";
import { getRuleVersions, type RuleVersion } from "@/lib/api/rules";
import { apiErrorMessage } from "@/lib/error";
import { formatDate, labelOf } from "@/lib/format";

const STATE_TONE: Record<string, PillTone> = { draft: "neutral", in_review: "at-risk", active: "go", retired: "neutral" };
const TARGET_LABEL: Record<RuleVersionState, (from: string) => string> = {
  draft: () => "Send back to draft",
  in_review: () => "Send to review",
  active: () => "Approve and activate",
  retired: () => "Retire version",
};

export function RuleVersions({ ruleId }: { ruleId: string }) {
  const qc = useQueryClient();
  const { can } = useRole();
  const [retiring, setRetiring] = useState<RuleVersion | null>(null);
  const q = useQuery({ queryKey: ["rule-versions", ruleId], queryFn: () => getRuleVersions(ruleId), retry: false });
  const move = useMutation({
    mutationFn: (v: { version: number; to: RuleVersionState }) => transitionRuleVersion(ruleId, v.version, { to: v.to }),
    onSuccess: (r) => {
      toast.success(`Version ${r.version} is now ${labelOf(r.state).toLowerCase()}`);
      setRetiring(null);
      qc.invalidateQueries({ queryKey: ["rule-versions", ruleId] });
      qc.invalidateQueries({ queryKey: ["rules"] });
    },
    onError: (e) => { setRetiring(null); toast.error(apiErrorMessage(e)); },
  });
  const canMove = can("manage_rules") || can("approve");

  const columns = useMemo<ColumnDef<RuleVersion>[]>(() => [
    { id: "version", header: "Version", cell: ({ row }) => `v${row.original.version}` },
    { id: "state", header: "State", cell: ({ row }) => <Pill tone={STATE_TONE[row.original.state] ?? "neutral"}>{labelOf(row.original.state)}</Pill> },
    { id: "note", header: "Note", cell: ({ row }) => row.original.note ?? "—" },
    { id: "by", header: "Written by", cell: ({ row }) => row.original.created_by ?? "—" },
    { id: "approved", header: "Approved", cell: ({ row }) => (row.original.approved_at ? `${row.original.approved_by ?? ""} ${formatDate(row.original.approved_at, "date")}`.trim() : "—") },
    {
      id: "transition",
      header: "",
      cell: ({ row }) => {
        const v = row.original;
        const targets = allowedVersionTargets(v.state);
        if (!canMove || targets.length === 0) return null;
        return (
          <Menu
            trigger={<Button variant="secondary" size="sm" pending={move.isPending && move.variables?.version === v.version}>Transition</Button>}
            items={targets.map((to) => ({
              label: TARGET_LABEL[to](v.state),
              onSelect: () => (to === "retired" ? setRetiring(v) : move.mutate({ version: v.version, to })),
            }))}
          />
        );
      },
    },
  ], [canMove, move]);

  const versions = q.data?.versions ?? [];
  return (
    <Card title="Versions" meta="A new version applies from the next analysis run">
      <Async query={q} skeleton={96}>{versions.length === 0 ? (
        <EmptyState
          variant="inline"
          title="No tenant versions"
          detail={q.data?.shipped ? "This rule runs as shipped, unchanged" : "Versions appear when the rule is changed"}
        />
      ) : (
        <DataTable columns={columns} data={versions} getRowId={(v) => String(v.version)} hideToolbar dense height="auto" tableId="rule-versions" />
      )}</Async>
      <ConfirmDialog
        open={retiring !== null}
        onOpenChange={(o) => { if (!o) setRetiring(null); }}
        title={retiring ? `Retire version ${retiring.version}` : "Retire version"}
        body="The rule stops running from the next analysis. You can write a new version later."
        confirmLabel="Retire version"
        tone="danger"
        pending={move.isPending}
        onConfirm={() => retiring && move.mutate({ version: retiring.version, to: "retired" })}
      />
    </Card>
  );
}
