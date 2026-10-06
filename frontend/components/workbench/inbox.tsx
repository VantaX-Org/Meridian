"use client";

/**
 * Workbench → Steward inbox: every open stewardship task in one list — the
 * steward's own queue, the team's workload and the throughput metrics that
 * used to live on three pages. Tasks carry their SLA age, can be assigned,
 * approved, rejected (with a correction reason that trains the rule engine)
 * and escalated one at a time or in bulk. Keys on the focused task:
 * A approve · R reject · E escalate · N next · X select · "." quick actions.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import {
  Banner, Button, Chip, CommandPalette, DataTable, Drawer, EmptyState, Field, Input, Panel, Select, Stack, Text, Textarea,
  useDrawerParam, type AuroraColumnMeta, type ChipTone, type CommandPaletteCommand,
} from "@/components/aurora";
import { Tally } from "@/components/ui-core";
import { copyToClipboard } from "@/lib/actions";
import { useAuth } from "@/context/auth-context";
import { useRole } from "@/hooks/use-role";
import { useUrlState } from "@/hooks/use-url-state";
import { assignItem, bulkApprove, escalateItem, getMetrics, getQueueItems, resolveItem, submitAiFeedback } from "@/lib/api/stewardship";
import { getTriageMetrics } from "@/lib/api/triage";
import { getUsers } from "@/lib/api/users";
import { relativeTime } from "@/lib/format";
import type { StewardshipQueueItem, StewardshipStatus } from "@/types/api";

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
const SORTS = [{ value: "sla", label: "SLA due" }, { value: "priority", label: "Priority" }, { value: "age", label: "Oldest" }];
const BULK_CONFIDENCE = 0.85;
const isToday = (iso: string | null, now: number) => !!iso && new Date(iso).toDateString() === new Date(now).toDateString();
const label = (s: string) => s.replace(/_/g, " ");
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

export function StewardInboxSurface() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { can } = useRole();
  // Backend guards (api/routes/stewardship.py): resolve, assign and bulk approve need `approve`; escalate needs `view`.
  const canApprove = can("approve");
  const canSeeTeam = can("assign");
  const [view, setView] = useUrlState("view", "all");
  const [sort, setSort] = useUrlState("sort", "sla");
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
    const due = (t: StewardshipQueueItem) => slaOf(t, now).remaining ?? Infinity;
    const age = (t: StewardshipQueueItem) => Date.parse(t.created_at);
    return rows.sort(sort === "priority" ? (a, b) => a.priority - b.priority || due(a) - due(b)
      : sort === "age" ? (a, b) => age(a) - age(b) : (a, b) => due(a) - due(b) || a.priority - b.priority);
  }, [all, type, view, assignee, sort, search, now, user?.id, who]);

  const selected = useMemo(() => all.filter((t) => picked.has(t.id)).map((t) => t.id), [all, picked]);
  const detail = drawer.value ? all.find((t) => t.id === drawer.value) ?? null : null;
  const target = detail ?? items.find((t) => t.id === focusedId) ?? null;
  const typeOptions = useMemo(
    () => [{ value: "all", label: "All types" }, ...[...new Set(all.map((t) => t.item_type))].sort().map((t) => ({ value: t, label: typeLabel(t) }))],
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

  const visibleIds = items.map((t) => t.id);
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
    { id: "sla", header: "SLA", meta: meta({ width: 120 }), cell: ({ row }) => { const s = slaOf(row.original, now); return <Chip tone={SLA_TONE[s.state]}>{slaText(s)}</Chip>; } },
    { id: "task", header: "Task", cell: ({ row }) => (
      <span><strong>{typeLabel(row.original.item_type)}</strong> <span className="aurora-number">{row.original.source_id}</span>
        <Text variant="text-micro" tone="muted" as="div">{row.original.domain}, {row.original.id.slice(0, 8)}{row.original.ai_recommendation ? ", model suggestion" : ""}</Text></span>) },
    { id: "priority", header: "Priority", meta: meta({ width: 80 }), cell: ({ row }) => `P${row.original.priority}` },
    { id: "status", header: "Status", meta: meta({ width: 120 }), cell: ({ row }) => <Chip tone={STATUS_TONE[row.original.status]}>{label(row.original.status)}</Chip> },
    { id: "assignee", header: "Assignee", meta: meta({ width: 140 }), cell: ({ row }) => who(row.original.assigned_to) },
    { id: "age", header: "Age", meta: meta({ width: 80, align: "end", numeric: true }), cell: ({ row }) => span(now - Date.parse(row.original.created_at)) },
  // eslint-disable-next-line react-hooks/exhaustive-deps -- visibleIds tracks items
  ], [picked, allVisible, items, now, toggle, who]);

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
  // eslint-disable-next-line react-hooks/exhaustive-deps -- visibleIds tracks items
  }, [target, canApprove, user, items, selected, now, who, approve, assign, escalate, drawer, toggle, setView, setSort]);

  const m = metricsQ.data;
  return (
    <Stack gap={5} className="aurora-page">
      <Tally level={2} label="Steward inbox" figures={[
        { label: "Overdue", value: counts.breached, tone: counts.breached ? "danger" : undefined, loading, verdict: counts.breached ? "Past their due time." : "Nothing past due.", href: "/workbench?view=breached" },
        { label: "Due today", value: counts.today, tone: counts.today ? "warning" : undefined, loading, verdict: counts.today ? "Due before midnight." : "Nothing due today.", href: "/workbench?view=today" },
        { label: "Unassigned", value: counts.unassigned, loading, verdict: counts.unassigned ? "Nobody owns these yet." : "Every task has an owner.", href: "/workbench?view=unassigned" },
        { label: "Open", value: all.length, loading, verdict: all.length ? "Tasks waiting on a steward." : "The inbox is clear.", href: "/workbench?view=all" },
        { label: "Resolved this week", value: weekQ.data?.weekly.at(-1)?.resolved ?? null, loading: weekQ.isLoading, verdict: weekQ.data?.weekly.at(-1)?.resolved ? "Closed in the last seven days." : "Nothing closed this week.", href: "/workbench?tab=progress" },
      ]} />

      <Stack direction="row" gap={2} wrap align="center">
        {VIEWS.map((v) => <Chip key={v.value} selected={view === v.value} onClick={() => setView(v.value)}>{v.label}</Chip>)}
        <span style={{ flex: 1 }} />
        <Button variant="ghost" size="sm" onClick={() => setPaletteOpen(true)} title="Quick actions (.)">Quick actions</Button>
      </Stack>
      <Stack direction="row" gap={3} wrap className="aurora-filters">
        <Field label="Search">{({ controlId }) => <Input id={controlId} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Record, domain, assignee, task id" />}</Field>
        <Field label="Type">{({ controlId }) => <Select id={controlId} options={typeOptions} value={type} onValueChange={setType} />}</Field>
        <Field label="Sort">{({ controlId }) => <Select id={controlId} options={SORTS} value={sort} onValueChange={setSort} />}</Field>
      </Stack>

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
        : items.length ? <DataTable columns={columns} data={items} getRowId={(t) => t.id} onRowFocus={(t) => setFocusedId(t?.id ?? null)} onRowActivate={(t) => drawer.open(t.id)} ariaLabel="Steward inbox" maxHeight="60vh" />
        : <EmptyState title={all.length ? "No tasks in this view." : "Inbox zero."} body={all.length ? "Change the view or clear the search." : "Merge decisions, golden-record reviews, writebacks and exceptions land here when they need a steward."} />}

      {canSeeTeam ? <TeamPanel items={all} now={now} who={who} metrics={m} /> : null}

      <Drawer open={!!detail} onClose={drawer.close} ariaLabel="Task details"
        header={detail ? <Stack direction="row" gap={2} align="center"><Chip tone={STATUS_TONE[detail.status]}>{label(detail.status)}</Chip><Text variant="text-lead">{typeLabel(detail.item_type)}: {detail.source_id}</Text></Stack> : null}>
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
    ["Record", t.source_id], ["Domain", t.domain], ["Type", typeLabel(t.item_type)], ["Priority", `P${t.priority}`],
    ["Assignee", who(t.assigned_to)], ["SLA", t.sla_hours ? `${t.sla_hours}h · ${slaText(s)}` : "no SLA"],
    ["Due", t.due_at ? new Date(t.due_at).toLocaleString() : "—"], ["Raised", relativeTime(t.created_at)], ["Updated", relativeTime(t.updated_at)],
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

/** Team workload (open tasks per assignee) and throughput per task type; the metrics endpoint
 * withholds the per-steward breakdown from roles that may not see it. */
