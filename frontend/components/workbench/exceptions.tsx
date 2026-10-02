"use client";

/**
 * Workbench → Exceptions: cases a check cannot settle on its own — raised by
 * stewards or by exception rules, investigated, escalated and resolved with a
 * typed root cause so trends can learn from them.
 */

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import {
  Banner, Button, Chip, DataTable, Drawer, EmptyState, Field, Input, KpiRail, Select, Stack, Stat, Text, Textarea, useDrawerParam,
  type AuroraColumnMeta, type ChipTone,
} from "@/components/aurora";
import { copyToClipboard } from "@/components/meridian/actions";
import { useRole } from "@/hooks/use-role";
import { useUrlState } from "@/hooks/use-url-state";
import { createException, escalateException, getExceptions, resolveException } from "@/lib/api/exceptions";
import { relativeTime } from "@/lib/format";
import type { Exception, ExceptionStatus } from "@/types/api";

const meta = (m: AuroraColumnMeta) => m;
const STATUS_TONE: Record<ExceptionStatus, ChipTone> = { open: "info", investigating: "warning", pending_approval: "warning", resolved: "success", verified: "success", closed: "neutral" };
const STATUSES: ("all" | ExceptionStatus)[] = ["all", "open", "investigating", "pending_approval", "resolved", "closed"];
const sev = (s: string) => (s === "critical" || s === "high" || s === "low" ? s : "medium");
const label = (s: string) => s.replace(/_/g, " ");
const RESOLUTION_TYPES = [
  { value: "steward", label: "Steward resolved" }, { value: "dedup", label: "Resolved via dedup" }, { value: "complex", label: "Complex / multi-step" },
  { value: "custom_rule", label: "New rule created" }, { value: "auto_resolved", label: "Auto-resolved" },
];
const ROOT_CAUSES = ["missing_data", "incorrect_data", "duplicate_record", "configuration_gap", "process_gap", "source_system_error", "other"].map((v) => ({ value: v, label: label(v) }));
const TYPES = [{ value: "data_quality", label: "Data quality" }, { value: "business_rule", label: "Business rule" }, { value: "configuration", label: "Configuration" }];
const SEVERITIES = ["low", "medium", "high", "critical"].map((v) => ({ value: v, label: v }));
const DONE = new Set<ExceptionStatus>(["resolved", "verified", "closed"]);

