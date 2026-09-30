"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { Download } from "lucide-react";
import {
  Button,
  Chip,
  DataTable,
  Drawer,
  Input,
  Pager,
  Panel,
  Select,
  Stack,
  Tabs,
  Text,
  Textarea,
  type AuroraColumnMeta,
  type ChipTone,
} from "@/components/aurora";
import { PageHead } from "@/components/meridian/atoms";
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
import { formatModuleName, relativeTime } from "@/lib/format";
import { useRole } from "@/hooks/use-role";

const PAGE = 100;
const STATUSES: { id: IssueStatus; label: string }[] = [
  { id: "open", label: "Open" },
  { id: "in_progress", label: "In progress" },
  { id: "accepted", label: "Accepted" },
  { id: "resolved", label: "Resolved" },
];
const SEVERITY_TONE: Record<string, ChipTone> = { critical: "danger", high: "danger", medium: "warning", low: "neutral" };
const RESOLUTION_LABEL: Record<string, string> = {
  verified_fixed: "verified fixed by a later run",
  fixed_in_source: "marked fixed — awaiting the next run",
  accepted_risk: "risk accepted",
  false_positive: "false positive",
};

const FILTER_KEYS = ["status", "module", "check_id", "severity", "assigned_to", "scope", "search"] as const;

const columns = (selected: Set<string>, toggle: (id: string) => void): ColumnDef<RecordIssue, unknown>[] => [
  {
    id: "select",
    header: "",
    cell: ({ row }) => (
      <input type="checkbox" aria-label={`Select ${row.original.record_key}`} checked={selected.has(row.original.id)}
        onClick={(e) => e.stopPropagation()} onChange={() => toggle(row.original.id)} />
    ),
    meta: { width: 36 } satisfies AuroraColumnMeta,
  },
  {
    id: "severity", header: "Severity",
    cell: ({ row }) => <Chip tone={SEVERITY_TONE[row.original.severity] ?? "neutral"}>{row.original.severity}</Chip>,
    meta: { width: 96 } satisfies AuroraColumnMeta,
  },
  {
    id: "record", header: "SAP record",
    cell: ({ row }) => <span className="font-mono">{row.original.record_key}</span>,
    meta: { width: 240, sticky: "start" } satisfies AuroraColumnMeta,
  },
  {
    id: "check", header: "Check",
    cell: ({ row }) => (
      <span title={row.original.message ?? undefined}>
        <span className="font-mono">{row.original.check_id}</span>
        {row.original.message && <span className="text-[var(--aurora-fg-tertiary)]"> · {row.original.message}</span>}
      </span>
    ),
    meta: { width: 380 } satisfies AuroraColumnMeta,
  },
  { id: "module", header: "Module", cell: ({ row }) => formatModuleName(row.original.module), meta: { width: 160 } satisfies AuroraColumnMeta },
  { id: "assignee", header: "Assignee", cell: ({ row }) => row.original.assignee_email ?? "—", meta: { width: 180 } satisfies AuroraColumnMeta },
  {
    id: "seen", header: "First seen",
    cell: ({ row }) => (
      <span>{relativeTime(row.original.first_seen_at)}{row.original.reopened_count > 0 && <Chip tone="warning">reopened ×{row.original.reopened_count}</Chip>}</span>
    ),
    meta: { width: 150 } satisfies AuroraColumnMeta,
  },
];

export default function IssuesPage() {
  return (
    <Suspense>
      <IssuesWorkList />
    </Suspense>
  );
}

