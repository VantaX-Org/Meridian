"use client";

import { toast } from "sonner";
/**
 * Steward inbox: every open stewardship task in one list. Ports the legacy
 * workbench inbox's data wiring (views, sorts, assign, resolve, escalate,
 * bulk approve, AI feedback) onto @/design. Replaces the
 * legacy A/R/E/N/X/. keymap with j/k row focus + enter to open the fix sheet
 * (spec 6.2); the actions themselves move to buttons so nothing is dropped.
 * The keys are listed once, in `INBOX_SHORTCUTS` (lib/shortcuts.ts); `?` opens
 * the shell's shortcut sheet with the Inbox group first, so this page keeps no list of its own.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { Button, Card, Drawer, ExplorerPage, ExportMenu, Field, Notice, PageHeader, Pill, Select, Stat, Tabs, emptyExportOptions, type PillTone, Input, Mono, Status } from "@/design";
import { Fact, Workbench, type WorkbenchItem, type WorkbenchTone } from "@/components/inbox/workbench";
import { useAuth } from "@/context/auth-context";
import { useRole } from "@/hooks/use-role";
import { oneOf, useUrlState } from "@/hooks/use-url-state";
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
import { apiErrorMessage, isNotFound } from "@/lib/error";
import { formatDate, formatInt, formatModuleName, labelOf, relativeTime } from "@/lib/format";
import { inboxKeyHandler } from "@/lib/inbox-keys";
import { queryKeys } from "@/lib/query-keys";
import { ApprovalsPanel, IssuesPanel, SapMonitorPanel } from "./inbox-panels";
import { useDayOne, DayOneAction } from "@/hooks/use-day-one";
import type { Exception, ExceptionRule, ExceptionStatus, Severity, StewardshipQueueItem, StewardshipStatus } from "@/types/api";

const HOUR = 3_600_000;
// Every status still waiting on a steward; the list endpoint filters one status at a time.
const LIVE: StewardshipStatus[] = ["open", "in_progress", "escalated"];
const STATUS_TONE: Record<StewardshipStatus, PillTone> = { open: "neutral", in_progress: "at-risk", escalated: "no-go", resolved: "go" };
const EXC_STATUS_TONE: Record<ExceptionStatus, PillTone> = { open: "neutral", investigating: "at-risk", pending_approval: "at-risk", resolved: "go", verified: "go", closed: "neutral" };
const KINDS = [
  { value: "task", label: "Tasks" }, { value: "exception", label: "Exceptions" }, { value: "issues", label: "Issues" },
  { value: "sap", label: "SAP monitor" }, { value: "approvals", label: "Approvals" },
];
const VIEWS = [
  { value: "all", label: "All open" }, { value: "mine", label: "Mine" }, { value: "unassigned", label: "Unassigned" },
  { value: "breached", label: "SLA breached" }, { value: "today", label: "Due today" }, { value: "escalated", label: "Escalated" },
];
const VIEW_BANNER: Record<string, string> = {
  mine: "tasks assigned to me", unassigned: "unassigned tasks", breached: "tasks with a breached SLA",
  today: "tasks due today", escalated: "escalated tasks", all: "all tasks",
};
/** Stands in for "no due date" so those tasks sort last. */
const NO_DUE = Number.MAX_SAFE_INTEGER;
const BULK_CONFIDENCE = 0.85;
const isToday = (iso: string | null, now: number) => !!iso && new Date(iso).toDateString() === new Date(now).toDateString();

/** 45m, 5h, 3d */
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

/** The severity bar of a task row: its SLA state on the severity scale, so the list ranks by what is about to breach. */
const SLA_BAR: Record<Sla["state"], WorkbenchTone> = { breached: "critical", risk: "medium", ok: "low", none: "low" };

/** SLA pill of an exception: over, inside its last day, or comfortable. */
function excSla(deadline: string | null, now: number): { tone: PillTone; text: string; bar: WorkbenchTone } {
  if (!deadline) return { tone: "neutral", text: "no SLA", bar: "low" };
  const remaining = Date.parse(deadline) - now;
  if (remaining < 0) return { tone: "no-go", text: `${span(remaining)} over`, bar: "critical" };
  return { tone: remaining < 24 * HOUR ? "at-risk" : "go", text: `${span(remaining)} left`, bar: remaining < 24 * HOUR ? "medium" : "low" };
}