function TeamPanel({ items, now, who, metrics }: {
  items: StewardshipQueueItem[]; now: number; who: (id: string | null) => string; metrics?: import("@/types/api").StewardshipMetrics;
}) {
  const load = useMemo(() => {
    const m = new Map<string, { open: number; breached: number }>();
    for (const t of items) {
      const k = who(t.assigned_to);
      const r = m.get(k) ?? { open: 0, breached: 0 };
      r.open += 1;
      if (slaOf(t, now).state === "breached") r.breached += 1;
      m.set(k, r);
    }
    return [...m.entries()].sort((a, b) => b[1].open - a[1].open);
  }, [items, now, who]);
  const types = Object.keys({ ...metrics?.items_by_type, ...metrics?.avg_resolution_hours_by_type }).sort();
  return (
    <Panel title="Team and throughput">
      <Stack direction="row" gap={6} wrap align="start">
        <Stack gap={2}>
          {metrics?.ai_acceptance_rate != null ? <Text variant="text-small">Suggestion acceptance {Math.round(metrics.ai_acceptance_rate * 100)} %</Text> : null}
          <Text variant="text-micro" tone="muted">Open workload</Text>
          <table className="ui-mini-table">
            <thead><tr><th>Assignee</th><th>Open</th><th>Breached</th></tr></thead>
            <tbody>{load.length ? load.map(([k, r]) => <tr key={k}><td>{k}</td><td className="aurora-number">{r.open}</td><td className="aurora-number">{r.breached}</td></tr>)
              : <tr><td colSpan={3}>No open tasks.</td></tr>}</tbody>
          </table>
        </Stack>
        {types.length ? (
          <Stack gap={2}>
            <Text variant="text-micro" tone="muted">By task type, all time</Text>
            <table className="ui-mini-table">
              <thead><tr><th>Type</th><th>Tasks</th><th>Avg to resolve</th></tr></thead>
              <tbody>{types.map((k) => {
                const h = metrics?.avg_resolution_hours_by_type[k];
                return <tr key={k}><td>{typeLabel(k)}</td><td className="aurora-number">{metrics?.items_by_type[k] ?? 0}</td><td className="aurora-number">{h != null ? `${h}h` : "—"}</td></tr>;
              })}</tbody>
            </table>
          </Stack>
        ) : null}
        {metrics?.steward_breakdown?.length ? (
          <Stack gap={2}>
            <Text variant="text-micro" tone="muted">Steward throughput</Text>
            <table className="ui-mini-table">
              <thead><tr><th>Steward</th><th>Resolved</th><th>Avg to resolve</th></tr></thead>
              <tbody>{metrics.steward_breakdown.map((s) => (
                <tr key={s.steward_name}><td>{s.steward_name}</td><td className="aurora-number">{s.resolved} / {s.total}</td>
                  <td className="aurora-number">{s.avg_resolution_hours != null ? `${s.avg_resolution_hours}h` : "—"}</td></tr>
              ))}</tbody>
            </table>
          </Stack>
        ) : null}
      </Stack>
    </Panel>
  );
}
