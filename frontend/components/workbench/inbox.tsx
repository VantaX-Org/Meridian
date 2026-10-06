"use client";

/**
 * Workbench → Steward inbox: every open stewardship task in one list — the
 * steward's own queue, the team's workload and the throughput metrics that
 * used to live on three pages. Tasks carry their SLA age, can be assigned,
 * approved, rejected (with a correction reason that trains the rule engine)
 * and escalated one at a time or in bulk. Keys on the focused task:
 * A approve · R reject · E escalate · N next · X select · "." quick actions.
 * Order is set from the column headers (`sort=column:direction` in the URL).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import {
  Banner, Button, Chip, CommandPalette, DataTable, Drawer, EmptyState, Field, Panel, Select, Stack, Text, Textarea,
  useDrawerParam, type AuroraColumnMeta, type ChipTone, type CommandPaletteCommand,
} from "@/components/aurora";
import { FieldChip, FilterBar, OwnerLadder, PageHeader, Tally } from "@/components/ui-core";
import { copyToClipboard } from "@/lib/actions";
import { useAuth } from "@/context/auth-context";
import { useRole } from "@/hooks/use-role";
import { useUrlState } from "@/hooks/use-url-state";
import { getIssues } from "@/lib/api/issues";
import { assignItem, bulkApprove, escalateItem, getMetrics, getQueueItems, resolveItem, submitAiFeedback } from "@/lib/api/stewardship";
import { getTriageMetrics, ownerRungs } from "@/lib/api/triage";
import { getUsers } from "@/lib/api/users";
import { relativeTime, formatDate, labelOf, formatModuleName, humanizeIds } from "@/lib/format";
import type { StewardshipMetrics, StewardshipQueueItem, StewardshipStatus } from "@/types/api";

const meta = (m: AuroraColumnMeta) => m;
const HOUR = 3_600_000;
// Every status still waiting on a steward; the list endpoint filters one status at a time.
const LIVE: StewardshipStatus[] = ["open", "in_progress", "escalated"];
const STATUS_TONE: Record<StewardshipStatus, ChipTone> = { open: "info", in_progress: "warning", escalated: "danger", resolved: "success" };
const TYPE_LABEL: Record<string, string> = {
  merge_decision: "Merge", golden_record_review: "Golden review", exception: "Exception",
  writeback_approval: "Writeback", contract_breach: "Contract", glossary_review: "Glossary",
};
const VIEWS = [
  { value: "all", label: "All open" }, { value: "mine", label: "Mine" }, { value: "unassigned", label: "Unassigned" },
  { value: "breached", label: "SLA breached" }, { value: "today", label: "Due today" }, { value: "escalated", label: "Escalated" },
];
const SORTS = [{ value: "sla:asc", label: "SLA due" }, { value: "priority:asc", label: "Priority" }, { value: "age:desc", label: "Oldest" }];
/** Stands in for "no due date" so those tasks sort last. */
const NO_DUE = Number.MAX_SAFE_INTEGER;
const BULK_CONFIDENCE = 0.85;
const isToday = (iso: string | null, now: number) => !!iso && new Date(iso).toDateString() === new Date(now).toDateString();
const label = labelOf;
const typeLabel = (t: string) => TYPE_LABEL[t] ?? label(t);

/** 45m · 5h · 3d */
function span(ms: number): string {
  const h = Math.abs(ms) / HOUR;
  if (h < 1) return `${Math.max(1, Math.round(h * 60))}m`;
  return h < 48 ? `${Math.round(h)}h` : `${Math.round(h / 24)}d`;
}

type Sla = { state: "none" | "ok" | "risk" | "breached"; remaining: number | null };

