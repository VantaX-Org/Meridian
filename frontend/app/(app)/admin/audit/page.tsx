"use client";

/** Admin › Audit log: who did what, the AI calls behind suggestions, and role changes. */

import { useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";
import { Button, DataTable, EmptyState, ExplorerPage, ExportMenu, Field, Input, Mono, PageHeader, Pager, Pill, Select, Skeleton, Tabs, asyncStateOf } from "@/design";
import {
  exportAuditEntries, getAuditEntries, getLlmAudit, type AuditEntry, type AuditListParams, type LlmAuditEntry,
} from "@/lib/api/audit";
import { apiErrorMessage } from "@/lib/error";
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
  { id: "model", header: "Model", cell: ({ row }) => row.original.model_version ?? "—" },
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

function AuditTable({ params, empty }: { params: AuditListParams; empty: string }) {
  const tz = useTenantTimezone();
  const [actor, setActor] = useState(ALL);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  // Filtering by actor needs the user list; an auditor without user admin simply gets no actor filter.
  const usersQ = useQuery({ queryKey: queryKeys.users(), queryFn: getUsers, retry: false, meta: { ignoreError: true } });
  const users = usersQ.data?.users ?? [];
  const filters: AuditListParams = {
    ...(actor !== ALL ? { actor_user_id: actor } : {}),
    ...(dayBound(from, false) ? { since: dayBound(from, false) } : {}),
    ...(dayBound(to, true) ? { until: dayBound(to, true) } : {}),
  };
  const query = { ...params, ...filters, limit: PAGE, offset: (page - 1) * PAGE };
  const q = useQuery({ queryKey: ["audit", query], queryFn: () => getAuditEntries(query), placeholderData: keepPreviousData });
  const entries = q.data?.entries ?? [];
  const total = q.data?.total ?? 0;
  const filtered = Object.keys(filters).length > 0;
  const columns = useMemo(() => auditColumns(tz), [tz]);
  const reset = (fn: () => void) => { fn(); setPage(1); };
  const badRange = !!(from && to && from > to);

  return (
    <ExplorerPage
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
            {filtered ? <Button variant="ghost" onClick={() => reset(() => { setActor(ALL); setFrom(""); setTo(""); })}>Clear filters</Button> : null}
          </div>
          <p className="m-text-meta m-ink-3">Times are in the tenant time zone, {tz.replace(/_/g, " ")}. Expand a row for the request behind it</p>
        </div>
      }
      toolbarEnd={
        params.path_contains ? undefined : (
          <ExportMenu options={[{ format: "xlsx", run: () => exportAuditEntries("xlsx", filters) }, { format: "csv", run: () => exportAuditEntries("csv", filters) }]} />
        )
      }
      state={asyncStateOf(q, () => entries.length === 0, true)}
      emptyProps={filtered
        ? { title: "Nothing matches these filters", detail: "Widen the dates or pick someone else.", action: <Button variant="secondary" onClick={() => reset(() => { setActor(ALL); setFrom(""); setTo(""); })}>Clear filters</Button> }
        : { title: empty, detail: "Changes people make are recorded here as they happen.", action: <Button variant="secondary" onClick={() => void q.refetch()}>Refresh</Button> }}
      errorProps={{ message: apiErrorMessage(q.error), onRetry: () => void q.refetch() }}
      table={
        <div className="flex flex-col gap-2">
          <DataTable columns={columns} data={entries} getRowId={(r) => r.id} renderExpanded={(e) => <RequestDetail e={e} />} />
          {total > PAGE ? <Pager page={page} pageCount={Math.max(1, Math.ceil(total / PAGE))} pageSize={PAGE} total={total} onPageChange={setPage} /> : null}
        </div>
      }
    />
  );
}

function LlmAudit() {
  const tz = useTenantTimezone();
  const columns = useMemo(() => llmColumns(tz), [tz]);
  const q = useQuery({ queryKey: ["audit", "llm"], queryFn: () => getLlmAudit({ limit: 100 }) });
  const entries = q.data?.entries ?? [];
  return (
    <ExplorerPage
      summary={q.data?.cache.length ? (
        <p className="m-text-body m-ink-3">
          {q.data.cache.map((c) => `${c.service_name}: ${c.deterministic} of ${c.decisions} answered by rules`).join(". ")}.
        </p>
      ) : undefined}
      state={asyncStateOf(q, () => entries.length === 0, true)}
      emptyProps={{ title: "No AI calls recorded", detail: "Every call to a model is listed here with its latency and outcome", action: <Button variant="secondary" render={<Link href="/admin/ai">Open AI settings</Link>} /> }}
      errorProps={{ message: apiErrorMessage(q.error), onRetry: () => void q.refetch() }}
      table={<DataTable columns={columns} data={entries} getRowId={(r) => r.id} />}
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
          { value: "log", label: "Audit log", content: <AuditTable params={{}} empty="No audit activity yet" /> },
          { value: "ai", label: "AI audit", content: <LlmAudit /> },
          { value: "roles", label: "User changes", content: <AuditTable params={{ path_contains: "/users" }} empty="No user changes recorded" /> },
        ]}
      />
    </div>
  );
}
