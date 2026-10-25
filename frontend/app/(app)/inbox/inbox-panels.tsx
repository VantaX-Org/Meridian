"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";
import { Button, Card, ConfirmDialog, DataTable, EmptyState, ErrorState, ExportMenu, Field, Mono, Notice, Pill, Select, Skeleton, Stat, Textarea, toast, type PillTone, Input, Status } from "@/design";
import { Workbench, type WorkbenchItem, type WorkbenchTone } from "@/components/inbox/workbench";
import { QuickFilters } from "@/components/inbox/quick-filters";
import { getAssignableUsers } from "@/lib/api/users";
import { useAuth } from "@/context/auth-context";
import { useRole } from "@/hooks/use-role";
import { getSAPMonitor } from "@/lib/api/exceptions";
import {
  commentIssue, exportIssues, getIssue, getIssues, updateIssues, type IssueStatus, type RecordIssue,
} from "@/lib/api/issues";
import { approveWriteback, getPendingApprovals, type PendingApproval } from "@/lib/api/writeback";
import { getFindingReportContext } from "@/lib/api/findings";
import { getVersion } from "@/lib/api/versions";
import { getRules } from "@/lib/api/rules";
import { getUsers } from "@/lib/api/users";
import { writeBackModeSentence } from "@/lib/api/remediation";
import { apiErrorMessage, isNotFound, apiErrorState } from "@/lib/error";
import { formatModuleName, labelOf, relativeTime } from "@/lib/format";
import { runName } from "@/lib/run-scope";
import { queryKeys } from "@/lib/query-keys";
import type { Exception } from "@/types/api";

const STATUSES: IssueStatus[] = ["open", "in_progress", "waiting_sap", "waiting_requester", "accepted", "resolved"];
const SEVERITIES = ["critical", "high", "medium", "low"] as const;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** How many issues the list loads at a time; "Load more" widens it. */
const ISSUE_PAGE = 200;

/** 45m, 5h, 3d */
function span(ms: number): string {
  const h = Math.abs(ms) / HOUR;
  if (h < 1) return `${Math.max(1, Math.round(h * 60))}m`;
  return h < 48 ? `${Math.round(h)}h` : `${Math.round(h / 24)}d`;
}

type Urgency = "overdue" | "soon" | "ok" | "none";
/** Overdue is red, due inside the next 24 hours (or flagged at risk by the server) is amber, the rest green. */
function urgencyOf(i: RecordIssue, now: number): { state: Urgency; tone: PillTone; text: string } {
  const due = i.due_at ? Date.parse(i.due_at) : NaN;
  const left = Number.isNaN(due) ? null : due - now;
  if (i.sla_state === "breached" || (left !== null && left < 0)) return { state: "overdue", tone: "no-go", text: left !== null ? `${span(left)} overdue` : "Overdue" };
  if (i.sla_paused_at) return { state: "ok", tone: "neutral", text: "Clock paused" };
  if (i.sla_state === "at_risk" || (left !== null && left < DAY)) return { state: "soon", tone: "at-risk", text: left !== null ? `Due in ${span(left)}` : "Due soon" };
  if (left === null) return { state: "none", tone: "neutral", text: "No due date" };
  return { state: "ok", tone: "go", text: `Due in ${span(left)}` };
}

function Panel({ q, children }: { q: { isLoading: boolean; error: unknown; refetch: () => unknown }; children: React.ReactNode }) {
  if (q.isLoading) return <Skeleton height={240} />;
  if (q.error && !isNotFound(q.error)) return <ErrorState {...apiErrorState(q.error)} onRetry={() => q.refetch()} />;
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
      <p className="m-ink-2">Record <Mono>{issue.record_key}</Mono>{issue.field ? <>, field <Mono>{issue.field}</Mono></> : null}</p>
      {q.isLoading ? <Skeleton height={80} /> : q.error ? <ErrorState {...apiErrorState(q.error)} onRetry={() => void q.refetch()} /> : (
        <ol className="flex flex-col gap-2">
          {(q.data?.events ?? []).length === 0 ? <li className="m-ink-2">No activity yet. Comments and status changes appear here.</li> : null}
          {(q.data?.events ?? []).map((e, i) => (
            <li key={`${e.created_at}-${i}`} className="border-l-2 pl-3">
              <span className="font-medium">{labelOf(e.action)}</span>
              {e.to_value ? <> to {labelOf(e.to_value)}</> : null}
              <span className="m-ink-2"> by {e.user_label ?? "System"}, {relativeTime(e.created_at)}</span>
              {e.note ? <p>{e.note}</p> : null}
            </li>
          ))}
        </ol>
      )}
      {can("analyse") ? (
        <Field label="Add a comment">
          <Textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} />
        </Field>
      ) : null}
      {can("analyse") ? <div><Button variant="secondary" disabled={!text.trim()} pending={post.isPending} onClick={() => post.mutate()}>Post comment</Button></div> : null}
    </div>
  );
}

