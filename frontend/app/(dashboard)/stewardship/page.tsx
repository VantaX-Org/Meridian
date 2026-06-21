"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  PageHead,
  KPI,
  SectionHeader,
  PriorityChip,
  ModChip,
  OwnerChip,
} from "@/components/meridian/atoms";
import { ArrowRight, MoreH, SparklesIcon } from "@/components/meridian/icons";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  escalateItem,
  getMetrics,
  getQueueItems,
  resolveItem,
} from "@/lib/api/stewardship";
import { getUsers } from "@/lib/api/users";
import { copyToClipboard } from "@/components/meridian/actions";
import { SearchField, matchesSearch } from "@/components/meridian/controls";
import { relativeTime } from "@/lib/format";
import type { StewardBreakdown, StewardshipQueueItem, User } from "@/types/api";

const STEWARD_ROLES = new Set(["steward", "admin", "approver", "ai_reviewer"]);

function initials(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "—";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function loadChipClass(n: number): "low" | "med" | "high" {
  if (n >= 6) return "high";
  if (n >= 4) return "med";
  return "low";
}

function priorityChip(p: number): "P1" | "P2" | "P3" {
  if (p === 1) return "P1";
  if (p === 2) return "P2";
  return "P3";
}

function slaLabel(item: StewardshipQueueItem): string {
  if (!item.sla_hours) return "—";
  return item.sla_hours < 24 ? `${item.sla_hours}h` : `${Math.round(item.sla_hours / 24)}d`;
}

export default function StewardshipPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [correctionReason, setCorrectionReason] = useState("");
  const queueQ = useQuery({
    queryKey: ["stewardship.queue", { status: "open", limit: 200 }],
    queryFn: () => getQueueItems({ status: "open", limit: 200 }),
  });
  const metricsQ = useQuery({
    queryKey: ["stewardship.metrics"],
    queryFn: getMetrics,
  });
  const usersQ = useQuery({
    queryKey: ["users.list"],
    queryFn: getUsers,
  });

  // All hooks must run before any conditional return. Pull the underlying
  // arrays defensively so the derived memos don't crash on an in-flight query.
  const items: StewardshipQueueItem[] = queueQ.data?.items ?? [];
  const allUsers: User[] = usersQ.data?.users ?? [];

  const loadByUser = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of items) {
      if (item.assigned_to) counts.set(item.assigned_to, (counts.get(item.assigned_to) ?? 0) + 1);
    }
    return counts;
  }, [items]);

  const breakdownByName = useMemo(() => {
    const m = new Map<string, StewardBreakdown>();
    const breakdown = metricsQ.data?.steward_breakdown;
    if (breakdown) {
      for (const row of breakdown) m.set(row.steward_name, row);
    }
    return m;
  }, [metricsQ.data]);

  const visibleItems = useMemo(
    () => items.filter((t) => matchesSearch(t, search)),
    [items, search],
  );

  const refresh = useCallback(() => {
    qc.invalidateQueries({ queryKey: ["stewardship.queue"] });
    qc.invalidateQueries({ queryKey: ["stewardship.metrics"] });
  }, [qc]);

  const resolveMut = useMutation({
    mutationFn: ({ id, action, notes }: { id: string; action: "approve" | "reject"; notes?: string }) =>
      resolveItem(id, action, notes),
    onSuccess: (_d, v) => {
      toast.success(v.action === "approve" ? "Task approved" : "Task rejected");
      setOverrideOpen(false);
      setCorrectionReason("");
      refresh();
    },
    onError: () => toast.error("Could not resolve task — AI Reviewers cannot approve data actions"),
  });

  const escalateMut = useMutation({
    mutationFn: (id: string) => escalateItem(id),
    onSuccess: () => {
      toast.success("Task escalated");
      refresh();
    },
    onError: () => toast.error("Could not escalate task"),
  });

  // Keyboard triage: A approve · R reject-with-reason · N next · E escalate.
  // Ignored while typing in an input or while the override modal is open.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || overrideOpen) return;
      // Accept both lower- and upper-case (caps lock / shift) for each action.
      const approve = e.key === "a" || e.key === "A";
      const reject = e.key === "r" || e.key === "R";
      const next = e.key === "n" || e.key === "N";
      const escalate = e.key === "e" || e.key === "E";
      if (!approve && !reject && !next && !escalate) return;
      const list = visibleItems;
      if (list.length === 0) return;
      const idx = list.findIndex((t) => t.id === selectedId);
      const current = idx >= 0 ? list[idx] : list[0];
      if (next) {
        const nextItem = list[(idx + 1) % list.length] ?? list[0];
        setSelectedId(nextItem.id);
      } else if (approve) {
        resolveMut.mutate({ id: current.id, action: "approve" });
      } else if (reject) {
        setSelectedId(current.id);
        setOverrideOpen(true);
      } else if (escalate) {
        escalateMut.mutate(current.id);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [visibleItems, selectedId, overrideOpen, resolveMut, escalateMut]);

  if (queueQ.isLoading || metricsQ.isLoading || usersQ.isLoading) {
    return (
      <>
        <PageHead title="Steward Workbench" route="Steward · /stewardship" sub="Loading team…" />
        <Skeleton className="h-[420px] rounded-[10px]" />
      </>
    );
  }
  if (queueQ.error || metricsQ.error || usersQ.error) {
    return (
      <>
        <PageHead title="Steward Workbench" route="Steward · /stewardship" sub="Failed to load." />
        <div className="mn-card mn-card-pad" style={{ color: "var(--mn-neg)" }}>
          Could not reach the stewardship or users endpoints.
        </div>
      </>
    );
  }

  const metrics = metricsQ.data!;
  const stewards = allUsers.filter((u) => u.is_active && STEWARD_ROLES.has(u.role));

  const slaBreaches7d = items.filter(
    (t) => t.sla_hours !== null && t.due_at && new Date(t.due_at).getTime() < Date.now(),
  ).length;

  return (
    <>
      <PageHead
        title="Steward Workbench"
        route="Steward · /stewardship"
        sub={
          <>
            Team view of stewardship —{" "}
            <strong style={{ color: "var(--mn-ink-700)" }}>{items.length} open tasks</strong> across{" "}
            <strong style={{ color: "var(--mn-ink-700)" }}>{stewards.length} stewards</strong>.{" "}
            <strong style={{ color: "var(--mn-warn)" }}>
              {Math.round(metrics.sla_compliance_rate * 100)}% SLA
            </strong>
            .
          </>
        }
        actions={
          <>
            <SearchField value={search} onChange={setSearch} placeholder="Filter tasks…" />
            <span className="mn-kbd-hint" style={{ fontSize: 11, color: "var(--mn-ink-400)" }}>
              <kbd>A</kbd> approve · <kbd>R</kbd> reject · <kbd>N</kbd> next · <kbd>E</kbd> escalate
            </span>
            <Link href="/workbench" className="mn-btn mn-btn-ghost">
              Open my workbench <ArrowRight size={13} />
            </Link>
            <Link href="/workbench" className="mn-btn mn-btn-primary">Assign tasks</Link>
          </>
        }
      />

      <div className="mn-row mn-stagger" style={{ gridTemplateColumns: "repeat(5, minmax(0, 1fr))", marginBottom: 18 }}>
        <KPI label="Open tasks" value={items.length} hint={`${stewards.length} stewards`} tone="warn" />
        <KPI label="Backlog" value={metrics.backlog_total} />
        <KPI
          label="SLA compliance"
          value={`${Math.round(metrics.sla_compliance_rate * 100)}%`}
          tone={metrics.sla_compliance_rate >= 0.95 ? "pos" : "warn"}
        />
        <KPI
          label="Suggestion acceptance"
          value={metrics.ai_acceptance_rate !== null ? `${Math.round(metrics.ai_acceptance_rate * 100)}%` : "—"}
          tone="pos"
        />
        <KPI label="SLA breaches" value={slaBreaches7d} tone={slaBreaches7d > 0 ? "neg" : "pos"} />
      </div>

      {/* Auto-rebalance suggestion when one steward has a notably higher load */}
      {(() => {
        if (stewards.length === 0 || loadByUser.size === 0) return null;
        const sorted = [...loadByUser.entries()].sort((a, b) => b[1] - a[1]);
        const [topId, topLoad] = sorted[0];
        const topUser = stewards.find((u) => u.id === topId);
        const avg = items.length / Math.max(stewards.length, 1);
        if (!topUser || topLoad < avg * 1.4) return null;
        return (
          <div className="mn-narrative" style={{ marginBottom: 18 }}>
            <div className="ico"><SparklesIcon size={15} /></div>
            <div style={{ flex: 1 }}>
              <div className="mn-narrative-headline">
                {topUser.name} carries {topLoad} open task{topLoad === 1 ? "" : "s"} — above the {avg.toFixed(1)}-task team average.
              </div>
              <div className="mn-narrative-detail">
                Reassign tasks in the workbench to keep everyone within the SLA window.
              </div>
            </div>
            <Link href="/workbench" className="mn-btn mn-btn-ghost" style={{ background: "white" }}>
              Open workbench <ArrowRight size={13} />
            </Link>
          </div>
        );
      })()}

      <SectionHeader title="Team" caption="Workload, throughput, accuracy" />
      <div
        className="mn-row"
        style={{
          gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
          marginBottom: 18,
        }}
      >
        {stewards.map((u) => {
          const load = loadByUser.get(u.id) ?? 0;
          const stats = breakdownByName.get(u.name);
          return (
            <div key={u.id} className="mn-steward-card">
              <div className="mn-steward-head">
                <span className="mn-steward-avatar">{initials(u.name)}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="mn-steward-name">{u.name}</div>
                  <div className="mn-steward-role">{u.role}</div>
                </div>
                <span className={`mn-load-chip ${loadChipClass(load)}`}>{load} open</span>
              </div>
              <div className="mn-steward-stats">
                <div>
                  <span className="mn-eyebrow">Resolved · 30d</span>
                  <span className="v mn-tabular">{stats?.resolved ?? 0}</span>
                </div>
                <div>
                  <span className="mn-eyebrow">Avg resolve</span>
                  <span className="v mn-tabular">
                    {stats?.avg_resolution_hours !== null && stats?.avg_resolution_hours !== undefined
                      ? `${stats.avg_resolution_hours.toFixed(1)}h`
                      : "—"}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
        {stewards.length === 0 && (
          <div className="mn-card mn-card-pad" style={{ textAlign: "center", color: "var(--mn-ink-400)" }}>
            No active stewards.
          </div>
        )}
      </div>

      <SectionHeader
        title="Team queue"
        caption={
          search.trim()
            ? `${visibleItems.length} of ${items.length} tasks match`
            : `${items.length} tasks across the team`
        }
        right={
          <Link href="/workbench" className="mn-link">
            Open in workbench <ArrowRight size={11} />
          </Link>
        }
      />
      <div className="mn-card" style={{ padding: 0, overflow: "hidden" }}>
        <div className="mn-table-wrap">
          <table className="mn-table">
            <thead>
              <tr>
                <th style={{ paddingLeft: 20 }}>Task</th>
                <th>Domain</th>
                <th>Priority</th>
                <th>Assignee</th>
                <th>SLA</th>
                <th>Age</th>
                <th style={{ width: 36 }}></th>
              </tr>
            </thead>
            <tbody>
              {visibleItems.map((t) => {
                const assignee = allUsers.find((u) => u.id === t.assigned_to);
                return (
                  <tr
                    key={t.id}
                    onClick={() => setSelectedId(t.id)}
                    style={t.id === selectedId ? { background: "var(--mn-primary-50)" } : undefined}
                  >
                    <td style={{ paddingLeft: 20 }}>
                      <span
                        className="mn-tabular"
                        style={{ font: "600 11px/1 'JetBrains Mono', monospace", color: "var(--mn-ink-500)" }}
                      >
                        {t.id.slice(0, 8)}
                      </span>
                      <div style={{ fontWeight: 500, color: "var(--mn-ink-900)", marginTop: 3, fontSize: 13 }}>
                        {t.item_type.replace(/_/g, " ")}
                      </div>
                      <div
                        style={{
                          font: "500 11.5px/1 'JetBrains Mono', monospace",
                          color: "var(--mn-ink-400)",
                          marginTop: 3,
                        }}
                      >
                        {t.source_id}
                      </div>
                    </td>
                    <td><ModChip>{t.domain}</ModChip></td>
                    <td><PriorityChip p={priorityChip(t.priority)} /></td>
                    <td>
                      {assignee ? (
                        <span className="ico-cell">
                          <OwnerChip owner={initials(assignee.name)} />
                          <span>{assignee.name.split(" ")[0]}</span>
                        </span>
                      ) : (
                        <span style={{ color: "var(--mn-ink-300)" }}>Unassigned</span>
                      )}
                    </td>
                    <td
                      className="mn-tabular"
                      style={{ font: "500 11.5px/1 'JetBrains Mono', monospace", color: "var(--mn-warn)" }}
                    >
                      {slaLabel(t)}
                    </td>
                    <td
                      className="mn-tabular"
                      style={{ font: "500 11.5px/1 'JetBrains Mono', monospace", color: "var(--mn-ink-500)" }}
                    >
                      {relativeTime(t.created_at)}
                    </td>
                    <td>
                      <button
                        type="button"
                        className="mn-icon-btn"
                        style={{ width: 26, height: 26 }}
                        aria-label="Copy task ID"
                        onClick={() => copyToClipboard(t.id, "Task ID copied")}
                      >
                        <MoreH size={14} />
                      </button>
                    </td>
                  </tr>
                );
              })}
              {visibleItems.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ padding: 32, textAlign: "center", color: "var(--mn-ink-400)" }}>
                    {items.length === 0 ? "No open tasks." : "No tasks match this filter."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Dialog open={overrideOpen} onOpenChange={setOverrideOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject with reason</DialogTitle>
            <DialogDescription>
              Override the AI recommendation for this task. A correction reason is
              required and feeds back into rule tuning.
            </DialogDescription>
          </DialogHeader>
          <label className="block text-xs font-medium text-[var(--mn-ink-500)]">
            Correction reason
            <textarea
              className="mt-1 w-full rounded-md border border-[var(--mn-line)] p-2 text-sm"
              rows={3}
              value={correctionReason}
              onChange={(e) => setCorrectionReason(e.target.value)}
              placeholder="Why is the AI recommendation wrong?"
            />
          </label>
          <DialogFooter>
            <button
              type="button"
              className="rounded-md border border-[var(--mn-line)] px-3 py-1.5 text-xs font-medium"
              onClick={() => setOverrideOpen(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="rounded-md bg-[var(--mn-neg)] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
              disabled={!correctionReason.trim() || !selectedId || resolveMut.isPending}
              onClick={() =>
                selectedId &&
                resolveMut.mutate({ id: selectedId, action: "reject", notes: correctionReason.trim() })
              }
            >
              Reject task
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
