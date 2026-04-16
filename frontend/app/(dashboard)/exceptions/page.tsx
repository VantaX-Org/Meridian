"use client";

import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  DndContext,
  DragOverlay,
  closestCorners,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ShieldAlert,
  Clock,
  AlertTriangle,
  CheckCircle2,
  Plus,
  GripVertical,
  MessageSquare,
  User,
  ArrowUpRight,
  X,
  ChevronDown,
  ToggleLeft,
  ToggleRight,
  Search,
} from "lucide-react";
import { toast } from "sonner";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import type {
  Exception,
  ExceptionStatus,
  ExceptionMetrics,
  ExceptionRule,
  ExceptionComment,
} from "@/types/api";
import {
  getExceptions,
  getException,
  getExceptionMetrics,
  getSAPMonitor,
  getExceptionRules,
  createExceptionRule,
  updateExceptionRule,
  assignException,
  escalateException,
  resolveException,
  addComment,
} from "@/lib/api/exceptions";

/* ─── Constants ─── */

const KANBAN_COLUMNS: { status: ExceptionStatus; label: string }[] = [
  { status: "open", label: "Open" },
  { status: "investigating", label: "Investigating" },
  { status: "pending_approval", label: "Pending Approval" },
  { status: "resolved", label: "Resolved" },
  { status: "closed", label: "Closed" },
];

const SEVERITY_COLORS: Record<string, string> = {
  critical: "bg-[#DC2626]/10 text-[#DC2626] border-[#DC2626]/20",
  high: "bg-[#EA580C]/10 text-[#EA580C] border-[#EA580C]/20",
  medium: "bg-[#D97706]/10 text-[#D97706] border-[#D97706]/20",
  low: "bg-primary/10 text-primary border-primary/20",
};

const TYPE_COLORS: Record<string, string> = {
  sap_transaction: "bg-[#7C3AED]/10 text-[#7C3AED] border-[#7C3AED]/20",
  dq_rule: "bg-[#2563EB]/10 text-[#2563EB] border-[#2563EB]/20",
  custom_business: "bg-[#16A34A]/10 text-[#16A34A] border-[#16A34A]/20",
  anomaly: "bg-[#EA580C]/10 text-[#EA580C] border-[#EA580C]/20",
  contract_violation: "bg-[#DC2626]/10 text-[#DC2626] border-[#DC2626]/20",
};

const STATUS_COLORS: Record<string, string> = {
  open: "bg-[#DC2626]/10 text-[#DC2626]",
  investigating: "bg-[#EA580C]/10 text-[#EA580C]",
  pending_approval: "bg-[#D97706]/10 text-[#D97706]",
  resolved: "bg-[#16A34A]/10 text-[#16A34A]",
  verified: "bg-primary/10 text-primary",
  closed: "bg-white/[0.65] text-muted-foreground",
};

function formatType(t: string): string {
  return t.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function slaCountdown(deadline: string | null): {
  text: string;
  urgent: boolean;
} {
  if (!deadline) return { text: "No SLA", urgent: false };
  const diff = new Date(deadline).getTime() - Date.now();
  if (diff <= 0) return { text: "OVERDUE", urgent: true };
  const hours = Math.floor(diff / 3_600_000);
  const mins = Math.floor((diff % 3_600_000) / 60_000);
  if (hours < 24)
    return {
      text: `${hours}h ${mins}m`,
      urgent: hours < 2,
    };
  const days = Math.floor(hours / 24);
  return { text: `${days}d ${hours % 24}h`, urgent: false };
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/* ─── Sortable Exception Card ─── */

function SortableExceptionCard({
  exception,
  onClick,
}: {
  exception: Exception;
  onClick: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: exception.id, data: { exception } });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes}>
      <ExceptionCard
        exception={exception}
        onClick={onClick}
        dragListeners={listeners}
      />
    </div>
  );
}

