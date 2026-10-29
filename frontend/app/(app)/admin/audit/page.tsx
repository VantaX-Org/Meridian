"use client";

/** Admin › Audit log: who did what, the AI calls behind suggestions, and role changes. */

import { useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";
import { Button, DataTable, EmptyState, ExplorerPage, ExportMenu, Field, FilterChip, Input, Mono, PageHeader, Pager, Pill, Select, Skeleton, Stat, Tabs, asyncStateOf } from "@/design";
import {
  exportAuditEntries, getAuditEntries, getAuditSummary, getLlmAudit, type AuditEntry, type AuditListParams, type AuditSummaryRow, type LlmAuditEntry,
} from "@/lib/api/audit";
import { labelOf } from "@/lib/format";
import { useRole } from "@/hooks/use-role";
import { getUsers } from "@/lib/api/users";
import { queryKeys } from "@/lib/query-keys";
import { useTenantTimezone } from "@/lib/tenant-zone";
import { usePermissions } from "@/lib/permissions";
import { useUrlState } from "@/hooks/use-url-state";
import { auditSentence, When } from "../_lib/audit-sentence";

const auditColumns = (tz: string): ColumnDef<AuditEntry>[] => [
  { id: "when", header: "When", cell: ({ row }) => <When iso={row.original.created_at} tz={tz} /> },
  { id: "what", header: "What happened", cell: ({ row }) => auditSentence(row.original) },
];

/** The request behind a row, for whoever needs it: method and path, the response code and where it came from. */
function RequestDetail({ e }: { e: AuditEntry }) {
  return (
    <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-1 m-text-meta">
      <dt className="m-ink-3">Request</dt><dd><Mono inline>{`${e.method} ${e.path}`}</Mono></dd>
      <dt className="m-ink-3">Response</dt><dd className="m-numeric">{e.status_code}</dd>
      {e.entity_id ? <><dt className="m-ink-3">Record</dt><dd><Mono inline>{e.entity_id}</Mono></dd></> : null}
      {e.ip ? <><dt className="m-ink-3">From</dt><dd>{e.ip}</dd></> : null}
    </dl>
  );
}

const llmColumns = (tz: string): ColumnDef<LlmAuditEntry>[] => [
  { id: "when", header: "When", cell: ({ row }) => <When iso={row.original.called_at} tz={tz} /> },
  { accessorKey: "service_name", header: "Service" },
  { id: "tokens", header: "Tokens", cell: ({ row }) => row.original.token_count ?? "—" },
  { id: "ms", header: "Latency (ms)", cell: ({ row }) => row.original.latency_ms ?? "—" },
  {
    id: "outcome",
    header: "Outcome",
    cell: ({ row }) => {
      const r = row.original;
      if (r.skip_reason) return `Skipped: ${r.skip_reason}`;
      if (r.deterministic_hit) return <Pill tone="go">Rule answered</Pill>;
      return <Pill tone={r.success ? "go" : "no-go"}>{r.success ? "Answered" : "Failed"}</Pill>;
    },
  },
];

const PAGE = 100;
const ALL = "all";

/** The start (or end) of a picked day in the viewer's clock, as ISO-8601 for the API. */
const dayBound = (day: string, end: boolean): string | undefined => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return undefined;
  const d = new Date(`${day}T${end ? "23:59:59.999" : "00:00:00"}`);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
};

/** One kind of change as words: "Create user", "Retry job". */
const kindLabel = (r: { action: string; entity_type: string | null }): string =>
  `${labelOf(r.action)}${r.entity_type ? ` ${labelOf(r.entity_type).toLowerCase()}` : ""}`;

/** The summary returns at most this many kinds (api/routes/audit.py LIMIT 50). */
const SUMMARY_KINDS = 50;

/**
 * The last 30 days at a glance (GET /audit/summary): every recorded event counted (reads such as exports
 * included, as the log lists them) and the three most frequent kinds; each kind filters the log below.
 */