/** The issue's rule by name when the rule library has it, with the check id in mono beside it. */
function IssueTitle({ issue, name }: { issue: RecordIssue; name?: string }) {
  return (
    <span className="inline-flex flex-wrap items-baseline gap-2">
      <span>{name ?? "Rule"} in {formatModuleName(issue.module)}</span>
      <Mono>{issue.check_id}</Mono>
    </span>
  );
}

const issueTone = (sev: string): WorkbenchTone => (sev === "critical" || sev === "high" || sev === "medium" ? sev : "low");

export function IssuesPanel() {
  const { can } = useRole();
  const { user } = useAuth();
  const qc = useQueryClient();
  // Status, assignee and resolve changes need `assign` on the server (api/routes/record_issues.py bulk_update).
  const canAssign = can("assign");
  const [status, setStatus] = useState<IssueStatus | "">("");
  const [severity, setSeverity] = useState("");
  const [who, setWho] = useState<"all" | "mine" | "unassigned">("all");
  const [when, setWhen] = useState<"any" | "overdue" | "soon">("any");
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
  const [limit, setLimit] = useState(ISSUE_PAGE);
  const filter = {
    status: status || undefined, severity: severity || undefined, search: search.trim() || undefined,
    assigned_to: who === "mine" ? "me" : who === "unassigned" ? "unassigned" : undefined,
  };
  const q = useQuery({ queryKey: ["issues", "list", filter, limit], queryFn: () => getIssues({ ...filter, limit }), retry: false, placeholderData: (prev) => prev });
  // Rule names for the detail title; the check id stays beside the name.
  const rules = useQuery({ queryKey: ["rules", "names"], queryFn: () => getRules({ limit: 1000 }), staleTime: 300_000, meta: { ignoreError: true } });
  const people = useQuery({ queryKey: ["users", "assignable"], queryFn: getAssignableUsers, enabled: canAssign, staleTime: 300_000 });
  const bulk = useMutation({
    mutationFn: (v: { ids: string[]; status?: IssueStatus; resolution?: string; assigned_to?: string }) => updateIssues(v),
    onSuccess: (r) => { toast.success(`${r.updated.toLocaleString()} ${r.updated === 1 ? "issue" : "issues"} updated`); void qc.invalidateQueries({ queryKey: ["issues"] }); },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });
  const now = q.dataUpdatedAt;
  const loaded = useMemo(() => q.data?.items ?? [], [q.data]);
  const total = q.data?.total ?? 0;
  const partial = total > loaded.length;
  // The urgency filter runs on the loaded page: the list endpoint filters by owner, status and severity, not by due date.
  const items = useMemo(() => (when === "any" ? loaded : loaded.filter((i) => urgencyOf(i, now).state === when)), [loaded, when, now]);
  const urgentCounts = useMemo(() => ({
    overdue: loaded.filter((i) => urgencyOf(i, now).state === "overdue").length,
    soon: loaded.filter((i) => urgencyOf(i, now).state === "soon").length,
  }), [loaded, now]);
  // The first issue is open until another is picked, so the right pane is never empty beside a full list.
  const selected = items.find((i) => i.id === picked) ?? items[0];
  const rows = useMemo<WorkbenchItem[]>(() => items.map((i) => {
    const u = urgencyOf(i, now);
    return {
      id: i.id,
      label: `${i.check_id} ${i.record_key}`,
      title: <>{i.message ?? i.check_id} in {formatModuleName(i.module)}</>,
      meta: `${i.record_key}, ${labelOf(i.status)}, ${i.assignee_email ?? "Unassigned"}, seen ${relativeTime(i.last_seen_at)}`,
      aside: <Pill tone={u.tone}>{u.text}</Pill>,
      tone: u.state === "overdue" ? "critical" : issueTone(i.severity),
    };
  }), [items, now]);
  const onCheck = (id: string, on: boolean) => setChecked((prev) => {
    const next = new Set(prev);
    if (on) next.add(id); else next.delete(id);
    return next;
  });
  const filtering = !!(status || severity || search.trim()) || who !== "all" || when !== "any";
  const clear = () => { setStatus(""); setSeverity(""); setSearch(""); setWho("all"); setWhen("any"); };
  const assignees = (Array.isArray(people.data) ? people.data : []).filter((u) => u.id !== user?.id).map((u) => ({ value: u.id, label: u.name || u.email }));
  const actions = (ids: string[]) => canAssign ? (
    <>
      {user ? <Button variant="secondary" size="sm" disabled={bulk.isPending} onClick={() => bulk.mutate({ ids, assigned_to: user.id })}>Claim</Button> : null}
      <Button variant="secondary" size="sm" disabled={bulk.isPending} onClick={() => bulk.mutate({ ids, assigned_to: "" })}>Release</Button>
      {assignees.length > 0 ? (
        <Select label="Reassign to" value="" placeholder="Reassign to…" options={assignees} onValueChange={(v) => { if (v) bulk.mutate({ ids, assigned_to: v }); }} />
      ) : null}
      <Button variant="secondary" size="sm" disabled={bulk.isPending} onClick={() => bulk.mutate({ ids, status: "in_progress" })}>Start work</Button>
      <Button variant="secondary" size="sm" disabled={bulk.isPending} onClick={() => bulk.mutate({ ids, status: "resolved", resolution: "fixed_in_source" })}>Fixed in SAP</Button>
    </>
  ) : null;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        <QuickFilters label="Who" value={who} onChange={(v) => setWho(v as typeof who)}
          options={[{ value: "all", label: "Everyone" }, { value: "mine", label: "Mine" }, { value: "unassigned", label: "Unassigned" }]} />
        <QuickFilters label="When" value={when} onChange={(v) => setWhen(v as typeof when)}
          options={[{ value: "any", label: "Any time" }, { value: "overdue", label: "Overdue", count: urgentCounts.overdue }, { value: "soon", label: "Due in 24 hours", count: urgentCounts.soon }]} />
      </div>
      <div className="flex flex-wrap items-end gap-4">
        <Stat label="Issues" value={q.isLoading ? "…" : (q.data?.total ?? 0).toLocaleString()} />
        <Field label="Status">
          <Select value={status} onValueChange={(v) => setStatus((v || "") as IssueStatus | "")} placeholder="All statuses"
            options={[{ value: "", label: "All statuses" }, ...STATUSES.map((s) => ({ value: s, label: `${labelOf(s)}${q.data?.counts[s] ? ` (${q.data.counts[s]})` : ""}` }))]} />
        </Field>
        <Field label="Severity">
          <Select value={severity} onValueChange={setSeverity} placeholder="All severities"
            options={[{ value: "", label: "All severities" }, ...SEVERITIES.map((s) => ({ value: s, label: labelOf(s) }))]} />
        </Field>
        <Field label="Search">
          <Input aria-label="Search issues" placeholder="Record key" value={search} onChange={(e) => setSearch(e.target.value)} />
        </Field>
        {filtering ? <Button variant="ghost" size="sm" onClick={clear}>Clear filters</Button> : null}
        <ExportMenu options={[{ format: "xlsx", label: "Issues (.xlsx)", run: () => exportIssues("xlsx", filter) }]} />
      </div>
      {!q.isLoading && partial ? (
        <Notice action={<Button variant="secondary" disabled={q.isFetching} onClick={() => setLimit((n) => n + ISSUE_PAGE)}>Load more</Button>}>
          {loaded.length.toLocaleString()} of {total.toLocaleString()} issues loaded, and the Overdue and Due in 24 hours counts cover only these
        </Notice>
      ) : null}
      <Panel q={q}>
        {items.length === 0 ? (
          filtering ? (
            <EmptyState title="No issues match these filters" detail="Clear the filters to see every open record issue." action={<Button variant="secondary" onClick={clear}>Clear filters</Button>} />
          ) : (
            <EmptyState title="No record issues" detail="Issues open when an analysis finds a failing SAP record, and close when it passes." action={<Button variant="secondary" render={<Link href="/runs">Open runs</Link>} />} />
          )
        ) : (
          <Workbench
            items={rows}
            selectedId={selected?.id ?? null}
            onSelect={setPicked}
            checked={checked}
            onCheck={onCheck}
            onCheckAll={(on) => setChecked(new Set(on ? items.map((i) => i.id) : []))}
            listLabel="Issues"
            bulk={actions}
            detail={selected ? (
              <Card
                title={<IssueTitle issue={selected} name={rules.data?.rules.find((r) => r.id === selected.check_id)?.name} />}
                meta={<span className="inline-flex items-center gap-2"><Status kind="severity" value={selected.severity} /><Pill tone={urgencyOf(selected, now).tone}>{urgencyOf(selected, now).text}</Pill></span>}
                actions={
                  <div className="flex flex-wrap items-center gap-2">
                    <Button variant="secondary" render={<Link href={`/objects/${encodeURIComponent(selected.module)}/records/${encodeURIComponent(selected.record_key)}`} />}>Open record</Button>
                    {canAssign && selected.status !== "resolved" ? (
                      <Button variant="primary" disabled={bulk.isPending} onClick={() => bulk.mutate({ ids: [selected.id], status: "resolved", resolution: "fixed_in_source" })}>Fixed in SAP</Button>
                    ) : null}
                    {canAssign && user ? (
                      selected.assigned_to === user.id
                        ? <Button variant="ghost" disabled={bulk.isPending} onClick={() => bulk.mutate({ ids: [selected.id], assigned_to: "" })}>Release</Button>
                        : <Button variant="secondary" disabled={bulk.isPending} onClick={() => bulk.mutate({ ids: [selected.id], assigned_to: user.id })}>Claim</Button>
                    ) : null}
                  </div>
                }
              >
                <IssueThread key={selected.id} issue={selected} />
              </Card>
            ) : null}
          />
        )}
      </Panel>
    </div>
  );
}

