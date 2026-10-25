"use client";

/** Admin › Audit log: who did what, the AI calls behind suggestions, and role changes. */

import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";
import { Button, DataTable, EmptyState, ExplorerPage, ExportMenu, Mono, PageHeader, Pill, Skeleton, Tabs, asyncStateOf } from "@/design";
import {
  exportAuditEntries, getAuditEntries, getLlmAudit, type AuditEntry, type AuditListParams, type LlmAuditEntry,
} from "@/lib/api/audit";
import { apiErrorMessage } from "@/lib/error";
import { labelOf, relativeTime } from "@/lib/format";
import { usePermissions } from "@/lib/permissions";
import { useUrlState } from "@/hooks/use-url-state";

const VERB: Record<string, string> = { POST: "created", PUT: "changed", PATCH: "changed", DELETE: "removed", GET: "read" };
const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const nameOf = (v: unknown): string | undefined => {
  const r = rec(v);
  const n = r.name ?? r.email ?? r.label ?? r.title;
  return typeof n === "string" ? n : undefined;
};

/** One sentence per action: "ana changed the role of Bob from steward to admin", built from method, path and entity. */
function auditSentence(e: AuditEntry): string {
  const who = e.actor_email ? e.actor_email.split("@")[0] : "The system";
  const before = rec(e.before_json), after = rec(e.after_json);
  const thing = (e.entity_type ? labelOf(e.entity_type).toLowerCase() : e.path.split("/").filter((p) => p && !/^(api|v1)$/.test(p) && !/^[0-9a-f-]{8,}$/i.test(p)).slice(-1)[0]?.replace(/[-_]/g, " ")) || "record";
  const subject = nameOf(e.after_json) ?? nameOf(e.before_json);
  const failed = e.status_code >= 400 ? ` (refused, ${e.status_code})` : "";
  if ("role" in before && "role" in after && before.role !== after.role) {
    return `${who} changed the role of ${subject ?? `a ${thing}`} from ${labelOf(String(before.role)).toLowerCase()} to ${labelOf(String(after.role)).toLowerCase()}${failed}`;
  }
  const verb = VERB[e.method.toUpperCase()] ?? labelOf(e.action).toLowerCase();
  return `${who} ${verb} ${subject ? `the ${thing} ${subject}` : `a ${thing}`}${failed}`;
}

const auditColumns: ColumnDef<AuditEntry>[] = [
  { id: "when", header: "When", cell: ({ row }) => <time dateTime={row.original.created_at}>{relativeTime(row.original.created_at)}</time> },
  { id: "what", header: "What happened", cell: ({ row }) => auditSentence(row.original) },
  { id: "ctx", header: "Request", cell: ({ row }) => <Mono inline>{`${row.original.method} ${row.original.path}`}</Mono> },
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
      state={asyncStateOf(q, () => entries.length === 0, true)}
      emptyProps={{ title: empty, detail: "Changes people make are recorded here as they happen.", action: <Button variant="secondary" onClick={() => void q.refetch()}>Refresh</Button> }}
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
        <p className="m-text-body m-ink-3">
          {q.data.cache.map((c) => `${c.service_name}: ${c.deterministic} of ${c.decisions} answered by rules`).join(". ")}.
        </p>
      ) : undefined}
      state={asyncStateOf(q, () => entries.length === 0, true)}
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
    <div className="flex flex-col gap-4">
      <PageHeader title="Audit log" meta="A permanent record of who changed what, every call to the language model, and every change to a user. Export it for an auditor" />
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
