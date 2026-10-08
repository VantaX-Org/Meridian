"use client";

/**
 * Steward inbox: every open stewardship task in one list. Ports
 * components/workbench/inbox.tsx's data wiring (views, sorts, assign,
 * resolve, escalate, bulk approve, AI feedback) onto @/design. Replaces the
 * legacy A/R/E/N/X/. keymap with j/k row focus + enter to open the fix sheet
 * (spec 6.2); the actions themselves move to buttons so nothing is dropped.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Button, DataTable, Drawer, ExplorerPage, Field, Pill, Select, Stat, toastManager, type PillTone } from "@/design";
import { useAuth } from "@/context/auth-context";
import { useRole } from "@/hooks/use-role";
import { useUrlState } from "@/hooks/use-url-state";
import { assignItem, bulkApprove, escalateItem, getMetrics, getQueueItems, resolveItem, submitAiFeedback } from "@/lib/api/stewardship";
import { getTriageMetrics, ownerRungs } from "@/lib/api/triage";
import { getUsers } from "@/lib/api/users";
import { formatModuleName, labelOf } from "@/lib/format";
import { inboxKeyHandler } from "@/lib/inbox-keys";
import { queryKeys } from "@/lib/query-keys";
import type { StewardshipQueueItem, StewardshipStatus } from "@/types/api";

const HOUR = 3_600_000;
// Every status still waiting on a steward; the list endpoint filters one status at a time.
const LIVE: StewardshipStatus[] = ["open", "in_progress", "escalated"];
const STATUS_TONE: Record<StewardshipStatus, PillTone> = { open: "neutral", in_progress: "at-risk", escalated: "no-go", resolved: "go" };
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
  // Backend guards (api/routes/stewardship.py): resolve, assign and bulk approve need `approve`; escalate needs `view`.
  const canApprove = can("approve");
  const canSeeTeam = can("assign");
  const [view, setView] = useUrlState("view", "all");
  const [type, setType] = useUrlState("type", "all");
  const [search, setSearch] = useState("");
  const [rawFocusedIndex, setFocusedIndex] = useState(0);
  const [rejectIds, setRejectIds] = useState<string[] | null>(null);
  const [reason, setReason] = useState("");

  const queues = useQueries({
    queries: LIVE.map((status) => ({
      queryKey: queryKeys.inbox({ status, limit: 200 }),
      queryFn: () => getQueueItems({ status, limit: 200 }),
      refetchInterval: 60_000,
    })),
  });
  const weekQ = useQuery({ queryKey: ["triage.metrics", 8], queryFn: () => getTriageMetrics(8), refetchInterval: 60_000 });
  const metricsQ = useQuery({ queryKey: ["stewardship.metrics"], queryFn: getMetrics, refetchInterval: 60_000 });
  // The user list needs `manage_users`; without it assignees show as "You" or an id prefix.
  const usersQ = useQuery({ queryKey: ["users.list"], queryFn: getUsers, enabled: can("manage_users") });

  const isLoading = queues.some((q) => q.isLoading);
  const isError = queues.some((q) => q.isError);
  // SLA maths runs against the last fetch time, so it stays pure and refreshes with the data.
  const now = Math.max(0, ...queues.map((q) => q.dataUpdatedAt));
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

  // Clamped at read time (not in an effect) so a shrinking list never points past its last row.
  const focusedIndex = Math.min(rawFocusedIndex, Math.max(items.length - 1, 0));

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
    void qc.invalidateQueries({ queryKey: ["stewardship.metrics"] });
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
  const busy = approve.isPending || reject.isPending || escalate.isPending || assign.isPending;

  const openRecord = useCallback((index: number) => {
    const t = items[index];
    if (t) router.push(`/objects/${t.domain}/records/${t.source_id}`);
  }, [items, router]);

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const el = ev.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)) return;
      inboxKeyHandler(ev, { focusedIndex, rowCount: items.length, setFocus: setFocusedIndex, onOpen: openRecord });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focusedIndex, items.length, openRecord]);

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

  const state: "loading" | "empty" | "error" | undefined = isLoading ? "loading" : isError ? "error" : items.length === 0 ? "empty" : undefined;

  return (
    <ExplorerPage
      state={state}
      emptyProps={{ title: all.length ? "No tasks in this view." : "Inbox zero." }}
      errorProps={{ message: "The inbox could not be read.", onRetry: refresh }}
      summary={
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-6">
            <Stat label="Open" value={isLoading ? "…" : all.length} />
            <Stat label="Overdue" value={isLoading ? "…" : counts.breached} />
            <Stat label="Due today" value={isLoading ? "…" : counts.today} />
            <Stat label="Unassigned" value={isLoading ? "…" : counts.unassigned} />
            <Stat label="Resolved this week" value={weekQ.isLoading ? "…" : weekQ.data?.weekly.at(-1)?.resolved ?? "—"} />
          </div>
          {canSeeTeam && <TeamPanel rungs={ownerRungs(weekQ.data)} aiAcceptance={metricsQ.data?.ai_acceptance_rate ?? null} />}
        </div>
      }
      filterBar={
        <div className="flex flex-wrap gap-3 items-end">
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
          <Field label="Type">
            <Select value={type === "all" ? "" : type} onValueChange={(v) => setType(v || "all")} options={typeOptions} placeholder="All types" />
          </Field>
          <Field label="Search">
            <input
              aria-label="Search tasks"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="rounded border px-3 py-1.5 text-[13px]"
              style={{ borderColor: "var(--m-line)", background: "var(--m-sheet)", color: "var(--m-ink)" }}
            />
          </Field>
        </div>
      }
      table={
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
      }
      drawer={
        <Drawer open={rejectIds !== null} onOpenChange={(open) => !open && setRejectIds(null)} title="Reject with reason">
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
              <Button variant="ghost" onClick={() => setRejectIds(null)}>Keep task open</Button>
              <Button
                variant="primary"
                disabled={!reason.trim() || reject.isPending}
                onClick={() => rejectIds && reject.mutate({ ids: rejectIds, reason })}
              >
                Reject
              </Button>
            </div>
          </div>
        </Drawer>
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
