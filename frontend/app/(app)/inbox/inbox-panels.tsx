"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";
import { Button, Card, ConfirmDialog, DataTable, Drawer, EmptyState, ErrorState, Field, Mono, Notice, Skeleton, Stat, Textarea, toast, Status } from "@/design";
import { QuickFilters } from "@/components/inbox/quick-filters";
import { getAssignableUsers } from "@/lib/api/users";
import { useAuth } from "@/context/auth-context";
import { useRole } from "@/hooks/use-role";
import { assignException, getSAPMonitor, resolveException } from "@/lib/api/exceptions";
import { STATUS_LABEL, getBatchDiff, listBatches, type BatchStatus, type BatchSummary } from "@/lib/api/remediation";
import { oneOf, useUrlState } from "@/hooks/use-url-state";
import { BatchDetailBody } from "@/app/(app)/fix/batches-tab";
import { approveWriteback, getPendingApprovals, type PendingApproval } from "@/lib/api/writeback";
import { getFindingReportContext } from "@/lib/api/findings";
import { getVersion } from "@/lib/api/versions";
import { getRules } from "@/lib/api/rules";
import { getUsers } from "@/lib/api/users";
import { writeBackModeSentence } from "@/lib/api/remediation";
import { apiErrorMessage, isNotFound, apiErrorState } from "@/lib/error";
import { formatInt, formatModuleName, labelOf, relativeTime } from "@/lib/format";
import { runName } from "@/lib/run-scope";
import { queryKeys } from "@/lib/query-keys";
import type { Exception } from "@/types/api";

function Panel({ q, children }: { q: { isLoading: boolean; error: unknown; refetch: () => unknown }; children: React.ReactNode }) {
  if (q.isLoading) return <Skeleton height={240} />;
  if (q.error && !isNotFound(q.error)) return <ErrorState {...apiErrorState(q.error)} onRetry={() => q.refetch()} />;
  return <>{children}</>;
}

/* ─── SAP monitor: exceptions raised from live SAP signals ─── */

/** The system the signal's run read and the objects whose findings raised it (api/services/exception_engine.py). */
export function sapSignalSource(e: Exception): { systemId: string | null; objects: string[] } {
  const a = e.affected_records ?? {};
  const systemId = typeof a.system_id === "string" && a.system_id ? a.system_id : null;
  const objects = Array.isArray(a.modules) ? a.modules.filter((m): m is string => typeof m === "string" && !!m) : [];
  return { systemId, objects };
}

/** The system's Extract drawer, opened with the signal's objects picked. */
export function reExtractHref(systemId: string, objects: string[]): string {
  const p = new URLSearchParams({ extract: "1" });
  for (const o of objects) p.append("object", o);
  return `/systems/${encodeURIComponent(systemId)}?${p}`;
}

const isClosed = (status: string) => status === "resolved" || status === "verified" || status === "closed";

/**
 * One SAP signal's detail and what can be done with it. Claim and Resolve need `assign` and `approve`, or
 * `manage_systems` (SAP Basis), which the server allows on SAP-raised exceptions only (api/routes/exceptions.py
 * require_action_or_sap_source); Re-extract needs `trigger_sync` and the system the signal's run read.
 */
