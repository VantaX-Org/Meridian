"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  ClipboardList,
  Filter,
  Loader2,
  CheckCircle2,
  XCircle,
  ArrowUpRight,
  ChevronRight,
  Zap,
  AlertTriangle,
  Crown,
  FileCheck2,
  BookOpen,
  GitMerge,
  Brain,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getQueueItems,
  resolveItem,
  escalateItem,
  bulkApprove,
  submitAiFeedback,
} from "@/lib/api/stewardship";
import { relativeTime } from "@/lib/format";
import type {
  StewardshipQueueItem,
  StewardshipItemType,
  StewardshipStatus,
} from "@/types/api";

// ── Config ──────────────────────────────────────────────────────────────────

const ITEM_TYPE_CONFIG: Record<
  StewardshipItemType,
  { label: string; icon: React.ReactNode; color: string }
> = {
  merge_decision: {
    label: "Merge Decision",
    icon: <GitMerge className="h-3.5 w-3.5" />,
    color: "bg-[#7C3AED]/10 text-[#7C3AED] border-[#7C3AED]/20",
  },
  golden_record_review: {
    label: "Golden Record",
    icon: <Crown className="h-3.5 w-3.5" />,
    color: "bg-[#EA580C]/10 text-[#EA580C] border-[#EA580C]/20",
  },
  exception: {
    label: "Exception",
    icon: <AlertTriangle className="h-3.5 w-3.5" />,
    color: "bg-[#DC2626]/10 text-[#DC2626] border-[#DC2626]/20",
  },
  writeback_approval: {
    label: "Writeback",
    icon: <FileCheck2 className="h-3.5 w-3.5" />,
    color: "bg-primary/10 text-primary border-primary/20",
  },
  contract_breach: {
    label: "Contract Breach",
    icon: <XCircle className="h-3.5 w-3.5" />,
    color: "bg-[#DC2626]/10 text-[#DC2626] border-[#DC2626]/20",
  },
  glossary_review: {
    label: "Glossary Review",
    icon: <BookOpen className="h-3.5 w-3.5" />,
    color: "bg-[#16A34A]/10 text-[#16A34A] border-[#16A34A]/20",
  },
};

const PRIORITY_LABELS: Record<number, { label: string; color: string }> = {
  1: { label: "Critical", color: "bg-[#DC2626]/10 text-[#DC2626]" },
  2: { label: "High", color: "bg-[#EA580C]/10 text-[#EA580C]" },
  3: { label: "Medium", color: "bg-primary/10 text-primary" },
  4: { label: "Low", color: "bg-[#16A34A]/10 text-[#16A34A]" },
  5: { label: "Info", color: "bg-white/[0.65] text-muted-foreground" },
};

const STATUS_FILTERS: StewardshipStatus[] = [
  "open",
  "in_progress",
  "resolved",
  "escalated",
];

// ── Confidence Bar ──────────────────────────────────────────────────────────

function ConfidenceBar({ confidence }: { confidence: number }) {
  const pct = Math.round(confidence * 100);
  const color =
    pct >= 85 ? "bg-[#16A34A]" : pct >= 60 ? "bg-[#EA580C]" : "bg-[#DC2626]";
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-24 rounded-full bg-white/[0.60]">
        <div
          className={`h-1.5 rounded-full ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs font-medium text-foreground">{pct}%</span>
    </div>
  );
}

// ── Override Modal ──────────────────────────────────────────────────────────

function OverrideModal({
  open,
  onClose,
  item,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  item: StewardshipQueueItem | null;
  onSubmit: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Override AI Recommendation</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {item?.ai_recommendation && (
            <div className="rounded-lg bg-white/[0.60] p-3">
              <p className="text-xs font-medium text-muted-foreground">
                AI Recommendation
              </p>
              <p className="mt-1 text-sm text-foreground">
                {item.ai_recommendation}
              </p>
            </div>
          )}
          <Textarea
            placeholder="Correction reason (required)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!reason.trim()}
            onClick={() => {
              onSubmit(reason);
              setReason("");
            }}
          >
            Submit Override
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Queue Item Row ──────────────────────────────────────────────────────────

function QueueRow({
  item,
  selected,
  onSelect,
}: {
  item: StewardshipQueueItem;
  selected: boolean;
  onSelect: () => void;
}) {
  const typeConfig = ITEM_TYPE_CONFIG[item.item_type] ?? { label: item.item_type, icon: <ClipboardList className="h-3.5 w-3.5" />, color: "bg-white/[0.65] text-muted-foreground border-black/[0.08]" };
  const priorityConfig = PRIORITY_LABELS[item.priority] ?? PRIORITY_LABELS[3];

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex w-full items-center gap-3 border-b border-black/[0.04] px-4 py-3 text-left transition-colors hover:bg-black/[0.03] ${
        selected ? "bg-primary/5 border-l-2 border-l-primary" : ""
      }`}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <Badge
            variant="outline"
            className={`text-xs ${typeConfig.color}`}
          >
            {typeConfig.icon}
            <span className="ml-1">{typeConfig.label}</span>
          </Badge>
          <Badge
            variant="outline"
            className={`text-xs ${priorityConfig.color}`}
          >
            P{item.priority}
          </Badge>
        </div>
        <p className="mt-1 truncate text-sm font-medium text-foreground">
          {item.domain}
        </p>
        <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
          <span>{relativeTime(item.created_at)}</span>
          {item.due_at && (
            <span>
              Due {relativeTime(item.due_at)}
            </span>
          )}
        </div>
      </div>
      {item.ai_confidence !== null && item.ai_confidence !== undefined && (
        <div className="shrink-0">
          <ConfidenceBar confidence={item.ai_confidence} />
        </div>
      )}
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
    </button>
  );
}

