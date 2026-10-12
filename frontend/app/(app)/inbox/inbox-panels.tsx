"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import Link from "next/link";
import { Button, DataTable, EmptyState, ErrorState, Field, Mono, Notice, Pill, Select, Skeleton, Stat, type PillTone, Input } from "@/design";
import { useAuth } from "@/context/auth-context";
import { useRole } from "@/hooks/use-role";
import { getSAPMonitor } from "@/lib/api/exceptions";
import {
  commentIssue, exportIssues, getIssue, getIssues, updateIssues, type IssueStatus, type RecordIssue,
} from "@/lib/api/issues";
import { approveWriteback, getPendingApprovals, type PendingApproval } from "@/lib/api/writeback";
import { apiErrorMessage, isNotFound } from "@/lib/error";
import { formatModuleName, labelOf, relativeTime } from "@/lib/format";
import type { Exception } from "@/types/api";

const SEVERITY_TONE: Record<string, PillTone> = { critical: "no-go", high: "no-go", medium: "at-risk", low: "neutral", warning: "at-risk" };
const SLA_TONE: Record<string, PillTone> = { on_track: "go", at_risk: "at-risk", breached: "no-go" };
const STATUSES: IssueStatus[] = ["open", "in_progress", "waiting_sap", "waiting_requester", "accepted", "resolved"];
const note = { color: "var(--m-ink-2)" };

function Panel({ q, children }: { q: { isLoading: boolean; error: unknown; refetch: () => unknown }; children: React.ReactNode }) {
  if (q.isLoading) return <Skeleton height={240} />;
  if (q.error && !isNotFound(q.error)) return <ErrorState message={apiErrorMessage(q.error)} onRetry={() => q.refetch()} />;
  return <>{children}</>;
}

/* ─── Issues: one row per failing SAP record, with its event thread in a Drawer ─── */

function IssueThread({ issue }: { issue: RecordIssue }) {
  const { can } = useRole();
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const q = useQuery({ queryKey: ["issues", "detail", issue.id], queryFn: () => getIssue(issue.id) });
  const post = useMutation({
    mutationFn: () => commentIssue(issue.id, text.trim()),
    onSuccess: () => { setText(""); void qc.invalidateQueries({ queryKey: ["issues"] }); },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });
  return (
    <div className="flex flex-col gap-3 m-text-body">
      <p>{issue.message ?? "No message"}</p>
      <p style={note}><Mono>{issue.record_key}</Mono>{issue.field ? <>, field {issue.field}</> : null}</p>
      {q.isLoading ? <Skeleton height={80} /> : q.error ? <p style={note}>{apiErrorMessage(q.error)}</p> : (
        <ol className="flex flex-col gap-2">
          {(q.data?.events ?? []).length === 0 ? <li style={note}>No activity yet.</li> : null}
          {(q.data?.events ?? []).map((e, i) => (
            <li key={`${e.created_at}-${i}`} className="border-l-2 pl-3">
              <span className="font-medium">{labelOf(e.action)}</span>
              {e.to_value ? <> to {labelOf(e.to_value)}</> : null}
              <span style={note}> by {e.user_label ?? "System"}, {relativeTime(e.created_at)}</span>
              {e.note ? <p>{e.note}</p> : null}
            </li>
          ))}
        </ol>
      )}
      {can("analyse") ? (
        <Field label="Add a comment">
          <textarea className="m-input" style={{ height: "auto", padding: "6px 10px" }} rows={3} value={text} onChange={(e) => setText(e.target.value)} />
        </Field>
      ) : null}
      {can("analyse") ? <Button variant="secondary" disabled={!text.trim() || post.isPending} onClick={() => post.mutate()}>Post comment</Button> : null}
    </div>
  );
}