function ExceptionCard({
  exception,
  onClick,
  dragListeners,
}: {
  exception: Exception;
  onClick: () => void;
  dragListeners?: Record<string, unknown>;
}) {
  const sla = slaCountdown(exception.sla_deadline);

  return (
    <div
      className="group cursor-pointer rounded-lg border border-black/[0.08] bg-white/[0.70] backdrop-blur-xl p-3 shadow-[0_4px_24px_rgba(0,0,0,0.12)] transition-shadow hover:shadow-md"
      onClick={onClick}
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <div
          className="mt-0.5 cursor-grab text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
          {...dragListeners}
        >
          <GripVertical className="h-3.5 w-3.5" />
        </div>
        <h4 className="flex-1 text-sm font-medium text-foreground line-clamp-2 leading-tight">
          {exception.title}
        </h4>
        <span
          className={`inline-flex shrink-0 items-center rounded-full border px-1.5 py-0.5 text-xs font-semibold uppercase ${SEVERITY_COLORS[exception.severity] || ""}`}
        >
          {exception.severity}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <span
          className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-xs font-medium ${TYPE_COLORS[exception.type] || ""}`}
        >
          {formatType(exception.type)}
        </span>
        {exception.assigned_to && (
          <span className="inline-flex items-center gap-0.5 text-xs text-muted-foreground">
            <User className="h-2.5 w-2.5" />
            Assigned
          </span>
        )}
      </div>
      {sla.text !== "No SLA" && (
        <div
          className={`mt-2 flex items-center gap-1 text-[13px] ${sla.urgent ? "font-semibold text-[#DC2626]" : "text-muted-foreground"}`}
        >
          <Clock className="h-3 w-3" />
          {sla.text}
        </div>
      )}
    </div>
  );
}

/* ─── Kanban Column ─── */

function KanbanColumn({
  status,
  label,
  exceptions,
  onCardClick,
}: {
  status: ExceptionStatus;
  label: string;
  exceptions: Exception[];
  onCardClick: (id: string) => void;
}) {
  return (
    <div className="flex min-h-[400px] w-[240px] shrink-0 flex-col rounded-xl border border-black/[0.08] bg-white/[0.60]">
      <div className="flex items-center justify-between border-b border-black/[0.08] px-3 py-2.5">
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[status] || ""}`}
          >
            {label}
          </span>
          <span className="text-xs font-medium text-muted-foreground">
            {exceptions.length}
          </span>
        </div>
      </div>
      <SortableContext
        items={exceptions.map((e) => e.id)}
        strategy={verticalListSortingStrategy}
      >
        <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-2">
          {exceptions.map((exc) => (
            <SortableExceptionCard
              key={exc.id}
              exception={exc}
              onClick={() => onCardClick(exc.id)}
            />
          ))}
          {exceptions.length === 0 && (
            <p className="py-8 text-center text-xs text-muted-foreground">No items</p>
          )}
        </div>
      </SortableContext>
    </div>
  );
}

/* ─── Exception Detail Sheet ─── */

