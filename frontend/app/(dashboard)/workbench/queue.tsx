"use client";

/**
 * Workbench, My queue: open stewardship tasks with a detail pane beside the
 * register. Keyboard: A approve, R reject with a reason, E escalate, N next.
 * TaskDetail and useTaskActions are shared with the team workload page.
 */

import { useEffect, useId, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import {
  Banner, Button, Chip, DataTable, EmptyState, Input, KeyValue, Metric, MetricStrip, Mono, PageHeader,
  SectionCard, StatusBadge, TableSkeleton, type AuroraColumnMeta, type Status,
} from "@/components/ui-core";
import { useRole } from "@/hooks/use-role";
import { useAuth } from "@/context/auth-context";
import { bulkApprove, escalateItem, getMetrics, getQueueItems, resolveItem, submitAiFeedback } from "@/lib/api/stewardship";
import { relativeTime } from "@/lib/format";
import type { StewardshipQueueItem } from "@/types/api";

const meta = (m: AuroraColumnMeta) => m;
const pct = (r: number | null | undefined) => (r == null ? null : Math.round(r * 100));

export function prioritySeverity(p: number): Status {
  return p === 1 ? "critical" : p === 2 ? "high" : p === 3 ? "medium" : "low";
}
export function slaLabel(t: StewardshipQueueItem): string {
  if (!t.sla_hours) return "—";
  return t.sla_hours < 24 ? `${t.sla_hours}h` : `${Math.round(t.sla_hours / 24)}d`;
}
const TYPE_LABEL: Record<string, string> = {
  merge_decision: "Merge",
  golden_record_review: "Golden review",
  exception: "Exception",
  writeback_approval: "Writeback",
  contract_breach: "Contract",
  glossary_review: "Glossary",
};
export const typeLabel = (t: string) => TYPE_LABEL[t] ?? t.charAt(0).toUpperCase() + t.slice(1).replace(/_/g, " ");

/** Approve, reject with a reason, escalate. A rejection also feeds the
 * reason to the rule engine, so the same mistake is not proposed again. */
export function useTaskActions(onDone?: () => void) {
  const qc = useQueryClient();
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["stewardship.queue"] });
    qc.invalidateQueries({ queryKey: ["stewardship.metrics"] });
    onDone?.();
  };
  const fail = (e: unknown) => toast.error((e as Error).message || "The task did not change");
  const approve = useMutation({
    mutationFn: (id: string) => resolveItem(id, "approve"),
    onSuccess: () => { toast.success("Task approved"); refresh(); },
    onError: fail,
  });
  const reject = useMutation({
    mutationFn: async ({ item, reason }: { item: StewardshipQueueItem; reason: string }) => {
      await resolveItem(item.id, "reject", reason);
      await submitAiFeedback({ queue_item_id: item.id, steward_decision: "reject", correction_reason: reason, domain: item.domain });
    },
    onSuccess: () => { toast.success("Task rejected. The reason goes to the rule engine."); refresh(); },
    onError: fail,
  });
  const escalate = useMutation({
    mutationFn: (id: string) => escalateItem(id),
    onSuccess: () => { toast.success("Task escalated"); refresh(); },
    onError: fail,
  });
  return { approve, reject, escalate, busy: approve.isPending || reject.isPending || escalate.isPending };
}

/** A/R/E/N on the current task. Ignored while typing. */
export function useTaskKeys(task: StewardshipQueueItem | null, canApprove: boolean, h: {
  approve: () => void; reject: () => void; escalate: () => void; next: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (!task || e.metaKey || e.ctrlKey || e.altKey || t?.closest("input,textarea,select,[contenteditable=true]")) return;
      const k = e.key.toLowerCase();
      if (k === "a" && canApprove) h.approve();
      else if (k === "r" && canApprove) h.reject();
      else if (k === "e") h.escalate();
      else if (k === "n") h.next();
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [task, canApprove, h]);
}