/** Filters live in the URL so a finding, a report or a colleague can link straight to a work list. */
function IssuesWorkList() {
  const qc = useQueryClient();
  const { can } = useRole();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [filter, setFilter] = useState<IssueFilter>(() => {
    const f: IssueFilter = { status: "open" };
    for (const k of FILTER_KEYS) {
      const v = params.get(k);
      if (v) (f as Record<string, string>)[k] = v;
    }
    return f;
  });
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openId, setOpenId] = useState<string | null>(null);

  const set = (patch: IssueFilter) => {
    const next = { ...filter, ...patch };
    setFilter(next);
    setOffset(0);
    setSelected(new Set());
    const q = new URLSearchParams(Object.entries(next).filter(([, v]) => v) as [string, string][]);
    router.replace(`${pathname}?${q}`, { scroll: false });
  };

  const { data, isFetching } = useQuery({
    queryKey: ["issues", filter, offset],
    queryFn: () => getIssues({ ...filter, limit: PAGE, offset }),
  });
  const { data: users = [] } = useQuery({ queryKey: ["users.assignable"], queryFn: getAssignableUsers, enabled: can("assign") });

  const bulk = useMutation({
    mutationFn: updateIssues,
    onSuccess: (r) => {
      toast.success(`${r.updated} issue${r.updated === 1 ? "" : "s"} updated`);
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: ["issues"] });
      qc.invalidateQueries({ queryKey: ["issue"] });
    },
    onError: (e) => toast.error((e as Error).message || "Update refused"),
  });
  const exporting = useMutation({
    mutationFn: (f: "csv" | "xlsx") => exportIssues(f, filter),
    onError: (e) => toast.error((e as Error).message || "Export failed"),
  });

  const toggle = (id: string) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
  const ids = Array.from(selected);
  const counts = data?.counts ?? {};
  const modules = Array.from(new Set((data?.items ?? []).map((i) => i.module).concat(filter.module ? [filter.module] : [])));

  return (
    <div data-theme="light" className="space-y-6">
      <PageHead
        title="Issues"
        route="/issues"
        sub="Every failing SAP record, per check, tracked across runs. A later run that evaluates the record and finds it passing resolves it automatically; if it fails again it re-opens."
        actions={can("export") ? (
          <Stack direction="row" gap={2}>
            {(["xlsx", "csv"] as const).map((f) => (
              <Button key={f} size="sm" variant="secondary" leadingIcon={<Download size={14} />} disabled={exporting.isPending}
                onClick={() => exporting.mutate(f)}>
                Work list {f.toUpperCase()}
              </Button>
            ))}
          </Stack>
        ) : undefined}
      />

      <Panel>
        <Stack gap={4}>
          <Tabs<IssueStatus> ariaLabel="Issue status" value={filter.status ?? "open"} onValueChange={(s) => set({ status: s })}
            items={STATUSES.map((s) => ({ id: s.id, label: s.label, count: counts[s.id] ?? 0 }))} />
          <Stack direction="row" gap={2} wrap align="center">
            <Select placeholder="All modules" value={filter.module ?? ""} aria-label="Module"
              options={modules.map((m) => ({ value: m, label: formatModuleName(m) }))} onValueChange={(v) => set({ module: v || undefined })} />
            <Select placeholder="All severities" value={filter.severity ?? ""} aria-label="Severity"
              options={["critical", "high", "medium", "low"].map((s) => ({ value: s, label: s }))}
              onValueChange={(v) => set({ severity: v || undefined })} />
            <Select placeholder="Anyone" value={filter.assigned_to ?? ""} aria-label="Assignee"
              options={[{ value: "me", label: "Assigned to me" }, { value: "unassigned", label: "Unassigned" },
                ...users.map((u) => ({ value: u.id, label: u.name || u.email }))]}
              onValueChange={(v) => set({ assigned_to: v || undefined })} />
            <Input placeholder="Record key (Enter)" aria-label="Search record key" defaultValue={filter.search}
              onKeyDown={(e) => e.key === "Enter" && set({ search: e.currentTarget.value || undefined })} />
            {filter.check_id && <Chip onDismiss={() => set({ check_id: undefined })}>check {filter.check_id}</Chip>}
          </Stack>

          {ids.length > 0 && (
            <Stack direction="row" gap={2} align="center" wrap
              className="rounded-md bg-[var(--aurora-accent-selected-bg)] px-3 py-2">
              <Text variant="text-small">{ids.length} selected</Text>
              {can("assign") && (
                <>
                  <Select placeholder="Assign to…" value="" aria-label="Assign selected"
                    options={[{ value: "__none__", label: "Unassign" }, ...users.map((u) => ({ value: u.id, label: u.name || u.email }))]}
                    onValueChange={(v) => bulk.mutate({ ids, assigned_to: v === "__none__" ? "" : v })} />
                  <Button size="sm" variant="secondary" onClick={() => bulk.mutate({ ids, status: "in_progress" })}>Start work</Button>
                  <Button size="sm" variant="secondary" onClick={() => bulk.mutate({ ids, status: "resolved", resolution: "fixed_in_source" })}>
                    Mark fixed in SAP
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => bulk.mutate({ ids, status: "open" })}>Re-open</Button>
                </>
              )}
              {can("approve") && (
                <>
                  <Button size="sm" variant="ghost" onClick={() => bulk.mutate({ ids, status: "accepted", resolution: "accepted_risk" })}>Accept risk</Button>
                  <Button size="sm" variant="ghost" onClick={() => bulk.mutate({ ids, status: "accepted", resolution: "false_positive" })}>False positive</Button>
                </>
              )}
            </Stack>
          )}

          <DataTable
            columns={columns(selected, toggle)}
            data={data?.items ?? []}
            getRowId={(r) => r.id}
            onRowActivate={(r) => setOpenId(r.id)}
            maxHeight={560}
            ariaLabel="Record issues"
            empty={<Text tone="muted">{isFetching ? "Fetching issues…" : "No issues match — run an analysis or widen the filters."}</Text>}
          />
          <Pager offset={offset} total={data?.total ?? 0} pageSize={PAGE} onChange={setOffset} noun="issues" />
        </Stack>
      </Panel>
      <IssueDrawer id={openId} onClose={() => setOpenId(null)} canComment={can("analyse")} />
    </div>
  );
}

