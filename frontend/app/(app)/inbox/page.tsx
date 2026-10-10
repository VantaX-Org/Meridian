"use client";

/**
 * Steward inbox: every open stewardship task in one list. Ports the legacy
 * workbench inbox's data wiring (views, sorts, assign, resolve, escalate,
 * bulk approve, AI feedback) onto @/design. Replaces the
 * legacy A/R/E/N/X/. keymap with j/k row focus + enter to open the fix sheet
 * (spec 6.2); the actions themselves move to buttons so nothing is dropped.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Button, DataTable, Drawer, ExplorerPage, ExportMenu, Field, Pill, Select, Stat, emptyExportOptions, toastManager, type PillTone } from "@/design";
import { useAuth } from "@/context/auth-context";
import { useRole } from "@/hooks/use-role";
import { useUrlState } from "@/hooks/use-url-state";
import { exportIssues } from "@/lib/api/issues";
import { assignItem, bulkApprove, escalateItem, getMetrics, getQueueItems, resolveItem, submitAiFeedback } from "@/lib/api/stewardship";
import { getTriageMetrics, ownerRungs } from "@/lib/api/triage";
import { getUsers } from "@/lib/api/users";
import {
  assignException,
  createExceptionRule,
  escalateException,
  getExceptionMetrics,
  getExceptionRules,
  getExceptions,
  resolveException,
  updateExceptionRule,
} from "@/lib/api/exceptions";
import { getUnreadCount } from "@/lib/api/notifications";
import { apiErrorMessage, isNotFound } from "@/lib/error";
import { formatModuleName, labelOf } from "@/lib/format";
import { inboxKeyHandler } from "@/lib/inbox-keys";
import { queryKeys } from "@/lib/query-keys";
import { useDayOne, DayOneAction } from "@/hooks/use-day-one";
import type { Exception, ExceptionRule, ExceptionStatus, Severity, StewardshipQueueItem, StewardshipStatus } from "@/types/api";

const HOUR = 3_600_000;
// Every status still waiting on a steward; the list endpoint filters one status at a time.
const LIVE: StewardshipStatus[] = ["open", "in_progress", "escalated"];
const STATUS_TONE: Record<StewardshipStatus, PillTone> = { open: "neutral", in_progress: "at-risk", escalated: "no-go", resolved: "go" };
const SEVERITY_TONE: Record<Severity, PillTone> = { critical: "no-go", high: "no-go", medium: "at-risk", low: "neutral", warning: "at-risk" };
const EXC_STATUS_TONE: Record<ExceptionStatus, PillTone> = { open: "neutral", investigating: "at-risk", pending_approval: "at-risk", resolved: "go", verified: "go", closed: "neutral" };
const KINDS = [{ value: "task", label: "Tasks" }, { value: "exception", label: "Exceptions" }];
const VIEWS = [
  { value: "all", label: "All open" }, { value: "mine", label: "Mine" }, { value: "unassigned", label: "Unassigned" },
  { value: "breached", label: "SLA breached" }, { value: "today", label: "Due today" }, { value: "escalated", label: "Escalated" },
];
/** Stands in for "no due date" so those tasks sort last. */
const NO_DUE = Number.MAX_SAFE_INTEGER;
const BULK_CONFIDENCE = 0.85;
const isToday = (iso: string | null, now: number) => !!iso && new Date(iso).toDateString() === new Date(now).toDateString();

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

const SLA_TONE: Record<Sla["state"], PillTone> = { none: "neutral", ok: "go", risk: "at-risk", breached: "no-go" };
const slaText = (s: Sla) => (s.remaining === null ? "no SLA" : s.remaining < 0 ? `${span(s.remaining)} over` : `${span(s.remaining)} left`);

