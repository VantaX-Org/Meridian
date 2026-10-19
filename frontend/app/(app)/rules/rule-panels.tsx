"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import Link from "next/link";
import { Button, DataTable, ExplorerPage, Mono, Pill, asyncStateOf } from "@/design";
import { actionColumn, RowButton } from "@/components/mdm/ledger";
import { useRole } from "@/hooks/use-role";
import { endRuleSuppression, getRuleFeedback, getRuleSuppressions, type RuleFeedbackRow, type RuleSuppression } from "@/lib/api/rules";
import { apiErrorMessage } from "@/lib/error";
import { formatDate } from "@/lib/format";

/** Active rule suppressions. Ending one needs `approve`; creating one happens from a finding. */
export function SuppressionsPanel() {
  const qc = useQueryClient();
  const { can } = useRole();
  const q = useQuery({ queryKey: ["rule-suppressions"], queryFn: () => getRuleSuppressions() });
  const end = useMutation({
    mutationFn: endRuleSuppression,
    onSuccess: () => { toast.success("Suppression ended. It takes effect on the next run"); qc.invalidateQueries({ queryKey: ["rule-suppressions"] }); },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });
  const columns: ColumnDef<RuleSuppression>[] = [
    { accessorKey: "check_id", header: "Rule", cell: ({ row }) => <Mono>{row.original.check_id}</Mono> },
    { id: "scope", header: "Scope", cell: ({ row }) => row.original.record_key ? <Mono>{row.original.record_key}</Mono> : <Pill tone="at-risk">Whole rule</Pill> },
    { accessorKey: "reason", header: "Reason" },
    { id: "exp", header: "Expires", cell: ({ row }) => formatDate(row.original.expires_at, "date") },
    { accessorKey: "created_by", header: "By", cell: ({ row }) => row.original.created_by ?? "-" },
    actionColumn((r) => (can("approve") ? <RowButton onClick={() => end.mutate(r.id)} disabled={end.isPending}>End now</RowButton> : null)),
  ];
  const rows = q.data?.suppressions ?? [];
  return (
    <ExplorerPage
      state={asyncStateOf(q, () => rows.length === 0, true)}
      emptyProps={{ title: "No active suppressions", detail: "A suppression keeps a rule or one record out of the score until it expires", action: <Button variant="secondary" render={<Link href="/rules">Browse rules</Link>} /> }}
      errorProps={{ message: apiErrorMessage(q.error), onRetry: () => q.refetch() }}
      table={<DataTable columns={columns} data={rows} getRowId={(r) => r.id} />}
    />
  );
}

const feedbackColumns: ColumnDef<RuleFeedbackRow>[] = [
  { accessorKey: "check_id", header: "Rule", cell: ({ row }) => <Mono>{row.original.check_id}</Mono> },
  { accessorKey: "flagged", header: "Flagged" },
  { accessorKey: "real", header: "Confirmed real" },
  { accessorKey: "false_positive", header: "False positive" },
  {
    id: "rate", header: "False-positive rate",
    cell: ({ row }) => row.original.false_positive_rate == null ? "-" : <Pill tone={row.original.false_positive_rate > 0.3 ? "no-go" : "neutral"}>{`${Math.round(row.original.false_positive_rate * 100)}%`}</Pill>,
  },
];

/** Steward verdicts per rule, so noisy rules stand out. */
export function FeedbackPanel() {
  const q = useQuery({ queryKey: ["rule-feedback"], queryFn: getRuleFeedback });
  const rows = q.data?.rules ?? [];
  return (
    <ExplorerPage
      state={asyncStateOf(q, () => rows.length === 0, true)}
      emptyProps={{ title: "No steward feedback yet", detail: "Verdicts appear when stewards mark flagged records as real or false positive", action: <Button variant="secondary" render={<Link href="/runs">View runs</Link>} /> }}
      errorProps={{ message: apiErrorMessage(q.error), onRetry: () => q.refetch() }}
      table={<DataTable columns={feedbackColumns} data={rows} getRowId={(r) => r.check_id} />}
    />
  );
}