function IssueDrawer({ id, onClose, canComment }: { id: string | null; onClose: () => void; canComment: boolean }) {
  const qc = useQueryClient();
  const [note, setNote] = useState("");
  const { data } = useQuery({ queryKey: ["issue", id], queryFn: () => getIssue(id as string), enabled: Boolean(id) });
  const comment = useMutation({
    mutationFn: () => commentIssue(id as string, note),
    onSuccess: () => { setNote(""); qc.invalidateQueries({ queryKey: ["issue", id] }); },
    onError: (e) => toast.error((e as Error).message || "Comment not saved"),
  });
  const i = data?.issue;
  return (
    <Drawer open={Boolean(id)} onClose={onClose} ariaLabel="Issue"
      header={i && <Stack gap={1}>
        <Text variant="display-sm" className="font-mono">{i.record_key}</Text>
        <Stack direction="row" gap={2}>
          <Chip tone={SEVERITY_TONE[i.severity] ?? "neutral"}>{i.severity}</Chip>
          <Chip tone={i.status === "resolved" ? "success" : i.status === "accepted" ? "info" : "warning"}>{i.status.replace("_", " ")}</Chip>
          {i.resolution && <Chip>{RESOLUTION_LABEL[i.resolution] ?? i.resolution}</Chip>}
        </Stack>
      </Stack>}>
      {i && data && (
        <Stack gap={4}>
          <Stack gap={1}>
            <Text className="font-semibold">{i.check_id}{i.field ? <span className="font-mono"> · {i.field}</span> : null}</Text>
            <Text tone="secondary">{i.message}</Text>
            <Text variant="text-small" tone="muted">
              {formatModuleName(i.module)}{i.grain ? ` · evaluated on ${i.grain}` : ""} · first seen {relativeTime(i.first_seen_at)} · last failing {relativeTime(i.last_seen_at)}
            </Text>
            <Link className="text-[13px] underline" href={`/findings?check_id=${encodeURIComponent(i.check_id)}&version_id=${i.last_seen_version}`}>
              Open the finding
            </Link>
          </Stack>
          <Stack gap={2}>
            <Text className="font-semibold">Run by run</Text>
            <Stack direction="row" gap={1} wrap>
              {data.runs.map((r) => (
                <span key={r.version_id} title={new Date(r.run_at).toLocaleString()}>
                  <Chip tone={r.failing ? "danger" : "success"}>{new Date(r.run_at).toLocaleDateString()} {r.failing ? "fails" : "passes"}</Chip>
                </span>
              ))}
            </Stack>
          </Stack>
          <Stack gap={2}>
            <Text className="font-semibold">Activity</Text>
            {data.events.length === 0 && <Text tone="muted">No activity yet.</Text>}
            {data.events.map((e, n) => (
              <Stack key={n} gap={1} className="border-l-2 border-[var(--aurora-canvas-line)] pl-3">
                <Text variant="text-small" tone="secondary">
                  {e.user_label ?? "system"} · {e.action.replace("_", " ")}
                  {e.from_value || e.to_value ? ` ${e.from_value ?? ""} → ${e.to_value ?? ""}` : ""} · {relativeTime(e.created_at)}
                </Text>
                {e.note && <Text>{e.note}</Text>}
              </Stack>
            ))}
            {canComment && (
              <Stack gap={2}>
                <Textarea rows={3} value={note} aria-label="Comment" placeholder="What was found or done in SAP"
                  onChange={(e) => setNote(e.target.value)} />
                <div><Button size="sm" disabled={!note.trim() || comment.isPending} onClick={() => comment.mutate()}>Add comment</Button></div>
              </Stack>
            )}
          </Stack>
        </Stack>
      )}
    </Drawer>
  );
}
