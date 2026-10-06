"use client";

/**
 * Failing records: every SAP record a check fails, tracked across runs. A
 * later run that finds the record passing resolves it; failing again
 * re-opens it. Filters live in the URL so a finding, a report or a colleague
 * can link straight to a work list.
 */

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { Select, Textarea } from "@/components/aurora";
import {
  Banner, Button, Chip, DataTable, DetailDrawer, EmptyState, FilterBar, KeyValue, Mono, PageHeader, Pager,
  ReasonButton, StatusBadge, TableSkeleton, Tabs, Tally, type AuroraColumnMeta, type Status,
} from "@/components/ui-core";
import {
  commentIssue,
  exportIssues,
  getIssue,
  getIssues,
  updateIssues,
  type IssueFilter,
  type IssueStatus,
  type RecordIssue,
} from "@/lib/api/issues";
import { getAssignableUsers } from "@/lib/api/users";
import { getTriageMetrics } from "@/lib/api/triage";
import { formatModuleName, relativeTime, formatDate } from "@/lib/format";
import { useRole } from "@/hooks/use-role";

const meta = (m: AuroraColumnMeta) => m;
const PAGE = 100;
const STATUSES: { id: IssueStatus; label: string }[] = [
  { id: "open", label: "Open" },
  { id: "in_progress", label: "In progress" },
  { id: "accepted", label: "Accepted" },
  { id: "resolved", label: "Resolved" },
];
const SEVERITIES = ["critical", "high", "medium", "low"] as const;
const sev = (s: string): Status => ((SEVERITIES as readonly string[]).includes(s) ? (s as Status) : "medium");
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const RESOLUTION_LABEL: Record<string, string> = {
  verified_fixed: "Verified fixed by a later run",
  fixed_in_source: "Marked fixed in SAP, waiting for the next run",
  accepted_risk: "Risk accepted",
  false_positive: "False positive",
};
const STATUS_BADGE: Record<IssueStatus, Status> = { open: "high", in_progress: "running", waiting_sap: "medium", waiting_requester: "medium", accepted: "idle", resolved: "ok" };
const ACTION_LABEL: Record<string, string> = {
  status: "changed status", assign: "assigned", comment: "commented", auto_resolved: "resolved by a run", reopened: "re-opened by a run",
};

const FILTER_KEYS = ["status", "module", "check_id", "severity", "assigned_to", "scope", "search", "version_id", "sla", "age", "week"] as const;

/** Filters the API does not know: applied to the loaded page in the browser. */
type RecordFilter = IssueFilter & { sla?: string; age?: string; week?: string };
const AGES: { id: string; label: string; min: number; max: number }[] = [
  { id: "0-2", label: "0 to 2 days", min: 0, max: 3 },
  { id: "3-7", label: "3 to 7 days", min: 3, max: 8 },
  { id: "8-14", label: "8 to 14 days", min: 8, max: 15 },
  { id: "15-30", label: "15 to 30 days", min: 15, max: 31 },
  { id: "30+", label: "Over 30 days", min: 31, max: Infinity },
];
const DAY_MS = 86_400_000;
const keep = (i: RecordIssue, f: RecordFilter) => {
  if (f.sla && i.sla_state !== f.sla) return false;
  const days = (Date.now() - new Date(i.first_seen_at).getTime()) / DAY_MS;
  const a = AGES.find((x) => x.id === f.age);
  if (a && !(days >= a.min && days < a.max)) return false;
  if (f.week) {
    const t = new Date(i.first_seen_at).getTime() - new Date(f.week).getTime();
    if (!(t >= 0 && t < 7 * DAY_MS)) return false;
  }
  return true;
};

