"use client";

/** Rules › Learned: house rules the tenant's own data follows for >= 95% of records
 * (checks/house_rules.py). The miner proposes; a person with `approve` turns a
 * proposal into an active rule with a new LR- id; `manage_rules` can reject. */

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { Button, DataTable, ExplorerPage, Field, Mono, Pill, Select } from "@/design";
import { useRole } from "@/hooks/use-role";
import {
  approveLearnedRule,
  getLearnedRules,
  KIND_LABEL,
  rejectLearnedRule,
  type LearnedKind,
  type LearnedRule,
  type LearnedStatus,
  type Severity,
} from "@/lib/api/learnedRules";
import { errorText } from "@/lib/api/remediation";
import { apiErrorMessage, isListFailure } from "@/lib/error";
import { queryKeys } from "@/lib/query-keys";

const STATUS_OPTIONS = [
  { value: "pending", label: "Awaiting review" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
];
const KIND_OPTIONS = [{ value: "all", label: "All kinds" }, ...Object.entries(KIND_LABEL).map(([value, label]) => ({ value, label }))];
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

export default function LearnedRulesPage() {
  const qc = useQueryClient();
  const { can } = useRole();
  const [status, setStatus] = useState<LearnedStatus>("pending");
  const [kind, setKind] = useState<"all" | LearnedKind>("all");
  const [severity] = useState<Severity>("medium");
  const q = useQuery({
    queryKey: queryKeys.learnedRules({ status, kind }),
    queryFn: () => getLearnedRules(status, kind === "all" ? undefined : kind),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["learned-rules"] });
  const approve = useMutation({
    mutationFn: (id: string) => approveLearnedRule(id, severity),
    onSuccess: (d) => { toast.success(`Rule ${d.rule_id} is active from the next run`); refresh(); },
    onError: (e) => toast.error(errorText(e)),
  });
  const reject = useMutation({
    mutationFn: rejectLearnedRule,
    onSuccess: () => { toast.success("Proposal rejected"); refresh(); },
    onError: (e) => toast.error(errorText(e)),
  });

  const columns = useMemo<ColumnDef<LearnedRule>[]>(() => [
    { id: "kind", header: "Kind", cell: ({ row }) => <Pill tone="neutral">{KIND_LABEL[row.original.kind]}</Pill> },
    { id: "field", header: "Field", cell: ({ row }) => <Mono>{row.original.field}</Mono> },
    { id: "det", header: "Decided by", cell: ({ row }) => (row.original.determinant ? <Mono>{row.original.determinant}</Mono> : "—") },
    { id: "conf", header: "Holds for", cell: ({ row }) => pct(row.original.confidence) },
    { id: "viol", header: "Breaks it", cell: ({ row }) => row.original.violations.toLocaleString() },
    { id: "keys", header: "Examples", cell: ({ row }) => <Mono>{row.original.sample_keys.slice(0, 2).join(", ") || "—"}</Mono> },
    {
      id: "act",
      header: "",
      cell: ({ row }) => row.original.status === "pending" ? (
        <span className="flex gap-2">
          {can("approve") ? <Button onClick={() => approve.mutate(row.original.id)} disabled={approve.isPending}>Approve</Button> : null}
          {can("manage_rules") ? <Button variant="secondary" onClick={() => reject.mutate(row.original.id)} disabled={reject.isPending}>Reject</Button> : null}
        </span>
      ) : <Mono>{row.original.rule_id ?? row.original.status}</Mono>,
    },
  ], [approve, reject, can]);

  const items = q.data?.items ?? [];
  return (
    <ExplorerPage
      filterBar={
        <div className="flex items-end gap-3">
          <Field label="Status"><Select value={status} onValueChange={(v) => setStatus(v as LearnedStatus)} options={STATUS_OPTIONS} /></Field>
          <Field label="Kind"><Select value={kind} onValueChange={(v) => setKind(v as "all" | LearnedKind)} options={KIND_OPTIONS} /></Field>
        </div>
      }
      state={q.isLoading ? "loading" : isListFailure(q) ? "error" : items.length === 0 ? "empty" : undefined}
      emptyProps={{ title: "No learned rules here yet. They appear after the next analysis." }}
      errorProps={{
        message: apiErrorMessage(q.error),
        onRetry: () => q.refetch(),
      }}
      table={<DataTable columns={columns} data={items} getRowId={(r) => r.id} />}
    />
  );
}