function ExceptionDetail({
  exceptionId,
  open,
  onClose,
}: {
  exceptionId: string | null;
  open: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [commentText, setCommentText] = useState("");
  const [resolveForm, setResolveForm] = useState(false);
  const [resolutionType, setResolutionType] = useState("steward");
  const [resolutionNotes, setResolutionNotes] = useState("");
  const [rootCause, setRootCause] = useState("");

  const { data: exc, isLoading } = useQuery({
    queryKey: ["exception", exceptionId],
    queryFn: () => getException(exceptionId!),
    enabled: !!exceptionId && open,
  });

  const assignMut = useMutation({
    mutationFn: (args: { user_id: string; user_name: string }) =>
      assignException(exceptionId!, args),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["exceptions"] });
      queryClient.invalidateQueries({
        queryKey: ["exception", exceptionId],
      });
      toast.success("Exception assigned");
    },
  });

  const escalateMut = useMutation({
    mutationFn: (args: { reason: string; tier?: number }) =>
      escalateException(exceptionId!, args),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["exceptions"] });
      queryClient.invalidateQueries({
        queryKey: ["exception", exceptionId],
      });
      toast.success("Exception escalated");
    },
  });

  const resolveMut = useMutation({
    mutationFn: () =>
      resolveException(exceptionId!, {
        resolution_type: resolutionType,
        resolution_notes: resolutionNotes,
        root_cause_category: rootCause,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["exceptions"] });
      queryClient.invalidateQueries({
        queryKey: ["exception", exceptionId],
      });
      setResolveForm(false);
      toast.success("Exception resolved");
    },
  });

  const commentMut = useMutation({
    mutationFn: () => addComment(exceptionId!, { text: commentText }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["exception", exceptionId],
      });
      setCommentText("");
    },
  });

  return (
    <Sheet
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
    >
      <SheetContent
        side="right"
        className="w-full max-w-2xl overflow-y-auto border-l border-black/[0.08] bg-white/[0.70] backdrop-blur-xl p-0"
      >
        {isLoading || !exc ? (
          <div className="space-y-4 p-6">
            <Skeleton className="h-6 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : (
          <>
            <SheetHeader className="border-b border-black/[0.08] p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1">
                  <SheetTitle className="text-base font-bold text-foreground">
                    {exc.title}
                  </SheetTitle>
                  <SheetDescription className="mt-1 text-sm text-secondary-foreground">
                    {exc.description}
                  </SheetDescription>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <span
                  className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold uppercase ${SEVERITY_COLORS[exc.severity] || ""}`}
                >
                  {exc.severity}
                </span>
                <span
                  className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[exc.status] || ""}`}
                >
                  {exc.status.replace(/_/g, " ")}
                </span>
                <span
                  className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${TYPE_COLORS[exc.type] || ""}`}
                >
                  {formatType(exc.type)}
                </span>
                {exc.sla_deadline && (
                  <span
                    className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs ${slaCountdown(exc.sla_deadline).urgent ? "bg-[#DC2626]/10 font-semibold text-[#DC2626]" : "bg-white/[0.60] text-secondary-foreground"}`}
                  >
                    <Clock className="h-3 w-3" />
                    SLA: {slaCountdown(exc.sla_deadline).text}
                  </span>
                )}
              </div>
            </SheetHeader>

            {/* Info Grid */}
            <div className="grid grid-cols-2 gap-3 border-b border-black/[0.08] p-5">
              <div>
                <span className="text-[13px] font-medium uppercase text-muted-foreground">
                  Source
                </span>
                <p className="text-sm text-foreground">
                  {exc.source_system || "Manual"}
                </p>
              </div>
              <div>
                <span className="text-[13px] font-medium uppercase text-muted-foreground">
                  Escalation Tier
                </span>
                <p className="text-sm text-foreground">{exc.escalation_tier}</p>
              </div>
              <div>
                <span className="text-[13px] font-medium uppercase text-muted-foreground">
                  Category
                </span>
                <p className="text-sm text-foreground">{exc.category}</p>
              </div>
              <div>
                <span className="text-[13px] font-medium uppercase text-muted-foreground">
                  Created
                </span>
                <p className="text-sm text-foreground">
                  {relativeTime(exc.created_at)}
                </p>
              </div>
              {exc.linked_finding_id && (
                <div className="col-span-2">
                  <span className="text-[13px] font-medium uppercase text-muted-foreground">
                    Linked Finding
                  </span>
                  <a
                    href={`/findings?id=${exc.linked_finding_id}`}
                    className="flex items-center gap-1 text-sm text-primary hover:underline"
                  >
                    View Finding
                    <ArrowUpRight className="h-3 w-3" />
                  </a>
                </div>
              )}
              {exc.linked_cleaning_id && (
                <div className="col-span-2">
                  <span className="text-[13px] font-medium uppercase text-muted-foreground">
                    Linked Cleaning Item
                  </span>
                  <a
                    href={`/cleaning?id=${exc.linked_cleaning_id}`}
                    className="flex items-center gap-1 text-sm text-primary hover:underline"
                  >
                    View Cleaning
                    <ArrowUpRight className="h-3 w-3" />
                  </a>
                </div>
              )}
            </div>

            {/* Actions */}
            {exc.status !== "resolved" && exc.status !== "closed" && (
              <div className="flex flex-wrap gap-2 border-b border-black/[0.08] p-5">
                <button
                  className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-primary/80"
                  onClick={() =>
                    assignMut.mutate({
                      user_id: "00000000-0000-0000-0000-000000000001",
                      user_name: "Dev User",
                    })
                  }
                >
                  Assign
                </button>
                <button
                  className="rounded-lg bg-[#EA580C] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#EA580C]/80"
                  onClick={() =>
                    escalateMut.mutate({ reason: "Requires immediate attention" })
                  }
                >
                  Escalate
                </button>
                <button
                  className="rounded-lg bg-[#16A34A] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#16A34A]/80"
                  onClick={() => setResolveForm(!resolveForm)}
                >
                  Resolve
                </button>
              </div>
            )}

            {/* Resolve Form */}
            {resolveForm && (
              <div className="space-y-3 border-b border-black/[0.08] p-5">
                <h4 className="text-sm font-semibold text-foreground">
                  Resolve Exception
                </h4>
                <select
                  value={resolutionType}
                  onChange={(e) => setResolutionType(e.target.value)}
                  className="w-full rounded-lg border border-black/[0.08] px-3 py-2 text-sm"
                >
                  <option value="auto_resolved">Auto-resolved (Tier 1)</option>
                  <option value="steward">Steward-resolved (Tier 2)</option>
                  <option value="dedup">Complex/Dedup (Tier 3)</option>
                  <option value="custom_rule">Custom Rule (Tier 4)</option>
                </select>
                <select
                  value={rootCause}
                  onChange={(e) => setRootCause(e.target.value)}
                  className="w-full rounded-lg border border-black/[0.08] px-3 py-2 text-sm"
                >
                  <option value="">Select root cause...</option>
                  <option value="data_entry_error">Data Entry Error</option>
                  <option value="system_configuration">System Configuration</option>
                  <option value="process_gap">Process Gap</option>
                  <option value="integration_failure">Integration Failure</option>
                  <option value="migration_issue">Migration Issue</option>
                  <option value="other">Other</option>
                </select>
                <textarea
                  placeholder="Resolution notes..."
                  value={resolutionNotes}
                  onChange={(e) => setResolutionNotes(e.target.value)}
                  className="w-full rounded-lg border border-black/[0.08] px-3 py-2 text-sm"
                  rows={3}
                />
                <button
                  className="rounded-lg bg-[#16A34A] px-4 py-2 text-xs font-medium text-white hover:bg-[#16A34A]/80 disabled:opacity-50"
                  disabled={!rootCause || !resolutionNotes || resolveMut.isPending}
                  onClick={() => resolveMut.mutate()}
                >
                  {resolveMut.isPending ? "Resolving..." : "Confirm Resolution"}
                </button>
              </div>
            )}

            {/* Comment Thread */}
            <div className="p-5">
              <h4 className="mb-3 flex items-center gap-1.5 text-sm font-semibold text-foreground">
                <MessageSquare className="h-4 w-4" />
                Comments ({exc.comments?.length || 0})
              </h4>
              <div className="space-y-2">
                {exc.comments?.map((c: ExceptionComment) => (
                  <div
                    key={c.id}
                    className="rounded-lg bg-white/[0.60] px-3 py-2"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-primary">
                        {c.user_name}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {relativeTime(c.created_at)}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-foreground">{c.text}</p>
                  </div>
                ))}
              </div>
              <div className="mt-3 flex gap-2">
                <input
                  type="text"
                  placeholder="Add a comment..."
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && commentText.trim()) {
                      commentMut.mutate();
                    }
                  }}
                  className="flex-1 rounded-lg border border-black/[0.08] px-3 py-2 text-sm"
                />
                <button
                  className="rounded-lg bg-primary px-3 py-2 text-xs font-medium text-white disabled:opacity-50"
                  disabled={!commentText.trim() || commentMut.isPending}
                  onClick={() => commentMut.mutate()}
                >
                  Send
                </button>
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