const columns = (selected: Set<string>, toggle: (id: string) => void): ColumnDef<RecordIssue, unknown>[] => [
  {
    id: "select",
    header: "",
    cell: ({ row }) => (
      <input type="checkbox" aria-label={`Select ${row.original.record_key}`} checked={selected.has(row.original.id)}
        onClick={(e) => e.stopPropagation()} onChange={() => toggle(row.original.id)} />
    ),
    meta: meta({ width: 36 }),
  },
  { id: "severity", header: "Severity", meta: meta({ width: 104 }), cell: ({ row }) => <StatusBadge status={sev(row.original.severity)}>{cap(row.original.severity)}</StatusBadge> },
  { id: "record", header: "SAP record", meta: meta({ width: 280, sticky: "start" }), cell: ({ row }) => <span title={row.original.record_key}><Mono>{row.original.record_key}</Mono></span> },
  {
    id: "check", header: "Check", meta: meta({ minWidth: 300 }),
    cell: ({ row }) => (
      <span className="ui-cell-stack" title={row.original.message ?? undefined}>
        <span className="ui-cell-stack__main">{row.original.message ?? row.original.check_id}</span>
        <span className="ui-cell-stack__sub">
          <Mono>{row.original.check_id}</Mono>
          {row.original.field ? <Mono>{row.original.field}</Mono> : null}
        </span>
      </span>
    ),
  },
  { id: "module", header: "Object", meta: meta({ width: 160 }), cell: ({ row }) => formatModuleName(row.original.module) },
  { id: "assignee", header: "Assignee", meta: meta({ width: 180 }), cell: ({ row }) => row.original.assignee_email ?? <span className="ui-micro">Unassigned</span> },
  {
    id: "seen", header: "First seen", meta: meta({ width: 150 }),
    cell: ({ row }) => {
      const n = row.original.reopened_count;
      return (
        <span title={n > 0 ? `Re-opened ${n} time${n === 1 ? "" : "s"}` : undefined}>
          {relativeTime(row.original.first_seen_at)}
          {n > 0 ? <span className="ui-micro"> Re-opened</span> : null}
        </span>
      );
    },
  },
];

export function RecordsSurface() {
  return (
    <Suspense>
      <IssuesWorkList />
    </Suspense>
  );
}