/* ─── SAP monitor: exceptions raised from live SAP signals ─── */

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
            renderDrawer={(e) => <p className="m-text-body">{e.description || "SAP sent no further detail for this signal."}</p>} />
        </div>
      )}
    </Panel>
  );
}

/* ─── Approvals: live write-back requests waiting for a second person ─── */

/** The rule behind a write-back request, from its finding: the check id in mono with the object beside it. */
function FindingRule({ findingId }: { findingId: string | null }) {
  const q = useQuery({ queryKey: ["findings", "context", findingId ?? ""], queryFn: () => getFindingReportContext(findingId as string), enabled: !!findingId, retry: false, meta: { ignoreError: true } });
  if (!findingId) return <>—</>;
  if (!q.data) return <Mono>{findingId}</Mono>;
  return <span className="inline-flex items-baseline gap-2"><Mono>{q.data.check_id}</Mono><span className="m-ink-3">{formatModuleName(q.data.module)}</span></span>;
}

/** The run a write-back request was raised from, by name. */
function RunName({ versionId }: { versionId: string | null }) {
  const q = useQuery({ queryKey: queryKeys.run(versionId ?? ""), queryFn: () => getVersion(versionId as string), enabled: !!versionId, retry: false, meta: { ignoreError: true } });
  if (!versionId) return <>—</>;
  return <>{q.data ? runName(q.data) : "Run"}</>;
}