export function ExceptionsSurface() {
  const qc = useQueryClient();
  const { can } = useRole();
  // Backend guards (api/routes/exceptions.py): requesting needs `analyse`, resolving and escalating need `approve`.
  const canRequest = can("analyse");
  const canApprove = can("approve");
  const [status, setStatus] = useUrlState("status", "all");
  const drawer = useDrawerParam("exception");
  const [requesting, setRequesting] = useState(false);

  const q = useQuery({ queryKey: ["exceptions.list", { status }], queryFn: () => getExceptions({ per_page: 100, status: status === "all" ? undefined : status }) });
  const items = useMemo(() => q.data?.exceptions ?? [], [q.data]);
  const total = q.data?.total ?? items.length;
  const refresh = () => qc.invalidateQueries({ queryKey: ["exceptions.list"] });
  const selected = drawer.value ? items.find((e) => e.id === drawer.value) ?? null : null;
  const counts = {
    open: items.filter((e) => e.status === "open").length,
    investigating: items.filter((e) => e.status === "investigating").length,
    escalated: items.filter((e) => e.escalation_tier > 0).length,
  };

  const columns = useMemo<ColumnDef<Exception, unknown>[]>(() => [
    { id: "status", header: "Status", meta: meta({ sticky: "start", width: 130 }), cell: ({ row }) => <Chip tone={STATUS_TONE[row.original.status]}>{label(row.original.status)}</Chip> },
    { id: "title", header: "Exception", cell: ({ row }) => (
      <span><strong>{row.original.title}</strong>
        <Text variant="text-micro" tone="muted" as="div">{row.original.source_system ?? "no source"} · {label(row.original.type)} · {row.original.category}</Text></span>) },
    { id: "severity", header: "Severity", meta: meta({ width: 100 }), cell: ({ row }) => <span className="aurora-workbench__severity" data-severity={sev(row.original.severity)}>{row.original.severity}</span> },
    { id: "tier", header: "Tier", meta: meta({ width: 70, align: "end", numeric: true }), cell: ({ row }) => row.original.escalation_tier },
    { id: "assignee", header: "Assigned", meta: meta({ width: 140 }), cell: ({ row }) => row.original.assigned_to ?? "—" },
    { id: "age", header: "Raised", meta: meta({ width: 110 }), cell: ({ row }) => relativeTime(row.original.created_at) },
  ], []);

  return (
    <Stack gap={5} className="aurora-page">
      <KpiRail>
        <Stat label="Exceptions" value={total} />
        <Stat label="Open" value={counts.open} tone={counts.open ? "info" : "neutral"} />
        <Stat label="Investigating" value={counts.investigating} tone={counts.investigating ? "warning" : "neutral"} />
        <Stat label="Escalated" value={counts.escalated} tone={counts.escalated ? "danger" : "neutral"} />
      </KpiRail>
      <Stack direction="row" gap={2} wrap align="center">
        {STATUSES.map((s) => <Chip key={s} selected={status === s} onClick={() => setStatus(s)}>{s === "all" ? "All" : label(s)}</Chip>)}
        <span style={{ flex: 1 }} />
        {canRequest ? <Button onClick={() => setRequesting(true)}>Request exception</Button> : null}
      </Stack>
      {q.isLoading ? <Text tone="muted">Reading exceptions.</Text>
        : q.error ? <Banner tone="danger" title="Exceptions could not be read">{(q.error as Error).message}</Banner>
        : items.length ? <DataTable columns={columns} data={items} getRowId={(e) => e.id} onRowActivate={(e) => drawer.open(e.id)} ariaLabel="Exceptions" maxHeight="60vh" />
        : <EmptyState title={status === "all" ? "No exceptions raised." : "No exceptions in this state."}
            body="Raise one when a finding needs a decision a check cannot make; exception rules raise them automatically." />}

      <Drawer open={!!selected} onClose={drawer.close} ariaLabel="Exception details"
        header={selected ? <Stack direction="row" gap={2} align="center"><Chip tone={STATUS_TONE[selected.status]}>{label(selected.status)}</Chip><Text variant="text-lead">{selected.title}</Text></Stack> : null}>
        {selected ? <ExceptionDetail exception={selected} canApprove={canApprove} onChanged={refresh} /> : null}
      </Drawer>
      <Drawer open={requesting} onClose={() => setRequesting(false)} ariaLabel="Request an exception" header={<Text variant="text-lead">Request an exception</Text>}>
        {requesting ? <RequestForm onDone={() => { setRequesting(false); refresh(); }} /> : null}
      </Drawer>
    </Stack>
  );
}