export function IssuesPanel() {
  const { can } = useRole();
  const qc = useQueryClient();
  const [status, setStatus] = useState<IssueStatus | "">("");
  const [search, setSearch] = useState("");
  const filter = { status: status || undefined, search: search.trim() || undefined };
  const q = useQuery({ queryKey: ["issues", "list", filter], queryFn: () => getIssues({ ...filter, limit: 200 }), retry: false });
  const bulk = useMutation({
    mutationFn: (v: { ids: string[]; status: IssueStatus }) => updateIssues(v),
    onSuccess: (r) => { toast.success(`${r.updated} issues updated`); void qc.invalidateQueries({ queryKey: ["issues"] }); },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });
  const cols = useMemo<ColumnDef<RecordIssue, unknown>[]>(() => [
    { id: "module", header: "Object", cell: ({ row }) => formatModuleName(row.original.module) },
    { id: "check", header: "Rule", cell: ({ row }) => <Mono>{row.original.check_id}</Mono> },
    { id: "record", header: "Record", cell: ({ row }) => <Mono>{row.original.record_key}</Mono> },
    { id: "sev", header: "Severity", cell: ({ row }) => <Pill tone={SEVERITY_TONE[row.original.severity] ?? "neutral"}>{labelOf(row.original.severity)}</Pill> },
    { id: "status", header: "Status", cell: ({ row }) => labelOf(row.original.status) },
    { id: "sla", header: "SLA", cell: ({ row }) => row.original.sla_state ? <Pill tone={SLA_TONE[row.original.sla_state] ?? "neutral"}>{labelOf(row.original.sla_state)}</Pill> : "—" },
    { id: "assignee", header: "Assignee", cell: ({ row }) => row.original.assignee_email ?? "Unassigned" },
    { id: "seen", header: "Last seen", cell: ({ row }) => relativeTime(row.original.last_seen_at) },
  ], []);
  const items = q.data?.items ?? [];
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-4">
        <Stat label="Issues" value={q.isLoading ? "…" : (q.data?.total ?? 0).toLocaleString()} />
        <Field label="Status">
          <Select value={status} onValueChange={(v) => setStatus((v || "") as IssueStatus | "")} placeholder="All statuses"
            options={STATUSES.map((s) => ({ value: s, label: `${labelOf(s)}${q.data?.counts[s] ? ` (${q.data.counts[s]})` : ""}` }))} />
        </Field>
        <Field label="Search">
          <Input aria-label="Search issues" value={search} onChange={(e) => setSearch(e.target.value)} />
        </Field>
      </div>
      <Panel q={q}>
        {items.length === 0 ? (
          <EmptyState title="No record issues" detail="Issues open when an analysis finds a failing SAP record, and close when it passes." action={<Button variant="secondary" render={<Link href="/runs">Open runs</Link>} />} />
        ) : (
          <DataTable columns={cols} data={items} getRowId={(i) => i.id} height={460} exportName="record-issues"
            exportOptions={[{ format: "xlsx", label: "Issues (.xlsx)", run: () => exportIssues("xlsx", filter) }]}
            renderDrawer={(i) => <IssueThread issue={i} />}
            bulkActions={(sel) => can("view") ? (
              <div className="flex gap-2">
                <Button variant="secondary" disabled={bulk.isPending} onClick={() => bulk.mutate({ ids: sel.map((i) => i.id), status: "in_progress" })}>Start work</Button>
                <Button variant="secondary" disabled={bulk.isPending} onClick={() => bulk.mutate({ ids: sel.map((i) => i.id), status: "resolved" })}>Resolve</Button>
              </div>
            ) : null} />
        )}
      </Panel>
    </div>
  );
}

/* ─── SAP monitor: exceptions raised from live SAP signals ─── */