export function ApprovalsPanel() {
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
  const who = (id: string | null) => (!id ? "Unknown user" : id === user?.id ? "You" : names.get(id) ?? "Unknown user");
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
    { id: "finding", header: "Rule", cell: ({ row }) => <FindingRule findingId={row.original.finding_id} /> },
    { id: "run", header: "Run", cell: ({ row }) => <RunName versionId={row.original.version_id} /> },
    { id: "host", header: "SAP host", cell: ({ row }) => row.original.sap_host ?? "—" },
    { id: "records", header: "Records", cell: ({ row }) => row.original.records_updated.toLocaleString() },
    { id: "by", header: "Requested by", cell: ({ row }) => who(row.original.requested_by) },
    { id: "when", header: "Requested", cell: ({ row }) => row.original.created_at ? relativeTime(row.original.created_at) : "—" },
    { id: "act", header: "", cell: ({ row }) => (
      <Button variant="secondary" disabled={approve.isPending || !q.data?.live_enabled || (user != null && row.original.requested_by === user.id)}
        title={user != null && row.original.requested_by === user.id ? "You requested this; another approver must approve it" : undefined}
        onClick={() => setAsking(row.original)}>Approve</Button>
    ) },
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `who` closes over names and user
  ], [approve, q.data?.live_enabled, user, names]);
  const list = q.data?.approvals ?? [];
  return (
    <Panel q={q}>
      <div className="flex flex-col gap-3">
        <Notice>
          {writeBackModeSentence(q.data?.live_enabled)}
          {q.data && !q.data.live_enabled ? " Live SAP write-back is off on this deployment. Export fixes as an LSMW or BAPI file and load them in SAP." : ""}
        </Notice>
        <p className="m-text-body m-ink-2">Each request needs a second person: you cannot approve a write-back you asked for.</p>
        {list.length === 0 ? <EmptyState title="No write-backs waiting" detail="Approved fixes queue here before they reach SAP" action={<Button variant="secondary" render={<Link href="/fix">Open fixes</Link>} />} /> : (
          <DataTable columns={cols} data={list} getRowId={(a) => a.id} height={380} exportName="writeback-approvals" />
        )}
        <ConfirmDialog
          open={asking !== null}
          onOpenChange={(open) => { if (!open) setAsking(null); }}
          title="Write these records back to SAP?"
          body={asking ? (
            <div className="flex flex-col gap-1">
              <p>Rule: <FindingRule findingId={asking.finding_id} /></p>
              <p>{asking.records_updated.toLocaleString()} record{asking.records_updated === 1 ? "" : "s"} on {asking.sap_host ?? "the connected SAP system"}, requested by {who(asking.requested_by)}.</p>
            </div>
          ) : null}
          confirmLabel="Approve and write back"
          cancelLabel="Keep waiting"
          pending={approve.isPending}
          onConfirm={() => asking && approve.mutate(asking.id)}
        />
      </div>
    </Panel>
  );
}
