"use client";

/** Admin › Audit log: who did what, the AI calls behind suggestions, and role changes. */

import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";
import { Button, DataTable, EmptyState, ExplorerPage, ExportMenu, PageHeader, Pill, Skeleton, Tabs } from "@/design";
import {
  exportAuditEntries, getAuditEntries, getLlmAudit, type AuditEntry, type AuditListParams, type LlmAuditEntry,
} from "@/lib/api/audit";
import { apiErrorMessage, isListFailure } from "@/lib/error";
import { relativeTime } from "@/lib/format";
import { usePermissions } from "@/lib/permissions";
import { useUrlState } from "@/hooks/use-url-state";

const auditColumns: ColumnDef<AuditEntry>[] = [
  { id: "when", header: "When", cell: ({ row }) => <time dateTime={row.original.created_at}>{relativeTime(row.original.created_at)}</time> },
  { id: "who", header: "Who", cell: ({ row }) => row.original.actor_email ?? "system" },
  { id: "what", header: "Action", cell: ({ row }) => [row.original.action, row.original.entity_type].filter(Boolean).join(", ") },
  { id: "ctx", header: "Request", cell: ({ row }) => `${row.original.method} ${row.original.path} returned ${row.original.status_code}` },
];

const llmColumns: ColumnDef<LlmAuditEntry>[] = [
  { id: "when", header: "When", cell: ({ row }) => <time dateTime={row.original.called_at}>{relativeTime(row.original.called_at)}</time> },
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

function AuditTable({ params, empty }: { params: AuditListParams; empty: string }) {
  const q = useQuery({ queryKey: ["audit", params], queryFn: () => getAuditEntries({ limit: 100, ...params }) });
  const entries = q.data?.entries ?? [];
  return (
    <ExplorerPage
      toolbarEnd={
        params.path_contains ? undefined : (
          <ExportMenu options={[{ format: "xlsx", run: () => exportAuditEntries("xlsx") }, { format: "csv", run: () => exportAuditEntries("csv") }]} />
        )
      }
      state={q.isLoading ? "loading" : isListFailure(q) ? "error" : entries.length === 0 ? "empty" : undefined}
      emptyProps={{ title: empty, action: <Button variant="secondary" onClick={() => void q.refetch()}>Refresh</Button> }}
      errorProps={{ message: apiErrorMessage(q.error), onRetry: () => void q.refetch() }}
      table={<DataTable columns={auditColumns} data={entries} getRowId={(r) => r.id} />}
    />
  );
}

function LlmAudit() {
  const q = useQuery({ queryKey: ["audit", "llm"], queryFn: () => getLlmAudit({ limit: 100 }) });
  const entries = q.data?.entries ?? [];
  return (
    <ExplorerPage
      summary={q.data?.cache.length ? (
        <p className="m-text-body" style={{ color: "var(--m-ink-3)" }}>
          {q.data.cache.map((c) => `${c.service_name}: ${c.deterministic} of ${c.decisions} answered by rules`).join(". ")}.
        </p>
      ) : undefined}
      state={q.isLoading ? "loading" : isListFailure(q) ? "error" : entries.length === 0 ? "empty" : undefined}
      emptyProps={{ title: "No AI calls recorded", detail: "Every call to a model is listed here with its latency and outcome", action: <Button variant="secondary" render={<Link href="/admin/ai">Open AI settings</Link>} /> }}
      errorProps={{ message: apiErrorMessage(q.error), onRetry: () => void q.refetch() }}
      table={<DataTable columns={llmColumns} data={entries} getRowId={(r) => r.id} />}
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
    <div className="flex flex-col gap-4 p-6">
      <PageHeader title="Audit log" meta="Who did what, AI calls and role changes" />
      <Tabs
        value={["log", "ai", "roles"].includes(tab) ? tab : "log"}
        onValueChange={setTab}
        items={[
          { value: "log", label: "Audit log", content: <AuditTable params={{}} empty="No audit activity yet" /> },
          { value: "ai", label: "AI audit", content: <LlmAudit /> },
          { value: "roles", label: "User changes", content: <AuditTable params={{ path_contains: "/users", method: "PUT" }} empty="No user changes recorded" /> },
        ]}
      />
    </div>
  );
}
