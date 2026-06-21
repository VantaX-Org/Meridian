"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  PageHead,
  KPI,
  SectionHeader,
  SevTag,
  PriorityChip,
  ModChip,
} from "@/components/meridian/atoms";
import { ArrowRight, MoreH, SparklesIcon } from "@/components/meridian/icons";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import {
  bulkApprove,
  escalateItem,
  getQueueItems,
  getMetrics,
  resolveItem,
  submitAiFeedback,
} from "@/lib/api/stewardship";
import { copyToClipboard } from "@/components/meridian/actions";
import { ConfirmDialog } from "@/components/meridian/controls";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { relativeTime } from "@/lib/format";
import type { StewardshipQueueItem } from "@/types/api";

function priorityChip(p: number): "P1" | "P2" | "P3" {
  if (p === 1) return "P1";
  if (p === 2) return "P2";
  return "P3";
}

function severityFromPriority(p: number): "critical" | "high" | "medium" | "low" {
  if (p === 1) return "critical";
  if (p === 2) return "high";
  if (p === 3) return "medium";
  return "low";
}

function slaLabel(item: StewardshipQueueItem): string {
  if (!item.sla_hours) return "—";
  const h = item.sla_hours;
  if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}

const ITEM_TYPE_LABEL: Record<string, string> = {
  merge_decision: "Merge",
  golden_record_review: "Golden review",
  exception: "Exception",
  writeback_approval: "Writeback",
  contract_breach: "Contract",
  glossary_review: "Glossary",
};