function AuditSummaryStrip({ onPick }: { onPick: (r: AuditSummaryRow) => void }) {
  const q = useQuery({ queryKey: ["audit", "summary"], queryFn: getAuditSummary });
  const rows = q.data?.summary ?? [];
  if (q.isError || (q.isSuccess && rows.length === 0)) return null;
  const total = q.data?.total ?? rows.reduce((n, r) => n + r.count, 0);
  return (
    <div className="m-stat-grid" data-testid="audit-summary">
      <Stat label="Recorded events, last 30 days" value={total.toLocaleString()} loading={q.isLoading}
        hint={`${rows.length >= SUMMARY_KINDS ? `The ${SUMMARY_KINDS} most frequent` : rows.length.toLocaleString()} kinds. The log below lists older events too`} />
      {rows.slice(0, 3).map((r) => (
        <Stat key={`${r.action}:${r.entity_type ?? ""}`} label={kindLabel(r)} value={r.count.toLocaleString()} hint="Show these in the log" onClick={() => onPick(r)} />
      ))}
    </div>
  );
}

function AuditTable({ params, empty, summary = false }: { params: AuditListParams; empty: string; summary?: boolean }) {
  const tz = useTenantTimezone();
  const [actor, setActor] = useState(ALL);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  // A kind picked from the summary strip: its action and entity type.
  const [kind, setKind] = useState<AuditSummaryRow | null>(null);
  // Filtering by actor needs the user list; an auditor without user admin simply gets no actor filter.
  // /users needs manage_users: asking without it is a 403 in every auditor's console.
  const { can } = useRole();
  const usersQ = useQuery({ queryKey: queryKeys.users(), queryFn: getUsers, enabled: can("manage_users"), retry: false, meta: { ignoreError: true } });
  const users = usersQ.data?.users ?? [];
  const filters: AuditListParams = {
    ...(actor !== ALL ? { actor_user_id: actor } : {}),
    ...(dayBound(from, false) ? { since: dayBound(from, false) } : {}),
    ...(dayBound(to, true) ? { until: dayBound(to, true) } : {}),
    ...(kind ? { action: kind.action, ...(kind.entity_type ? { entity_type: kind.entity_type } : {}) } : {}),
  };
  const query = { ...params, ...filters, limit: PAGE, offset: (page - 1) * PAGE };
  const q = useQuery({ queryKey: ["audit", query], queryFn: () => getAuditEntries(query), placeholderData: keepPreviousData });
  const entries = q.data?.entries ?? [];
  const total = q.data?.total ?? 0;
  const filtered = Object.keys(filters).length > 0;
  const columns = useMemo(() => auditColumns(tz), [tz]);
  const reset = (fn: () => void) => { fn(); setPage(1); };
  const badRange = !!(from && to && from > to);
  const clearAll = () => { setActor(ALL); setFrom(""); setTo(""); setKind(null); };

  return (
    <ExplorerPage
      summary={summary ? <AuditSummaryStrip onPick={(r) => reset(() => setKind(r))} /> : undefined}
      filterBar={
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-end gap-3">
            {users.length ? (
              <div className="w-[220px]">
                <Field label="Who">
                  <Select value={actor} onValueChange={(v) => reset(() => setActor(v || ALL))}
                    options={[{ value: ALL, label: "Everyone" }, ...users.map((u) => ({ value: u.id, label: u.name || u.email }))]} />
                </Field>
              </div>
            ) : null}
            <Field label="From"><Input type="date" value={from} max={to || undefined} onChange={(e) => reset(() => setFrom(e.target.value))} /></Field>
            <Field label="To" error={badRange ? "Ends before it starts" : undefined}><Input type="date" value={to} min={from || undefined} onChange={(e) => reset(() => setTo(e.target.value))} /></Field>
            {filtered ? <Button variant="ghost" onClick={() => reset(clearAll)}>Clear filters</Button> : null}
          </div>
          {kind ? <div><FilterChip label="Kind" value={kindLabel(kind)} onRemove={() => reset(() => setKind(null))} /></div> : null}
          <p className="m-text-meta m-ink-3">Times are in the tenant time zone, {tz.replace(/_/g, " ")}. Expand a row for the request behind it</p>
        </div>
      }
      toolbarEnd={
        // Exports what the table shows: this tab's scope, who, the from/to window and the picked kind.
        <ExportMenu options={[{ format: "csv", run: () => exportAuditEntries("csv", { ...params, ...filters }) }, { format: "xlsx", run: () => exportAuditEntries("xlsx", { ...params, ...filters }) }]} />
      }
      state={asyncStateOf(q, () => entries.length === 0, true)}
      emptyProps={filtered
        ? { title: "Nothing matches these filters", detail: "Widen the dates or pick someone else.", action: <Button variant="secondary" onClick={() => reset(clearAll)}>Clear filters</Button> }
        : { title: empty, detail: "Changes people make are recorded here as they happen.", action: <Button variant="secondary" onClick={() => void q.refetch()}>Refresh</Button> }}
      errorProps={{ error: q.error, onRetry: () => void q.refetch() }}
      table={
        <div className="flex flex-col gap-2">
          <DataTable hideExport columns={columns} data={entries} getRowId={(r) => r.id} renderExpanded={(e) => <RequestDetail e={e} />} />
          {total > PAGE ? <Pager page={page} pageCount={Math.max(1, Math.ceil(total / PAGE))} pageSize={PAGE} total={total} onPageChange={setPage} /> : null}
        </div>
      }
    />
  );
}

