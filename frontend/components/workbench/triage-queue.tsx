"use client";

/**
 * Workbench → My queue: open issues and steward tasks routed by triage, split
 * into overdue, due today and later, ranked by impact. Bulk actions go through
 * /triage/bulk (needs `assign`); one call per item kind.
 */

import { useCallback, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import {
  Banner, Button, Chip, DataTable, Drawer, EmptyState, Field, Input, Select, Stack, Text, Textarea,
  type AuroraColumnMeta, type ChipTone,
} from "@/components/aurora";
import { useAuth } from "@/context/auth-context";
import { useRole } from "@/hooks/use-role";
import { StatusBadge, Tally, type Status } from "@/components/ui-core";
import { useUrlState } from "@/hooks/use-url-state";
import type { SlaState } from "@/lib/api/issues";
import { bulkTriage, getTeams, getTriageQueue, type BulkAction, type TriageBulkInput, type TriageQueueItem } from "@/lib/api/triage";
import { getAssignableUsers } from "@/lib/api/users";
import { formatModuleName, formatDate } from "@/lib/format";

const meta = (m: AuroraColumnMeta) => m;
const BUCKETS = [
  { key: "overdue", title: "Overdue" },
  { key: "due_today", title: "Due today" },
  { key: "later", title: "Later" },
] as const;
const SLA_TONE: Record<SlaState, ChipTone> = { on_track: "success", at_risk: "warning", breached: "danger" };
const SLA_LABEL: Record<SlaState, string> = { on_track: "On track", at_risk: "At risk", breached: "Breached" };
const PRIORITIES = [1, 2, 3, 4, 5] as const;
type Payload = Omit<TriageBulkInput, "kind" | "ids">;

const keyOf = (t: TriageQueueItem) => `${t.kind}:${t.id}`;
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
const label = (s: string) => s.replace(/_/g, " ");
const when = (iso: string) => formatDate(iso, "datetime");

export function TriageQueueSurface() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { can } = useRole();
  const canAct = can("assign");
  const [assignee, setAssignee] = useUrlState("assignee", "me");
  const [snoozed, setSnoozed] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [snoozeOpen, setSnoozeOpen] = useState(false);

  const queueQ = useQuery({
    queryKey: ["triage.queue", { assignee, snoozed }],
    queryFn: () => getTriageQueue({ assignee, include_snoozed: snoozed, limit: 500 }),
    refetchInterval: 60_000,
  });
  const teamsQ = useQuery({ queryKey: ["triage.teams"], queryFn: getTeams });
  const usersQ = useQuery({ queryKey: ["users.assignable"], queryFn: getAssignableUsers, enabled: canAct });

  const names = useMemo(() => new Map((usersQ.data ?? []).map((u) => [u.id, u.name || u.email])), [usersQ.data]);
  const teamNames = useMemo(() => new Map((teamsQ.data ?? []).map((t) => [t.id, t.name])), [teamsQ.data]);
  const who = useCallback((t: TriageQueueItem) => {
    if (t.assigned_to) return t.assigned_to === user?.id ? "You" : names.get(t.assigned_to) ?? t.assigned_to.slice(0, 8);
    return t.assigned_team_id ? teamNames.get(t.assigned_team_id) ?? "Team" : "Unassigned";
  }, [names, teamNames, user?.id]);

  const all = useMemo(() => (queueQ.data ? BUCKETS.flatMap((b) => queueQ.data[b.key].items) : []), [queueQ.data]);
  const selected = useMemo(() => all.filter((t) => picked.has(keyOf(t))), [all, picked]);

  const bulk = useMutation({
    // bulkTriage takes one kind per call, so split the selection by kind.
    mutationFn: async (p: Payload) => {
      const byKind = (["issue", "queue"] as const)
        .map((kind) => ({ kind, ids: selected.filter((t) => t.kind === kind).map((t) => t.id) }))
        .filter((g) => g.ids.length);
      const res = await Promise.all(byKind.map((g) => bulkTriage({ ...p, ...g })));
      return res.reduce((n, r) => n + r.updated, 0);
    },
    onSuccess: (n, p) => {
      toast.success(`${label(p.action)}: ${plural(n, "item")} updated`);
      setPicked(new Set());
      setSnoozeOpen(false);
      void qc.invalidateQueries({ queryKey: ["triage.queue"] });
      void qc.invalidateQueries({ queryKey: ["triage.metrics"] });
    },
    onError: (e) => toast.error((e as Error).message || "Not updated"),
  });
  const run = (action: BulkAction, extra: Omit<Payload, "action"> = {}) => bulk.mutate({ action, ...extra });

  const toggle = useCallback((keys: string[], on: boolean) => {
    setPicked((p) => {
      const n = new Set(p);
      keys.forEach((k) => (on ? n.add(k) : n.delete(k)));
      return n;
    });
  }, []);

  const columns = useCallback((rows: TriageQueueItem[], title: string): ColumnDef<TriageQueueItem, unknown>[] => {
    const keys = rows.map(keyOf);
    const allOn = keys.length > 0 && keys.every((k) => picked.has(k));
    const cols: ColumnDef<TriageQueueItem, unknown>[] = [
      { id: "severity", header: "Severity", meta: meta({ width: 96 }), cell: ({ row }) => <StatusBadge status={row.original.severity as Status}>{row.original.severity}</StatusBadge> },
      { id: "module", header: "Module", cell: ({ row }) => (row.original.module ? formatModuleName(row.original.module) : row.original.kind === "queue" ? "Steward task" : "—") },
      { id: "check", header: "Check", cell: ({ row }) => <span className="aurora-number">{row.original.check_id ?? "—"}</span> },
      { id: "ref", header: "Ref", cell: ({ row }) => <span className="aurora-number">{row.original.ref ?? row.original.id.slice(0, 8)}</span> },
      { id: "sla", header: "SLA", meta: meta({ width: 180 }), cell: ({ row }) => {
        const t = row.original;
        const state = t.sla_paused_at ? "Paused" : t.snoozed_until ? `Snoozed to ${when(t.snoozed_until)}` : null;
        return (
          <span>
            {t.sla_state ? <Chip tone={SLA_TONE[t.sla_state]}>{SLA_LABEL[t.sla_state]}</Chip> : <Text as="span" variant="text-small" tone="muted">No SLA</Text>}
            <Text variant="text-micro" tone="muted" as="div">{state ?? (t.due_at ? `Due ${when(t.due_at)}` : "No due time")}</Text>
          </span>
        );
      } },
      { id: "rank", header: "Impact rank", meta: meta({ width: 110, align: "end", numeric: true }), cell: ({ row }) => <span title={`Impact ${row.original.impact}, urgency ${row.original.urgency}`}>{row.original.rank_score}</span> },
      { id: "priority", header: "Priority", meta: meta({ width: 80 }), cell: ({ row }) => (row.original.priority ? `P${row.original.priority}` : "—") },
      { id: "status", header: "Status", meta: meta({ width: 130 }), cell: ({ row }) => label(row.original.status) },
      { id: "owner", header: "Assignee", meta: meta({ width: 140 }), cell: ({ row }) => who(row.original) },
    ];
    return canAct ? [{
      id: "pick", meta: meta({ sticky: "start", width: 44 }),
      header: () => <input type="checkbox" aria-label={`Select all ${title.toLowerCase()}`} checked={allOn} onChange={(e) => toggle(keys, e.target.checked)} />,
      cell: ({ row }) => <input type="checkbox" aria-label={`Select ${row.original.ref ?? row.original.id.slice(0, 8)}`} checked={picked.has(keyOf(row.original))} onChange={(e) => toggle([keyOf(row.original)], e.target.checked)} />,
    }, ...cols] : cols;
  }, [picked, canAct, toggle, who]);

  const assigneeOptions = [
    { value: "me", label: "Assigned to me" }, { value: "unassigned", label: "Unassigned" }, { value: "all", label: "Everyone" },
    ...(teamsQ.data ?? []).map((t) => ({ value: `team:${t.id}`, label: `Team: ${t.name}` })),
  ];
  const q = queueQ.data;

  return (
    <Stack gap={5} className="aurora-page">
      <Tally level={2} label="My queue" figures={[
        { label: "Overdue", value: q?.overdue.count ?? null, loading: !q, tone: q?.overdue.count ? "danger" : undefined, verdict: q?.overdue.count ? "Past their due time." : "Nothing past due.", href: "#triage-overdue" },
        { label: "Due today", value: q?.due_today.count ?? null, loading: !q, tone: q?.due_today.count ? "warning" : undefined, verdict: q?.due_today.count ? "Due before midnight." : "Nothing due today.", href: "#triage-due_today" },
        { label: "Later", value: q?.later.count ?? null, loading: !q, verdict: q?.later.count ? "Not due yet." : "Nothing scheduled later.", href: "#triage-later" },
      ]} />

      <Stack direction="row" gap={3} wrap align="center" className="aurora-filters">
        <Field label="Queue">{({ controlId }) => <Select id={controlId} options={assigneeOptions} value={assignee} onValueChange={(v) => { setAssignee(v); setPicked(new Set()); }} />}</Field>
        <Chip selected={snoozed} onClick={() => setSnoozed((s) => !s)}>Include snoozed</Chip>
      </Stack>

      {canAct && selected.length ? (
        <BulkBar count={selected.length} busy={bulk.isPending} users={usersQ.data ?? []} teams={teamsQ.data ?? []} me={user?.id}
          onRun={run} onSnooze={() => setSnoozeOpen(true)} onClear={() => setPicked(new Set())} />
      ) : null}

      {queueQ.isLoading ? <Text tone="muted">Reading the queue.</Text>
        : queueQ.error ? <Banner tone="danger" title="The queue could not be read">{(queueQ.error as Error).message}</Banner>
        : q && !all.length ? <EmptyState title="Nothing in this queue." body="Issues and steward tasks land here when triage routes them to you or your team." />
        : q ? BUCKETS.map((b) => (
          <section key={b.key} aria-labelledby={`triage-${b.key}`}>
            <Text as="h2" id={`triage-${b.key}`} variant="text-lead" className="aurora-runs__h">
              {b.title} <span className="aurora-number">{q[b.key].count}</span>
            </Text>
            {q[b.key].items.length ? (
              <>
                {q[b.key].count > q[b.key].items.length ? <Text variant="text-micro" tone="muted">Showing the top {q[b.key].items.length} by impact rank.</Text> : null}
                <DataTable columns={columns(q[b.key].items, b.title)} data={q[b.key].items} getRowId={keyOf} ariaLabel={b.title} maxHeight="50vh" />
              </>
            ) : <Text variant="text-small" tone="muted">None.</Text>}
          </section>
        )) : null}

      <Drawer open={snoozeOpen} onClose={() => setSnoozeOpen(false)} ariaLabel="Snooze" header={<Text variant="text-lead">Snooze {plural(selected.length, "item")}</Text>}>
        {snoozeOpen ? <SnoozeForm pending={bulk.isPending} onCancel={() => setSnoozeOpen(false)} onSubmit={(reason, until) => run("snooze", { reason, until })} /> : null}
      </Drawer>
    </Stack>
  );
}