function SapSignal({ e }: { e: Exception }) {
  const { can } = useRole();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [note, setNote] = useState("");
  const fromSap = !!e.source_system;
  const basis = fromSap && can("manage_systems");
  const canClaim = can("assign") || basis;
  const canResolve = can("approve") || basis;
  const { systemId, objects } = sapSignalSource(e);
  const done = (what: string) => { toast.success(what); void qc.invalidateQueries({ queryKey: ["inbox", "sap-monitor"] }); };
  const claim = useMutation({
    mutationFn: (me: { id: string; name: string }) => assignException(e.id, { user_id: me.id, user_name: me.name }),
    onSuccess: () => done("Claimed"),
    onError: (err) => toast.error(`Not claimed: ${apiErrorMessage(err)}`),
  });
  const resolve = useMutation({
    mutationFn: () => resolveException(e.id, { resolution_type: "steward", resolution_notes: note.trim(), root_cause_category: "system" }),
    onSuccess: () => { setNote(""); done("Resolved"); },
    onError: (err) => toast.error(`Not resolved: ${apiErrorMessage(err)}`),
  });
  const open = !isClosed(e.status);
  const mine = !!user && e.assigned_to === user.id;
  return (
    <div className="flex flex-col gap-3 m-text-body">
      <p>{e.description || "SAP sent no further detail for this signal."}</p>
      {objects.length ? <p className="m-ink-2">Raised from {objects.map(formatModuleName).join(", ")}{e.source_system ? `, ${e.source_system}` : ""}</p> : null}
      {open && canResolve ? (
        <Field label="What was done in SAP">
          <Textarea rows={3} value={note} onChange={(ev) => setNote(ev.target.value)} />
        </Field>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        {open && canResolve ? (
          <Button variant="primary" disabled={!note.trim() || claim.isPending} pending={resolve.isPending} onClick={() => resolve.mutate()}>Resolve</Button>
        ) : null}
        {open && canClaim && user && !mine ? (
          <Button variant="secondary" disabled={resolve.isPending} pending={claim.isPending} onClick={() => claim.mutate({ id: user.id, name: user.name || user.email })}>Claim</Button>
        ) : null}
        {systemId && can("trigger_sync") ? (
          <Button variant="secondary" render={<Link href={reExtractHref(systemId, objects)} />}>Re-extract</Button>
        ) : null}
      </div>
    </div>
  );
}

export function SapMonitorPanel() {
  const q = useQuery({ queryKey: ["inbox", "sap-monitor"], queryFn: getSAPMonitor, refetchInterval: 60_000, retry: false });
  const cols = useMemo<ColumnDef<Exception, unknown>[]>(() => [
    { id: "title", header: "What happened", cell: ({ row }) => row.original.title },
    { id: "category", header: "Category", cell: ({ row }) => labelOf(row.original.category) },
    { id: "sev", header: "Severity", cell: ({ row }) => <Status kind="severity" value={row.original.severity} /> },
    { id: "status", header: "Status", cell: ({ row }) => labelOf(row.original.status) },
    { id: "source", header: "Source", cell: ({ row }) => row.original.source_system ?? "—" },
    { id: "when", header: "Raised", cell: ({ row }) => relativeTime(row.original.created_at) },
    // The click reaches the row, which opens the signal's detail.
    { id: "review", header: "", enableSorting: false, size: 90, cell: ({ row }) => <Button variant="ghost" aria-label={`Review ${row.original.title}`}>Review</Button> },
  ], []);
  const list = q.data?.exceptions ?? [];
  return (
    <Panel q={q}>
      {list.length === 0 ? (
        <EmptyState title="Nothing raised from SAP" detail="Failed jobs and locked records appear here once a connected system reports them." action={<Button variant="secondary" render={<Link href="/systems">Open systems</Link>} />} />
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-6">
            {Object.entries(q.data?.by_category ?? {}).map(([k, v]) => <Stat key={k} label={labelOf(k)} value={v.length} />)}
          </div>
          <DataTable columns={cols} data={list} getRowId={(e) => e.id} height={440} exportName="sap-monitor"
            renderDrawer={(e) => <SapSignal key={e.id} e={e} />} />
        </div>
      )}
    </Panel>
  );
}

/* ─── Approvals: every change that waits for a second person, fix batches and live write-backs ─── */

/** The rule behind a write-back request, from its finding: the check id in mono with the object beside it. */
/**
 * The rule a write-back request fixes: the check id, its message and object as the approvals API names them; an
 * older API without them is looked up by finding. Never the bare finding id: an unknown rule reads "Rule not found".
 */
function FindingRule({ approval }: { approval: PendingApproval }) {
  const findingId = approval.finding_id;
  const named = !!approval.check_id;
  const q = useQuery({ queryKey: ["findings", "context", findingId ?? ""], queryFn: () => getFindingReportContext(findingId as string), enabled: !!findingId && !named, retry: false, meta: { ignoreError: true } });
  const checkId = approval.check_id ?? q.data?.check_id;
  const objectId = approval.module ?? q.data?.module;
  if (!findingId) return <>—</>;
  if (!checkId) return <span className="m-ink-3">{q.isLoading ? "…" : "Rule not found"}</span>;
  return (
    <span className="inline-flex flex-col items-start">
      <span className="inline-flex items-baseline gap-2"><Mono>{checkId}</Mono>{objectId ? <span className="m-ink-3">{formatModuleName(objectId)}</span> : null}</span>
      {approval.rule_message ? <span className="m-text-meta m-ink-2">{approval.rule_message}</span> : null}
    </span>
  );
}

/** The run a write-back request was raised from, by name. */
function RunName({ versionId }: { versionId: string | null }) {
  const q = useQuery({ queryKey: queryKeys.run(versionId ?? ""), queryFn: () => getVersion(versionId as string), enabled: !!versionId, retry: false, meta: { ignoreError: true } });
  if (!versionId) return <>—</>;
  return <>{q.data ? runName(q.data) : "Run"}</>;
}

/**
 * Inbox › Approvals, the one approvals page: the fix batches Fix work drafted (approve them here, export them under
 * Fix › Batches and export) and the live SAP write-back requests. Batches need `approve` to decide and are read with
 * `view_audit` (the four-eyes evidence); write-backs need `approve`, as their API does.
 */
export function ApprovalsPanel() {
  const { can } = useRole();
  return (
    <div className="flex flex-col gap-6">
      <BatchApprovals />
      {can("approve") ? <WritebackApprovals /> : null}
    </div>
  );
}

const BATCH_SHOW = [
  { value: "draft", label: "Waiting for approval" }, { value: "approved", label: "Approved" },
  { value: "exported", label: "Exported" }, { value: "all", label: "All" },
] as const;
type BatchShow = (typeof BATCH_SHOW)[number]["value"];

/** A rules row is named "<check id>: <message>"; the message, for the check ids a batch fixes. */
function ruleMessages(names: readonly string[] | undefined): Map<string, string> {
  const out = new Map<string, string>();
  for (const n of names ?? []) {
    const at = n.indexOf(":");
    if (at > 0) out.set(n.slice(0, at).trim(), n.slice(at + 1).trim());
  }
  return out;
}

/** What a batch changes, from its diff: the rules it fixes by name, and its first change as before and after. */
function BatchPreview({ batch, messages }: { batch: BatchSummary; messages: Map<string, string> }) {
  const q = useQuery({ queryKey: queryKeys.remediationDiff(batch.id), queryFn: () => getBatchDiff(batch.id), retry: false, meta: { ignoreError: true } });
  const changes = (q.data?.records ?? []).flatMap((r) => r.changes.map((c) => ({ ...c, record_key: r.record_key, table: r.table })));
  const rules = [...new Set(changes.map((c) => c.rule))];
  if (rules.length === 0 && batch.filter.check_id) rules.push(batch.filter.check_id);
  const first = changes[0];
  if (q.isLoading) return <span className="m-ink-3">…</span>;
  if (!first && rules.length === 0) return <span className="m-ink-3">No changes yet</span>;
  const message = rules[0] ? messages.get(rules[0]) : undefined;
  return (
    <span className="inline-flex flex-col items-start gap-0.5" data-testid="batch-preview">
      {rules[0] ? (
        <span className="inline-flex flex-wrap items-baseline gap-2">
          <Mono>{rules[0]}</Mono>
          {message ? <span>{message}</span> : null}
          {rules.length > 1 ? <span className="m-ink-3">and {formatInt(rules.length - 1)} more</span> : null}
        </span>
      ) : null}
      {first ? (
        <span className="m-text-meta m-ink-2">
          <Mono>{first.table}.{first.field}</Mono> on <Mono>{first.record_key}</Mono>: {first.before ? <Mono>{first.before}</Mono> : "blank"} to <Mono>{first.after}</Mono>
          {changes.length > 1 ? `, and ${formatInt(changes.length - 1)} more` : ""}
        </span>
      ) : null}
    </span>
  );
}

function BatchApprovals() {
  const { user } = useAuth();
  const { can } = useRole();
  const [showRaw, setShow] = useUrlState("batches", "draft");
  const show: BatchShow = oneOf(showRaw, BATCH_SHOW.map((s) => s.value), "draft");
  const [batchId, setBatchId] = useUrlState("batch", "");
  const q = useQuery({ queryKey: queryKeys.remediationBatches(), queryFn: listBatches, retry: false });
  const rulesQ = useQuery({ queryKey: ["rules", "names"], queryFn: () => getRules({ limit: 1000 }), staleTime: 300_000, meta: { ignoreError: true } });
  const messages = useMemo(() => ruleMessages(rulesQ.data?.rules.map((r) => r.name)), [rulesQ.data]);
  const batches = useMemo(() => q.data?.items ?? [], [q.data]);
  const count = (s: BatchShow) => (s === "all" ? batches.length : batches.filter((b) => b.status === s).length);
  const rows = show === "all" ? batches : batches.filter((b) => b.status === show);
  const selected = batchId ? batches.find((b) => b.id === batchId) ?? null : null;
  const cols = useMemo<ColumnDef<BatchSummary, unknown>[]>(() => [
    { id: "name", header: "Batch", cell: ({ row }) => row.original.name },
    { id: "change", header: "Rules and change", enableSorting: false, cell: ({ row }) => <BatchPreview batch={row.original} messages={messages} /> },
    { id: "by", header: "Requested by", cell: ({ row }) => row.original.created_by_label ?? "Meridian monitor" },
    { id: "items", header: "Records", meta: { numeric: true }, cell: ({ row }) => formatInt(row.original.items) },
    { id: "status", header: "Status", cell: ({ row }) => STATUS_LABEL[row.original.status as BatchStatus] },
    { id: "when", header: "Requested", cell: ({ row }) => relativeTime(row.original.created_at) },
    { id: "act", header: "", enableSorting: false, size: 90, cell: ({ row }) => <Button variant="ghost" aria-label={`Review ${row.original.name}`}>Review</Button> },
  ], [messages]);
  return (
    <Card title="Fix batches" meta="Values decided in Fix work. A second person approves each batch before it is exported for SAP">
      <Panel q={q}>
        <div className="flex flex-col gap-3">
          <QuickFilters label="Show" value={show} onChange={(v) => setShow(v === "draft" ? "" : v)}
            options={BATCH_SHOW.map((s) => ({ value: s.value, label: s.label, count: count(s.value) }))} />
          {rows.length === 0 ? (
            <EmptyState
              title={show === "draft" ? "No batches waiting for approval" : "No batches in this view"}
              detail="A steward's accepted and entered values collect in a draft batch until someone approves it"
              action={<Button variant="secondary" render={<Link href="/fix">Open Fix work</Link>} />}
            />
          ) : (
            <DataTable columns={cols} data={rows} getRowId={(b) => b.id} onRowClick={(b) => setBatchId(b.id)} height={380} exportName="fix-batch-approvals" />
          )}
        </div>
      </Panel>
      <Drawer open={!!selected} onOpenChange={(open) => { if (!open) setBatchId(""); }} title={selected?.name ?? "Batch"}>
        {selected ? <BatchDetailBody batchId={selected.id} currentUserId={user?.id ?? null} canApprove={can("approve")} canExport={can("export")} /> : null}
      </Drawer>
    </Card>
  );
}

/** Live write-back requests waiting for a second person. */
function WritebackApprovals() {
  const { user } = useAuth();
  const { can } = useRole();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["inbox", "approvals"], queryFn: getPendingApprovals, retry: false });
  // Names come from the assignable list (`assign`), or the full user list (`manage_users`); a requester neither
  // names reads as "Unknown user", never an id.
  const usersQ = useQuery({ queryKey: queryKeys.users(), queryFn: getUsers, enabled: can("manage_users"), meta: { ignoreError: true } });
  const assignableQ = useQuery({ queryKey: ["users", "assignable"], queryFn: getAssignableUsers, enabled: can("assign"), staleTime: 300_000, meta: { ignoreError: true } });
  const names = useMemo(
    () => new Map([...(Array.isArray(assignableQ.data) ? assignableQ.data : []), ...(usersQ.data?.users ?? [])].map((u) => [u.id, u.name || u.email])),
    [usersQ.data, assignableQ.data],
  );
  const who = (a: PendingApproval) =>
    !a.requested_by ? "Unknown user" : a.requested_by === user?.id ? "You" : a.requested_by_name ?? names.get(a.requested_by) ?? "Unknown user";
  const [asking, setAsking] = useState<PendingApproval | null>(null);
  const approve = useMutation({
    mutationFn: (id: string) => approveWriteback(id),
    onSuccess: (r) => {
      setAsking(null);
      if (r.errors.length) toast.error(r.errors.join("; "));
      else toast.success(`${r.applied.toLocaleString()} records written back`);
      void qc.invalidateQueries({ queryKey: ["inbox", "approvals"] });
    },
    // The server enforces 4-eyes and the live switch; show its reason rather than guess.
    onError: (e) => { setAsking(null); toast.error(apiErrorMessage(e)); },
  });
  const cols = useMemo<ColumnDef<PendingApproval, unknown>[]>(() => [
    { id: "finding", header: "Rule", cell: ({ row }) => <FindingRule approval={row.original} /> },
    { id: "run", header: "Run", cell: ({ row }) => <RunName versionId={row.original.version_id} /> },
    { id: "host", header: "SAP host", cell: ({ row }) => row.original.sap_host ?? "—" },
    { id: "records", header: "Records", cell: ({ row }) => row.original.records_updated.toLocaleString() },
    { id: "by", header: "Requested by", cell: ({ row }) => who(row.original) },
    { id: "when", header: "Requested", cell: ({ row }) => row.original.created_at ? relativeTime(row.original.created_at) : "—" },
    // Approve is the row's one action: a real primary button when it can run, else the reason it cannot, as text,
    // never a greyed button that reads as broken.
    { id: "act", header: "", cell: ({ row }) => {
      if (user != null && row.original.requested_by === user.id) return <span className="m-text-meta m-ink-3">Needs another approver</span>;
      if (!q.data?.live_enabled) return <span className="m-text-meta m-ink-3">Write-back is off</span>;
      return <Button disabled={approve.isPending} onClick={() => setAsking(row.original)}>Approve</Button>;
    } },
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `who` closes over names and user
  ], [approve, q.data?.live_enabled, user, names]);
  const list = q.data?.approvals ?? [];
  return (
    <Card title="SAP write-backs" meta="Live changes to SAP. You cannot approve a write-back you asked for">
    <Panel q={q}>
      <div className="flex flex-col gap-3">
        <Notice>
          {writeBackModeSentence(q.data?.live_enabled)}
          {q.data && !q.data.live_enabled ? " Live SAP write-back is off on this deployment. Export fixes as an LSMW or BAPI file and load them in SAP." : ""}
        </Notice>
        {list.length === 0 ? <EmptyState title="No write-backs waiting" detail="Approved fixes queue here before they reach SAP" action={<Button variant="secondary" render={<Link href="/fix">Open fixes</Link>} />} /> : (
          <DataTable columns={cols} data={list} getRowId={(a) => a.id} height={380} exportName="writeback-approvals" />
        )}
        <ConfirmDialog
          open={asking !== null}
          onOpenChange={(open) => { if (!open) setAsking(null); }}
          title="Write these records back to SAP?"
          body={asking ? (
            <div className="flex flex-col gap-1">
              <div className="inline-flex items-baseline gap-2"><span>Rule:</span> <FindingRule approval={asking} /></div>
              <p>{asking.records_updated.toLocaleString()} record{asking.records_updated === 1 ? "" : "s"} on {asking.sap_host ?? "the connected SAP system"}, requested by {who(asking)}.</p>
            </div>
          ) : null}
          confirmLabel="Approve and write back"
          cancelLabel="Keep waiting"
          pending={approve.isPending}
          onConfirm={() => asking && approve.mutate(asking.id)}
        />
      </div>
    </Panel>
    </Card>
  );
}