/** AI calls per page of the AI audit tab. */
const LLM_PAGE = 100;

function LlmAudit() {
  const tz = useTenantTimezone();
  const columns = useMemo(() => llmColumns(tz), [tz]);
  // Newest first, a page at a time: the pager reaches every recorded call, not only the newest page.
  const [page, setPage] = useState(1);
  const q = useQuery({
    queryKey: ["audit", "llm", page],
    queryFn: () => getLlmAudit({ limit: LLM_PAGE, offset: (page - 1) * LLM_PAGE }),
    placeholderData: keepPreviousData,
  });
  const entries = q.data?.entries ?? [];
  const total = q.data?.total ?? 0;
  return (
    <ExplorerPage
      summary={q.data?.cache.length ? (
        <p className="m-text-body m-ink-3">
          {q.data.cache.map((c) => `${c.service_name}: ${c.deterministic} of ${c.decisions} answered by rules`).join(". ")}.
        </p>
      ) : undefined}
      state={asyncStateOf(q, () => entries.length === 0, true)}
      emptyProps={{ title: "No AI calls recorded", detail: "Every AI call is listed here with its latency and outcome" }}
      errorProps={{ error: q.error, onRetry: () => void q.refetch() }}
      table={
        <div className="flex flex-col gap-2">
          <DataTable columns={columns} data={entries} getRowId={(r) => r.id} />
          {total > LLM_PAGE ? <Pager page={page} pageCount={Math.ceil(total / LLM_PAGE)} pageSize={LLM_PAGE} total={total} onPageChange={setPage} /> : null}
        </div>
      }
    />
  );
}

export default function AdminAuditPage() {
  const [tab, setTab] = useUrlState("tab", "log");
  const { has, loading } = usePermissions();
  if (loading) return <Skeleton height={240} />;
  if (!has("audit", "view") && !has("users", "admin")) {
    return (
      <EmptyState title="Audit log is for auditors and administrators" detail="Ask an administrator for audit access." ghost="list" action={<Button variant="secondary" render={<Link href="/home">Back to home</Link>} />} />
    );
  }
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Audit log" meta="A permanent record of who changed what, every call to the language model, and every change to a user. Export it for an auditor" />
      <Tabs
        value={["log", "ai", "roles"].includes(tab) ? tab : "log"}
        onValueChange={setTab}
        items={[
          { value: "log", label: "Audit log", content: <AuditTable params={{}} empty="No audit activity yet" summary /> },
          { value: "ai", label: "AI audit", content: <LlmAudit /> },
          { value: "roles", label: "User changes", content: <AuditTable params={{ path_contains: "/users" }} empty="No user changes recorded" /> },
        ]}
      />
    </div>
  );
}