/** Run one call per task; report how many went through rather than failing the batch on the first error. */
async function each(ids: string[], fn: (id: string) => Promise<unknown>): Promise<{ ok: number; failed: number }> {
  const r = await Promise.allSettled(ids.map(fn));
  const ok = r.filter((x) => x.status === "fulfilled").length;
  return { ok, failed: r.length - ok };
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

type QueueCache = { items: StewardshipQueueItem[] };
type QueueSnapshot = [readonly unknown[], QueueCache][];

export default function InboxPage() {
  const qc = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const urlParams = useSearchParams();
  const { user } = useAuth();
  const { can } = useRole();
  const dayOne = useDayOne();
  // Backend guards (api/routes/stewardship.py): resolve, assign and bulk approve need `approve`; escalate needs `view`.
  const canApprove = can("approve");
  const canSeeTeam = can("assign");
  const canManageRules = can("manage_rules");
  const [viewRaw, setView] = useUrlState("view", "all");
  const [typeRaw, setType] = useUrlState("type", "all");
  const [kindRaw, setKind] = useUrlState("kind", "task");
  const view = oneOf(viewRaw, VIEWS.map((v) => v.value), "all");
  // Approvals needs `approve`; a deep link by anyone else falls back to Tasks.
  const kind = oneOf(kindRaw, KINDS.filter((k) => k.value !== "approvals" || canApprove).map((k) => k.value), "task");
  const isExceptions = kind === "exception";
  const [search, setSearch] = useState("");
  // One replace: separate useUrlState setters would each rebuild the query from the same stale string.
  const showAll = (alsoSearch: boolean) => {
    const params = new URLSearchParams(urlParams.toString());
    params.delete("view");
    params.delete("type");
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    if (alsoSearch) setSearch("");
  };
  const [rawFocusedIndex, setFocusedIndex] = useState(0);
  const [rollbackNote, setRollbackNote] = useState<string | null>(null);
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
  const queueTotal = queues.reduce((n, q) => n + (q.data?.total ?? 0), 0);

  const names = useMemo(() => new Map((usersQ.data?.users ?? []).map((u) => [u.id, u.name])), [usersQ.data]);
  const who = useCallback(
    (id: string | null) => (!id ? "Unassigned" : id === user?.id ? "You" : names.get(id) ?? id.slice(0, 8)),
    [names, user?.id],
  );

  // A type is only a filter when the loaded tasks carry it; unknown values apply nothing.
  const type = useMemo(() => oneOf(typeRaw, [...new Set(all.map((t) => t.item_type))], "all"), [typeRaw, all]);
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
    if (r.ok) toast(`${verb} ${plural(r.ok, "task")}`);
    if (r.failed) toast.error(`${plural(r.failed, "task")} not ${verb.toLowerCase()}`);
    refresh();
  }, [refresh]);

  /** Optimistic edit of every cached queue page; returns the snapshot so a failure can restore it. */
  const patchQueue = useCallback(async (ids: string[], fn: (t: StewardshipQueueItem) => StewardshipQueueItem | null): Promise<QueueSnapshot> => {
    await qc.cancelQueries({ queryKey: ["inbox"] });
    const snap: QueueSnapshot = [];
    for (const [key, data] of qc.getQueriesData<QueueCache>({ queryKey: ["inbox"] })) {
      if (!data || !Array.isArray(data.items)) continue;
      snap.push([key, data]);
      qc.setQueryData<QueueCache>(key, { ...data, items: data.items.flatMap((t) => (ids.includes(t.id) ? [fn(t)].filter((x): x is StewardshipQueueItem => x !== null) : [t])) });
    }
    return snap;
  }, [qc]);
  const rollback = useCallback((snap: QueueSnapshot | undefined, msg: string) => {
    snap?.forEach(([key, data]) => qc.setQueryData(key, data));
    setRollbackNote(msg);
  }, [qc]);

  const approve = useMutation({
    onMutate: async (ids: string[]) => { setRollbackNote(null); return { snap: await patchQueue(ids, () => null) }; },
    mutationFn: (ids: string[]) =>
      ids.length === 1 ? resolveItem(ids[0], "approve").then(() => ({ approved: 1, asked: 1 })) : bulkApprove(ids, BULK_CONFIDENCE).then((d) => ({ approved: d.approved, asked: ids.length })),
    onSuccess: ({ approved, asked }) => {
      toast(`Approved ${plural(approved, "task")}`);
      if (asked > approved) toast(`${asked - approved} below ${BULK_CONFIDENCE * 100}% model confidence or already closed — left for manual review`);
      refresh();
    },
    onError: (e, _ids, ctx) => rollback(ctx?.snap, `Not approved: ${apiErrorMessage(e)}`),
  });
  // Rejecting overrides the model's recommendation: the correction reason is recorded on the task
  // and fed to the AI-feedback loop that proposes new match rules (/ai/rules).
  const reject = useMutation({
    onMutate: async ({ ids }: { ids: string[]; reason: string }) => { setRollbackNote(null); return { snap: await patchQueue(ids, () => null) }; },
    mutationFn: ({ ids, reason: why }: { ids: string[]; reason: string }) =>
      each(ids, async (id) => {
        await resolveItem(id, "reject", why);
        const t = all.find((x) => x.id === id);
        if (t) await submitAiFeedback({ queue_item_id: id, steward_decision: "reject", correction_reason: why, domain: t.domain });
      }),
    onSuccess: (r) => { setRejectIds(null); setReason(""); done("Rejected", r); },
    onError: (e, _v, ctx) => rollback(ctx?.snap, `Not rejected: ${apiErrorMessage(e)}`),
  });
  const escalate = useMutation({
    mutationFn: (ids: string[]) => each(ids, escalateItem),
    onSuccess: (r) => done("Escalated", r),
  });
  const assign = useMutation({
    onMutate: async ({ ids, userId }: { ids: string[]; userId: string }) => { setRollbackNote(null); return { snap: await patchQueue(ids, (t) => ({ ...t, assigned_to: userId })) }; },
    mutationFn: ({ ids, userId }: { ids: string[]; userId: string }) => each(ids, (id) => assignItem(id, userId)),
    onSuccess: (r) => done("Assigned", r),
    onError: (e, _v, ctx) => rollback(ctx?.snap, `Not assigned: ${apiErrorMessage(e)}`),
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
    onError: () => toast.error("Not resolved"),
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
      if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
      const t = isExceptions ? null : items[focusedIndex];
      const e = isExceptions ? excItems[focusedIndex] : null;
      switch (ev.key) {
        case "Escape": setRejectIds(null); setRulesOpen(false); return;
        case "a": if (t && canApprove && !busy && user) { ev.preventDefault(); assign.mutate({ ids: [t.id], userId: user.id }); } else if (e && canSeeTeam && !busy && user) { ev.preventDefault(); excAssign.mutate({ ids: [e.id], userId: user.id }); } return;
        case "r": if (t && canApprove && !busy) { ev.preventDefault(); approve.mutate([t.id]); } else if (e && canApprove && !busy) { ev.preventDefault(); setRejectIds([e.id]); } return;
        case "x": if (t && canApprove) { ev.preventDefault(); setRejectIds([t.id]); } return;
        default: inboxKeyHandler(ev, { focusedIndex, rowCount, setFocus: setFocusedIndex, onOpen: openRecord });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focusedIndex, rowCount, openRecord, isExceptions, items, excItems, canApprove, canSeeTeam, busy, user, assign, approve, excAssign]);

  const createRule = useMutation({
    mutationFn: () => createExceptionRule({ ...ruleDraft, auto_assign_to: undefined }),
    onSuccess: () => {
      toast("Exception rule created");
      setRuleDraft({ name: "", description: "", rule_type: "", object_type: "", condition: "", severity: "medium" });
      void qc.invalidateQueries({ queryKey: queryKeys.exceptionRules() });
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });
  const toggleRule = useMutation({
    mutationFn: ({ id, is_active }: { id: string; is_active: boolean }) => updateExceptionRule(id, { is_active }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: queryKeys.exceptionRules() }),
  });

  const taskRows = useMemo<WorkbenchItem[]>(() => items.map((t) => {
    const sla = slaOf(t, now);
    return {
      id: t.id,
      label: `${labelOf(t.item_type)} ${t.source_id}`,
      title: <>{labelOf(t.item_type)} in {formatModuleName(t.domain)}</>,
      meta: `${who(t.assigned_to)}, P${t.priority}, record ${t.source_id}, ${span(now - Date.parse(t.created_at))} old`,
      aside: <Pill tone={SLA_TONE[sla.state]}>{slaText(sla)}</Pill>,
      tone: SLA_BAR[sla.state],
    };
  }), [items, now, who]);
  const excRows = useMemo<WorkbenchItem[]>(() => excItems.map((e) => {
    const sla = excSla(e.sla_deadline, now);
    return {
      id: e.id,
      label: e.title,
      title: e.title,
      meta: `${labelOf(e.category)}, ${labelOf(e.status)}, ${who(e.assigned_to)}`,
      aside: <Pill tone={sla.tone}>{sla.text}</Pill>,
      tone: e.severity === "critical" || e.severity === "high" || e.severity === "medium" || e.severity === "low" ? e.severity : "low",
    };
  }), [excItems, now, who]);
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
  const onCheck = useCallback((id: string, on: boolean) => setChecked((prev) => {
    const next = new Set(prev);
    if (on) next.add(id); else next.delete(id);
    return next;
  }), []);
  const selectedTask = isExceptions ? undefined : items[focusedIndex];
  const selectedExc = isExceptions ? excItems[focusedIndex] : undefined;

  // Hold "empty" for the all-tasks view until useDayOne() has resolved too —
  // otherwise the generic "Inbox zero." copy flashes before the day-one step
  // (which decides the real empty-state detail/action) is known.
  const state: "loading" | "empty" | "error" | undefined = isExceptions
    ? excQ.isLoading ? "loading" : excFailed ? "error" : excItems.length === 0 ? "empty" : undefined
    : isLoading ? "loading" : isError ? "error" : items.length === 0 ? (dayOne.status === "loading" ? "loading" : "empty") : undefined;

  const kindToggle = (
    <Tabs items={KINDS.filter((k) => k.value !== "approvals" || canApprove).map((k) => ({ ...k, content: null }))} value={kind} onValueChange={setKind} />
  );
  const overdue = isExceptions ? excMetricsQ.data?.overdue_count ?? 0 : counts.breached;
  const openCount = isExceptions ? excMetricsQ.data?.open_count ?? excItems.length : all.length;
  const exportOptions = [{ format: "xlsx" as const, label: "Issues (.xlsx)", run: () => exportIssues("xlsx", { search: search || undefined, assigned_to: view === "mine" ? user?.id : undefined }) }];
  const header = (
    <PageHeader
      title="Inbox"
      meta={`${formatInt(openCount)} open, ${formatInt(overdue)} overdue`}
      tabs={kindToggle}
      actions={
        isExceptions
          ? canManageRules ? <Button variant="secondary" onClick={() => setRulesOpen(true)}>Manage exception rules</Button> : undefined
          : kind === "task" ? <ExportMenu options={items.length === 0 ? emptyExportOptions(exportOptions) : exportOptions} /> : undefined
      }
    />
  );

  if (kind === "issues" || kind === "sap" || kind === "approvals") {
    // These views own their data; the hooks above already ran, so returning early is safe.
    const Panel = kind === "issues" ? IssuesPanel : kind === "sap" ? SapMonitorPanel : ApprovalsPanel;
    return <ExplorerPage header={header} table={<Panel />} />;
  }

  return (
    <ExplorerPage
      header={header}
      state={state}
      emptyProps={
        isExceptions
          ? (excQ.data?.exceptions.length ?? 0) === 0
            ? {
                title: "No exceptions",
                detail: "Exceptions are raised by exception rules on new findings.",
                action: <Button variant="secondary" onClick={() => setRulesOpen(true)}>Exception rules</Button>,
              }
            : { title: "No exceptions in this view", detail: "Clear the search to see all exceptions", action: <Button variant="secondary" onClick={() => setSearch("")}>Clear search</Button> }
          : all.length === 0
          ? {
              title: "Inbox is clear",
              detail: dayOne.step?.detail ?? "Tasks arrive when findings are assigned or proposals need review.",
              action: <DayOneAction step={dayOne.step} fallbackHref="/objects" fallbackLabel="Open objects" />,
            }
          : { title: "No tasks in this view", detail: "Show all tasks to see the rest of the queue", action: <Button variant="secondary" onClick={() => showAll(true)}>Show all</Button> }
      }
      errorProps={{ message: apiErrorMessage(firstError), onRetry: refresh }}
      summary={
        <div className="flex flex-col gap-4">
          <div className="m-stat-grid @5xl:[grid-template-columns:repeat(3,minmax(0,240px))]">
            <Stat label="Overdue" value={overdue} tone={overdue > 0 ? "no-go" : undefined} loading={isExceptions ? excMetricsQ.isLoading : isLoading} href={isExceptions ? undefined : "/inbox?view=breached"} />
            {!isExceptions && <Stat label="Due today" value={counts.today} loading={isLoading} href="/inbox?view=today" />}
            {!isExceptions && !isLoading && queueTotal > all.length && <Stat label="Tasks loaded" value={all.length.toLocaleString()} hint={`of ${queueTotal.toLocaleString()}`} />}
          </div>
          {!isExceptions && canSeeTeam && <TeamPanel rungs={ownerRungs(weekQ.data)} aiAcceptance={metricsQ.data?.ai_acceptance_rate ?? null} />}
        </div>
      }
      filterBar={
        <div className="flex flex-wrap gap-3 items-end">
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
            <Input
              aria-label={isExceptions ? "Search exceptions" : "Search tasks"}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </Field>
          {!isExceptions && (view !== "all" || type !== "all") && (
            <Notice action={<Button variant="ghost" onClick={() => showAll(false)}>Show all</Button>}>
              Showing {[view !== "all" ? VIEW_BANNER[view] : null, type !== "all" ? `${labelOf(type)} tasks` : null].filter(Boolean).join(", ")} only.
            </Notice>
          )}
          {rollbackNote && <Notice tone="danger">{rollbackNote}</Notice>}
        </div>
      }
      table={
        isExceptions ? (
          <Workbench
            items={excRows}
            selectedId={selectedExc?.id ?? null}
            onSelect={(id) => setFocusedIndex(excItems.findIndex((e) => e.id === id))}
            checked={checked}
            onCheck={onCheck}
            listLabel="Exceptions"
            bulk={(ids) => (
              <>
                {canSeeTeam && user && <Button variant="secondary" disabled={busy} onClick={() => excAssign.mutate({ ids, userId: user.id })}>Assign to me</Button>}
                <Button variant="secondary" disabled={busy} onClick={() => excEscalate.mutate(ids)}>Escalate</Button>
                {canApprove && <Button variant="secondary" disabled={busy} onClick={() => setRejectIds(ids)}>Resolve with notes</Button>}
              </>
            )}
            detail={selectedExc ? (
              <ExceptionDetail
                e={selectedExc}
                now={now}
                assignee={who(selectedExc.assigned_to)}
                busy={busy}
                canResolve={canApprove}
                canAssign={canSeeTeam && !!user}
                onResolve={() => setRejectIds([selectedExc.id])}
                onEscalate={() => excEscalate.mutate([selectedExc.id])}
                onAssign={() => user && excAssign.mutate({ ids: [selectedExc.id], userId: user.id })}
              />
            ) : null}
          />
        ) : (
          <Workbench
            items={taskRows}
            selectedId={selectedTask?.id ?? null}
            onSelect={(id) => setFocusedIndex(items.findIndex((t) => t.id === id))}
            checked={checked}
            onCheck={onCheck}
            listLabel="Tasks"
            bulk={(ids) => (
              <>
                {canApprove && <Button variant="secondary" disabled={busy} onClick={() => approve.mutate(ids)}>Approve</Button>}
                {canApprove && <Button variant="secondary" disabled={busy} onClick={() => setRejectIds(ids)}>Reject with reason</Button>}
                <Button variant="secondary" disabled={busy} onClick={() => escalate.mutate(ids)}>Escalate</Button>
                {canApprove && user && <Button variant="secondary" disabled={busy} onClick={() => assign.mutate({ ids, userId: user.id })}>Assign to me</Button>}
              </>
            )}
            detail={selectedTask ? (
              <TaskDetail
                t={selectedTask}
                sla={slaOf(selectedTask, now)}
                now={now}
                assignee={who(selectedTask.assigned_to)}
                busy={busy}
                canApprove={canApprove}
                canAssign={canApprove && !!user && !selectedTask.assigned_to}
                onApprove={() => approve.mutate([selectedTask.id])}
                onReject={() => setRejectIds([selectedTask.id])}
                onEscalate={() => escalate.mutate([selectedTask.id])}
                onAssign={() => user && assign.mutate({ ids: [selectedTask.id], userId: user.id })}
              />
            ) : null}
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
                <textarea className="m-input [height:auto] [padding:6px_10px]"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
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
                  <div key={r.id} className="flex items-center justify-between gap-2 border-b py-2">
                    <div className="flex flex-col">
                      <span className="m-text-body font-medium">{r.name}</span>
                      <span className="m-text-body m-ink-3">{r.object_type}, {r.rule_type}</span>
                    </div>
                    <Button variant="secondary" onClick={() => toggleRule.mutate({ id: r.id, is_active: !r.is_active })}>
                      {r.is_active ? "Disable" : "Enable"}
                    </Button>
                  </div>
                ))}
                {excRulesQ.data && excRulesQ.data.rules.length === 0 && (
                  <span className="m-text-body m-ink-3">No exception rules yet.</span>
                )}
              </div>
              <div className="flex flex-col gap-2">
                <span className="m-text-body font-medium">New rule</span>
                <Field label="Name">
                  <Input
                    value={ruleDraft.name}
                    onChange={(e) => setRuleDraft({ ...ruleDraft, name: e.target.value })}
                  />
                </Field>
                <Field label="Rule type">
                  <Input
                    value={ruleDraft.rule_type}
                    onChange={(e) => setRuleDraft({ ...ruleDraft, rule_type: e.target.value })}
                  />
                </Field>
                <Field label="Object type">
                  <Input
                    value={ruleDraft.object_type}
                    onChange={(e) => setRuleDraft({ ...ruleDraft, object_type: e.target.value })}
                  />
                </Field>
                <Field label="Condition">
                  <Input
                    value={ruleDraft.condition}
                    onChange={(e) => setRuleDraft({ ...ruleDraft, condition: e.target.value })}
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

/** The selected task: what it is, where it stands against its SLA, the model's suggestion and the one decision. */
function TaskDetail({ t, sla, now, assignee, busy, canApprove, canAssign, onApprove, onReject, onEscalate, onAssign }: {
  t: StewardshipQueueItem; sla: Sla; now: number; assignee: string; busy: boolean; canApprove: boolean; canAssign: boolean;
  onApprove: () => void; onReject: () => void; onEscalate: () => void; onAssign: () => void;
}) {
  return (
    <Card
      title={`${labelOf(t.item_type)} in ${formatModuleName(t.domain)}`}
      meta={<Pill tone={SLA_TONE[sla.state]}>{slaText(sla)}</Pill>}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          {canApprove && <Button variant="primary" disabled={busy} onClick={onApprove}>Approve</Button>}
          {canApprove && <Button variant="secondary" disabled={busy} onClick={onReject}>Reject</Button>}
          <Button variant="ghost" disabled={busy || t.status === "escalated"} onClick={onEscalate}>Escalate</Button>
          {canAssign && <Button variant="ghost" disabled={busy} onClick={onAssign}>Assign to me</Button>}
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <dl className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(160px,1fr))]">
          <Fact label="Record"><Mono>{t.source_id}</Mono></Fact>
          <Fact label="Object">{formatModuleName(t.domain)}</Fact>
          <Fact label="Priority">{`P${t.priority}`}</Fact>
          <Fact label="Status"><Pill tone={STATUS_TONE[t.status]}>{labelOf(t.status)}</Pill></Fact>
          <Fact label="Assignee">{assignee}</Fact>
          <Fact label="Age">{span(now - Date.parse(t.created_at))}</Fact>
          <Fact label="Raised">{formatDate(t.created_at, "datetime")}</Fact>
          <Fact label="Due">{t.due_at ? formatDate(t.due_at, "datetime") : t.sla_hours ? `${t.sla_hours}h after it was raised` : "No due date"}</Fact>
        </dl>
        {t.ai_recommendation ? (
          <p className="m-text-body m-ink-2">
            Suggested decision: {labelOf(t.ai_recommendation)}
            {t.ai_confidence != null ? `, ${Math.round(t.ai_confidence * 100)}% confidence` : ""}
          </p>
        ) : null}
        <div>
          <Button variant="secondary" render={<Link href={`/objects/${t.domain}/records/${t.source_id}`} />}>Open record</Button>
        </div>
      </div>
    </Card>
  );
}