/** Run one call per task; report how many went through rather than failing the batch on the first error. */
async function each(ids: string[], fn: (id: string) => Promise<unknown>): Promise<{ ok: number; failed: number }> {
  const r = await Promise.allSettled(ids.map(fn));
  const ok = r.filter((x) => x.status === "fulfilled").length;
  return { ok, failed: r.length - ok };
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

export default function InboxPage() {
  const qc = useQueryClient();
  const router = useRouter();
  const { user } = useAuth();
  const { can } = useRole();
  const dayOne = useDayOne();
  // Backend guards (api/routes/stewardship.py): resolve, assign and bulk approve need `approve`; escalate needs `view`.
  const canApprove = can("approve");
  const canSeeTeam = can("assign");
  const canManageRules = can("manage_rules");
  const [view, setView] = useUrlState("view", "all");
  const [type, setType] = useUrlState("type", "all");
  const [kind, setKind] = useUrlState("kind", "task");
  const isExceptions = kind === "exception";
  const [search, setSearch] = useState("");
  const [rawFocusedIndex, setFocusedIndex] = useState(0);
  const [rejectIds, setRejectIds] = useState<string[] | null>(null);
  const [reason, setReason] = useState("");
  const [rulesOpen, setRulesOpen] = useState(false);
  const [ruleDraft, setRuleDraft] = useState({ name: "", description: "", rule_type: "", object_type: "", condition: "", severity: "medium" as Severity });

  const queues = useQueries({
    queries: LIVE.map((status) => ({
      queryKey: queryKeys.inbox({ status, limit: 200 }),
      queryFn: () => getQueueItems({ status, limit: 200 }),
      refetchInterval: 60_000,
      enabled: !isExceptions,
    })),
  });
  const weekQ = useQuery({ queryKey: queryKeys.triageMetrics(8), queryFn: () => getTriageMetrics(8), refetchInterval: 60_000, enabled: !isExceptions });
  const metricsQ = useQuery({ queryKey: queryKeys.stewardshipMetrics(), queryFn: getMetrics, refetchInterval: 60_000, enabled: !isExceptions });
  // The user list needs `manage_users`; without it assignees show as "You" or an id prefix.
  const usersQ = useQuery({ queryKey: queryKeys.users(), queryFn: getUsers, enabled: can("manage_users") });
  // Unread notifications: shown as a header stat regardless of which kind is active (spec 6.2 fallback).
  const unreadQ = useQuery({ queryKey: queryKeys.unreadNotifications(), queryFn: getUnreadCount, refetchInterval: 30_000 });

  const excQ = useQuery({
    queryKey: queryKeys.inbox({ kind: "exception", per_page: 100 }),
    queryFn: () => getExceptions({ per_page: 100 }),
    refetchInterval: 60_000,
    enabled: isExceptions,
  });
  const excMetricsQ = useQuery({ queryKey: queryKeys.exceptionMetrics(), queryFn: () => getExceptionMetrics(), enabled: isExceptions });
  const excRulesQ = useQuery({ queryKey: queryKeys.exceptionRules(), queryFn: getExceptionRules, enabled: isExceptions && rulesOpen });

  const isLoading = queues.some((q) => q.isLoading);
  // A 404 means no queue yet: that is the empty state, not an error.
  const failedQueue = queues.find((q) => q.isError && !isNotFound(q.error));
  const isError = !!failedQueue;
  const excFailed = excQ.isError && !isNotFound(excQ.error);
  const firstError = isExceptions ? excQ.error : failedQueue?.error;
  // SLA maths runs against the last fetch time, so it stays pure and refreshes with the data.
  const now = isExceptions ? excQ.dataUpdatedAt : Math.max(0, ...queues.map((q) => q.dataUpdatedAt));
  const all = useMemo(() => queues.flatMap((q) => q.data?.items ?? []), [queues]);

  const names = useMemo(() => new Map((usersQ.data?.users ?? []).map((u) => [u.id, u.name])), [usersQ.data]);
  const who = useCallback(
    (id: string | null) => (!id ? "Unassigned" : id === user?.id ? "You" : names.get(id) ?? id.slice(0, 8)),
    [names, user?.id],
  );

  const items = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = all.filter((t) => {
      if (type !== "all" && t.item_type !== type) return false;
      if (view === "mine" && t.assigned_to !== user?.id) return false;
      if (view === "unassigned" && t.assigned_to) return false;
      if (view === "breached" && slaOf(t, now).state !== "breached") return false;
      if (view === "today" && !isToday(t.due_at, now)) return false;
      if (view === "escalated" && t.status !== "escalated") return false;
      return !q || [t.id, t.source_id, t.domain, t.item_type, who(t.assigned_to)].some((v) => v.toLowerCase().includes(q));
    });
    const due = (t: StewardshipQueueItem) => slaOf(t, now).remaining ?? NO_DUE;
    return rows.sort((x, y) => due(x) - due(y) || x.priority - y.priority);
  }, [all, type, view, search, now, user?.id, who]);

  const excItems = useMemo(() => {
    const excAll = excQ.data?.exceptions ?? [];
    const q = search.trim().toLowerCase();
    const rows = excAll.filter((e) => !q || [e.id, e.title, e.category, e.type, e.status, who(e.assigned_to)].some((v) => v.toLowerCase().includes(q)));
    const due = (e: Exception) => (e.sla_deadline ? Date.parse(e.sla_deadline) : NO_DUE);
    return [...rows].sort((a, b) => due(a) - due(b));
  }, [excQ.data, search, who]);

  // Clamped at read time (not in an effect) so a shrinking list never points past its last row.
  const rowCount = isExceptions ? excItems.length : items.length;
  const focusedIndex = Math.min(rawFocusedIndex, Math.max(rowCount - 1, 0));

  const typeOptions = useMemo(
    () => [{ value: "", label: "All types" }, ...[...new Set(all.map((t) => t.item_type))].sort().map((t) => ({ value: t, label: labelOf(t) }))],
    [all],
  );

  const counts = useMemo(() => {
    const sla = all.map((t) => slaOf(t, now).state);
    return {
      mine: all.filter((t) => t.assigned_to && t.assigned_to === user?.id).length,
      unassigned: all.filter((t) => !t.assigned_to).length,
      breached: sla.filter((s) => s === "breached").length,
      today: all.filter((t) => isToday(t.due_at, now)).length,
      escalated: all.filter((t) => t.status === "escalated").length,
    };
  }, [all, now, user?.id]);

  const refresh = useCallback(() => {
    void qc.invalidateQueries({ queryKey: ["inbox"] });
    void qc.invalidateQueries({ queryKey: queryKeys.stewardshipMetrics() });
    void qc.invalidateQueries({ queryKey: queryKeys.exceptionMetrics() });
    void qc.invalidateQueries({ queryKey: queryKeys.unreadNotifications() });
  }, [qc]);
  const done = useCallback((verb: string, r: { ok: number; failed: number }) => {
    if (r.ok) toastManager.add({ title: `${verb} ${plural(r.ok, "task")}` });
    if (r.failed) toastManager.add({ title: `${plural(r.failed, "task")} not ${verb.toLowerCase()}` });
    refresh();
  }, [refresh]);

  const approve = useMutation({
    mutationFn: (ids: string[]) =>
      ids.length === 1 ? resolveItem(ids[0], "approve").then(() => ({ approved: 1, asked: 1 })) : bulkApprove(ids, BULK_CONFIDENCE).then((d) => ({ approved: d.approved, asked: ids.length })),
    onSuccess: ({ approved, asked }) => {
      toastManager.add({ title: `Approved ${plural(approved, "task")}` });
      if (asked > approved) toastManager.add({ title: `${asked - approved} below ${BULK_CONFIDENCE * 100}% model confidence or already closed — left for manual review` });
      refresh();
    },
    onError: (e) => toastManager.add({ title: (e as Error).message || "Not approved" }),
  });
  // Rejecting overrides the model's recommendation: the correction reason is recorded on the task
  // and fed to the AI-feedback loop that proposes new match rules (/ai/rules).
  const reject = useMutation({
    mutationFn: ({ ids, reason: why }: { ids: string[]; reason: string }) =>
      each(ids, async (id) => {
        await resolveItem(id, "reject", why);
        const t = all.find((x) => x.id === id);
        if (t) await submitAiFeedback({ queue_item_id: id, steward_decision: "reject", correction_reason: why, domain: t.domain });
      }),
    onSuccess: (r) => { setRejectIds(null); setReason(""); done("Rejected", r); },
    onError: () => toastManager.add({ title: "Not rejected" }),
  });
  const escalate = useMutation({
    mutationFn: (ids: string[]) => each(ids, escalateItem),
    onSuccess: (r) => done("Escalated", r),
  });
  const assign = useMutation({
    mutationFn: ({ ids, userId }: { ids: string[]; userId: string }) => each(ids, (id) => assignItem(id, userId)),
    onSuccess: (r) => done("Assigned", r),
  });

  // Exception mutations: same intent (assign/escalate/resolve) as the stewardship ones above, but
  // the exceptions API (lib/api/exceptions.ts) takes structured bodies with different field names —
  // reconciled here rather than in a second table, per the task brief.
  const excAssign = useMutation({
    mutationFn: ({ ids, userId }: { ids: string[]; userId: string }) => each(ids, (id) => assignException(id, { user_id: userId })),
    onSuccess: (r) => done("Assigned", r),
  });
  const excEscalate = useMutation({
    mutationFn: (ids: string[]) => each(ids, (id) => escalateException(id, { reason: "Escalated from the inbox" })),
    onSuccess: (r) => done("Escalated", r),
  });
  const excResolve = useMutation({
    mutationFn: ({ ids, reason: why }: { ids: string[]; reason: string }) =>
      each(ids, (id) => resolveException(id, { resolution_type: "fixed", resolution_notes: why, root_cause_category: "other" })),
    onSuccess: (r) => { setRejectIds(null); setReason(""); done("Resolved", r); },
    onError: () => toastManager.add({ title: "Not resolved" }),
  });
  const busy = isExceptions
    ? excAssign.isPending || excEscalate.isPending || excResolve.isPending
    : approve.isPending || reject.isPending || escalate.isPending || assign.isPending;

  const openRecord = useCallback((index: number) => {
    if (isExceptions) return; // exceptions have no object/record to open — the row carries its own detail.
    const t = items[index];
    if (t) router.push(`/objects/${t.domain}/records/${t.source_id}`);
  }, [isExceptions, items, router]);

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const el = ev.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)) return;
      inboxKeyHandler(ev, { focusedIndex, rowCount, setFocus: setFocusedIndex, onOpen: openRecord });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focusedIndex, rowCount, openRecord]);

  const createRule = useMutation({
    mutationFn: () => createExceptionRule({ ...ruleDraft, auto_assign_to: undefined }),
    onSuccess: () => {
      toastManager.add({ title: "Exception rule created" });
      setRuleDraft({ name: "", description: "", rule_type: "", object_type: "", condition: "", severity: "medium" });
      void qc.invalidateQueries({ queryKey: queryKeys.exceptionRules() });
    },
    onError: (e) => toastManager.add({ title: (e as Error).message || "Rule not created" }),
  });
  const toggleRule = useMutation({
    mutationFn: ({ id, is_active }: { id: string; is_active: boolean }) => updateExceptionRule(id, { is_active }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: queryKeys.exceptionRules() }),
  });

  const columns = useMemo<ColumnDef<StewardshipQueueItem>[]>(() => [
    {
      id: "task", header: "Task",
      cell: ({ row }) => {
        const focused = items[focusedIndex]?.id === row.original.id;
        return <span>{focused ? "> " : ""}{labelOf(row.original.item_type)} <span style={{ color: "var(--m-ink-3)" }}>in {formatModuleName(row.original.domain)}, record {row.original.source_id}</span></span>;
      },
    },
    { id: "sla", header: "SLA", accessorFn: (t) => slaOf(t, now).remaining ?? NO_DUE, cell: ({ row }) => { const s = slaOf(row.original, now); return <Pill tone={SLA_TONE[s.state]}>{slaText(s)}</Pill>; } },
    { id: "priority", header: "Priority", accessorFn: (t) => t.priority, cell: ({ row }) => `P${row.original.priority}` },
    { id: "status", header: "Status", accessorFn: (t) => t.status, cell: ({ row }) => <Pill tone={STATUS_TONE[row.original.status]}>{labelOf(row.original.status)}</Pill> },
    { id: "assignee", header: "Assignee", accessorFn: (t) => who(t.assigned_to), cell: ({ row }) => who(row.original.assigned_to) },
    { id: "age", header: "Age", accessorFn: (t) => now - Date.parse(t.created_at), cell: ({ row }) => span(now - Date.parse(row.original.created_at)) },
    {
      id: "actions", header: "", enableSorting: false,
      cell: ({ row }) => {
        const t = row.original;
        return (
          <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
            {canApprove && <Button variant="secondary" disabled={busy} onClick={() => approve.mutate([t.id])}>Approve</Button>}
            {canApprove && <Button variant="ghost" disabled={busy} onClick={() => setRejectIds([t.id])}>Reject</Button>}
            <Button variant="ghost" disabled={busy || t.status === "escalated"} onClick={() => escalate.mutate([t.id])}>Escalate</Button>
            {canApprove && !t.assigned_to && user && <Button variant="ghost" disabled={busy} onClick={() => assign.mutate({ ids: [t.id], userId: user.id })}>Assign to me</Button>}
          </div>
        );
      },
    },
  ], [items, focusedIndex, now, who, canApprove, busy, approve, escalate, assign, user]);

  const excColumns = useMemo<ColumnDef<Exception>[]>(() => [
    {
      id: "exception", header: "Exception",
      cell: ({ row }) => {
        const focused = excItems[focusedIndex]?.id === row.original.id;
        return <span>{focused ? "> " : ""}{row.original.title} <span style={{ color: "var(--m-ink-3)" }}>in {row.original.category}</span></span>;
      },
    },
    { id: "severity", header: "Severity", accessorFn: (e) => e.severity, cell: ({ row }) => <Pill tone={SEVERITY_TONE[row.original.severity]}>{labelOf(row.original.severity)}</Pill> },
    { id: "status", header: "Status", accessorFn: (e) => e.status, cell: ({ row }) => <Pill tone={EXC_STATUS_TONE[row.original.status]}>{labelOf(row.original.status)}</Pill> },
    { id: "assignee", header: "Assignee", accessorFn: (e) => who(e.assigned_to), cell: ({ row }) => who(row.original.assigned_to) },
    {
      id: "deadline", header: "SLA", accessorFn: (e) => (e.sla_deadline ? Date.parse(e.sla_deadline) : NO_DUE),
      cell: ({ row }) => {
        const d = row.original.sla_deadline;
        if (!d) return "no SLA";
        const remaining = Date.parse(d) - now;
        return <Pill tone={remaining < 0 ? "no-go" : remaining < 24 * HOUR ? "at-risk" : "go"}>{remaining < 0 ? `${span(remaining)} over` : `${span(remaining)} left`}</Pill>;
      },
    },
    {
      id: "actions", header: "", enableSorting: false,
      cell: ({ row }) => {
        const e = row.original;
        const open = e.status !== "resolved" && e.status !== "closed";
        return (
          <div className="flex gap-2" onClick={(ev) => ev.stopPropagation()}>
            {canApprove && open && <Button variant="secondary" disabled={busy} onClick={() => setRejectIds([e.id])}>Resolve</Button>}
            <Button variant="ghost" disabled={busy || e.escalation_tier > 0} onClick={() => excEscalate.mutate([e.id])}>Escalate</Button>
            {canSeeTeam && !e.assigned_to && user && <Button variant="ghost" disabled={busy} onClick={() => excAssign.mutate({ ids: [e.id], userId: user.id })}>Assign to me</Button>}
          </div>
        );
      },
    },
  ], [excItems, focusedIndex, now, who, canApprove, canSeeTeam, busy, excEscalate, excAssign, user]);

  // Hold "empty" for the all-tasks view until useDayOne() has resolved too —
  // otherwise the generic "Inbox zero." copy flashes before the day-one step
  // (which decides the real empty-state detail/action) is known.
  const state: "loading" | "empty" | "error" | undefined = isExceptions
    ? excQ.isLoading ? "loading" : excFailed ? "error" : excItems.length === 0 ? "empty" : undefined
    : isLoading ? "loading" : isError ? "error" : items.length === 0 ? (dayOne.status === "loading" ? "loading" : "empty") : undefined;

  const kindToggle = (
    <div className="flex flex-wrap gap-2">
      {KINDS.map((k) => (
        <Button key={k.value} variant={kind === k.value ? "primary" : "secondary"} onClick={() => setKind(k.value)}>
          {k.label}
        </Button>
      ))}
    </div>
  );

  return (
    <ExplorerPage
      state={state}
      emptyProps={
        isExceptions
          ? (excQ.data?.exceptions.length ?? 0) === 0
            ? {
                title: "No exceptions.",
                detail: "Exceptions are raised by exception rules on new findings.",
                action: <Button variant="secondary" onClick={() => setRulesOpen(true)}>Exception rules</Button>,
              }
            : { title: "No exceptions in this view." }
          : all.length === 0
          ? {
              title: "Inbox zero.",
              detail: dayOne.step?.detail ?? "Tasks arrive when findings are assigned or proposals need review.",
              action: <DayOneAction step={dayOne.step} fallbackHref="/objects" fallbackLabel="Open objects" />,
            }
          : { title: "No tasks in this view." }
      }
      errorProps={{ message: apiErrorMessage(firstError), onRetry: refresh }}
      summary={
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-6">
            <Stat label="Unread notifications" value={unreadQ.isLoading ? "…" : unreadQ.isError ? "—" : unreadQ.data ?? 0} />
            {isExceptions ? (
              <>
                <Stat label="Open" value={excMetricsQ.isLoading ? "…" : excMetricsQ.data?.open_count ?? 0} />
                <Stat label="Overdue" value={excMetricsQ.isLoading ? "…" : excMetricsQ.data?.overdue_count ?? 0} />
                <Stat label="SLA compliance" value={excMetricsQ.isLoading ? "…" : `${Math.round(excMetricsQ.data?.sla_compliance_pct ?? 0)}%`} />
              </>
            ) : (
              <>
                <Stat label="Open" value={isLoading ? "…" : all.length} />
                <Stat label="Overdue" value={isLoading ? "…" : counts.breached} />
                <Stat label="Due today" value={isLoading ? "…" : counts.today} />
                <Stat label="Unassigned" value={isLoading ? "…" : counts.unassigned} />
                <Stat label="Resolved this week" value={weekQ.isLoading ? "…" : weekQ.data?.weekly.at(-1)?.resolved ?? "—"} />
              </>
            )}
          </div>
          {!isExceptions && canSeeTeam && <TeamPanel rungs={ownerRungs(weekQ.data)} aiAcceptance={metricsQ.data?.ai_acceptance_rate ?? null} />}
          {!isExceptions && (
            <ExportMenu
              options={
                items.length === 0
                  ? emptyExportOptions([{ format: "xlsx", label: "Issues (.xlsx)", run: () => exportIssues("xlsx", { search: search || undefined, assigned_to: view === "mine" ? user?.id : undefined }) }])
                  : [{ format: "xlsx", label: "Issues (.xlsx)", run: () => exportIssues("xlsx", { search: search || undefined, assigned_to: view === "mine" ? user?.id : undefined }) }]
              }
            />
          )}
        </div>
      }
      filterBar={
        <div className="flex flex-wrap gap-3 items-end">
          {kindToggle}
          {!isExceptions && (
            <div className="flex flex-wrap gap-2">
              {VIEWS.map((v) => {
                const n = v.value === "all" ? all.length : counts[v.value as keyof typeof counts];
                return (
                  <Button key={v.value} variant={view === v.value ? "primary" : "secondary"} onClick={() => setView(v.value)}>
                    {v.label} ({n})
                  </Button>
                );
              })}
            </div>
          )}
          {!isExceptions && (
            <Field label="Type">
              <Select value={type === "all" ? "" : type} onValueChange={(v) => setType(v || "all")} options={typeOptions} placeholder="All types" />
            </Field>
          )}
          <Field label="Search">
            <input
              aria-label={isExceptions ? "Search exceptions" : "Search tasks"}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="rounded border px-3 py-1.5 text-[13px]"
              style={{ borderColor: "var(--m-line)", background: "var(--m-sheet)", color: "var(--m-ink)" }}
            />
          </Field>
          {isExceptions && canManageRules && (
            <Button variant="secondary" onClick={() => setRulesOpen(true)}>Manage exception rules</Button>
          )}
        </div>
      }
      table={
        isExceptions ? (
          <DataTable
            columns={excColumns}
            data={excItems}
            getRowId={(e) => e.id}
            bulkActions={(selected) => (
              <div className="flex gap-2">
                {canSeeTeam && user && <Button variant="secondary" disabled={busy} onClick={() => excAssign.mutate({ ids: selected.map((e) => e.id), userId: user.id })}>Assign to me</Button>}
                <Button variant="secondary" disabled={busy} onClick={() => excEscalate.mutate(selected.map((e) => e.id))}>Escalate</Button>
                {canApprove && <Button variant="secondary" disabled={busy} onClick={() => setRejectIds(selected.map((e) => e.id))}>Resolve with notes</Button>}
              </div>
            )}
          />
        ) : (
          <DataTable
            columns={columns}
            data={items}
            getRowId={(t) => t.id}
            onRowClick={(t) => router.push(`/objects/${t.domain}/records/${t.source_id}`)}
            bulkActions={(selected) => (
              <div className="flex gap-2">
                {canApprove && <Button variant="secondary" disabled={busy} onClick={() => approve.mutate(selected.map((t) => t.id))}>Approve</Button>}
                {canApprove && <Button variant="secondary" disabled={busy} onClick={() => setRejectIds(selected.map((t) => t.id))}>Reject with reason</Button>}
                <Button variant="secondary" disabled={busy} onClick={() => escalate.mutate(selected.map((t) => t.id))}>Escalate</Button>
                {canApprove && user && <Button variant="secondary" disabled={busy} onClick={() => assign.mutate({ ids: selected.map((t) => t.id), userId: user.id })}>Assign to me</Button>}
              </div>
            )}
          />
        )
      }
      drawer={
        <>
          <Drawer
            open={rejectIds !== null}
            onOpenChange={(open) => !open && setRejectIds(null)}
            title={isExceptions ? "Resolve exception" : "Reject with reason"}
          >
            <div className="flex flex-col gap-3">
              <Field label="Reason">
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className="w-full rounded border px-3 py-2 text-[13px]"
                  style={{ borderColor: "var(--m-line)", background: "var(--m-sheet)", color: "var(--m-ink)" }}
                  rows={4}
                />
              </Field>
              <div className="flex gap-2 justify-end">
                <Button variant="ghost" onClick={() => setRejectIds(null)}>{isExceptions ? "Keep open" : "Keep task open"}</Button>
                <Button
                  variant="primary"
                  disabled={!reason.trim() || reject.isPending || excResolve.isPending}
                  onClick={() =>
                    rejectIds &&
                    (isExceptions ? excResolve.mutate({ ids: rejectIds, reason }) : reject.mutate({ ids: rejectIds, reason }))
                  }
                >
                  {isExceptions ? "Resolve" : "Reject"}
                </Button>
              </div>
            </div>
          </Drawer>
          <Drawer open={rulesOpen} onOpenChange={setRulesOpen} title="Exception rules">
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                {(excRulesQ.data?.rules ?? []).map((r: ExceptionRule) => (
                  <div key={r.id} className="flex items-center justify-between gap-2 border-b py-2" style={{ borderColor: "var(--m-line)" }}>
                    <div className="flex flex-col">
                      <span className="text-[13px] font-medium">{r.name}</span>
                      <span className="text-[13px]" style={{ color: "var(--m-ink-3)" }}>{r.object_type}, {r.rule_type}</span>
                    </div>
                    <Button variant="secondary" onClick={() => toggleRule.mutate({ id: r.id, is_active: !r.is_active })}>
                      {r.is_active ? "Disable" : "Enable"}
                    </Button>
                  </div>
                ))}
                {excRulesQ.data && excRulesQ.data.rules.length === 0 && (
                  <span className="text-[13px]" style={{ color: "var(--m-ink-3)" }}>No exception rules yet.</span>
                )}
              </div>
              <div className="flex flex-col gap-2">
                <span className="text-[13px] font-medium">New rule</span>
                <Field label="Name">
                  <input
                    value={ruleDraft.name}
                    onChange={(e) => setRuleDraft({ ...ruleDraft, name: e.target.value })}
                    className="w-full rounded border px-3 py-1.5 text-[13px]"
                    style={{ borderColor: "var(--m-line)", background: "var(--m-sheet)", color: "var(--m-ink)" }}
                  />
                </Field>
                <Field label="Rule type">
                  <input
                    value={ruleDraft.rule_type}
                    onChange={(e) => setRuleDraft({ ...ruleDraft, rule_type: e.target.value })}
                    className="w-full rounded border px-3 py-1.5 text-[13px]"
                    style={{ borderColor: "var(--m-line)", background: "var(--m-sheet)", color: "var(--m-ink)" }}
                  />
                </Field>
                <Field label="Object type">
                  <input
                    value={ruleDraft.object_type}
                    onChange={(e) => setRuleDraft({ ...ruleDraft, object_type: e.target.value })}
                    className="w-full rounded border px-3 py-1.5 text-[13px]"
                    style={{ borderColor: "var(--m-line)", background: "var(--m-sheet)", color: "var(--m-ink)" }}
                  />
                </Field>
                <Field label="Condition">
                  <input
                    value={ruleDraft.condition}
                    onChange={(e) => setRuleDraft({ ...ruleDraft, condition: e.target.value })}
                    className="w-full rounded border px-3 py-1.5 text-[13px]"
                    style={{ borderColor: "var(--m-line)", background: "var(--m-sheet)", color: "var(--m-ink)" }}
                  />
                </Field>
                <div className="flex justify-end">
                  <Button
                    variant="primary"
                    disabled={!ruleDraft.name.trim() || !ruleDraft.condition.trim() || createRule.isPending}
                    onClick={() => createRule.mutate()}
                  >
                    Create rule
                  </Button>
                </div>
              </div>
            </div>
          </Drawer>
        </>
      }
    />
  );
}

/** Replaces the legacy OwnerLadder (not in @/design) with a plain table. */
function TeamPanel({ rungs, aiAcceptance }: { rungs: ReturnType<typeof ownerRungs>; aiAcceptance: number | null }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[13px] font-medium">Who holds the work</span>
      {rungs.length ? (
        <table className="w-full text-[13px]">
          <tbody>
            {rungs.map((r) => (
              <tr key={r.label}><td>{r.label}</td><td>{r.open} open</td><td>{r.breached} breached</td></tr>
            ))}
          </tbody>
        </table>
      ) : (
        <span className="text-[13px]" style={{ color: "var(--m-ink-3)" }}>Nobody holds open work.</span>
      )}
      {aiAcceptance != null && (
        <span className="text-[13px]" style={{ color: "var(--m-ink-3)" }}>Suggestion acceptance {Math.round(aiAcceptance * 100)}%</span>
      )}
    </div>
  );
}