function IssuesWorkList() {
  const qc = useQueryClient();
  const { can } = useRole();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [filter, setFilter] = useState<RecordFilter>(() => {
    const f: RecordFilter = { status: "open" };
    for (const k of FILTER_KEYS) {
      const v = params.get(k);
      if (v) (f as Record<string, string>)[k] = v;
    }
    return f;
  });
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openId, setOpenId] = useState<string | null>(null);
  const [search, setSearch] = useState(filter.search ?? "");

  const set = (patch: RecordFilter) => {
    const next = { ...filter, ...patch };
    setFilter(next);
    setOffset(0);
    setSelected(new Set());
    const q = new URLSearchParams(Object.entries(next).filter(([, v]) => v) as [string, string][]);
    if (params.get("tab")) q.set("tab", params.get("tab") as string);
    router.replace(`${pathname}?${q}`, { scroll: false });
  };

  // Record keys are searched on the server; wait for a pause in typing.
  useEffect(() => {
    const term = search.trim() || undefined;
    if (term === filter.search) return;
    const t = setTimeout(() => set({ search: term }), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const { sla, age, week, ...apiFilter } = filter;
  const { data, isLoading, error } = useQuery({
    queryKey: ["issues", apiFilter, offset],
    queryFn: () => getIssues({ ...apiFilter, limit: PAGE, offset }),
  });
  const metricsQ = useQuery({ queryKey: ["triage.metrics", 8], queryFn: () => getTriageMetrics(8) });
  const m = metricsQ.data;
  const { data: users = [] } = useQuery({ queryKey: ["users.assignable"], queryFn: getAssignableUsers, enabled: can("assign") });

  const bulk = useMutation({
    mutationFn: updateIssues,
    onSuccess: (r) => {
      toast.success(`${r.updated} record${r.updated === 1 ? "" : "s"} updated`);
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: ["issues"] });
      qc.invalidateQueries({ queryKey: ["issue"] });
    },
    onError: (e) => toast.error((e as Error).message || "The update was refused"),
  });
  const exporting = useMutation({
    mutationFn: (f: "csv" | "xlsx") => exportIssues(f, apiFilter),
    onError: (e) => toast.error((e as Error).message || "The export failed"),
  });

  const toggle = (id: string) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
  const ids = Array.from(selected);
  const counts = data?.counts ?? {};
  const items = (data?.items ?? []).filter((i) => keep(i, filter));
  const modules = Array.from(new Set(items.map((i) => i.module).concat(filter.module ? [filter.module] : [])));
  const status = filter.status ?? "open";
  const narrowed = Boolean(sla || age || week || filter.module || filter.severity || filter.assigned_to || filter.search || filter.check_id || filter.version_id);
  const clearAll = () => {
    setSearch("");
    set({ sla: undefined, age: undefined, week: undefined, module: undefined, severity: undefined, assigned_to: undefined, search: undefined, check_id: undefined, version_id: undefined, scope: undefined });
  };

  const base = "/analyse?tab=records";
  const atRisk = m ? m.backlog_by_owner.reduce((a, r) => a + r.at_risk, 0) : null;
  const resolvedWeek = m?.weekly.at(-1)?.resolved ?? null;
  return (
    <div className="ui-page">
      <PageHeader
        title="Failing records"
        summary={data
          ? `${(counts.open ?? 0).toLocaleString()} open and ${(counts.in_progress ?? 0).toLocaleString()} in progress. A record resolves itself when a later run finds it passing.`
          : "Every SAP record a check fails, tracked from run to run."}
        actions={can("export") ? (
          <>
            {(["xlsx", "csv"] as const).map((f) => (
              <Button key={f} variant="secondary" disabled={exporting.isPending} onClick={() => exporting.mutate(f)}>
                Export {f === "xlsx" ? "Excel" : "CSV"}
              </Button>
            ))}
          </>
        ) : undefined}
      />

      <Tally level={2} label="Failing records" figures={[
        { label: "Open", value: counts.open ?? null, verdict: counts.open ? "Records a run found failing." : "No records failing.", href: `${base}&status=open`, loading: !data },
        { label: "Breached SLA", value: m?.breach_count ?? null, tone: m?.breach_count ? "danger" : undefined, verdict: m?.breach_count ? "Past their due date." : "Nothing past due.", href: `${base}&status=open&sla=breached`, loading: !m },
        { label: "At risk", value: atRisk, tone: atRisk ? "warning" : undefined, verdict: atRisk ? "Close to their due date." : "Nothing close to due.", href: `${base}&status=open&sla=at_risk`, loading: !m },
        { label: "Unassigned", value: m?.unassigned ?? null, verdict: m?.unassigned ? "Nobody owns these yet." : "Every record has an owner.", href: `${base}&status=open&assigned_to=unassigned`, loading: !m },
        { label: "Resolved this week", value: resolvedWeek, verdict: resolvedWeek ? "Closed in the last seven days." : "Nothing closed this week.", href: `${base}&status=resolved`, loading: !m },
      ]} />

      <Tabs<IssueStatus> ariaLabel="Failing record status" value={status} onValueChange={(s) => set({ status: s })}
        items={STATUSES.map((s) => ({ id: s.id, label: s.label, count: counts[s.id] ?? 0 }))} />

      <FilterBar
        search={{ value: search, onChange: setSearch, placeholder: "Search record keys" }}
        onClear={narrowed ? clearAll : undefined}
        actions={
          <>
            <Select placeholder="All objects" value={filter.module ?? ""} aria-label="Object"
              options={modules.map((m) => ({ value: m, label: formatModuleName(m) }))} onValueChange={(v) => set({ module: v || undefined })} />
            <Select placeholder="Anyone" value={filter.assigned_to ?? ""} aria-label="Assignee"
              options={[{ value: "me", label: "Assigned to me" }, { value: "unassigned", label: "Unassigned" },
                ...users.map((u) => ({ value: u.id, label: u.name || u.email }))]}
              onValueChange={(v) => set({ assigned_to: v || undefined })} />
          </>
        }
      >
        {SEVERITIES.map((s) => (
          <Chip key={s} selected={filter.severity === s} onClick={() => set({ severity: filter.severity === s ? undefined : s })}>{cap(s)}</Chip>
        ))}
        {AGES.map((a) => (
          <Chip key={a.id} selected={age === a.id} onClick={() => set({ age: age === a.id ? undefined : a.id })}>{a.label}</Chip>
        ))}
        {week ? <Chip tone="info" onDismiss={() => set({ week: undefined })}>Opened week of {week}</Chip> : null}
        {sla ? <Chip tone="info" onDismiss={() => set({ sla: undefined })}>{sla === "breached" ? "Breached SLA" : "At risk"}</Chip> : null}
        {filter.check_id ? <Chip tone="info" onDismiss={() => set({ check_id: undefined })}>Check: <Mono>{filter.check_id}</Mono></Chip> : null}
        {filter.version_id ? (
          <Chip tone="info" onDismiss={() => set({ version_id: undefined })}>Failing in run <Mono>{filter.version_id.slice(0, 8)}</Mono></Chip>
        ) : null}
      </FilterBar>

      {ids.length > 0 ? (
        <div className="ui-notice" role="region" aria-label="Selected records">
          <span>{ids.length} selected</span>
          {can("assign") ? (
            <>
              <Select placeholder="Assign to" value="" aria-label="Assign selected"
                options={[{ value: "__none__", label: "Unassign" }, ...users.map((u) => ({ value: u.id, label: u.name || u.email }))]}
                onValueChange={(v) => bulk.mutate({ ids, assigned_to: v === "__none__" ? "" : v })} />
              <Button size="sm" variant="secondary" onClick={() => bulk.mutate({ ids, status: "in_progress" })}>Start work</Button>
              <Button size="sm" variant="secondary" onClick={() => bulk.mutate({ ids, status: "resolved", resolution: "fixed_in_source" })}>
                Mark fixed in SAP
              </Button>
              <Button size="sm" variant="ghost" onClick={() => bulk.mutate({ ids, status: "open" })}>Re-open</Button>
            </>
          ) : null}
          {can("approve") ? (
            <>
              <Button size="sm" variant="ghost" onClick={() => bulk.mutate({ ids, status: "accepted", resolution: "accepted_risk" })}>Accept risk</Button>
              <ReasonButton size="sm" label="False positive" prompt="Why are these not issues?"
                onConfirm={(note) => bulk.mutate({ ids, status: "accepted", resolution: "false_positive", note })} />
            </>
          ) : null}
          <button type="button" className="ui-link-button" onClick={() => setSelected(new Set())}>Clear selection</button>
        </div>
      ) : null}

      {isLoading ? <TableSkeleton rows={10} label="Loading failing records" />
        : error ? <Banner tone="danger" title="Failing records could not be read">{(error as Error).message}</Banner>
        : items.length ? (
          <div className="ui-stack" style={{ gap: "var(--aurora-space-3)" }}>
            <DataTable columns={columns(selected, toggle)} data={items} getRowId={(r) => r.id} onRowActivate={(r) => setOpenId(r.id)}
              maxHeight="62vh" ariaLabel="Failing records. Use j and k to move, Enter to open." />
            <Pager offset={offset} total={data?.total ?? 0} pageSize={PAGE} onChange={setOffset} noun="failing records" />
          </div>
        ) : (
          <EmptyState action={narrowed
            ? <button type="button" className="ui-link-button" onClick={clearAll}>Clear filters</button>
            : <Link className="ui-link" href="/analyse?tab=findings">Open findings</Link>}>
            {narrowed ? "No failing records match these filters."
              : status === "open" ? "No open failing records. Records appear here after a run finds them failing."
              : `No ${STATUSES.find((s) => s.id === status)?.label.toLowerCase()} records.`}
          </EmptyState>
        )}
      <IssueDrawer id={openId} onClose={() => setOpenId(null)} canComment={can("analyse")} />
    </div>
  );
}