/** The selected exception: severity, SLA, what happened and the one decision. */
function ExceptionDetail({ e, now, assignee, busy, canResolve, canAssign, onResolve, onEscalate, onAssign }: {
  e: Exception; now: number; assignee: string; busy: boolean; canResolve: boolean; canAssign: boolean;
  onResolve: () => void; onEscalate: () => void; onAssign: () => void;
}) {
  const sla = excSla(e.sla_deadline, now);
  const open = e.status !== "resolved" && e.status !== "closed";
  return (
    <Card
      title={e.title}
      meta={<Pill tone={sla.tone}>{sla.text}</Pill>}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          {canResolve && open && <Button variant="primary" disabled={busy} onClick={onResolve}>Resolve</Button>}
          <Button variant="ghost" disabled={busy || e.escalation_tier > 0} onClick={onEscalate}>Escalate</Button>
          {canAssign && !e.assigned_to && <Button variant="ghost" disabled={busy} onClick={onAssign}>Assign to me</Button>}
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <dl className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(160px,1fr))]">
          <Fact label="Severity"><Status kind="severity" value={e.severity} /></Fact>
          <Fact label="Status"><Pill tone={EXC_STATUS_TONE[e.status]}>{labelOf(e.status)}</Pill></Fact>
          <Fact label="Category">{labelOf(e.category)}</Fact>
          <Fact label="Assignee">{assignee}</Fact>
          <Fact label="Raised">{relativeTime(e.created_at)}</Fact>
          {e.source_system ? <Fact label="Source">{e.source_system}</Fact> : null}
          {e.estimated_impact_zar != null ? <Fact label="Estimated impact">{`${e.estimated_impact_zar.toLocaleString()} ZAR`}</Fact> : null}
        </dl>
        {e.description ? <p className="m-text-body m-ink-2">{e.description}</p> : null}
      </div>
    </Card>
  );
}

/**
 * Replaces the legacy OwnerLadder (not in @/design) with a plain table. Its counts come from the triage
 * metrics, which span every queue (record issues as well as stewardship tasks), so the heading says so
 * rather than reading as a breakdown of the inbox list.
 */
function TeamPanel({ rungs, aiAcceptance }: { rungs: ReturnType<typeof ownerRungs>; aiAcceptance: number | null }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 m-text-body">
      <span className="font-medium">Who holds the work across all queues</span>
      {rungs.length ? (
        rungs.map((r) => (
          <span key={r.label} className="inline-flex items-baseline gap-3">
            <span>{r.label}</span>
            <span className="m-ink-2">{formatInt(r.open)} open across all queues</span>
            <span className="m-ink-2">{formatInt(r.breached)} breached</span>
          </span>
        ))
      ) : (
        <span className="m-ink-3">Nobody holds open work</span>
      )}
      {aiAcceptance != null && (
        <span className="m-ink-3">Suggestion acceptance {Math.round(aiAcceptance * 100)}%</span>
      )}
    </div>
  );
}
