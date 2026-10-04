"use client";

/**
 * Workbench, Team workload: who holds which open tasks, how fast each
 * steward resolves, and the whole team queue. A task opens in the drawer
 * with the same actions and keys as My queue.
 */

import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import {
  Banner, DataTable, DetailDrawer, EmptyState, FilterBar, Metric, MetricStrip, Mono, PageHeader, SectionCard,
  StatusBadge, TableSkeleton, useDrawerParam, type AuroraColumnMeta,
} from "@/components/ui-core";
import { prioritySeverity, slaLabel, TaskDetail, typeLabel, useTaskActions, useTaskKeys } from "@/app/(dashboard)/workbench/queue";
import { useRole } from "@/hooks/use-role";
import { getMetrics, getQueueItems } from "@/lib/api/stewardship";
import { getUsers } from "@/lib/api/users";
import { relativeTime } from "@/lib/format";
import type { StewardshipQueueItem } from "@/types/api";

const STEWARD_ROLES = new Set(["steward", "admin", "approver", "ai_reviewer"]);
const meta = (m: AuroraColumnMeta) => m;
const pct = (r: number | null | undefined) => (r == null ? null : Math.round(r * 100));

export function TeamWorkloadSurface() {
  const canApprove = useRole().can("approve");
  // Reference time for SLA maths, fixed per mount (Date.now() is impure in render).
  const [now] = useState(() => Date.now());
  const [search, setSearch] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const drawer = useDrawerParam("task");

  const queueQ = useQuery({ queryKey: ["stewardship.queue", { status: "open", limit: 200 }], queryFn: () => getQueueItems({ status: "open", limit: 200 }) });
  const metricsQ = useQuery({ queryKey: ["stewardship.metrics"], queryFn: getMetrics });
  const usersQ = useQuery({ queryKey: ["users.list"], queryFn: getUsers });
  const actions = useTaskActions(() => setRejecting(false));

  const items = useMemo(() => queueQ.data?.items ?? [], [queueQ.data]);
  const users = useMemo(() => usersQ.data?.users ?? [], [usersQ.data]);
  const nameOf = useMemo(() => new Map(users.map((u) => [u.id, u.name])), [users]);
  const stewards = users.filter((u) => u.is_active && STEWARD_ROLES.has(u.role));
  const load = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of items) if (t.assigned_to) m.set(t.assigned_to, (m.get(t.assigned_to) ?? 0) + 1);
    return m;
  }, [items]);
  const stats = new Map((metricsQ.data?.steward_breakdown ?? []).map((s) => [s.steward_name, s]));

  const needle = search.trim().toLowerCase();
  const visible = needle
    ? items.filter((t) => `${t.item_type} ${t.source_id} ${t.domain} ${nameOf.get(t.assigned_to ?? "") ?? ""}`.toLowerCase().includes(needle))
    : items;
  const selected = drawer.value ? items.find((t) => t.id === drawer.value) ?? null : null;

  const keys = useMemo(() => ({
    approve: () => selected && actions.approve.mutate(selected.id),
    reject: () => setRejecting(true),
    escalate: () => selected && actions.escalate.mutate(selected.id),
    next: () => {
      if (!selected || !visible.length) return;
      setRejecting(false);
      drawer.open(visible[(visible.indexOf(selected) + 1) % visible.length].id);
    },
  }), [selected, visible, actions.approve, actions.escalate, drawer]);
  useTaskKeys(selected, canApprove, keys);

  const columns = useMemo<ColumnDef<StewardshipQueueItem, unknown>[]>(() => [
    { id: "priority", header: "Priority", meta: meta({ sticky: "start", width: 104 }), cell: ({ row }) => (
      <StatusBadge status={prioritySeverity(row.original.priority)}>P{row.original.priority}</StatusBadge>) },
    { id: "task", header: "Task", meta: meta({ minWidth: 220 }), cell: ({ row }) => (
      <span>{typeLabel(row.original.item_type)} <Mono>{row.original.source_id}</Mono></span>) },
    { id: "domain", header: "Domain", meta: meta({ width: 130 }), cell: ({ row }) => row.original.domain },
    { id: "assignee", header: "Assignee", meta: meta({ width: 170 }), cell: ({ row }) =>
      row.original.assigned_to ? nameOf.get(row.original.assigned_to) ?? row.original.assigned_to : <span className="ui-micro">Unassigned</span> },
    { id: "sla", header: "SLA", meta: meta({ width: 72, align: "end", numeric: true }), cell: ({ row }) => slaLabel(row.original) },
    { id: "age", header: "Opened", meta: meta({ width: 110, align: "end" }), cell: ({ row }) => relativeTime(row.original.created_at) },
  ], [nameOf]);

  const m = metricsQ.data;
  const breaches = items.filter((t) => t.sla_hours !== null && t.due_at && new Date(t.due_at).getTime() < now).length;
  const avg = items.length / Math.max(stewards.length, 1);
  const [topId, topLoad] = [...load.entries()].sort((a, b) => b[1] - a[1])[0] ?? [null, 0];
  const top = stewards.find((u) => u.id === topId);
  const error = queueQ.error ?? metricsQ.error ?? usersQ.error;

  return (
    <div className="ui-page">
      <PageHeader title="Team workload"
        summary={queueQ.data && usersQ.data ? `${items.length} open task${items.length === 1 ? "" : "s"} across ${stewards.length} steward${stewards.length === 1 ? "" : "s"}.` : undefined} />
      <MetricStrip label="Team health">
        <Metric label="Open tasks" value={queueQ.data ? items.length : null} />
        <Metric label="Backlog" value={m?.backlog_total ?? null} />
        <Metric label="SLA compliance" value={pct(m?.sla_compliance_rate)} unit="%" tone={m && m.sla_compliance_rate < 0.95 ? "warning" : "default"} />
        <Metric label="Suggestions accepted" value={pct(m?.ai_acceptance_rate)} unit="%" />
        <Metric label="Past due" value={queueQ.data ? breaches : null} tone={breaches ? "danger" : "default"} />
      </MetricStrip>
      {top && topLoad >= avg * 1.4 ? (
        <p className="ui-notice">
          <span>{top.name} holds {topLoad} open task{topLoad === 1 ? "" : "s"}, against a team average of {avg.toFixed(1)}. Reassign some to keep everyone inside the SLA.</span>
          <Link href="/workbench" className="ui-link">Open my queue</Link>
        </p>
      ) : null}
      {error ? <Banner tone="danger" title="Team workload could not be read">{(error as Error).message}</Banner> : null}

      <SectionCard title="Stewards" meta={usersQ.data ? stewards.length : undefined} flush>
        {usersQ.isLoading ? <TableSkeleton rows={4} label="Loading stewards" />
          : stewards.length ? (
            <div className="ui-matrix-scroll"><table className="ui-mini-table">
              <thead><tr>
                <th scope="col">Steward</th><th scope="col">Role</th>
                <th scope="col" className="aurora-number">Open</th>
                <th scope="col" className="aurora-number">Resolved in 30 days</th>
                <th scope="col" className="aurora-number">Average resolve</th>
              </tr></thead>
              <tbody>{stewards.map((u) => {
                const s = stats.get(u.name);
                return (
                  <tr key={u.id}>
                    <td>{u.name}</td>
                    <td>{u.role.replace(/_/g, " ")}</td>
                    <td className="aurora-number">{load.get(u.id) ?? 0}</td>
                    <td className="aurora-number">{s?.resolved ?? 0}</td>
                    <td className="aurora-number">{s?.avg_resolution_hours != null ? `${s.avg_resolution_hours.toFixed(1)}h` : "—"}</td>
                  </tr>
                );
              })}</tbody>
            </table></div>
          ) : <EmptyState>No active stewards. Give a user the steward or approver role in Settings.</EmptyState>}
      </SectionCard>

      <SectionCard title="Team queue" meta={needle ? `${visible.length} of ${items.length}` : items.length} flush>
        <FilterBar search={{ value: search, onChange: setSearch, placeholder: "Search tasks, sources, stewards" }} />
        {queueQ.isLoading ? <TableSkeleton rows={8} label="Loading the team queue" />
          : visible.length ? <DataTable columns={columns} data={visible} getRowId={(t) => t.id} onRowActivate={(t) => { setRejecting(false); drawer.open(t.id); }}
              ariaLabel="Team queue. Use j and k to move, Enter to open." maxHeight="62vh" />
          : <EmptyState action={needle ? <button type="button" className="ui-link-button" onClick={() => setSearch("")}>Clear search</button> : undefined}>
              {needle ? "No tasks match this search." : "No open tasks across the team."}
            </EmptyState>}
      </SectionCard>

      <DetailDrawer open={!!selected} onClose={drawer.close} ariaLabel="Task details"
        header={selected ? (
          <div className="ui-drawer-head">
            <StatusBadge status={prioritySeverity(selected.priority)}>P{selected.priority}</StatusBadge>
            <h2 className="ui-drawer-head__title">{typeLabel(selected.item_type)} <Mono>{selected.source_id}</Mono></h2>
          </div>) : null}>
        {selected ? (
          <TaskDetail task={selected} assignee={selected.assigned_to ? nameOf.get(selected.assigned_to) : undefined}
            canApprove={canApprove} busy={actions.busy} rejecting={rejecting} setRejecting={setRejecting}
            onApprove={keys.approve} onEscalate={keys.escalate}
            onReject={(reason) => actions.reject.mutate({ item: selected, reason })} />
        ) : null}
      </DetailDrawer>
    </div>
  );
}