const Part = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="ui-detail-part"><h3 className="ui-detail-part__title">{title}</h3>{children}</section>
);

function IssueDrawer({ id, onClose, canComment }: { id: string | null; onClose: () => void; canComment: boolean }) {
  const qc = useQueryClient();
  const [note, setNote] = useState("");
  const { data, error } = useQuery({ queryKey: ["issue", id], queryFn: () => getIssue(id as string), enabled: Boolean(id) });
  const comment = useMutation({
    mutationFn: () => commentIssue(id as string, note),
    onSuccess: () => { setNote(""); qc.invalidateQueries({ queryKey: ["issue", id] }); },
    onError: (e) => toast.error((e as Error).message || "The comment was not saved"),
  });
  const i = data?.issue;
  return (
    <DetailDrawer open={Boolean(id)} onClose={onClose} ariaLabel="Failing record"
      header={i ? (
        <div className="ui-drawer-head">
          <StatusBadge status={sev(i.severity)}>{cap(i.severity)}</StatusBadge>
          <h2 className="ui-drawer-head__title"><Mono>{i.record_key}</Mono></h2>
        </div>
      ) : null}>
      {error ? <p className="ui-note">This record could not be read: {(error as Error).message}</p>
        : !i || !data ? <TableSkeleton rows={4} label="Loading the record" />
        : (
          <div className="ui-detail">
            {i.message ? <p className="ui-note">{i.message}</p> : null}
            <KeyValue rows={[
              { k: "Status", v: <StatusBadge status={STATUS_BADGE[i.status]}>{STATUSES.find((s) => s.id === i.status)?.label ?? i.status}</StatusBadge> },
              ...(i.resolution ? [{ k: "Resolution", v: RESOLUTION_LABEL[i.resolution] ?? i.resolution }] : []),
              { k: "Check", v: i.check_id, mono: true },
              ...(i.field ? [{ k: "Field", v: i.field, mono: true }] : []),
              { k: "Object", v: formatModuleName(i.module) },
              ...(i.grain ? [{ k: "Evaluated on", v: i.grain, mono: true }] : []),
              { k: "Assignee", v: i.assignee_email ?? "Unassigned" },
              { k: "First seen", v: relativeTime(i.first_seen_at) },
              { k: "Last failing", v: relativeTime(i.last_seen_at) },
            ]} />
            <div className="ui-page-header__actions">
              <Link className="ui-link" href={`/workbench/record/${i.id}`}>Open the record report</Link>
              <Link className="ui-link" href={`/findings?${new URLSearchParams({ check_id: i.check_id, version_id: i.last_seen_version, module: i.module })}`}>
                Open the finding
              </Link>
            </div>
            <Part title="Run by run">
              {data.runs.length ? (
                <table className="ui-mini-table">
                  <thead><tr><th scope="col">Run</th><th scope="col">Result</th></tr></thead>
                  <tbody>
                    {data.runs.map((r) => (
                      <tr key={r.version_id}>
                        <td>{formatDate(r.run_at, "datetime")}</td>
                        <td><StatusBadge status={r.failing ? "failed" : "ok"}>{r.failing ? "Fails" : "Passes"}</StatusBadge></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : <p className="ui-note">No run has evaluated this record since it was first seen.</p>}
            </Part>
            <Part title="Activity">
              {data.events.length === 0 ? <p className="ui-note">No activity yet.</p> : (
                <ol className="ui-plain-list">
                  {data.events.map((e, n) => (
                    <li key={n}>
                      <span className="ui-micro">{relativeTime(e.created_at)}</span>{" "}
                      {e.user_label ?? "Meridian"} {ACTION_LABEL[e.action] ?? e.action.replace("_", " ")}
                      {e.from_value || e.to_value ? ` from ${e.from_value ?? "none"} to ${e.to_value ?? "none"}` : ""}
                      {e.note ? <p className="ui-note">{e.note}</p> : null}
                    </li>
                  ))}
                </ol>
              )}
              {canComment ? (
                <form className="ui-stack" style={{ gap: "var(--aurora-space-2)" }} onSubmit={(e) => { e.preventDefault(); comment.mutate(); }}>
                  <Textarea rows={3} value={note} aria-label="Comment" placeholder="What was found or done in SAP"
                    onChange={(e) => setNote(e.target.value)} />
                  <div><Button size="sm" type="submit" disabled={!note.trim() || comment.isPending}>Add comment</Button></div>
                </form>
              ) : null}
            </Part>
          </div>
        )}
    </DetailDrawer>
  );
}