// ── Action Panel ────────────────────────────────────────────────────────────

function ActionPanel({
  item,
  onApprove,
  onReject,
  onEscalate,
  onOverride,
  isResolving,
  userRole,
}: {
  item: StewardshipQueueItem;
  onApprove: () => void;
  onReject: () => void;
  onEscalate: () => void;
  onOverride: () => void;
  isResolving: boolean;
  userRole: string;
}) {
  const typeConfig = ITEM_TYPE_CONFIG[item.item_type] ?? { label: item.item_type, icon: <ClipboardList className="h-3.5 w-3.5" />, color: "bg-white/[0.65] text-muted-foreground border-black/[0.08]" };
  const isAiReviewer = userRole === "ai_reviewer";
  const canApprove = !isAiReviewer && item.status !== "resolved";

  return (
    <div className="space-y-4">
      {/* Item header */}
      <div className="flex items-center gap-2">
        <Badge variant="outline" className={typeConfig.color}>
          {typeConfig.icon}
          <span className="ml-1">{typeConfig.label}</span>
        </Badge>
        <span className="text-sm font-medium text-foreground">
          {item.domain}
        </span>
      </div>

      {/* Details */}
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <p className="text-xs text-muted-foreground">Priority</p>
          <p className="font-medium text-foreground">
            P{item.priority} —{" "}
            {PRIORITY_LABELS[item.priority]?.label ?? "Normal"}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Status</p>
          <p className="font-medium text-foreground capitalize">{item.status}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Created</p>
          <p className="font-medium text-foreground">
            {relativeTime(item.created_at)}
          </p>
        </div>
        {item.sla_hours && (
          <div>
            <p className="text-xs text-muted-foreground">SLA</p>
            <p className="font-medium text-foreground">{item.sla_hours}h</p>
          </div>
        )}
      </div>

      {/* AI Recommendation panel */}
      {item.ai_recommendation && (
        <div className="rounded-lg border border-black/[0.08] bg-white/[0.60] p-3">
          <div className="flex items-center gap-2">
            <Brain className="h-4 w-4 text-[#7C3AED]" />
            <span className="text-xs font-semibold text-foreground">
              AI Recommendation
            </span>
          </div>
          {item.ai_confidence !== null && item.ai_confidence !== undefined && (
            <div className="mt-2">
              <ConfidenceBar confidence={item.ai_confidence} />
            </div>
          )}
          <p className="mt-2 text-sm text-foreground">
            {item.ai_recommendation}
          </p>
          <Button
            variant="outline"
            size="sm"
            className="mt-2 text-xs"
            onClick={onOverride}
          >
            Override
          </Button>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex gap-2 pt-2 border-t border-black/[0.08]">
        {canApprove ? (
          <>
            <Button
              size="sm"
              className="flex-1 bg-[#16A34A] hover:bg-[#16A34A]/90"
              onClick={onApprove}
              disabled={isResolving}
            >
              {isResolving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
              )}
              Approve (A)
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="flex-1 text-[#DC2626] border-[#DC2626]/30 hover:bg-[#DC2626]/5"
              onClick={onReject}
              disabled={isResolving}
            >
              <XCircle className="mr-1 h-3.5 w-3.5" />
              Reject (R)
            </Button>
          </>
        ) : isAiReviewer ? (
          <div className="w-full rounded-lg bg-white/[0.65] px-3 py-2 text-center text-xs text-muted-foreground">
            AI Reviewer role cannot approve data actions. Contact a Steward or
            Admin.
          </div>
        ) : null}
        <Button
          size="sm"
          variant="outline"
          onClick={onEscalate}
          disabled={isResolving || item.status === "resolved"}
        >
          <ArrowUpRight className="mr-1 h-3.5 w-3.5" />
          Escalate (E)
        </Button>
      </div>
    </div>
  );
}

// ── Main Page ───────────────────────────────────────────────────────────────

export default function StewardshipWorkbench() {
  const qc = useQueryClient();
  const [typeFilter, setTypeFilter] = useState<string>("");
  const [statusFilter, setStatusFilter] =
    useState<StewardshipStatus>("open");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [bulkMode, setBulkMode] = useState(false);
  const [bulkIds, setBulkIds] = useState<Set<string>>(new Set());

  // Simulated user role — in production read from auth context
  const userRole =
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("role") ?? "steward"
      : "steward";

  const { data, isLoading } = useQuery({
    queryKey: ["stewardship-queue", typeFilter, statusFilter],
    queryFn: () =>
      getQueueItems({
        item_type: typeFilter || undefined,
        status: statusFilter,
        limit: 100,
      }),
    refetchInterval: 15_000,
  });

  const items = data?.items ?? [];
  const selectedItem = items.find((i) => i.id === selectedId) ?? null;

  const resolveMutation = useMutation({
    mutationFn: ({
      id,
      action,
    }: {
      id: string;
      action: "approve" | "reject";
    }) => resolveItem(id, action),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["stewardship-queue"] });
      // Move to next item
      const idx = items.findIndex((i) => i.id === selectedId);
      if (idx >= 0 && idx < items.length - 1) {
        setSelectedId(items[idx + 1].id);
      } else {
        setSelectedId(null);
      }
    },
  });

  const escalateMutation = useMutation({
    mutationFn: (id: string) => escalateItem(id),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["stewardship-queue"] }),
  });

  const bulkApproveMutation = useMutation({
    mutationFn: (ids: string[]) => bulkApprove(ids, 0.85),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["stewardship-queue"] });
      setBulkIds(new Set());
      setBulkMode(false);
    },
  });

  const feedbackMutation = useMutation({
    mutationFn: (body: {
      queue_item_id: string;
      steward_decision: string;
      correction_reason: string;
      domain: string;
    }) => submitAiFeedback(body),
    onSuccess: () => setOverrideOpen(false),
  });

  // Keyboard shortcuts
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) return;
      if (!selectedItem || selectedItem.status === "resolved") return;

      if (e.key === "a" || e.key === "A") {
        e.preventDefault();
        if (userRole !== "ai_reviewer") {
          resolveMutation.mutate({ id: selectedItem.id, action: "approve" });
        }
      } else if (e.key === "r" || e.key === "R") {
        e.preventDefault();
        if (userRole !== "ai_reviewer") {
          resolveMutation.mutate({ id: selectedItem.id, action: "reject" });
        }
      } else if (e.key === "n" || e.key === "N") {
        e.preventDefault();
        const idx = items.findIndex((i) => i.id === selectedId);
        if (idx >= 0 && idx < items.length - 1) {
          setSelectedId(items[idx + 1].id);
        }
      } else if (e.key === "e" || e.key === "E") {
        e.preventDefault();
        escalateMutation.mutate(selectedItem.id);
      }
    },
    [selectedItem, selectedId, items, resolveMutation, escalateMutation, userRole]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
            <ClipboardList className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground">
              Stewardship Workbench
            </h1>
            <p className="text-sm text-muted-foreground">
              {data?.total ?? 0} items in queue
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/stewardship/metrics">
            <Button variant="outline" size="sm">
              Metrics
            </Button>
          </Link>
          {userRole !== "ai_reviewer" && (
            <Button
              variant={bulkMode ? "default" : "outline"}
              size="sm"
              onClick={() => {
                setBulkMode(!bulkMode);
                setBulkIds(new Set());
              }}
            >
              <Zap className="mr-1 h-3.5 w-3.5" />
              {bulkMode ? "Cancel Bulk" : "Bulk Approve"}
            </Button>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2">
        <Filter className="h-4 w-4 text-muted-foreground" />
        {/* Status */}
        {STATUS_FILTERS.map((s) => (
          <Button
            key={s}
            variant={statusFilter === s ? "default" : "outline"}
            size="sm"
            className="text-xs capitalize"
            onClick={() => setStatusFilter(s)}
          >
            {s.replace("_", " ")}
          </Button>
        ))}
        <span className="mx-1 h-4 w-px bg-black/[0.05]" />
        {/* Type */}
        <Button
          variant={!typeFilter ? "default" : "outline"}
          size="sm"
          className="text-xs"
          onClick={() => setTypeFilter("")}
        >
          All Types
        </Button>
        {Object.entries(ITEM_TYPE_CONFIG).map(([key, cfg]) => (
          <Button
            key={key}
            variant={typeFilter === key ? "default" : "outline"}
            size="sm"
            className="text-xs"
            onClick={() => setTypeFilter(key)}
          >
            {cfg.label}
          </Button>
        ))}
      </div>

      {/* Bulk approve bar */}
      {bulkMode && (
        <div className="flex items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-2">
          <span className="text-sm text-foreground">
            {bulkIds.size} selected (confidence &ge; 85%)
          </span>
          <Button
            size="sm"
            disabled={bulkIds.size === 0 || bulkApproveMutation.isPending}
            onClick={() => bulkApproveMutation.mutate(Array.from(bulkIds))}
          >
            {bulkApproveMutation.isPending ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
            ) : null}
            Approve {bulkIds.size}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              // Select all with high confidence
              const highConf = items.filter(
                (i) =>
                  i.ai_confidence !== null &&
                  i.ai_confidence >= 0.85 &&
                  i.status !== "resolved"
              );
              setBulkIds(new Set(highConf.map((i) => i.id)));
            }}
          >
            Select all high confidence
          </Button>
        </div>
      )}

      {/* Split panel */}
      <div className="flex gap-4" style={{ minHeight: "calc(100vh - 280px)" }}>
        {/* Left: queue list */}
        <Card className="w-[420px] shrink-0 overflow-hidden">
          <CardContent className="p-0">
            {isLoading ? (
              <div className="flex h-40 items-center justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
              </div>
            ) : items.length === 0 ? (
              <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
                No items in queue
              </div>
            ) : (
              <div className="max-h-[calc(100vh-300px)] overflow-y-auto">
                {items.map((item) => (
                  <div key={item.id} className="flex items-center">
                    {bulkMode && (
                      <input
                        type="checkbox"
                        className="ml-3 h-4 w-4 rounded border-black/[0.08]"
                        checked={bulkIds.has(item.id)}
                        onChange={(e) => {
                          const next = new Set(bulkIds);
                          if (e.target.checked) next.add(item.id);
                          else next.delete(item.id);
                          setBulkIds(next);
                        }}
                      />
                    )}
                    <div className="flex-1">
                      <QueueRow
                        item={item}
                        selected={item.id === selectedId}
                        onSelect={() => setSelectedId(item.id)}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Right: action panel */}
        <Card className="flex-1">
          <CardContent className="p-5">
            {selectedItem ? (
              <ActionPanel
                item={selectedItem}
                onApprove={() =>
                  resolveMutation.mutate({
                    id: selectedItem.id,
                    action: "approve",
                  })
                }
                onReject={() =>
                  resolveMutation.mutate({
                    id: selectedItem.id,
                    action: "reject",
                  })
                }
                onEscalate={() => escalateMutation.mutate(selectedItem.id)}
                onOverride={() => setOverrideOpen(true)}
                isResolving={resolveMutation.isPending}
                userRole={userRole}
              />
            ) : (
              <div className="flex h-60 items-center justify-center text-sm text-muted-foreground">
                Select an item from the queue
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Override modal */}
      <OverrideModal
        open={overrideOpen}
        onClose={() => setOverrideOpen(false)}
        item={selectedItem}
        onSubmit={(reason) => {
          if (selectedItem) {
            feedbackMutation.mutate({
              queue_item_id: selectedItem.id,
              steward_decision: "override",
              correction_reason: reason,
              domain: selectedItem.domain,
            });
          }
        }}
      />

      {/* Keyboard shortcut hint */}
      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        <span>
          <kbd className="rounded border border-black/[0.08] px-1.5 py-0.5 font-mono">
            A
          </kbd>{" "}
          Approve
        </span>
        <span>
          <kbd className="rounded border border-black/[0.08] px-1.5 py-0.5 font-mono">
            R
          </kbd>{" "}
          Reject
        </span>
        <span>
          <kbd className="rounded border border-black/[0.08] px-1.5 py-0.5 font-mono">
            N
          </kbd>{" "}
          Next
        </span>
        <span>
          <kbd className="rounded border border-black/[0.08] px-1.5 py-0.5 font-mono">
            E
          </kbd>{" "}
          Escalate
        </span>
      </div>
    </div>
  );
}