export function TaskDetail({ task, assignee, canApprove, busy, rejecting, setRejecting, onApprove, onReject, onEscalate }: {
  task: StewardshipQueueItem;
  assignee?: string;
  canApprove: boolean;
  busy: boolean;
  rejecting: boolean;
  setRejecting: (v: boolean) => void;
  onApprove: () => void;
  onReject: (reason: string) => void;
  onEscalate: () => void;
}) {
  const [reason, setReason] = useState("");
  const id = useId();
  const conf = pct(task.ai_confidence);
  return (
    <div className="ui-detail">
      {task.ai_recommendation ? (
        <div className="ui-notice">
          <span>
            Suggested{conf != null ? ` with ${conf}% confidence` : ""}: {task.ai_recommendation}
          </span>
          {canApprove ? <Button size="sm" variant="ghost" onClick={onApprove} disabled={busy}>Apply suggestion</Button> : null}
        </div>
      ) : null}
      <KeyValue rows={[
        { k: "Type", v: typeLabel(task.item_type) },
        { k: "Source", v: task.source_id, mono: true },
        { k: "Domain", v: task.domain },
        { k: "Priority", v: <StatusBadge status={prioritySeverity(task.priority)}>P{task.priority}</StatusBadge> },
        { k: "Assignee", v: assignee ?? (task.assigned_to ? "Another steward" : "Unassigned") },
        { k: "SLA", v: slaLabel(task) },
        { k: "Due", v: task.due_at ? relativeTime(task.due_at) : "—" },
        { k: "Opened", v: relativeTime(task.created_at) },
        { k: "Task ID", v: task.id, mono: true },
      ]} />
      {rejecting ? (
        <form className="ui-reason" onSubmit={(e) => { e.preventDefault(); if (reason.trim()) { onReject(reason.trim()); setReason(""); } }}>
          <label htmlFor={id} className="ui-reason__label">Why is the suggestion wrong? The rule engine learns from this.</label>
          <Input id={id} autoFocus required maxLength={2000} value={reason} onChange={(e) => setReason(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape") setRejecting(false); }} />
          <Button size="sm" type="submit" disabled={!reason.trim() || busy}>Reject</Button>
          <Button size="sm" variant="ghost" type="button" onClick={() => setRejecting(false)}>Keep as is</Button>
        </form>
      ) : (
        <div className="ui-page-header__actions">
          {canApprove ? <Button onClick={onApprove} disabled={busy}>Approve</Button> : null}
          {canApprove ? <Button variant="ghost" onClick={() => setRejecting(true)} disabled={busy}>Reject</Button> : null}
          <Button variant="ghost" onClick={onEscalate} disabled={busy}>Escalate</Button>
        </div>
      )}
      <p className="ui-micro">
        Keys: <kbd className="ui-kbd">A</kbd> approve, <kbd className="ui-kbd">R</kbd> reject, <kbd className="ui-kbd">E</kbd> escalate, <kbd className="ui-kbd">N</kbd> next task.
      </p>
    </div>
  );
}

const SORTS = [["sla", "SLA"], ["priority", "Priority"], ["age", "Oldest"]] as const;
type Sort = (typeof SORTS)[number][0];

export function MyQueuePage() {
  // Approve, reject and bulk approve need `approve` (api/routes/stewardship.py).
  const canApprove = useRole().can("approve");
  const me = useAuth().user?.id;
  // Reference time for SLA maths, fixed per mount (Date.now() is impure in render).
  const [now] = useState(() => Date.now());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [sort, setSort] = useState<Sort>("sla");
  const [confirmBulk, setConfirmBulk] = useState(false);
  const [rejecting, setRejecting] = useState(false);

  const queueQ = useQuery({ queryKey: ["stewardship.queue", { status: "open", limit: 200 }], queryFn: () => getQueueItems({ status: "open", limit: 200 }) });
  const metricsQ = useQuery({ queryKey: ["stewardship.metrics"], queryFn: getMetrics });
  const actions = useTaskActions(() => setRejecting(false));
  const qc = useQueryClient();
  const bulk = useMutation({
    mutationFn: (ids: string[]) => bulkApprove(ids, 0.85),
    onSuccess: (d) => {
      toast.success(`Approved ${d.approved} task${d.approved === 1 ? "" : "s"}`);
      setConfirmBulk(false);
      qc.invalidateQueries({ queryKey: ["stewardship.queue"] });
    },
    onError: (e) => toast.error((e as Error).message || "Bulk approval did not run"),
  });

  const items = useMemo(() => {
    const arr = [...(queueQ.data?.items ?? [])];
    if (sort === "sla") arr.sort((a, b) => (a.sla_hours ?? Infinity) - (b.sla_hours ?? Infinity));
    else if (sort === "priority") arr.sort((a, b) => a.priority - b.priority);
    else arr.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    return arr;
  }, [queueQ.data, sort]);
  const selected = items.find((t) => t.id === activeId) ?? items[0] ?? null;

  const keys = useMemo(() => ({
    approve: () => selected && actions.approve.mutate(selected.id),
    reject: () => setRejecting(true),
    escalate: () => selected && actions.escalate.mutate(selected.id),
    next: () => {
      if (!selected) return;
      const next = items[(items.indexOf(selected) + 1) % items.length];
      setRejecting(false);
      setActiveId(next.id);
    },
  }), [selected, items, actions.approve, actions.escalate]);
  useTaskKeys(confirmBulk ? null : selected, canApprove, keys);

  const columns = useMemo<ColumnDef<StewardshipQueueItem, unknown>[]>(() => [
    { id: "priority", header: "Priority", meta: meta({ sticky: "start", width: 104 }), cell: ({ row }) => (
      <StatusBadge status={prioritySeverity(row.original.priority)}>P{row.original.priority}</StatusBadge>) },
    { id: "task", header: "Task", meta: meta({ minWidth: 220 }), cell: ({ row }) => (
      <span>{typeLabel(row.original.item_type)} <Mono>{row.original.source_id}</Mono></span>) },
    { id: "domain", header: "Domain", meta: meta({ width: 130 }), cell: ({ row }) => row.original.domain },
    { id: "sla", header: "SLA", meta: meta({ width: 72, align: "end", numeric: true }), cell: ({ row }) => slaLabel(row.original) },
    { id: "age", header: "Opened", meta: meta({ width: 110, align: "end" }), cell: ({ row }) => relativeTime(row.original.created_at) },
  ], []);

  const m = metricsQ.data;
  const assigned = items.filter((t) => t.assigned_to).length;
  const atRisk = items.filter((t) => t.sla_hours !== null && t.due_at && new Date(t.due_at).getTime() - now < t.sla_hours * 0.5 * 3600_000).length;
  const bulkCount = Math.min(items.length, 25);

  return (
    <div className="ui-page">
      <PageHeader title="My queue"
        summary={queueQ.data ? `${items.length} open task${items.length === 1 ? "" : "s"}. ${atRisk} at risk of missing the SLA.` : undefined}
        actions={canApprove ? <Button onClick={() => setConfirmBulk(true)} disabled={!items.length || bulk.isPending || confirmBulk}>Approve confident tasks</Button> : null} />
      <MetricStrip label="Queue health">
        <Metric label="Assigned" value={queueQ.data ? assigned : null} />
        <Metric label="Unassigned" value={queueQ.data ? items.length - assigned : null} tone={items.length - assigned ? "warning" : "default"} />
        <Metric label="Backlog" value={m?.backlog_total ?? null} />
        <Metric label="SLA compliance" value={pct(m?.sla_compliance_rate)} unit="%" tone={m && m.sla_compliance_rate < 0.95 ? "warning" : "default"} />
        <Metric label="Suggestions accepted" value={pct(m?.ai_acceptance_rate)} unit="%" />
      </MetricStrip>
      {confirmBulk ? (
        <Banner tone="info" title={`Approve up to ${bulkCount} task${bulkCount === 1 ? "" : "s"}?`} action={
          <div className="ui-page-header__actions">
            <Button size="sm" onClick={() => bulk.mutate(items.slice(0, 25).map((t) => t.id))} disabled={bulk.isPending}>{bulk.isPending ? "Approving" : "Approve tasks"}</Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirmBulk(false)}>Not now</Button>
          </div>}>
          The top {bulkCount} in the current order are approved when the suggestion confidence is 85% or higher. The rest stay here for review.
        </Banner>
      ) : null}
      {queueQ.isLoading ? <TableSkeleton rows={8} label="Loading your queue" />
        : queueQ.error ? <Banner tone="danger" title="Your queue could not be read">{(queueQ.error as Error).message}</Banner>
        : !items.length ? <EmptyState>Your queue is empty. New tasks arrive as rules and matches need a decision.</EmptyState>
        : (
          <div className="ui-split">
            <div className="ui-stack" style={{ gap: "var(--aurora-space-3)" }}>
              <div className="ui-filterbar__chips" role="group" aria-label="Sort by">
                {SORTS.map(([k, l]) => <Chip key={k} selected={sort === k} onClick={() => setSort(k)}>{l}</Chip>)}
              </div>
              <DataTable columns={columns} data={items} getRowId={(t) => t.id}
                onRowActivate={(t) => { setRejecting(false); setActiveId(t.id); }}
                ariaLabel="My queue. Use j and k to move, Enter to open." maxHeight="62vh" />
            </div>
            {selected ? (
              <div className="ui-split__pane">
                <SectionCard title={typeLabel(selected.item_type)} meta={<Mono>{selected.source_id}</Mono>}>
                  <TaskDetail task={selected} assignee={selected.assigned_to && selected.assigned_to === me ? "You" : undefined} canApprove={canApprove} busy={actions.busy}
                    rejecting={rejecting} setRejecting={setRejecting}
                    onApprove={keys.approve} onEscalate={keys.escalate}
                    onReject={(reason) => actions.reject.mutate({ item: selected, reason })} />
                </SectionCard>
              </div>
            ) : null}
          </div>
        )}
    </div>
  );
}