/** Time left against the task's due date (or created + SLA hours); at risk inside the last half of the window. */
function slaOf(t: StewardshipQueueItem, now: number): Sla {
  const due = t.due_at ? Date.parse(t.due_at) : t.sla_hours ? Date.parse(t.created_at) + t.sla_hours * HOUR : null;
  if (due === null || Number.isNaN(due)) return { state: "none", remaining: null };
  const remaining = due - now;
  if (remaining < 0) return { state: "breached", remaining };
  const window = (t.sla_hours ?? 24) * HOUR;
  return { state: remaining < window * 0.5 ? "risk" : "ok", remaining };
}

const SLA_TONE: Record<Sla["state"], ChipTone> = { none: "neutral", ok: "success", risk: "warning", breached: "danger" };
const slaText = (s: Sla) => (s.remaining === null ? "no SLA" : s.remaining < 0 ? `${span(s.remaining)} over` : `${span(s.remaining)} left`);

/** Run one call per task; report how many went through rather than failing the batch on the first error. */
async function each(ids: string[], fn: (id: string) => Promise<unknown>): Promise<{ ok: number; failed: number }> {
  const r = await Promise.allSettled(ids.map(fn));
  const ok = r.filter((x) => x.status === "fulfilled").length;
  return { ok, failed: r.length - ok };
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
/** "LFA1.STCD1" gives table and field; a bare field has no table. */
const splitField = (s: string) => (s.includes(".") ? { table: s.slice(0, s.indexOf(".")), field: s.slice(s.lastIndexOf(".") + 1) } : { table: null, field: s });

export function StewardInboxSurface() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { can } = useRole();
  // Backend guards (api/routes/stewardship.py): resolve, assign and bulk approve need `approve`; escalate needs `view`.
  const canApprove = can("approve");
  const canSeeTeam = can("assign");
  const [view, setView] = useUrlState("view", "all");
  // Older links carry a bare "age" (oldest first); the Age column sorts by how old, so that is descending.
  const [sortParam, setSort] = useUrlState("sort", "sla:asc");
  const sort = sortParam === "age" ? "age:desc" : sortParam;
  const [type, setType] = useUrlState("type", "all");
  const [assignee] = useUrlState("assignee", "");
  const [search, setSearch] = useState("");
  const drawer = useDrawerParam("task");
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [rejectIds, setRejectIds] = useState<string[] | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);

  const queues = useQueries({
    queries: LIVE.map((status) => ({
      queryKey: ["stewardship.queue", { status, limit: 200 }],
      queryFn: () => getQueueItems({ status, limit: 200 }),
      refetchInterval: 60_000,
    })),
  });
  const weekQ = useQuery({ queryKey: ["triage.metrics", 8], queryFn: () => getTriageMetrics(8), refetchInterval: 60_000 });
  const metricsQ = useQuery({ queryKey: ["stewardship.metrics"], queryFn: getMetrics, refetchInterval: 60_000 });
  // What each task is about, read from the open record issues it points at.
  const issuesQ = useQuery({ queryKey: ["issues.list", { status: "open", limit: 100, offset: 0 }], queryFn: () => getIssues({ status: "open", limit: 100, offset: 0 }), retry: false, meta: { ignoreError: true } });
  const about = useMemo(() => {
    const m = new Map<string, { message: string | null; field: string | null }>();
    for (const i of issuesQ.data?.items ?? []) { m.set(i.id, i); m.set(i.record_key, i); }
    return m;
  }, [issuesQ.data]);
  // The user list needs `manage_users`; without it assignees show as "You" or an id prefix.
  const usersQ = useQuery({ queryKey: ["users.list"], queryFn: getUsers, enabled: can("manage_users") });

  const loading = queues.some((q) => q.isLoading);
  const error = queues.find((q) => q.error)?.error as Error | undefined;
  // SLA maths runs against the last fetch time, so it stays pure and refreshes with the data.
  const now = Math.max(0, ...queues.map((q) => q.dataUpdatedAt));
  const truncated = queues.some((q) => (q.data?.total ?? 0) > (q.data?.items.length ?? 0));
  const all = useMemo(() => queues.flatMap((q) => q.data?.items ?? []), [queues]);

  const names = useMemo(() => new Map((usersQ.data?.users ?? []).map((u) => [u.id, u.name])), [usersQ.data]);
  const who = useCallback(
    (id: string | null) => (!id ? "Unassigned" : id === user?.id ? "You" : names.get(id) ?? id.slice(0, 8)),
    [names, user?.id],
  );
  const assignees = useMemo(
    () => (usersQ.data?.users ?? []).filter((u) => u.is_active).map((u) => ({ value: u.id, label: u.id === user?.id ? `${u.name} (you)` : u.name })),
    [usersQ.data, user?.id],
  );

  const items = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = all.filter((t) => {
      if (type !== "all" && t.item_type !== type) return false;
      if (view === "mine" && t.assigned_to !== user?.id) return false;
      if (view === "unassigned" && t.assigned_to) return false;
      if (assignee && (assignee === "unassigned" ? t.assigned_to : t.assigned_to !== assignee)) return false;
      if (view === "breached" && slaOf(t, now).state !== "breached") return false;
      if (view === "today" && !isToday(t.due_at, now)) return false;
      if (view === "escalated" && t.status !== "escalated") return false;
      return !q || [t.id, t.source_id, t.domain, t.item_type, who(t.assigned_to)].some((v) => v.toLowerCase().includes(q));
    });
    // the table orders by the header sort; this is the order before any header is clicked
    const due = (t: StewardshipQueueItem) => slaOf(t, now).remaining ?? NO_DUE;
    return rows.sort((x, y) => due(x) - due(y) || x.priority - y.priority);
  }, [all, type, view, assignee, search, now, user?.id, who]);

  const selected = useMemo(() => all.filter((t) => picked.has(t.id)).map((t) => t.id), [all, picked]);
  const detail = drawer.value ? all.find((t) => t.id === drawer.value) ?? null : null;
  const target = detail ?? items.find((t) => t.id === focusedId) ?? null;
  const typeOptions = useMemo(
    () => [...new Set(all.map((t) => t.item_type))].sort().map((t) => ({ value: t, label: typeLabel(t), count: all.filter((x) => x.item_type === t).length })),
    [all],
  );

  const counts = useMemo(() => {
    const sla = all.map((t) => slaOf(t, now).state);
    return {
      mine: all.filter((t) => t.assigned_to && t.assigned_to === user?.id).length,
      unassigned: all.filter((t) => !t.assigned_to).length,
      breached: sla.filter((s) => s === "breached").length,
      risk: sla.filter((s) => s === "risk").length,
      today: all.filter((t) => isToday(t.due_at, now)).length,
      escalated: all.filter((t) => t.status === "escalated").length,
    };
  }, [all, now, user?.id]);

  const refresh = useCallback(() => {
    void qc.invalidateQueries({ queryKey: ["stewardship.queue"] });
    void qc.invalidateQueries({ queryKey: ["stewardship.metrics"] });
  }, [qc]);
  const done = useCallback((verb: string, r: { ok: number; failed: number }) => {
    if (r.ok) toast.success(`${verb} ${plural(r.ok, "task")}`);
    if (r.failed) toast.error(`${plural(r.failed, "task")} not ${verb.toLowerCase()}`);
    setPicked(new Set());
    refresh();
  }, [refresh]);

  const approve = useMutation({
    mutationFn: (ids: string[]) =>
      ids.length === 1 ? resolveItem(ids[0], "approve").then(() => ({ approved: 1, asked: 1 })) : bulkApprove(ids, BULK_CONFIDENCE).then((d) => ({ approved: d.approved, asked: ids.length })),
    onSuccess: ({ approved, asked }) => {
      toast.success(`Approved ${plural(approved, "task")}`);
      if (asked > approved) toast.info(`${asked - approved} below ${BULK_CONFIDENCE * 100}% model confidence or already closed — left for manual review`);
      setPicked(new Set());
      refresh();
    },
    onError: (e) => toast.error((e as Error).message || "Not approved"),
  });
  // Rejecting overrides the model's recommendation: the correction reason is recorded on the task
  // and fed to the AI-feedback loop that proposes new match rules (/ai/rules).
  const reject = useMutation({
    mutationFn: ({ ids, reason }: { ids: string[]; reason: string }) =>
      each(ids, async (id) => {
        await resolveItem(id, "reject", reason);
        const t = all.find((x) => x.id === id);
        if (t) await submitAiFeedback({ queue_item_id: id, steward_decision: "reject", correction_reason: reason, domain: t.domain });
      }),
    onSuccess: (r) => { setRejectIds(null); done("Rejected", r); },
    onError: () => toast.error("Not rejected"),
  });
  const escalate = useMutation({
    mutationFn: (ids: string[]) => each(ids, escalateItem),
    onSuccess: (r) => done("Escalated", r),
  });
  const assign = useMutation({
    mutationFn: ({ ids, userId }: { ids: string[]; userId: string }) => each(ids, (id) => assignItem(id, userId)),
    onSuccess: (r) => done("Assigned", r),
  });
  const busy = approve.isPending || reject.isPending || escalate.isPending || assign.isPending;

  const toggle = useCallback((ids: string[], on: boolean) => {
    setPicked((p) => {
      const n = new Set(p);
      ids.forEach((id) => (on ? n.add(id) : n.delete(id)));
      return n;
    });
  }, []);
  const next = useCallback(() => {
    const i = target ? items.findIndex((t) => t.id === target.id) : -1;
    const n = items[(i + 1) % Math.max(items.length, 1)];
    if (n) { setFocusedId(n.id); drawer.open(n.id); }
  }, [items, target, drawer]);

  // Keys act on the task in the drawer, else the focused row. Ignored while typing, with a
  // modifier held (⌘A stays select-all) or while the reject form or quick actions are open.
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (rejectIds || paletteOpen || ev.metaKey || ev.ctrlKey || ev.altKey) return;
      const el = ev.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)) return;
      const k = ev.key;
      if (k === ".") setPaletteOpen(true);
      else if (k === "n" || k === "N") next();
      else if (!target || busy) return;
      else if ((k === "a" || k === "A") && canApprove) approve.mutate([target.id]);
      else if ((k === "r" || k === "R") && canApprove) setRejectIds([target.id]);
      else if (k === "e" || k === "E") escalate.mutate([target.id]);
      else if (k === "x" || k === "X") toggle([target.id], !picked.has(target.id));
      else return;
      ev.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rejectIds, paletteOpen, target, busy, canApprove, approve, escalate, next, toggle, picked]);

  const visibleIds = useMemo(() => items.map((t) => t.id), [items]);
  const allVisible = visibleIds.length > 0 && visibleIds.every((id) => picked.has(id));
  const columns = useMemo<ColumnDef<StewardshipQueueItem, unknown>[]>(() => [
    {
      id: "pick", meta: meta({ sticky: "start", width: 44 }),
      header: () => <input type="checkbox" aria-label="Select all shown tasks" checked={allVisible} onChange={(e) => toggle(visibleIds, e.target.checked)} />,
      cell: ({ row }) => (
        <input type="checkbox" aria-label={`Select task ${row.original.id.slice(0, 8)}`} checked={picked.has(row.original.id)}
          onClick={(e) => e.stopPropagation()} onChange={(e) => toggle([row.original.id], e.target.checked)} />
      ),
    },
    { id: "sla", header: "SLA", accessorFn: (t) => slaOf(t, now).remaining ?? NO_DUE, meta: meta({ width: 120 }), cell: ({ row }) => { const s = slaOf(row.original, now); return <Chip tone={SLA_TONE[s.state]}>{slaText(s)}</Chip>; } },
    { id: "task", header: "Task", accessorFn: (t) => typeLabel(t.item_type), cell: ({ row }) => (
      <span><strong>{typeLabel(row.original.item_type)}</strong>
        <Text variant="text-micro" tone="muted" as="div">
          {formatModuleName(row.original.domain)}
          {about.get(row.original.source_id)?.message ? `, ${about.get(row.original.source_id)?.message}` : ""}
          {about.get(row.original.source_id)?.field ? <>{" "}<FieldChip {...splitField(about.get(row.original.source_id)?.field ?? "")} /></> : null}
          {row.original.ai_recommendation ? ", model suggestion" : ""}
        </Text></span>) },
    { id: "priority", header: "Priority", accessorFn: (t) => t.priority, meta: meta({ width: 80 }), cell: ({ row }) => `P${row.original.priority}` },
    { id: "status", header: "Status", accessorFn: (t) => t.status, meta: meta({ width: 120 }), cell: ({ row }) => <Chip tone={STATUS_TONE[row.original.status]}>{label(row.original.status)}</Chip> },
    { id: "assignee", header: "Assignee", accessorFn: (t) => who(t.assigned_to), meta: meta({ width: 140 }), cell: ({ row }) => who(row.original.assigned_to) },
    { id: "age", header: "Age", accessorFn: (t) => now - Date.parse(t.created_at), meta: meta({ width: 80, align: "end", numeric: true }), cell: ({ row }) => span(now - Date.parse(row.original.created_at)) },
  ], [picked, allVisible, visibleIds, now, toggle, who, about]);

  const commands = useMemo<CommandPaletteCommand[]>(() => {
    const c: CommandPaletteCommand[] = [];
    const t = target;
    if (t) {
      const g = `Task: ${typeLabel(t.item_type)} ${t.source_id}`;
      if (canApprove) {
        c.push({ id: "t-approve", group: g, label: "Approve", hint: "A", onRun: () => approve.mutate([t.id]) });
        c.push({ id: "t-reject", group: g, label: "Reject with reason", hint: "R", onRun: () => setRejectIds([t.id]) });
        if (user && t.assigned_to !== user.id) c.push({ id: "t-mine", group: g, label: "Assign to me", onRun: () => assign.mutate({ ids: [t.id], userId: user.id }) });
      }
      c.push({ id: "t-escalate", group: g, label: "Escalate", hint: "E", onRun: () => escalate.mutate([t.id]) });
      c.push({ id: "t-open", group: g, label: "Open details", hint: "Enter", onRun: () => drawer.open(t.id) });
      c.push({ id: "t-copy", group: g, label: "Copy task ID", onRun: () => copyToClipboard(t.id, "Task ID copied") });
    }
    c.push({ id: "s-all", group: "Selection", label: `Select all shown (${items.length})`, onRun: () => toggle(visibleIds, true) });
    if (selected.length) {
      const n = plural(selected.length, "task");
      c.push({ id: "s-clear", group: "Selection", label: "Clear selection", onRun: () => setPicked(new Set()) });
      if (canApprove) {
        c.push({ id: "s-approve", group: "Selection", label: `Approve ${n}`, onRun: () => approve.mutate(selected) });
        c.push({ id: "s-reject", group: "Selection", label: `Reject ${n} with reason`, onRun: () => setRejectIds(selected) });
        if (user) c.push({ id: "s-mine", group: "Selection", label: `Assign ${n} to me`, onRun: () => assign.mutate({ ids: selected, userId: user.id }) });
      }
      c.push({ id: "s-escalate", group: "Selection", label: `Escalate ${n}`, onRun: () => escalate.mutate(selected) });
    }
    VIEWS.forEach((v) => c.push({ id: `v-${v.value}`, group: "View", label: `Show: ${v.label}`, onRun: () => setView(v.value) }));
    SORTS.forEach((s) => c.push({ id: `o-${s.value}`, group: "View", label: `Sort by ${s.label}`, onRun: () => setSort(s.value) }));
    items.slice(0, 100).forEach((x) => c.push({
      id: `j-${x.id}`, group: "Jump to task", label: `${typeLabel(x.item_type)} · ${x.source_id}`, hint: slaText(slaOf(x, now)),
      keywords: [x.id, x.domain, who(x.assigned_to)], onRun: () => drawer.open(x.id),
    }));
    return c;
  }, [target, canApprove, user, items, visibleIds, selected, now, who, approve, assign, escalate, drawer, toggle, setView, setSort]);

  return (
    <Stack gap={5} className="aurora-page">
      <PageHeader title="Steward inbox" summary={loading ? undefined : `${all.length} open, ${counts.breached} past SLA${all.length ? `, oldest ${span(now - Math.min(...all.map((t) => Date.parse(t.created_at))))}` : ""}.`} />
      <Tally level={2} label="Steward inbox" figures={[
        { label: "Open", value: all.length, loading, verdict: all.length ? "Tasks waiting on a steward." : "The inbox is clear.", href: "/workbench?view=all" },
        { label: "Overdue", value: counts.breached, tone: counts.breached ? "danger" : undefined, loading, verdict: counts.breached ? "Past their due time." : "Nothing past due.", href: "/workbench?view=breached" },
        { label: "Due today", value: counts.today, tone: counts.today ? "warning" : undefined, loading, verdict: counts.today ? "Due before midnight." : "Nothing due today.", href: "/workbench?view=today" },
        { label: "Unassigned", value: counts.unassigned, loading, verdict: counts.unassigned ? "Nobody owns these yet." : "Every task has an owner.", href: "/workbench?view=unassigned" },
        { label: "Resolved this week", value: weekQ.data?.weekly.at(-1)?.resolved ?? null, loading: weekQ.isLoading, verdict: weekQ.data?.weekly.at(-1)?.resolved ? "Closed in the last seven days." : "Nothing closed this week.", href: "/workbench?tab=progress" },
      ]} />

      <FilterBar
        search={{ value: search, onChange: setSearch, placeholder: "Search tasks, or press . for quick actions" }}
        groups={[{ id: "type", label: "Type", value: type === "all" ? "" : type, allLabel: "All types", onChange: (v) => setType(v || "all"), options: typeOptions }]}
        onClear={search || type !== "all" || view !== "all" ? () => { setSearch(""); setType("all"); setView("all"); } : undefined}
      >
        {VIEWS.map((v) => {
          const n = v.value === "all" ? all.length : counts[v.value as keyof typeof counts];
          return <Chip key={v.value} selected={view === v.value} onClick={() => setView(v.value)}>{v.label}<span className="aurora-number ui-chip-count">{n}</span></Chip>;
        })}
      </FilterBar>

      {selected.length ? (
        <Stack direction="row" gap={2} wrap align="center" role="toolbar" aria-label="Bulk actions">
          <Text variant="text-small">{plural(selected.length, "task")} selected</Text>
          {canApprove ? <Button size="sm" disabled={busy} onClick={() => approve.mutate(selected)}>{approve.isPending ? "Approving…" : "Approve"}</Button> : null}
          {canApprove ? <Button size="sm" variant="secondary" disabled={busy} onClick={() => setRejectIds(selected)}>Reject with reason</Button> : null}
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => escalate.mutate(selected)}>{escalate.isPending ? "Escalating…" : "Escalate"}</Button>
          {canApprove ? <AssignControl options={assignees} me={user?.id} disabled={busy} onAssign={(userId) => assign.mutate({ ids: selected, userId })} /> : null}
          <Button size="sm" variant="ghost" onClick={() => setPicked(new Set())}>Clear</Button>
          {canApprove && selected.length > 1 ? <Text variant="text-micro" tone="muted">Bulk approve skips tasks under {BULK_CONFIDENCE * 100}% model confidence.</Text> : null}
        </Stack>
      ) : null}

      {truncated ? <Banner tone="warning" title="Showing the first 200 tasks per status">Narrow by type or work the oldest down to see the rest.</Banner> : null}
      {loading ? <Text tone="muted">Reading the inbox.</Text>
        : error ? <Banner tone="danger" title="The inbox could not be read">{error.message}</Banner>
        : items.length ? <DataTable columns={columns} data={items} getRowId={(t) => t.id} onRowFocus={(t) => setFocusedId(t?.id ?? null)} onRowActivate={(t) => drawer.open(t.id)} ariaLabel="Steward inbox" maxHeight="60vh" sort={sort} onSortChange={setSort} />
        : <EmptyState title={all.length ? "No tasks in this view." : "Inbox zero."} body={all.length ? "Change the view or clear the search." : "Merge decisions, golden-record reviews, writebacks and exceptions land here when they need a steward."} />}

      {canSeeTeam ? <TeamPanel week={weekQ.data} metrics={metricsQ.data} /> : null}

      <Drawer open={!!detail} onClose={drawer.close} ariaLabel="Task details"
        header={detail ? <Stack direction="row" gap={2} align="center"><Chip tone={STATUS_TONE[detail.status]}>{label(detail.status)}</Chip><Text variant="text-lead">{typeLabel(detail.item_type)}: {humanizeIds(detail.source_id)}</Text></Stack> : null}>
        {detail ? (
          <TaskDetail task={detail} now={now} who={who} canApprove={canApprove} busy={busy} assignees={assignees} me={user?.id}
            onApprove={() => approve.mutate([detail.id])} onReject={() => setRejectIds([detail.id])} onEscalate={() => escalate.mutate([detail.id])}
            onAssign={(userId) => assign.mutate({ ids: [detail.id], userId })} onNext={next} />
        ) : null}
      </Drawer>

      <Drawer open={!!rejectIds} onClose={() => setRejectIds(null)} ariaLabel="Reject with reason" header={<Text variant="text-lead">Reject with reason</Text>}>
        {rejectIds ? <RejectForm count={rejectIds.length} pending={reject.isPending} onSubmit={(reason) => reject.mutate({ ids: rejectIds, reason })} onCancel={() => setRejectIds(null)} /> : null}
      </Drawer>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} disableGlobalHotkey commands={commands} placeholder="Act on the inbox…" emptyMessage="No action matches." />
    </Stack>
  );
}