function ExceptionDetail({ exception: e, canApprove, onChanged }: { exception: Exception; canApprove: boolean; onChanged: () => void }) {
  const [resolving, setResolving] = useState(false);
  const [r, setR] = useState({ resolution_type: "steward", root_cause_category: "incorrect_data", resolution_notes: "" });
  const resolve = useMutation({
    mutationFn: () => resolveException(e.id, r),
    onSuccess: () => { toast.success("Exception resolved"); setResolving(false); onChanged(); },
    onError: (err) => toast.error((err as Error).message || "Not resolved"),
  });
  const escalate = useMutation({
    mutationFn: () => escalateException(e.id, { reason: "Escalated from the workbench" }),
    onSuccess: (d) => { toast.success(`Escalated to tier ${d.escalation_tier}`); onChanged(); },
    onError: (err) => toast.error((err as Error).message || "Not escalated"),
  });
  const rows: [string, string][] = [
    ["Type", label(e.type)], ["Category", e.category], ["Severity", e.severity], ["Source", e.source_system ?? "—"], ["Reference", e.source_reference ?? "—"],
    ["Assigned", e.assigned_to ?? "—"], ["Escalation tier", String(e.escalation_tier)], ["SLA", e.sla_deadline ? new Date(e.sla_deadline).toLocaleString() : "—"],
    ["Raised", relativeTime(e.created_at)], ["Resolved", e.resolved_at ? relativeTime(e.resolved_at) : "—"],
    ["Root cause", e.root_cause_category ? label(e.root_cause_category) : "—"], ["Resolution", e.resolution_type ? label(e.resolution_type) : "—"],
  ];
  return (
    <Stack gap={4}>
      <Text variant="text-small" tone="secondary">{e.description}</Text>
      <table className="aurora-exec__table"><tbody>{rows.map(([k, v]) => <tr key={k}><td>{k}</td><td className="aurora-number">{v}</td></tr>)}</tbody></table>
      {e.resolution_notes ? <Stack gap={1}><Text variant="text-micro" tone="muted" className="aurora-exec__eyebrow">Resolution notes</Text><Text variant="text-small" tone="secondary">{e.resolution_notes}</Text></Stack> : null}
      {e.comments?.length ? (
        <Stack gap={1}>
          <Text variant="text-micro" tone="muted" className="aurora-exec__eyebrow">Comments</Text>
          {e.comments.map((c, i) => <Text key={i} variant="text-small" tone="secondary">{c.user_name ?? "someone"} · {relativeTime(c.created_at)} — {c.text}</Text>)}
        </Stack>
      ) : null}
      {resolving ? (
        <form onSubmit={(ev) => { ev.preventDefault(); if (r.resolution_notes.trim()) resolve.mutate(); }}>
          <Stack gap={3}>
            <Stack direction="row" gap={3} wrap className="aurora-filters">
              <Field label="Resolution type">{({ controlId }) => <Select id={controlId} options={RESOLUTION_TYPES} value={r.resolution_type} onValueChange={(v) => setR({ ...r, resolution_type: v })} />}</Field>
              <Field label="Root cause">{({ controlId }) => <Select id={controlId} options={ROOT_CAUSES} value={r.root_cause_category} onValueChange={(v) => setR({ ...r, root_cause_category: v })} />}</Field>
            </Stack>
            <Field label="Resolution notes" required helper="Resolution type sets the billing tier; root cause feeds the trend analytics.">
              {({ controlId }) => <Textarea id={controlId} value={r.resolution_notes} onChange={(ev) => setR({ ...r, resolution_notes: ev.target.value })} placeholder="What was done to resolve this exception?" required />}
            </Field>
            <Stack direction="row" gap={2}>
              <Button type="submit" disabled={!r.resolution_notes.trim() || resolve.isPending}>{resolve.isPending ? "Resolving…" : "Resolve exception"}</Button>
              <Button type="button" variant="ghost" onClick={() => setResolving(false)}>Keep open</Button>
            </Stack>
          </Stack>
        </form>
      ) : (
        <Stack direction="row" gap={2} wrap>
          {canApprove && !DONE.has(e.status) ? <Button onClick={() => setResolving(true)}>Resolve</Button> : null}
          {canApprove && !DONE.has(e.status) ? <Button variant="secondary" onClick={() => escalate.mutate()} disabled={escalate.isPending}>{escalate.isPending ? "Escalating…" : "Escalate"}</Button> : null}
          <Button variant="ghost" onClick={() => copyToClipboard(e.id, "Exception ID copied")}>Copy ID</Button>
        </Stack>
      )}
    </Stack>
  );
}

function RequestForm({ onDone }: { onDone: () => void }) {
  const [d, setD] = useState({ title: "", description: "", type: "data_quality", category: "general", severity: "medium" });
  const create = useMutation({ mutationFn: () => createException(d), onSuccess: () => { toast.success("Exception submitted"); onDone(); }, onError: (e) => toast.error((e as Error).message || "Not submitted") });
  const valid = d.title.trim() && d.description.trim();
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (valid) create.mutate(); }}>
      <Stack gap={3}>
        <Field label="Title" required>{({ controlId }) => <Input id={controlId} value={d.title} onChange={(e) => setD({ ...d, title: e.target.value })} placeholder="Brief summary" required />}</Field>
        <Field label="Description" required>{({ controlId }) => <Textarea id={controlId} value={d.description} onChange={(e) => setD({ ...d, description: e.target.value })} placeholder="What needs an exception, and why?" required />}</Field>
        <Stack direction="row" gap={3} wrap className="aurora-filters">
          <Field label="Type">{({ controlId }) => <Select id={controlId} options={TYPES} value={d.type} onValueChange={(v) => setD({ ...d, type: v })} />}</Field>
          <Field label="Category">{({ controlId }) => <Input id={controlId} value={d.category} onChange={(e) => setD({ ...d, category: e.target.value })} />}</Field>
          <Field label="Severity">{({ controlId }) => <Select id={controlId} options={SEVERITIES} value={d.severity} onValueChange={(v) => setD({ ...d, severity: v })} />}</Field>
        </Stack>
        <Stack direction="row" gap={2}><Button type="submit" disabled={!valid || create.isPending}>{create.isPending ? "Raising…" : "Raise exception"}</Button></Stack>
      </Stack>
    </form>
  );
}
