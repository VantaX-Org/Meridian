"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PageHead, KPI, ModChip } from "@/components/meridian/atoms";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import {
  createException,
  escalateException,
  getExceptions,
  resolveException,
} from "@/lib/api/exceptions";
import { copyToClipboard } from "@/components/meridian/actions";
import { relativeTime } from "@/lib/format";
import type { Exception, ExceptionStatus } from "@/types/api";

const STATUS_TONE: Record<ExceptionStatus, { bg: string; fg: string; l: string }> = {
  open:              { bg: "var(--mn-pos-bg)",     fg: "var(--mn-pos)",         l: "OPEN" },
  investigating:     { bg: "var(--mn-warn-bg)",    fg: "var(--mn-warn)",        l: "INVESTIGATING" },
  pending_approval:  { bg: "var(--mn-primary-50)", fg: "var(--mn-primary-700)", l: "PENDING" },
  resolved:          { bg: "var(--mn-pos-bg)",     fg: "var(--mn-pos)",         l: "RESOLVED" },
  verified:          { bg: "var(--mn-pos-bg)",     fg: "var(--mn-pos)",         l: "VERIFIED" },
  closed:            { bg: "rgba(15,23,42,0.06)",  fg: "var(--mn-ink-500)",     l: "CLOSED" },
};

const RESOLUTION_TYPES = [
  { value: "steward", label: "Steward resolved" },
  { value: "dedup", label: "Resolved via dedup" },
  { value: "complex", label: "Complex / multi-step" },
  { value: "custom_rule", label: "New rule created" },
  { value: "auto_resolved", label: "Auto-resolved" },
];

const ROOT_CAUSE_CATEGORIES = [
  "missing_data",
  "incorrect_data",
  "duplicate_record",
  "configuration_gap",
  "process_gap",
  "source_system_error",
  "other",
];