export function SapMonitorPanel() {
  const q = useQuery({ queryKey: ["inbox", "sap-monitor"], queryFn: getSAPMonitor, refetchInterval: 60_000, retry: false });
  const cols = useMemo<ColumnDef<Exception, unknown>[]>(() => [
    { id: "title", header: "Signal", cell: ({ row }) => row.original.title },
    { id: "category", header: "Category", cell: ({ row }) => labelOf(row.original.category) },
    { id: "sev", header: "Severity", cell: ({ row }) => <Pill tone={SEVERITY_TONE[row.original.severity] ?? "neutral"}>{labelOf(row.original.severity)}</Pill> },
    { id: "status", header: "Status", cell: ({ row }) => labelOf(row.original.status) },
    { id: "source", header: "Source", cell: ({ row }) => row.original.source_system ?? "—" },
    { id: "when", header: "Raised", cell: ({ row }) => relativeTime(row.original.created_at) },
  ], []);
  const list = q.data?.exceptions ?? [];
  return (
    <Panel q={q}>
      {list.length === 0 ? (
        <EmptyState title="No SAP monitor exceptions" detail="Signals such as failed jobs and locked records appear here as they are raised." action={<Button variant="secondary" render={<Link href="/systems">Open systems</Link>} />} />
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-6">
            {Object.entries(q.data?.by_category ?? {}).map(([k, v]) => <Stat key={k} label={labelOf(k)} value={v.length} />)}
          </div>
          <DataTable columns={cols} data={list} getRowId={(e) => e.id} height={440} exportName="sap-monitor"
            renderDrawer={(e) => <p className="m-text-body">{e.description}</p>} />
        </div>
      )}
    </Panel>
  );
}

/* ─── Approvals: live write-back requests waiting for a second person ─── */

export function ApprovalsPanel() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["inbox", "approvals"], queryFn: getPendingApprovals, retry: false });
  const approve = useMutation({
    mutationFn: (id: string) => approveWriteback(id),
    onSuccess: (r) => {
      if (r.errors.length) toast.error(r.errors.join("; "));
      else toast.success(`${r.applied} records written back`);
      void qc.invalidateQueries({ queryKey: ["inbox", "approvals"] });
    },
    // The server enforces 4-eyes and the live switch; show its reason rather than guess.
    onError: (e) => toast.error(apiErrorMessage(e)),
  });
  const cols = useMemo<ColumnDef<PendingApproval, unknown>[]>(() => [
    { id: "finding", header: "Finding", cell: ({ row }) => <Mono>{row.original.finding_id?.slice(0, 8) ?? "—"}</Mono> },
    { id: "run", header: "Run", cell: ({ row }) => <Mono>{row.original.version_id ?? "—"}</Mono> },
    { id: "host", header: "SAP host", cell: ({ row }) => row.original.sap_host ?? "—" },
    { id: "records", header: "Records", cell: ({ row }) => row.original.records_updated.toLocaleString() },
    { id: "by", header: "Requested by", cell: ({ row }) => <Mono>{row.original.requested_by?.slice(0, 8) ?? "—"}</Mono> },
    { id: "when", header: "Requested", cell: ({ row }) => row.original.created_at ? relativeTime(row.original.created_at) : "—" },
    { id: "act", header: "", cell: ({ row }) => (
      <Button variant="secondary" disabled={approve.isPending || !q.data?.live_enabled || (user != null && row.original.requested_by === user.id)}
        title={user != null && row.original.requested_by === user.id ? "You requested this; another approver must approve it" : undefined}
        onClick={() => approve.mutate(row.original.id)}>Approve</Button>
    ) },
  ], [approve, q.data?.live_enabled, user]);
  const list = q.data?.approvals ?? [];
  return (
    <Panel q={q}>
      <div className="flex flex-col gap-3">
        {q.data && !q.data.live_enabled ? (
          <Notice>Live SAP write-back is off on this deployment. Export fixes as an LSMW or BAPI file and load them in SAP.</Notice>
        ) : null}
        <p className="m-text-body" style={note}>A different person than the requester must approve each request.</p>
        {list.length === 0 ? <EmptyState title="No write-backs waiting" detail="Approved fixes queue here before they reach SAP" action={<Button variant="secondary" render={<Link href="/fix">Open fixes</Link>} />} /> : (
          <DataTable columns={cols} data={list} getRowId={(a) => a.id} height={380} exportName="writeback-approvals" />
        )}
      </div>
    </Panel>
  );
}