function AssignControl({ options, me, disabled, onAssign }: { options: { value: string; label: string }[]; me?: string; disabled: boolean; onAssign: (userId: string) => void }) {
  const [to, setTo] = useState("");
  if (!options.length) return me ? <Button size="sm" variant="secondary" disabled={disabled} onClick={() => onAssign(me)}>Assign to me</Button> : null;
  return (
    <Stack direction="row" gap={2} align="center">
      <Select aria-label="Assign to" options={[{ value: "", label: "Assign to…" }, ...options]} value={to} onValueChange={setTo} />
      <Button size="sm" variant="secondary" disabled={disabled || !to} onClick={() => onAssign(to)}>Assign</Button>
    </Stack>
  );
}

function TaskDetail({ task: t, now, who, canApprove, busy, assignees, me, onApprove, onReject, onEscalate, onAssign, onNext }: {
  task: StewardshipQueueItem; now: number; who: (id: string | null) => string; canApprove: boolean; busy: boolean;
  assignees: { value: string; label: string }[]; me?: string;
  onApprove: () => void; onReject: () => void; onEscalate: () => void; onAssign: (userId: string) => void; onNext: () => void;
}) {
  const s = slaOf(t, now);
  const rows: [string, string][] = [
    ["Record", humanizeIds(t.source_id)], ["Domain", formatModuleName(t.domain)], ["Type", typeLabel(t.item_type)], ["Priority", `P${t.priority}`],
    ["Assignee", who(t.assigned_to)], ["SLA", t.sla_hours ? `${t.sla_hours}h · ${slaText(s)}` : "no SLA"],
    ["Due", t.due_at ? formatDate(t.due_at, "datetime") : "—"], ["Raised", relativeTime(t.created_at)], ["Updated", relativeTime(t.updated_at)],
  ];
  return (
    <Stack gap={4}>
      {t.ai_recommendation ? (
        <Panel title="Model suggestion">
          {t.ai_confidence != null ? <Text variant="text-small">Confidence {Math.round(t.ai_confidence * 100)} %</Text> : null}
          <Text variant="text-small" tone="secondary">{t.ai_recommendation}</Text>
        </Panel>
      ) : null}
      <table className="ui-mini-table"><tbody>{rows.map(([k, v]) => <tr key={k}><td>{k}</td><td className="aurora-number">{v}</td></tr>)}</tbody></table>
      <Stack direction="row" gap={2} wrap>
        {canApprove ? <Button disabled={busy} onClick={onApprove}>Approve <kbd>A</kbd></Button> : null}
        {canApprove ? <Button variant="secondary" disabled={busy} onClick={onReject}>Reject <kbd>R</kbd></Button> : null}
        <Button variant="secondary" disabled={busy || t.status === "escalated"} onClick={onEscalate}>Escalate <kbd>E</kbd></Button>
        <Button variant="ghost" onClick={onNext}>Next <kbd>N</kbd></Button>
        <Button variant="ghost" onClick={() => copyToClipboard(t.id, "Task ID copied")}>Copy ID</Button>
      </Stack>
      {canApprove ? <AssignControl options={assignees} me={me} disabled={busy} onAssign={onAssign} /> : null}
    </Stack>
  );
}

