"use client";

/** Rules › Learned: house rules the tenant's own data follows for >= 95% of records
 * (checks/house_rules.py). The miner proposes; a person with `approve` turns a
 * proposal into an active rule with a new LR- id; `manage_rules` can reject. */

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { Button, DataTable, DrillLink, ExplorerPage, Field, Mono, PageHeader, Pill, Select, asyncStateOf } from "@/design";
import { actionColumn, RowButton } from "@/components/mdm/ledger";
import { useRole } from "@/hooks/use-role";
import {
  approveLearnedRule,
  getLearnedRules,
  KIND_LABEL,
  mineLearnedRules,
  rejectLearnedRule,
  type LearnedKind,
  type LearnedRule,
  type LearnedStatus,
  type Severity,
} from "@/lib/api/learnedRules";
import { errorText } from "@/lib/api/remediation";
import { getVersions } from "@/lib/api/versions";
import { apiErrorMessage } from "@/lib/error";
import { queryKeys } from "@/lib/query-keys";

const STATUS_OPTIONS = [
  { value: "pending", label: "Awaiting review" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
];
const KIND_OPTIONS = [{ value: "all", label: "All kinds" }, ...Object.entries(KIND_LABEL).map(([value, label]) => ({ value, label }))];
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

/** The part of a composite record key that is the rule's own field (`PRCTR=BAD-0037`), else its first part. */
function exampleOf(key: string, field: string): string {
  const name = field.split(".").pop();
  const parts = key.split("|");
  return parts.find((p) => p.split("=")[0].split(".").pop() === name) ?? parts[0];
}

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

  const versions = useQuery({ queryKey: ["versions-list", { for: "mine" }], queryFn: () => getVersions({ limit: 20 }), staleTime: 60_000 });
  const fromUrl = useSearchParams().get("run");
  const finished = (versions.data?.versions ?? []).filter((v) => v.status !== "pending" && v.status !== "running" && v.status !== "failed");
  const latestRun = finished.find((v) => v.id === fromUrl) ?? finished[0];
  const mine = useMutation({
    mutationFn: () => mineLearnedRules((latestRun as { id: string }).id),
    onSuccess: () => { toast.success("Mining queued. New proposals appear here when it finishes"); refresh(); },
    onError: (e) => toast.error(errorText(e)),
  });

  const columns = useMemo<ColumnDef<LearnedRule>[]>(() => [
    { id: "kind", header: "Kind", cell: ({ row }) => <Pill tone="neutral">{KIND_LABEL[row.original.kind]}</Pill> },
    { id: "field", header: "Field", cell: ({ row }) => <Mono>{row.original.field}</Mono> },
    { id: "det", header: "Decided by", cell: ({ row }) => (row.original.determinant ? <Mono>{row.original.determinant}</Mono> : "—") },
    { id: "conf", header: "Holds for", cell: ({ row }) => pct(row.original.confidence) },
    { id: "viol", header: "Breaks it", cell: ({ row }) => (
      <DrillLink object={row.original.module} run={row.original.version_id ?? undefined}>{row.original.violations.toLocaleString()}</DrillLink>
    ) },
    { id: "keys", header: "Examples", cell: ({ row }) => {
      const keys = row.original.sample_keys.slice(0, 2);
      return keys.length
        ? <span title={keys.join("\n")}><Mono>{keys.map((k) => exampleOf(k, row.original.field)).join(", ")}</Mono></span>
        : "—";
    } },
    actionColumn((r) => r.status === "pending" ? (
      <span className="flex gap-3">
        {can("approve") ? <RowButton onClick={() => approve.mutate(r.id)} disabled={approve.isPending}>Approve</RowButton> : null}
        {can("manage_rules") ? <RowButton onClick={() => reject.mutate(r.id)} disabled={reject.isPending}>Reject</RowButton> : null}
      </span>
    ) : <Mono>{r.rule_id ?? r.status}</Mono>),
  ], [approve, reject, can]);

  const items = q.data?.items ?? [];
  return (
    <ExplorerPage
      header={
        <PageHeader
          title="Learned rules"
          meta="Patterns your own data follows for at least 95% of records. Approve one to make it a rule; the records that break it then show as findings."
          actions={can("manage_rules") ? <Button onClick={() => mine.mutate()} pending={mine.isPending} disabled={!latestRun}>Mine now</Button> : undefined}
        />
      }
      filterBar={
        <div className="flex items-end gap-3">
          <Field label="Status"><Select value={status} onValueChange={(v) => setStatus(v as LearnedStatus)} options={STATUS_OPTIONS} /></Field>
          <Field label="Kind"><Select value={kind} onValueChange={(v) => setKind(v as "all" | LearnedKind)} options={KIND_OPTIONS} /></Field>
        </div>
      }
      state={asyncStateOf(q, () => items.length === 0, true)}
      emptyProps={status === "pending"
        ? {
            title: "No proposals waiting",
            detail: latestRun ? "Mining looks for new patterns after each analysis. Mine now to look again." : "Mining needs a finished analysis first.",
            action: can("manage_rules") && latestRun
              ? <Button onClick={() => mine.mutate()} pending={mine.isPending}>Mine now</Button>
              : <Button variant="secondary" render={<Link href={latestRun ? "/rules" : "/runs"}>{latestRun ? "Open rules" : "Open runs"}</Link>} />,
          }
        : { title: status === "approved" ? "Nothing approved yet" : "Nothing rejected", detail: "Proposals you decide on are listed here.", action: <Button variant="secondary" onClick={() => setStatus("pending")}>Show proposals waiting</Button> }}
      errorProps={{
        message: apiErrorMessage(q.error),
        onRetry: () => q.refetch(),
      }}
      table={<DataTable columns={columns} data={items} getRowId={(r) => r.id} />}
    />
  );
}