export default function ExceptionsPage() {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<"all" | ExceptionStatus>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [requestOpen, setRequestOpen] = useState(false);
  const [resolveOpen, setResolveOpen] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ["exceptions.list", { status: statusFilter }],
    queryFn: () =>
      getExceptions({
        per_page: 100,
        status: statusFilter === "all" ? undefined : statusFilter,
      }),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["exceptions.list"] });

  const resolveExc = useMutation({
    mutationFn: ({
      id,
      body,
    }: {
      id: string;
      body: { resolution_type: string; resolution_notes: string; root_cause_category: string };
    }) => resolveException(id, body),
    onSuccess: () => {
      toast.success("Exception resolved");
      setResolveOpen(false);
      invalidate();
    },
    onError: () => toast.error("Could not resolve exception"),
  });

  const escalateExc = useMutation({
    mutationFn: (id: string) =>
      escalateException(id, { reason: "Escalated from workbench" }),
    onSuccess: () => {
      toast.success("Exception escalated");
      invalidate();
    },
    onError: () => toast.error("Could not escalate exception"),
  });

  const createExc = useMutation({
    mutationFn: createException,
    onSuccess: () => {
      toast.success("Exception submitted");
      setRequestOpen(false);
      invalidate();
    },
    onError: () => toast.error("Could not submit exception"),
  });

  const items: Exception[] = data?.exceptions ?? [];
  const total = data?.total ?? items.length;
  const selected = items.find((e) => e.id === selectedId) ?? items[0];

  const open = items.filter((i) => i.status === "open").length;
  const investigating = items.filter((i) => i.status === "investigating").length;
  const escalated = items.filter((i) => i.escalation_tier > 0).length;

  if (isLoading) {
    return (
      <>
        <PageHead title="Exceptions" route="Steward · /exceptions" sub="Loading…" />
        <Skeleton className="h-[420px] rounded-[10px]" />
      </>
    );
  }
  if (error) {
    return (
      <>
        <PageHead title="Exceptions" route="Steward · /exceptions" sub="Failed to load." />
        <div className="mn-card mn-card-pad" style={{ color: "var(--mn-neg)" }}>
          Could not reach <code>/api/v1/exceptions</code>.
        </div>
      </>
    );
  }

  return (
    <>
      <PageHead
        title="Exceptions"
        route="Steward · /exceptions"
        sub={
          <>
            <strong style={{ color: "var(--mn-pos)" }}>{open} open</strong>,{" "}
            <strong style={{ color: "var(--mn-warn)" }}>{investigating} investigating</strong>,{" "}
            <strong style={{ color: "var(--mn-neg)" }}>{escalated} escalated</strong>.
          </>
        }
        actions={
          <>
            <Dialog open={requestOpen} onOpenChange={setRequestOpen}>
              <DialogTrigger type="button" className="mn-btn mn-btn-primary">
                Request exception
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Request exception</DialogTitle>
                </DialogHeader>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const fd = new FormData(e.currentTarget);
                    createExc.mutate({
                      type: String(fd.get("type") ?? "data_quality"),
                      category: String(fd.get("category") ?? "general"),
                      severity: String(fd.get("severity") ?? "medium"),
                      title: String(fd.get("title") ?? ""),
                      description: String(fd.get("description") ?? ""),
                    });
                  }}
                >
                  <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 8 }}>
                    <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
                      <span style={{ color: "var(--mn-ink-500)" }}>Title</span>
                      <input name="title" required className="mn-input" placeholder="Brief summary" />
                    </label>
                    <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
                      <span style={{ color: "var(--mn-ink-500)" }}>Description</span>
                      <textarea name="description" required rows={4} className="mn-input" placeholder="What needs an exception?" />
                    </label>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                      <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
                        <span style={{ color: "var(--mn-ink-500)" }}>Type</span>
                        <select name="type" className="mn-input" defaultValue="data_quality">
                          <option value="data_quality">Data quality</option>
                          <option value="business_rule">Business rule</option>
                          <option value="configuration">Configuration</option>
                        </select>
                      </label>
                      <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
                        <span style={{ color: "var(--mn-ink-500)" }}>Category</span>
                        <input name="category" className="mn-input" defaultValue="general" />
                      </label>
                      <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
                        <span style={{ color: "var(--mn-ink-500)" }}>Severity</span>
                        <select name="severity" className="mn-input" defaultValue="medium">
                          <option value="low">Low</option>
                          <option value="medium">Medium</option>
                          <option value="high">High</option>
                          <option value="critical">Critical</option>
                        </select>
                      </label>
                    </div>
                  </div>
                  <DialogFooter>
                    <button type="button" className="mn-btn mn-btn-ghost" onClick={() => setRequestOpen(false)}>
                      Cancel
                    </button>
                    <button type="submit" className="mn-btn mn-btn-primary" disabled={createExc.isPending}>
                      {createExc.isPending ? "Submitting…" : "Submit"}
                    </button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          </>
        }
      />

      {selected && (
        <Dialog open={resolveOpen} onOpenChange={setResolveOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Resolve exception</DialogTitle>
            </DialogHeader>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const fd = new FormData(e.currentTarget);
                resolveExc.mutate({
                  id: selected.id,
                  body: {
                    resolution_type: String(fd.get("resolution_type") ?? "steward"),
                    root_cause_category: String(fd.get("root_cause_category") ?? "other"),
                    resolution_notes: String(fd.get("resolution_notes") ?? ""),
                  },
                });
              }}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 8 }}>
                <div
                  style={{
                    font: "500 11.5px/1.4 'JetBrains Mono', monospace",
                    color: "var(--mn-ink-400)",
                  }}
                >
                  {selected.id.slice(0, 8)} · {selected.title}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
                    <span style={{ color: "var(--mn-ink-500)" }}>Resolution type</span>
                    <select name="resolution_type" className="mn-input" defaultValue="steward">
                      {RESOLUTION_TYPES.map((r) => (
                        <option key={r.value} value={r.value}>
                          {r.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
                    <span style={{ color: "var(--mn-ink-500)" }}>Root cause</span>
                    <select name="root_cause_category" className="mn-input" defaultValue="incorrect_data">
                      {ROOT_CAUSE_CATEGORIES.map((c) => (
                        <option key={c} value={c}>
                          {c.replace(/_/g, " ")}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
                  <span style={{ color: "var(--mn-ink-500)" }}>Resolution notes</span>
                  <textarea
                    name="resolution_notes"
                    required
                    rows={4}
                    className="mn-input"
                    placeholder="What was done to resolve this exception?"
                  />
                </label>
                <p style={{ fontSize: 11.5, color: "var(--mn-ink-400)", margin: 0 }}>
                  Resolution type sets the billing tier; root cause feeds DQ trend analytics.
                </p>
              </div>
              <DialogFooter>
                <button type="button" className="mn-btn mn-btn-ghost" onClick={() => setResolveOpen(false)}>
                  Cancel
                </button>
                <button type="submit" className="mn-btn mn-btn-primary" disabled={resolveExc.isPending}>
                  {resolveExc.isPending ? "Resolving…" : "Resolve exception"}
                </button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}

      <div className="mn-row mn-stagger" style={{ gridTemplateColumns: "repeat(4, minmax(0, 1fr))", marginBottom: 18 }}>
        <KPI label="Total" value={total} />
        <KPI label="Open" value={open} tone="pos" />
        <KPI label="Investigating" value={investigating} tone="warn" />
        <KPI label="Escalated" value={escalated} tone="neg" />
      </div>

      <div className="mn-segment" style={{ marginBottom: 12, flexWrap: "wrap" }}>
        {(["all", "open", "investigating", "pending_approval", "resolved", "closed"] as const).map((k) => (
          <button key={k} type="button" className={statusFilter === k ? "on" : ""} onClick={() => setStatusFilter(k)}>
            {k === "all" ? "All" : STATUS_TONE[k as ExceptionStatus]?.l ?? k}
          </button>
        ))}
      </div>

      <div className="mn-row mn-row-12">
        <div className="mn-col-7" style={{ gridColumn: "span 7" }}>
          <div className="mn-card" style={{ padding: 0, overflow: "hidden" }}>
            <div className="mn-table-wrap">
              <table className="mn-table">
                <thead>
                  <tr>
                    <th style={{ paddingLeft: 20 }}>ID</th>
                    <th>Exception</th>
                    <th>Category</th>
                    <th>Severity</th>
                    <th>Age</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((e) => {
                    const st = STATUS_TONE[e.status];
                    return (
                      <tr
                        key={e.id}
                        className={selected?.id === e.id ? "selected" : ""}
                        onClick={() => setSelectedId(e.id)}
                        style={{ cursor: "pointer" }}
                      >
                        <td style={{ paddingLeft: 20 }} className="mn-tabular">
                          <span style={{ font: "600 11.5px/1 'JetBrains Mono', monospace", color: "var(--mn-ink-500)" }}>
                            {e.id.slice(0, 8)}
                          </span>
                        </td>
                        <td>
                          <div style={{ fontWeight: 500, color: "var(--mn-ink-900)", fontSize: 13 }}>{e.title}</div>
                          <div
                            style={{
                              font: "500 11px/1 'JetBrains Mono', monospace",
                              color: "var(--mn-ink-400)",
                              marginTop: 3,
                              letterSpacing: "0.04em",
                            }}
                          >
                            {e.source_system ?? "unknown"} · {e.type}
                          </div>
                        </td>
                        <td><ModChip>{e.category}</ModChip></td>
                        <td>
                          <span
                            style={{
                              display: "inline-flex",
                              padding: "2px 7px",
                              borderRadius: 4,
                              background:
                                e.severity === "critical"
                                  ? "var(--mn-neg-bg)"
                                  : e.severity === "high"
                                    ? "var(--mn-warn-bg)"
                                    : "rgba(15,23,42,0.06)",
                              color:
                                e.severity === "critical"
                                  ? "var(--mn-neg)"
                                  : e.severity === "high"
                                    ? "var(--mn-warn)"
                                    : "var(--mn-ink-500)",
                              font: "700 9.5px/1 'JetBrains Mono', monospace",
                              letterSpacing: "0.1em",
                            }}
                          >
                            {e.severity.toUpperCase()}
                          </span>
                        </td>
                        <td
                          className="mn-tabular"
                          style={{ font: "500 11.5px/1 'JetBrains Mono', monospace", color: "var(--mn-ink-500)" }}
                        >
                          {relativeTime(e.created_at)}
                        </td>
                        <td>
                          <span
                            style={{
                              display: "inline-flex",
                              padding: "3px 8px",
                              borderRadius: 4,
                              background: st.bg,
                              color: st.fg,
                              font: "700 9.5px/1 'JetBrains Mono', monospace",
                              letterSpacing: "0.1em",
                            }}
                          >
                            {st.l}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                  {items.length === 0 && (
                    <tr>
                      <td colSpan={6} style={{ padding: 32, textAlign: "center", color: "var(--mn-ink-400)" }}>
                        No exceptions.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
        <div className="mn-col-5" style={{ gridColumn: "span 5" }}>
          {selected ? (
            <div className="mn-card mn-card-pad" style={{ height: "100%" }}>
              <div className="mn-detail-head">
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span
                      className="mn-tabular"
                      style={{ font: "600 11.5px/1 'JetBrains Mono', monospace", color: "var(--mn-ink-500)" }}
                    >
                      {selected.id.slice(0, 8)}
                    </span>
                  </div>
                  <h3 className="mn-detail-title" style={{ marginTop: 8 }}>{selected.title}</h3>
                </div>
              </div>
              <div className="mn-detail-meta">
                <div><span className="k">Type</span><span className="v">{selected.type}</span></div>
                <div><span className="k">Category</span><span className="v">{selected.category}</span></div>
                <div><span className="k">Severity</span><span className="v">{selected.severity}</span></div>
                <div><span className="k">Status</span><span className="v">{selected.status}</span></div>
                <div><span className="k">Tier</span><span className="v mn-tabular">{selected.escalation_tier}</span></div>
                <div><span className="k">Age</span><span className="v mn-tabular">{relativeTime(selected.created_at)}</span></div>
              </div>
              <div className="mn-detail-section">
                <div className="mn-eyebrow">Description</div>
                <p style={{ margin: "8px 0 0", fontSize: 13, color: "var(--mn-ink-500)", lineHeight: 1.55 }}>
                  {selected.description}
                </p>
              </div>
              {selected.resolution_notes && (
                <div className="mn-detail-section">
                  <div className="mn-eyebrow">Resolution notes</div>
                  <p style={{ margin: "8px 0 0", fontSize: 13, color: "var(--mn-ink-500)", lineHeight: 1.55 }}>
                    {selected.resolution_notes}
                  </p>
                </div>
              )}
              <div className="mn-detail-actions">
                <button
                  type="button"
                  className="mn-btn mn-btn-primary"
                  style={{ flex: 1, justifyContent: "center" }}
                  onClick={() => setResolveOpen(true)}
                  disabled={resolveExc.isPending || selected.status === "resolved" || selected.status === "closed"}
                >
                  {resolveExc.isPending ? "Resolving…" : "Resolve"}
                </button>
                <button
                  type="button"
                  className="mn-btn mn-btn-ghost"
                  onClick={() => escalateExc.mutate(selected.id)}
                  disabled={escalateExc.isPending}
                >
                  {escalateExc.isPending ? "Escalating…" : "Escalate"}
                </button>
                <button
                  type="button"
                  className="mn-btn mn-btn-ghost"
                  onClick={() => copyToClipboard(selected.id, "Exception ID copied")}
                >
                  Copy ID
                </button>
              </div>
            </div>
          ) : (
            <div className="mn-card mn-card-pad" style={{ color: "var(--mn-ink-400)" }}>No exception selected.</div>
          )}
        </div>
      </div>
    </>
  );
}