/* ─── New Rule Modal ─── */

function NewRuleModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    name: "",
    description: "",
    rule_type: "field_condition",
    object_type: "business_partner",
    condition: "",
    severity: "medium",
  });

  const createMut = useMutation({
    mutationFn: () => createExceptionRule(form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["exception-rules"] });
      toast.success("Rule created");
      onClose();
      setForm({
        name: "",
        description: "",
        rule_type: "field_condition",
        object_type: "business_partner",
        condition: "",
        severity: "medium",
      });
    },
  });

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-lg rounded-xl border border-black/[0.08] bg-white/[0.70] backdrop-blur-xl shadow-[0_4px_24px_rgba(0,0,0,0.12)]">
        <div className="flex items-center justify-between border-b border-black/[0.08] px-5 py-4">
          <h3 className="text-base font-bold text-foreground">
            New Exception Rule
          </h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="space-y-3 p-5">
          <input
            placeholder="Rule name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="w-full rounded-lg border border-black/[0.08] px-3 py-2 text-sm"
          />
          <textarea
            placeholder="Description"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            className="w-full rounded-lg border border-black/[0.08] px-3 py-2 text-sm"
            rows={2}
          />
          <div className="grid grid-cols-2 gap-3">
            <select
              value={form.rule_type}
              onChange={(e) => setForm({ ...form, rule_type: e.target.value })}
              className="rounded-lg border border-black/[0.08] px-3 py-2 text-sm"
            >
              <option value="field_condition">Field Condition</option>
              <option value="threshold">Threshold</option>
              <option value="temporal">Temporal</option>
              <option value="relationship">Relationship</option>
              <option value="cross_record">Cross Record</option>
              <option value="aggregate">Aggregate</option>
            </select>
            <select
              value={form.object_type}
              onChange={(e) =>
                setForm({ ...form, object_type: e.target.value })
              }
              className="rounded-lg border border-black/[0.08] px-3 py-2 text-sm"
            >
              <option value="business_partner">Business Partner</option>
              <option value="material_master">Material Master</option>
              <option value="fi_gl">GL Accounts</option>
              <option value="employee_central">Employee Central</option>
              <option value="accounts_payable">Accounts Payable</option>
              <option value="accounts_receivable">Accounts Receivable</option>
            </select>
          </div>
          <input
            placeholder="Condition (e.g. BU_TYPE IS NULL)"
            value={form.condition}
            onChange={(e) => setForm({ ...form, condition: e.target.value })}
            className="w-full rounded-lg border border-black/[0.08] px-3 py-2 text-sm font-mono"
          />
          <select
            value={form.severity}
            onChange={(e) => setForm({ ...form, severity: e.target.value })}
            className="w-full rounded-lg border border-black/[0.08] px-3 py-2 text-sm"
          >
            <option value="critical">Critical</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
          <button
            className="w-full rounded-lg bg-primary py-2 text-sm font-medium text-white hover:bg-primary/80 disabled:opacity-50"
            disabled={!form.name || !form.condition || createMut.isPending}
            onClick={() => createMut.mutate()}
          >
            {createMut.isPending ? "Creating..." : "Create Rule"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Main Page ─── */

export default function ExceptionsPage() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("kanban");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [draggingExc, setDraggingExc] = useState<Exception | null>(null);
  const [newRuleOpen, setNewRuleOpen] = useState(false);

  // Filters for list view
  const [filterType, setFilterType] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterSeverity, setFilterSeverity] = useState("");
  const [listPage, setListPage] = useState(1);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  // Queries
  const { data: exceptionsData, isLoading } = useQuery({
    queryKey: [
      "exceptions",
      filterType,
      filterStatus,
      filterSeverity,
      listPage,
    ],
    queryFn: () =>
      getExceptions({
        type: filterType || undefined,
        status: filterStatus || undefined,
        severity: filterSeverity || undefined,
        page: listPage,
        per_page: 200,
      }),
  });

  const { data: metrics } = useQuery({
    queryKey: ["exception-metrics"],
    queryFn: () => getExceptionMetrics(),
  });

  const { data: sapMonitor } = useQuery({
    queryKey: ["sap-monitor"],
    queryFn: () => getSAPMonitor(),
    enabled: activeTab === "sap-monitor",
  });

  const { data: rulesData } = useQuery({
    queryKey: ["exception-rules"],
    queryFn: () => getExceptionRules(),
    enabled: activeTab === "rules",
  });

  const toggleRuleMut = useMutation({
    mutationFn: ({ id, is_active }: { id: string; is_active: boolean }) =>
      updateExceptionRule(id, { is_active }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["exception-rules"] });
      toast.success("Rule updated");
    },
  });

  const exceptions = exceptionsData?.exceptions || [];

  // Group by status for Kanban
  const byStatus: Record<ExceptionStatus, Exception[]> = {
    open: [],
    investigating: [],
    pending_approval: [],
    resolved: [],
    verified: [],
    closed: [],
  };
  for (const exc of exceptions) {
    if (byStatus[exc.status]) {
      byStatus[exc.status].push(exc);
    }
  }

  const openDetail = useCallback((id: string) => {
    setSelectedId(id);
    setSheetOpen(true);
  }, []);

  // ── Drag handlers ──

  function handleDragStart(event: DragStartEvent) {
    const exc = (event.active.data.current as { exception: Exception })?.exception;
    if (exc) setDraggingExc(exc);
  }

  function handleDragEnd(event: DragEndEvent) {
    setDraggingExc(null);
    const { active, over } = event;
    if (!over) return;

    const exc = (active.data.current as { exception: Exception })?.exception;
    if (!exc) return;

    // Determine target column — find which column the "over" item belongs to
    let targetStatus: ExceptionStatus | null = null;
    for (const col of KANBAN_COLUMNS) {
      if (byStatus[col.status].some((e) => e.id === over.id)) {
        targetStatus = col.status;
        break;
      }
    }

    if (!targetStatus || targetStatus === exc.status) return;

    // Perform the appropriate API call based on the target column
    if (targetStatus === "investigating") {
      assignException(exc.id, {
        user_id: "00000000-0000-0000-0000-000000000001",
        user_name: "Dev User",
      }).then(() => {
        queryClient.invalidateQueries({ queryKey: ["exceptions"] });
        toast.success(`Moved to ${targetStatus}`);
      });
    } else if (targetStatus === "resolved") {
      resolveException(exc.id, {
        resolution_type: "steward",
        resolution_notes: "Resolved via Kanban drag",
        root_cause_category: "other",
      }).then(() => {
        queryClient.invalidateQueries({ queryKey: ["exceptions"] });
        toast.success("Exception resolved");
      });
    } else if (
      targetStatus === "pending_approval" ||
      targetStatus === "closed"
    ) {
      escalateException(exc.id, {
        reason: `Status changed to ${targetStatus} via Kanban`,
      }).then(() => {
        queryClient.invalidateQueries({ queryKey: ["exceptions"] });
        toast.success(`Moved to ${targetStatus}`);
      });
    }
  }

  // ── KPI Cards ──

  const kpiCards = [
    {
      label: "Open",
      value: metrics?.open_count ?? 0,
      icon: ShieldAlert,
      color: "text-[#DC2626]",
      bg: "bg-[#DC2626]/5",
    },
    {
      label: "Investigating",
      value: byStatus.investigating.length,
      icon: Search,
      color: "text-[#EA580C]",
      bg: "bg-[#EA580C]/5",
    },
    {
      label: "Overdue SLA",
      value: metrics?.overdue_count ?? 0,
      icon: Clock,
      color: "text-[#DC2626]",
      bg: "bg-[#DC2626]/5",
    },
    {
      label: "Resolved This Week",
      value: metrics?.resolved_count ?? 0,
      icon: CheckCircle2,
      color: "text-[#16A34A]",
      bg: "bg-[#16A34A]/5",
    },
  ];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-foreground">
            Exception Management
          </h1>
          <p className="text-sm text-secondary-foreground">
            SAP transaction monitors, custom rules, SLA escalation
          </p>
        </div>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-4 gap-4">
        {kpiCards.map((kpi) => (
          <Card
            key={kpi.label}
            className={`border-black/[0.08] ${kpi.bg}`}
          >
            <CardContent className="flex items-center gap-3 p-4">
              <kpi.icon className={`h-8 w-8 ${kpi.color}`} />
              <div>
                <p className="text-2xl font-bold text-foreground">
                  {kpi.value}
                </p>
                <p className="text-xs text-muted-foreground">{kpi.label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="kanban">Kanban View</TabsTrigger>
          <TabsTrigger value="list">List View</TabsTrigger>
          <TabsTrigger value="sap-monitor">SAP Monitor</TabsTrigger>
          <TabsTrigger value="rules">Custom Rules</TabsTrigger>
        </TabsList>

        {/* ── Kanban View ── */}
        <TabsContent value="kanban">
          {isLoading ? (
            <div className="flex gap-4">
              {KANBAN_COLUMNS.map((c) => (
                <Skeleton key={c.status} className="h-[400px] w-[240px]" />
              ))}
            </div>
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCorners}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
            >
              <div className="flex gap-4 overflow-x-auto pb-4">
                {KANBAN_COLUMNS.map((col) => (
                  <KanbanColumn
                    key={col.status}
                    status={col.status}
                    label={col.label}
                    exceptions={byStatus[col.status]}
                    onCardClick={openDetail}
                  />
                ))}
              </div>
              <DragOverlay>
                {draggingExc && (
                  <ExceptionCard
                    exception={draggingExc}
                    onClick={() => {}}
                  />
                )}
              </DragOverlay>
            </DndContext>
          )}
        </TabsContent>

        {/* ── List View ── */}
        <TabsContent value="list">
          <div className="mb-4 flex flex-wrap gap-3">
            <select
              value={filterType}
              onChange={(e) => { setFilterType(e.target.value); setListPage(1); }}
              className="rounded-lg border border-black/[0.08] px-3 py-2 text-sm"
            >
              <option value="">All Types</option>
              <option value="sap_transaction">SAP Transaction</option>
              <option value="dq_rule">DQ Rule</option>
              <option value="custom_business">Custom Business</option>
              <option value="anomaly">Anomaly</option>
              <option value="contract_violation">Contract Violation</option>
            </select>
            <select
              value={filterStatus}
              onChange={(e) => { setFilterStatus(e.target.value); setListPage(1); }}
              className="rounded-lg border border-black/[0.08] px-3 py-2 text-sm"
            >
              <option value="">All Statuses</option>
              {KANBAN_COLUMNS.map((c) => (
                <option key={c.status} value={c.status}>
                  {c.label}
                </option>
              ))}
            </select>
            <select
              value={filterSeverity}
              onChange={(e) => { setFilterSeverity(e.target.value); setListPage(1); }}
              className="rounded-lg border border-black/[0.08] px-3 py-2 text-sm"
            >
              <option value="">All Severities</option>
              <option value="critical">Critical</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </div>

          <div className="rounded-xl border border-black/[0.08] bg-white/[0.70] backdrop-blur-xl">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Severity</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>SLA</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {exceptions.map((exc) => {
                  const sla = slaCountdown(exc.sla_deadline);
                  return (
                    <TableRow
                      key={exc.id}
                      className="cursor-pointer hover:bg-black/[0.03]"
                      onClick={() => openDetail(exc.id)}
                    >
                      <TableCell className="max-w-[300px] truncate font-medium text-foreground">
                        {exc.title}
                      </TableCell>
                      <TableCell>
                        <span
                          className={`inline-flex rounded-full border px-2 py-0.5 text-[13px] font-medium ${TYPE_COLORS[exc.type] || ""}`}
                        >
                          {formatType(exc.type)}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span
                          className={`inline-flex rounded-full border px-2 py-0.5 text-[13px] font-semibold uppercase ${SEVERITY_COLORS[exc.severity] || ""}`}
                        >
                          {exc.severity}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-[13px] font-medium ${STATUS_COLORS[exc.status] || ""}`}
                        >
                          {exc.status.replace(/_/g, " ")}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span
                          className={`text-xs ${sla.urgent ? "font-semibold text-[#DC2626]" : "text-muted-foreground"}`}
                        >
                          {sla.text}
                        </span>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {relativeTime(exc.created_at)}
                      </TableCell>
                    </TableRow>
                  );
                })}
                {exceptions.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="py-12 text-center text-sm text-muted-foreground">
                      No exceptions found
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>

          {/* Pagination */}
          {(exceptionsData?.total || 0) > 200 && (
            <div className="mt-4 flex items-center justify-center gap-3">
              <button
                className="rounded-lg border border-black/[0.08] px-3 py-1.5 text-sm disabled:opacity-50"
                disabled={listPage <= 1}
                onClick={() => setListPage((p) => p - 1)}
              >
                Previous
              </button>
              <span className="text-sm text-muted-foreground">Page {listPage}</span>
              <button
                className="rounded-lg border border-black/[0.08] px-3 py-1.5 text-sm disabled:opacity-50"
                disabled={exceptions.length < 200}
                onClick={() => setListPage((p) => p + 1)}
              >
                Next
              </button>
            </div>
          )}
        </TabsContent>

        {/* ── SAP Monitor ── */}
        <TabsContent value="sap-monitor">
          {!sapMonitor ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <div className="space-y-4">
              {Object.entries(sapMonitor.by_category).map(([cat, excs]) => (
                <Card key={cat} className="border-black/[0.08]">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-semibold capitalize text-foreground">
                      {cat} ({(excs as Exception[]).length})
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Title</TableHead>
                          <TableHead>Severity</TableHead>
                          <TableHead>Source</TableHead>
                          <TableHead>SLA</TableHead>
                          <TableHead>Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(excs as Exception[]).map((exc) => {
                          const sla = slaCountdown(exc.sla_deadline);
                          return (
                            <TableRow
                              key={exc.id}
                              className="cursor-pointer hover:bg-black/[0.03]"
                              onClick={() => openDetail(exc.id)}
                            >
                              <TableCell className="font-medium text-foreground">
                                {exc.title}
                              </TableCell>
                              <TableCell>
                                <span
                                  className={`inline-flex rounded-full border px-2 py-0.5 text-[13px] font-semibold uppercase ${SEVERITY_COLORS[exc.severity] || ""}`}
                                >
                                  {exc.severity}
                                </span>
                              </TableCell>
                              <TableCell className="text-xs text-muted-foreground">
                                {exc.source_system}
                              </TableCell>
                              <TableCell>
                                <span
                                  className={`text-xs ${sla.urgent ? "font-semibold text-[#DC2626]" : "text-muted-foreground"}`}
                                >
                                  {sla.text}
                                </span>
                              </TableCell>
                              <TableCell>
                                <span
                                  className={`inline-flex rounded-full px-2 py-0.5 text-[13px] font-medium ${STATUS_COLORS[exc.status] || ""}`}
                                >
                                  {exc.status.replace(/_/g, " ")}
                                </span>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              ))}
              {Object.keys(sapMonitor.by_category).length === 0 && (
                <p className="py-12 text-center text-sm text-muted-foreground">
                  No SAP transaction exceptions in the last 24 hours
                </p>
              )}
            </div>
          )}
        </TabsContent>

        {/* ── Custom Rules ── */}
        <TabsContent value="rules">
          <div className="mb-4 flex items-center justify-between">
            <p className="text-sm text-secondary-foreground">
              {rulesData?.rules.length ?? 0} rules configured
            </p>
            <button
              className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-white hover:bg-primary/80"
              onClick={() => setNewRuleOpen(true)}
            >
              <Plus className="h-4 w-4" />
              New Rule
            </button>
          </div>

          <div className="rounded-xl border border-black/[0.08] bg-white/[0.70] backdrop-blur-xl">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Object</TableHead>
                  <TableHead>Severity</TableHead>
                  <TableHead>Condition</TableHead>
                  <TableHead>Active</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rulesData?.rules.map((rule: ExceptionRule) => (
                  <TableRow key={rule.id}>
                    <TableCell className="font-medium text-foreground">
                      {rule.name}
                    </TableCell>
                    <TableCell className="text-xs text-secondary-foreground">
                      {rule.rule_type.replace(/_/g, " ")}
                    </TableCell>
                    <TableCell className="text-xs text-secondary-foreground">
                      {rule.object_type.replace(/_/g, " ")}
                    </TableCell>
                    <TableCell>
                      <span
                        className={`inline-flex rounded-full border px-2 py-0.5 text-[13px] font-semibold uppercase ${SEVERITY_COLORS[rule.severity] || ""}`}
                      >
                        {rule.severity}
                      </span>
                    </TableCell>
                    <TableCell className="max-w-[200px] truncate font-mono text-xs text-muted-foreground">
                      {rule.condition}
                    </TableCell>
                    <TableCell>
                      <button
                        onClick={() =>
                          toggleRuleMut.mutate({
                            id: rule.id,
                            is_active: !rule.is_active,
                          })
                        }
                        className={`transition-colors ${rule.is_active ? "text-[#16A34A]" : "text-muted-foreground"}`}
                      >
                        {rule.is_active ? (
                          <ToggleRight className="h-6 w-6" />
                        ) : (
                          <ToggleLeft className="h-6 w-6" />
                        )}
                      </button>
                    </TableCell>
                  </TableRow>
                ))}
                {(!rulesData || rulesData.rules.length === 0) && (
                  <TableRow>
                    <TableCell colSpan={6} className="py-12 text-center text-sm text-muted-foreground">
                      No custom rules configured
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>

          <NewRuleModal open={newRuleOpen} onClose={() => setNewRuleOpen(false)} />
        </TabsContent>
      </Tabs>

      {/* Detail Sheet */}
      <ExceptionDetail
        exceptionId={selectedId}
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
      />
    </div>
  );
}
