"use client";

/** Rules › Learned: house rules the tenant's own data follows for >= 95% of records
 * (checks/house_rules.py). The miner proposes; a person with `approve` (or `review_ai_rules`)
 * turns a proposal into an active rule with a new LR- id, or rejects it; `manage_rules` can reject too. */

import { useMemo } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { Button, DataTable, DrillLink, ExplorerPage, Field, Mono, Notice, PageHeader, Pill, Select, asyncStateOf } from "@/design";
import { RequestAccessButton } from "@/components/request-access-button";
import { actionColumn, RowButton } from "@/components/mdm/ledger";
import { useRole } from "@/hooks/use-role";
import { oneOf, useUrlState } from "@/hooks/use-url-state";
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
import { labelOf } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";

const STATUS_OPTIONS = [
  { value: "pending", label: "Awaiting review" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
];
const KIND_OPTIONS = [{ value: "all", label: "All kinds" }, ...Object.entries(KIND_LABEL).map(([value, label]) => ({ value, label }))];
const SEVERITIES = ["critical", "high", "medium", "low"] as const;
const SEVERITY_OPTIONS = SEVERITIES.map((value) => ({ value, label: labelOf(value) }));
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
  // api/routes/learned_rules.py: the checker (approve or review_ai_rules) approves and rejects; manage_rules may reject.
  const canDecide = can("approve") || can("review_ai_rules");
  const canReject = canDecide || can("manage_rules");
  const [statusRaw, setStatus] = useUrlState("status", "pending");
  const status = oneOf(statusRaw, ["pending", "approved", "rejected"] as const satisfies readonly LearnedStatus[], "pending");
  const [kindRaw, setKind] = useUrlState("kind", "all");
  const kind = oneOf(kindRaw, ["all", ...(Object.keys(KIND_LABEL) as LearnedKind[])] as const, "all");
  const [severityRaw, setSeverity] = useUrlState("severity", "medium");
  const severity: Severity = oneOf(severityRaw, SEVERITIES, "medium");
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

  // A ?run= older than the window used to be replaced by the newest run without a word, so "Mine now"
  // mined a different run than the one the URL named. Ask for enough to contain it, and say when it
  // is missing rather than switching silently.
  const fromUrl = useSearchParams().get("run");
  const versions = useQuery({ queryKey: ["versions-list", { for: "mine", fromUrl }], queryFn: () => getVersions({ limit: 100 }), staleTime: 60_000 });
  const finished = (versions.data?.versions ?? []).filter((v) => v.status !== "pending" && v.status !== "running" && v.status !== "failed");
  const urlRun = fromUrl ? finished.find((v) => v.id === fromUrl) : undefined;
  const missingUrlRun = Boolean(fromUrl) && !versions.isLoading && !urlRun;
  const latestRun = urlRun ?? finished[0];
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
    // Nobody to decide here: the column would be empty on every row, so it is left out and the notice says how to get it.
    ...(canReject ? [actionColumn<LearnedRule>((r) => r.status === "pending" ? (
      <span className="flex gap-3">
        {canDecide ? <RowButton onClick={() => approve.mutate(r.id)} disabled={approve.isPending}>Approve</RowButton> : null}
        {canReject ? <RowButton onClick={() => reject.mutate(r.id)} disabled={reject.isPending}>Reject</RowButton> : null}
      </span>
    ) : r.rule_id ? <Mono>{r.rule_id}</Mono> : <Pill tone="neutral">{labelOf(r.status)}</Pill>)] : []),
  ], [approve, reject, canDecide, canReject]);

  const items = q.data?.items ?? [];
  return (
    <ExplorerPage
      header={
        <>
          <PageHeader
            title="Learned rules"
            meta="Patterns your own data follows for at least 95% of records. Approve one to make it a rule; the records that break it then show as findings."
            actions={can("manage_rules") ? <Button onClick={() => mine.mutate()} pending={mine.isPending} disabled={!latestRun}>Mine now</Button> : undefined}
          />
          {!canReject ? (
            <Notice tone="info" action={<RequestAccessButton resource="rules" action="approve" />}>
              Approving or rejecting a proposal needs the review permission, so you can read the proposals but not decide on them.
            </Notice>
          ) : null}
          {missingUrlRun ? (
            <span className="m-text-meta m-ink-3" role="status">
              That run is not among the latest {finished.length} finished runs; mining uses the newest instead.
            </span>
          ) : null}
        </>
      }
      filterBar={
        <div className="flex items-end gap-3">
          <Field label="Status"><Select value={status} onValueChange={setStatus} options={STATUS_OPTIONS} /></Field>
          <Field label="Kind"><Select value={kind} onValueChange={setKind} options={KIND_OPTIONS} /></Field>
          {canDecide && status === "pending" ? (
            <Field label="Approve as"><Select value={severity} onValueChange={setSeverity} options={SEVERITY_OPTIONS} /></Field>
          ) : null}
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
        error: q.error,
        onRetry: () => q.refetch(),
      }}
      table={<DataTable columns={columns} data={items} getRowId={(r) => r.id} />}
    />
  );
}