export default function WorkbenchPage() {
  const qc = useQueryClient();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [sortMode, setSortMode] = useState<"sla" | "priority" | "age">("sla");
  const [bulkOpen, setBulkOpen] = useState(false);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [overrideReason, setOverrideReason] = useState("");

  const queueQ = useQuery({
    queryKey: ["stewardship.queue", { status: "open", limit: 200 }],
    queryFn: () => getQueueItems({ status: "open", limit: 200 }),
  });
  const metricsQ = useQuery({
    queryKey: ["stewardship.metrics"],
    queryFn: getMetrics,
  });

  const resolve = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "approve" | "reject" }) =>
      resolveItem(id, action),
    onSuccess: (_d, vars) => {
      toast.success(vars.action === "approve" ? "Task approved" : "Task rejected");
      qc.invalidateQueries({ queryKey: ["stewardship.queue"] });
    },
    onError: () => toast.error("Could not resolve task"),
  });

  // Rejecting an AI recommendation captures a correction reason — this both
  // records the rejection and feeds the AI-feedback loop that proposes new
  // match rules (see /ai/rules). Reject without context teaches the engine
  // nothing, so the reason is required.
  const override = useMutation({
    mutationFn: async ({ item, reason }: { item: StewardshipQueueItem; reason: string }) => {
      await resolveItem(item.id, "reject", reason);
      await submitAiFeedback({
        queue_item_id: item.id,
        steward_decision: "reject",
        correction_reason: reason,
        domain: item.domain,
      });
    },
    onSuccess: () => {
      toast.success("Rejected — correction sent to the rule engine");
      qc.invalidateQueries({ queryKey: ["stewardship.queue"] });
      setOverrideOpen(false);
      setOverrideReason("");
    },
    onError: () => toast.error("Could not reject task"),
  });

  const escalate = useMutation({
    mutationFn: (id: string) => escalateItem(id),
    onSuccess: () => {
      toast.success("Task escalated");
      qc.invalidateQueries({ queryKey: ["stewardship.queue"] });
    },
    onError: () => toast.error("Could not escalate task"),
  });

  const bulk = useMutation({
    mutationFn: (ids: string[]) => bulkApprove(ids, 0.85),
    onSuccess: (d) => {
      toast.success(`Approved ${d.approved} task${d.approved === 1 ? "" : "s"}`);
      qc.invalidateQueries({ queryKey: ["stewardship.queue"] });
    },
    onError: () => toast.error("Could not bulk approve"),
  });

  const rawItems: StewardshipQueueItem[] = queueQ.data?.items ?? [];
  const items = useMemo(() => {
    const arr = [...rawItems];
    if (sortMode === "sla") {
      arr.sort((a, b) => (a.sla_hours ?? Infinity) - (b.sla_hours ?? Infinity));
    } else if (sortMode === "priority") {
      arr.sort((a, b) => a.priority - b.priority);
    } else {
      arr.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    }
    return arr;
  }, [rawItems, sortMode]);

  // Steward keyboard shortcuts on the focused task: A approve · R reject
  // (opens the correction-reason override) · N next · E escalate. Ignored
  // while typing in a field or when a dialog is open.
  const focused = items.find((t) => t.id === activeId) ?? items[0];
  const onKey = useCallback(
    (ev: KeyboardEvent) => {
      if (overrideOpen || bulkOpen) return;
      const el = ev.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      if (!focused) return;
      const k = ev.key;
      if (k === "a" || k === "A") {
        resolve.mutate({ id: focused.id, action: "approve" });
      } else if (k === "r" || k === "R") {
        setOverrideReason("");
        setOverrideOpen(true);
      } else if (k === "e" || k === "E") {
        escalate.mutate(focused.id);
      } else if (k === "n" || k === "N") {
        const idx = items.findIndex((t) => t.id === focused.id);
        const next = items[(idx + 1) % items.length];
        if (next) setActiveId(next.id);
      } else {
        return;
      }
      ev.preventDefault();
    },
    [focused, items, overrideOpen, bulkOpen, resolve, escalate],
  );
  useEffect(() => {
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onKey]);

  if (queueQ.isLoading || metricsQ.isLoading) {
    return (
      <>
        <PageHead title="Workbench" route="Aurora · /workbench" sub="Loading queue…" />
        <Skeleton className="h-[420px] rounded-[10px]" />
      </>
    );
  }
  if (queueQ.error || metricsQ.error) {
    return (
      <>
        <PageHead title="Workbench" route="Aurora · /workbench" sub="Failed to load." />
        <div className="mn-card mn-card-pad" style={{ color: "var(--mn-neg)" }}>
          Could not reach <code>/api/v1/stewardship</code>.
        </div>
      </>
    );
  }

  const metrics = metricsQ.data!;
  const selected = items.find((t) => t.id === activeId) ?? items[0];

  const assignedToMe = items.filter((t) => t.assigned_to).length;
  const slaAtRisk = items.filter(
    (t) => t.sla_hours !== null && t.due_at && new Date(t.due_at).getTime() - Date.now() < (t.sla_hours * 0.5) * 3600 * 1000,
  ).length;

  return (
    <>
      <PageHead
        title="Workbench"
        route="Aurora · /workbench"
        sub={
          <>
            You have <strong style={{ color: "var(--mn-ink-700)" }}>{items.length} open tasks</strong>.{" "}
            <strong style={{ color: "var(--mn-warn)" }}>{slaAtRisk} at risk</strong>. Median resolution accuracy:{" "}
            <strong style={{ color: "var(--mn-pos)" }}>
              {metrics.ai_acceptance_rate !== null ? `${Math.round(metrics.ai_acceptance_rate * 100)}%` : "—"}
            </strong>
            .
          </>
        }
        actions={
          <>
            <span className="mn-pill"><span className="pdot" />Live queue</span>
            <button
              type="button"
              className="mn-btn mn-btn-primary"
              onClick={() => {
                if (items.length === 0) {
                  toast.info("Nothing to approve");
                  return;
                }
                setBulkOpen(true);
              }}
              disabled={bulk.isPending || items.length === 0}
            >
              {bulk.isPending ? "Approving…" : "Bulk approve"}
            </button>
          </>
        }
      />

      <ConfirmDialog
        open={bulkOpen}
        onOpenChange={setBulkOpen}
        title="Bulk approve queue tasks"
        confirmLabel={`Approve ${Math.min(items.length, 25)} task${Math.min(items.length, 25) === 1 ? "" : "s"}`}
        body={
          <>
            This approves the top {Math.min(items.length, 25)} task
            {Math.min(items.length, 25) === 1 ? "" : "s"} in the current sort order whose
            model confidence is 85% or higher. Lower-confidence tasks are skipped and stay
            in the queue for manual review.
          </>
        }
        onConfirm={() => bulk.mutate(items.slice(0, 25).map((t) => t.id))}
      />

      {/* Reject with reason — overrides the AI recommendation and feeds the
          correction back into the rule-proposal engine. */}
      <Dialog open={overrideOpen} onOpenChange={(o) => !o && setOverrideOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject with reason</DialogTitle>
          </DialogHeader>
          <div style={{ padding: "8px 0" }}>
            <label
              htmlFor="correction-reason"
              style={{ display: "block", fontSize: 13, fontWeight: 600, color: "var(--mn-ink-700)", marginBottom: 6 }}
            >
              Correction reason
            </label>
            <textarea
              id="correction-reason"
              className="mn-input"
              style={{ width: "100%", minHeight: 96, resize: "vertical" }}
              placeholder="Why is the recommendation wrong? This trains the match-rule engine."
              value={overrideReason}
              onChange={(e) => setOverrideReason(e.target.value)}
              autoFocus
            />
          </div>
          <DialogFooter>
            <button type="button" className="mn-btn mn-btn-ghost" onClick={() => setOverrideOpen(false)}>
              Cancel
            </button>
            <button
              type="button"
              className="mn-btn mn-btn-primary"
              disabled={!overrideReason.trim() || override.isPending || !selected}
              onClick={() => selected && override.mutate({ item: selected, reason: overrideReason.trim() })}
            >
              {override.isPending ? "Rejecting…" : "Reject & correct"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="mn-row mn-stagger" style={{ gridTemplateColumns: "repeat(4, minmax(0, 1fr))", marginBottom: 18 }}>
        <KPI label="Assigned" value={assignedToMe} hint={`${items.length - assignedToMe} unassigned`} tone="warn" />
        <KPI label="Backlog" value={metrics.backlog_total} tone={metrics.backlog_total > 0 ? "warn" : "pos"} />
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
      </div>

      <div className="mn-row mn-row-12">
        <div className="mn-col-4">
          <div className="mn-card" style={{ padding: 0, overflow: "hidden", height: "100%", display: "flex", flexDirection: "column" }}>
            <div className="mn-queue-head">
              <span className="mn-eyebrow">Queue · {items.length} tasks</span>
              <button
                type="button"
                className="mn-link"
                onClick={() =>
                  setSortMode((m) => (m === "sla" ? "priority" : m === "priority" ? "age" : "sla"))
                }
              >
                Sort: {sortMode === "sla" ? "SLA" : sortMode === "priority" ? "Priority" : "Age"}
              </button>
            </div>
            <div className="mn-queue-list">
              {items.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={`mn-queue-item ${t.id === selected?.id ? "active" : ""}`}
                  onClick={() => setActiveId(t.id)}
                >
                  <div className="mn-queue-row">
                    <PriorityChip p={priorityChip(t.priority)} />
                    <span className="mn-queue-id mn-tabular">{t.id.slice(0, 8)}</span>
                    <span className="mn-queue-mod">{t.domain}</span>
                    <span className="mn-queue-sla mn-tabular">SLA · {slaLabel(t)}</span>
                  </div>
                  <div className="mn-queue-title">{ITEM_TYPE_LABEL[t.item_type] ?? t.item_type}</div>
                  <div className="mn-queue-record">{t.source_id}</div>
                </button>
              ))}
              {items.length === 0 && (
                <div style={{ padding: 32, textAlign: "center", color: "var(--mn-ink-400)" }}>
                  No open queue items.
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="mn-col-8">
          {selected ? (
            <div className="mn-card mn-card-pad" style={{ height: "100%" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <SevTag sev={severityFromPriority(selected.priority)} />
                    <PriorityChip p={priorityChip(selected.priority)} />
                    <span style={{ font: "500 11.5px/1 'JetBrains Mono', monospace", color: "var(--mn-ink-400)" }}>
                      {selected.id.slice(0, 8)} · {ITEM_TYPE_LABEL[selected.item_type] ?? selected.item_type}
                    </span>
                  </div>
                  <h2 className="mn-detail-title" style={{ marginTop: 8 }}>{selected.source_id}</h2>
                </div>
                <button
                  type="button"
                  className="mn-icon-btn"
                  aria-label="Copy task ID"
                  onClick={() => copyToClipboard(selected.id, "Task ID copied")}
                >
                  <MoreH size={14} />
                </button>
              </div>

              {selected.ai_recommendation && (
                <div className="mn-narrative" style={{ marginTop: 14 }}>
                  <div className="ico"><SparklesIcon size={15} /></div>
                  <div style={{ flex: 1 }}>
                    <div className="mn-narrative-headline">
                      Model suggests action — confidence{" "}
                      {selected.ai_confidence !== null ? `${Math.round(selected.ai_confidence * 100)}%` : "—"}.
                    </div>
                    <div className="mn-narrative-detail">{selected.ai_recommendation}</div>
                  </div>
                  <button
                    type="button"
                    className="mn-btn"
                    style={{
                      background: "white",
                      color: "var(--mn-primary)",
                      border: "1px solid var(--mn-primary-200)",
                    }}
                    onClick={() => resolve.mutate({ id: selected.id, action: "approve" })}
                    disabled={resolve.isPending}
                  >
                    Apply
                  </button>
                </div>
              )}

              <SectionHeader title="Task detail" caption="Source + assignment" />
              <div className="mn-detail-meta">
                <div><span className="k">Source</span><span className="v mn-tabular">{selected.source_id}</span></div>
                <div><span className="k">Domain</span><ModChip>{selected.domain}</ModChip></div>
                <div><span className="k">Type</span><span className="v">{ITEM_TYPE_LABEL[selected.item_type] ?? selected.item_type}</span></div>
                <div><span className="k">Assignee</span><span className="v">{selected.assigned_to ?? "Unassigned"}</span></div>
                <div><span className="k">SLA</span><span className="v mn-tabular">{slaLabel(selected)}</span></div>
                <div><span className="k">Age</span><span className="v mn-tabular">{relativeTime(selected.created_at)}</span></div>
              </div>

              <div className="mn-wb-actions">
                <button
                  type="button"
                  className="mn-btn mn-btn-ghost"
                  onClick={() => {
                    setOverrideReason("");
                    setOverrideOpen(true);
                  }}
                  disabled={resolve.isPending || override.isPending}
                >
                  Reject
                </button>
                <button
                  type="button"
                  className="mn-btn mn-btn-ghost"
                  onClick={() => escalate.mutate(selected.id)}
                  disabled={escalate.isPending}
                >
                  {escalate.isPending ? "Escalating…" : "Escalate"}
                </button>
                <div style={{ flex: 1 }} />
                <button
                  type="button"
                  className="mn-btn mn-btn-primary"
                  onClick={() => resolve.mutate({ id: selected.id, action: "approve" })}
                  disabled={resolve.isPending}
                >
                  {resolve.isPending ? "Approving…" : "Approve"} <ArrowRight size={13} />
                </button>
              </div>
            </div>
          ) : (
            <div className="mn-card mn-card-pad" style={{ color: "var(--mn-ink-400)" }}>
              No task selected.
            </div>
          )}
        </div>
      </div>
    </>
  );
}