function BulkBar({ count, busy, users, teams, me, onRun, onSnooze, onClear }: {
  count: number; busy: boolean; users: { id: string; name: string; email: string }[]; teams: { id: string; name: string }[]; me?: string;
  onRun: (action: BulkAction, extra?: Omit<Payload, "action">) => void; onSnooze: () => void; onClear: () => void;
}) {
  const [to, setTo] = useState("");
  const [priority, setPriority] = useState("");
  const [waiting, setWaiting] = useState<"waiting_sap" | "waiting_requester">("waiting_sap");
  const targets = [
    { value: "", label: "Assign to…" },
    ...(me ? [{ value: `user:${me}`, label: "Me" }] : []),
    ...users.filter((u) => u.id !== me).map((u) => ({ value: `user:${u.id}`, label: u.name || u.email })),
    ...teams.map((t) => ({ value: `team:${t.id}`, label: `Team: ${t.name}` })),
  ];
  const target = (): Omit<Payload, "action"> => (to.startsWith("team:") ? { team_id: to.slice(5) } : { user_id: to.slice(5) });
  return (
    <Stack direction="row" gap={2} wrap align="center" role="toolbar" aria-label="Bulk actions">
      <Text variant="text-small">{plural(count, "item")} selected</Text>
      <Button size="sm" disabled={busy} onClick={() => onRun("acknowledge")}>Acknowledge</Button>
      <Select aria-label="Assign to" options={targets} value={to} onValueChange={setTo} />
      <Button size="sm" variant="secondary" disabled={busy || !to} onClick={() => onRun("assign", target())} title="Only items with no assignee">Assign</Button>
      <Button size="sm" variant="secondary" disabled={busy || !to} onClick={() => onRun("reassign", target())}>Reassign</Button>
      <Select aria-label="Priority" options={[{ value: "", label: "Priority…" }, ...PRIORITIES.map((p) => ({ value: String(p), label: `P${p}` }))]} value={priority} onValueChange={setPriority} />
      <Button size="sm" variant="secondary" disabled={busy || !priority} onClick={() => onRun("priority", { priority: Number(priority) as Payload["priority"] })}>Set priority</Button>
      <Select aria-label="Wait on" options={[{ value: "waiting_sap", label: "Waiting on SAP" }, { value: "waiting_requester", label: "Waiting on requester" }]}
        value={waiting} onValueChange={(v) => setWaiting(v === "waiting_requester" ? v : "waiting_sap")} />
      <Button size="sm" variant="secondary" disabled={busy} onClick={() => onRun("wait", { waiting })}>Wait</Button>
      <Button size="sm" variant="secondary" disabled={busy} onClick={() => onRun("resume")}>Resume</Button>
      <Button size="sm" variant="secondary" disabled={busy} onClick={onSnooze}>Snooze</Button>
      <Button size="sm" variant="secondary" disabled={busy} onClick={() => onRun("unsnooze")}>Unsnooze</Button>
      <Button size="sm" variant="ghost" onClick={onClear}>Clear</Button>
    </Stack>
  );
}

function SnoozeForm({ pending, onSubmit, onCancel }: { pending: boolean; onSubmit: (reason: string, until: string) => void; onCancel: () => void }) {
  const [reason, setReason] = useState("");
  const [until, setUntil] = useState("");
  return (
    <Stack gap={3}>
      <Field label="Reason" required>{({ controlId }) => <Textarea id={controlId} value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />}</Field>
      <Field label="Until" required helper="Local time, in the future. The item returns to the queue then.">
        {({ controlId }) => <Input id={controlId} type="datetime-local" value={until} onChange={(e) => setUntil(e.target.value)} />}
      </Field>
      <Stack direction="row" gap={2}>
        {/* datetime-local is zone-less; toISOString gives the tz-aware value the API needs. */}
        <Button disabled={pending || !reason.trim() || !until} onClick={() => onSubmit(reason.trim(), new Date(until).toISOString())}>{pending ? "Snoozing…" : "Snooze"}</Button>
        <Button variant="ghost" onClick={onCancel}>Keep in queue</Button>
      </Stack>
    </Stack>
  );
}