function RejectForm({ count, pending, onSubmit, onCancel }: { count: number; pending: boolean; onSubmit: (reason: string) => void; onCancel: () => void }) {
  const [reason, setReason] = useState("");
  return (
    <Stack gap={3}>
      <Field label="Correction reason" required helper="Why is the recommendation wrong? The reason is kept on the task and trains the match-rule engine.">
        {({ controlId }) => <Textarea id={controlId} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus required />}
      </Field>
      <Stack direction="row" gap={2}>
        <Button variant="danger" disabled={!reason.trim() || pending} onClick={() => onSubmit(reason.trim())}>{pending ? "Rejecting…" : `Reject ${plural(count, "task")}`}</Button>
        <Button variant="ghost" onClick={onCancel}>Keep the task open</Button>
      </Stack>
    </Stack>
  );
}

/** Who holds the open work, and how fast it closes. */
function TeamPanel({ week, metrics }: { week?: import("@/lib/api/triage").TriageMetrics; metrics?: StewardshipMetrics }) {
  const rungs = ownerRungs(week);
  const resolved = week?.weekly.at(-1)?.resolved;
  const mttr = week?.mttr_hours;
  return (
    <Panel title="Who holds the work">
      <Stack gap={3}>
        {rungs.length ? <OwnerLadder rows={rungs} ariaLabel="Open work by owner" /> : <Text variant="text-small" tone="muted">Nobody holds open work.</Text>}
        {week ? <Text variant="text-small" tone="secondary">{resolved != null ? `${plural(resolved, "task")} resolved this week` : "Nothing resolved this week"}{mttr != null ? `, ${Math.round(mttr * 10) / 10} h on average to resolve.` : "."}</Text> : null}
        {metrics?.ai_acceptance_rate != null ? <Text variant="text-small" tone="secondary">Suggestion acceptance {Math.round(metrics.ai_acceptance_rate * 100)} %</Text> : null}
        {metrics?.steward_breakdown?.length ? (
          <table className="ui-mini-table">
            <thead><tr><th>Steward</th><th>Resolved</th><th>Avg to resolve</th></tr></thead>
            <tbody>{metrics.steward_breakdown.map((s) => (
              <tr key={s.steward_name}><td>{s.steward_name}</td><td className="aurora-number">{s.resolved} / {s.total}</td>
                <td className="aurora-number">{s.avg_resolution_hours != null ? `${s.avg_resolution_hours} h` : "—"}</td></tr>
            ))}</tbody>
          </table>
        ) : null}
      </Stack>
    </Panel>
  );
}
