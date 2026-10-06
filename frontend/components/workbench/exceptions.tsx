"use client";

/**
 * Workbench, Exceptions: cases a check cannot settle on its own. Stewards or
 * exception rules raise them; they are investigated, escalated and resolved
 * with a typed root cause so trends can learn from them.
 */

import { useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { Field, Select, Textarea } from "@/components/aurora";
import {
  Banner, Button, Chip, DataTable, DetailDrawer, EmptyState, FilterBar, Input, KeyValue, Mono,
  PageHeader, StatusBadge, TableSkeleton, Tally, useDrawerParam, type AuroraColumnMeta, type Status,
} from "@/components/ui-core";
import { copyToClipboard } from "@/lib/actions";
import { useRole } from "@/hooks/use-role";
import { useUrlState } from "@/hooks/use-url-state";
import { createException, escalateException, getExceptionMetrics, getExceptions, resolveException } from "@/lib/api/exceptions";
import { relativeTime, formatDate } from "@/lib/format";
import type { Exception, ExceptionStatus } from "@/types/api";

const meta = (m: AuroraColumnMeta) => m;
const STATUS: Record<ExceptionStatus, Status> = { open: "medium", investigating: "running", pending_approval: "running", resolved: "ok", verified: "ok", closed: "idle" };
const STATUSES: ("all" | ExceptionStatus)[] = ["all", "open", "investigating", "pending_approval", "resolved", "closed"];
const sev = (s: string): Status => (s === "critical" || s === "high" || s === "low" ? s : "medium");
const label = (s: string) => { const t = s.replace(/_/g, " "); return t.charAt(0).toUpperCase() + t.slice(1); };
const RESOLUTION_TYPES = [
  { value: "steward", label: "Steward resolved" }, { value: "dedup", label: "Resolved by merging duplicates" }, { value: "complex", label: "Complex, several steps" },
  { value: "custom_rule", label: "New rule created" }, { value: "auto_resolved", label: "Auto-resolved" },
];
const ROOT_CAUSES = ["missing_data", "incorrect_data", "duplicate_record", "configuration_gap", "process_gap", "source_system_error", "other"].map((v) => ({ value: v, label: label(v) }));
const TYPES = [{ value: "data_quality", label: "Data quality" }, { value: "business_rule", label: "Business rule" }, { value: "configuration", label: "Configuration" }];
const SEVERITIES = ["low", "medium", "high", "critical"].map((v) => ({ value: v, label: label(v) }));
const DONE = new Set<ExceptionStatus>(["resolved", "verified", "closed"]);

const Part = ({ title, children }: { title: string; children: ReactNode }) => (
  <section className="ui-detail-part"><h3 className="ui-detail-part__title">{title}</h3>{children}</section>
);

export function ExceptionsSurface() {
  const qc = useQueryClient();
  const { can } = useRole();
  // Backend guards (api/routes/exceptions.py): requesting needs `analyse`, resolving and escalating need `approve`.
  const canRequest = can("analyse");
  const canApprove = can("approve");
  const [status, setStatus] = useUrlState("status", "all");
  const drawer = useDrawerParam("exception");
  const [requesting, setRequesting] = useState(false);
  const [search, setSearch] = useState("");

  const q = useQuery({ queryKey: ["exceptions.list", { status }], queryFn: () => getExceptions({ per_page: 100, status: status === "all" ? undefined : status }) });
  const items = useMemo(() => q.data?.exceptions ?? [], [q.data]);
  const total = q.data?.total ?? items.length;
  // Tenant-wide KPIs from the server, independent of the status filter and the 100-row page.
  const mq = useQuery({ queryKey: ["exceptions.metrics"], queryFn: () => getExceptionMetrics() });
  const m = mq.data;
  const resolvedAny = !!m?.avg_resolution_hours;
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["exceptions.list"] });
    qc.invalidateQueries({ queryKey: ["exceptions.metrics"] });
  };
  const needle = search.trim().toLowerCase();
  const visible = needle ? items.filter((e) => `${e.title} ${e.category} ${e.source_system ?? ""} ${e.assigned_to ?? ""}`.toLowerCase().includes(needle)) : items;
  const selected = drawer.value ? items.find((e) => e.id === drawer.value) ?? null : null;

  const columns = useMemo<ColumnDef<Exception, unknown>[]>(() => [
    { id: "status", header: "Status", meta: meta({ sticky: "start", width: 150 }), cell: ({ row }) => <StatusBadge status={STATUS[row.original.status]}>{label(row.original.status)}</StatusBadge> },
    { id: "title", header: "Exception", meta: meta({ minWidth: 280 }), cell: ({ row }) => (
      <span className="ui-cell-stack">
        <span className="ui-cell-stack__main">{row.original.title}</span>
        <span className="ui-cell-stack__sub"><span>{label(row.original.type)}</span><span>{row.original.category}</span>{row.original.source_system ? <Mono>{row.original.source_system}</Mono> : null}</span>
      </span>) },
    { id: "severity", header: "Severity", meta: meta({ width: 110 }), cell: ({ row }) => <StatusBadge status={sev(row.original.severity)}>{label(sev(row.original.severity))}</StatusBadge> },
    { id: "tier", header: "Tier", meta: meta({ width: 70, align: "end", numeric: true }), cell: ({ row }) => row.original.escalation_tier },
    { id: "assignee", header: "Assigned", meta: meta({ width: 150 }), cell: ({ row }) => row.original.assigned_to ?? "—" },
    { id: "age", header: "Raised", meta: meta({ width: 110, align: "end" }), cell: ({ row }) => relativeTime(row.original.created_at) },
  ], []);

  return (
    <div className="ui-page">
      <PageHeader title="Exceptions"
        summary={q.data ? `${total.toLocaleString()} cases a check could not settle on its own.` : undefined}
        actions={canRequest ? <Button onClick={() => setRequesting(true)}>Request exception</Button> : null} />
      {mq.error ? <Banner tone="warning" title="Exception metrics could not be read">{(mq.error as Error).message}</Banner> : (
        <Tally level={2} label="Exception metrics" figures={[
          { label: "Open", value: m ? m.open_count : null, loading: mq.isLoading, verdict: m?.open_count ? "Cases still to settle." : "No open cases.", href: "/exceptions?status=open" },
          { label: "Past SLA", value: m ? m.overdue_count : null, loading: mq.isLoading, tone: m?.overdue_count ? "danger" : undefined, verdict: m?.overdue_count ? "Open beyond their deadline." : "Nothing past due.", href: "/exceptions?status=open" },
          { label: "Resolved, last 7 days", value: m ? m.resolved_count : null, loading: mq.isLoading, verdict: m?.resolved_count ? "Settled this week." : "Nothing settled this week.", href: "/exceptions?status=resolved" },
          /* With nothing resolved yet the endpoint returns 0 h and 100 %; show a plain word, not made-up figures. */
          { label: "Mean time to resolve", value: m ? (resolvedAny ? Math.round(m.avg_resolution_hours * 10) / 10 : null) : null, unit: resolvedAny ? "h" : undefined, loading: mq.isLoading,
            tone: resolvedAny && m.sla_compliance_pct < 90 ? "warning" : undefined,
            verdict: resolvedAny ? `${Math.round(m.sla_compliance_pct)}% resolved within SLA.` : "Nothing resolved yet.", href: "/exceptions?status=resolved" },
        ]} />
      )}
      <FilterBar search={{ value: search, onChange: setSearch, placeholder: "Search exceptions" }}>
        {STATUSES.map((s) => <Chip key={s} selected={status === s} onClick={() => setStatus(s)}>{s === "all" ? "All" : label(s)}</Chip>)}
      </FilterBar>
      {q.isLoading ? <TableSkeleton rows={8} label="Loading exceptions" />
        : q.error ? <Banner tone="danger" title="Exceptions could not be read">{(q.error as Error).message}</Banner>
        : visible.length ? <DataTable columns={columns} data={visible} getRowId={(e) => e.id} onRowActivate={(e) => drawer.open(e.id)}
            ariaLabel="Exceptions. Use j and k to move, Enter to open." maxHeight="62vh" />
        : <EmptyState action={canRequest && !needle ? <button type="button" className="ui-link-button" onClick={() => setRequesting(true)}>Request exception</button> : undefined}>
            {needle || status !== "all" ? "No exceptions match this view." : "No exceptions raised. Raise one when a finding needs a decision a check cannot make."}
          </EmptyState>}

      <DetailDrawer open={!!selected} onClose={drawer.close} ariaLabel="Exception details"
        header={selected ? (
          <div className="ui-drawer-head">
            <StatusBadge status={STATUS[selected.status]}>{label(selected.status)}</StatusBadge>
            <h2 className="ui-drawer-head__title">{selected.title}</h2>
          </div>) : null}>
        {selected ? <ExceptionDetail exception={selected} canApprove={canApprove} onChanged={refresh} /> : null}
      </DetailDrawer>
      <DetailDrawer open={requesting} onClose={() => setRequesting(false)} ariaLabel="Request an exception"
        header={<div className="ui-drawer-head"><h2 className="ui-drawer-head__title">Request an exception</h2></div>}>
        {requesting ? <RequestForm onDone={() => { setRequesting(false); refresh(); }} /> : null}
      </DetailDrawer>
    </div>
  );
}

function ExceptionDetail({ exception: e, canApprove, onChanged }: { exception: Exception; canApprove: boolean; onChanged: () => void }) {
  const [resolving, setResolving] = useState(false);
  const [escalating, setEscalating] = useState(false);
  const [r, setR] = useState({ resolution_type: "steward", root_cause_category: "incorrect_data", resolution_notes: "" });
  const resolve = useMutation({
    mutationFn: () => resolveException(e.id, r),
    onSuccess: () => { toast.success("Exception resolved"); setResolving(false); onChanged(); },
    onError: (err) => toast.error((err as Error).message || "Not resolved"),
  });
  const escalate = useMutation({
    mutationFn: () => escalateException(e.id, { reason: "Escalated from the workbench" }),
    onSuccess: (d) => { toast.success(`Escalated to tier ${d.escalation_tier}`); setEscalating(false); onChanged(); },
    onError: (err) => toast.error((err as Error).message || "Not escalated"),
  });
  return (
    <div className="ui-detail">
      <p className="ui-note">{e.description}</p>
      <KeyValue rows={[
        { k: "Type", v: label(e.type) }, { k: "Category", v: e.category }, { k: "Severity", v: label(e.severity) },
        { k: "Source", v: e.source_system ?? "—", mono: !!e.source_system }, { k: "Reference", v: e.source_reference ?? "—", mono: !!e.source_reference },
        { k: "Assigned", v: e.assigned_to ?? "—" }, { k: "Escalation tier", v: String(e.escalation_tier) },
        { k: "SLA", v: e.sla_deadline ? formatDate(e.sla_deadline, "datetime") : "—" },
        { k: "Raised", v: relativeTime(e.created_at) }, { k: "Resolved", v: e.resolved_at ? relativeTime(e.resolved_at) : "—" },
        { k: "Root cause", v: e.root_cause_category ? label(e.root_cause_category) : "—" }, { k: "Resolution", v: e.resolution_type ? label(e.resolution_type) : "—" },
      ]} />
      {e.resolution_notes ? <Part title="Resolution notes"><p className="ui-note">{e.resolution_notes}</p></Part> : null}
      {e.comments?.length ? (
        <Part title="Comments">
          <ul className="ui-plain-list">{e.comments.map((c, i) => (
            <li key={i}>{c.text} <span className="ui-micro">{c.user_name ?? "Someone"}, {relativeTime(c.created_at)}</span></li>
          ))}</ul>
        </Part>
      ) : null}
      {resolving ? (
        <form className="ui-stack" style={{ gap: "var(--aurora-space-3)" }} onSubmit={(ev) => { ev.preventDefault(); if (r.resolution_notes.trim()) resolve.mutate(); }}>
          <div className="ui-fields">
            <Field label="Resolution type">{({ controlId }) => <Select id={controlId} options={RESOLUTION_TYPES} value={r.resolution_type} onValueChange={(v) => setR({ ...r, resolution_type: v })} />}</Field>
            <Field label="Root cause">{({ controlId }) => <Select id={controlId} options={ROOT_CAUSES} value={r.root_cause_category} onValueChange={(v) => setR({ ...r, root_cause_category: v })} />}</Field>
          </div>
          <Field label="Resolution notes" required helper="Resolution type sets the billing tier. Root cause feeds the trend analytics.">
            {({ controlId }) => <Textarea id={controlId} value={r.resolution_notes} onChange={(ev) => setR({ ...r, resolution_notes: ev.target.value })} placeholder="What was done to resolve this exception?" required />}
          </Field>
          <div className="ui-page-header__actions">
            <Button type="submit" disabled={!r.resolution_notes.trim() || resolve.isPending}>{resolve.isPending ? "Resolving" : "Resolve exception"}</Button>
            <Button type="button" variant="ghost" onClick={() => setResolving(false)}>Keep open</Button>
          </div>
        </form>
      ) : escalating ? (
        <Banner tone="warning" title={`Escalate to tier ${e.escalation_tier + 1}?`} action={
          <div className="ui-page-header__actions">
            <Button size="sm" onClick={() => escalate.mutate()} disabled={escalate.isPending}>{escalate.isPending ? "Escalating" : "Escalate"}</Button>
            <Button size="sm" variant="ghost" onClick={() => setEscalating(false)}>Not now</Button>
          </div>}>
          The next tier is told and takes the case.
        </Banner>
      ) : (
        <div className="ui-page-header__actions">
          {canApprove && !DONE.has(e.status) ? <Button onClick={() => setResolving(true)}>Resolve</Button> : null}
          {canApprove && !DONE.has(e.status) ? <Button variant="secondary" onClick={() => setEscalating(true)}>Escalate</Button> : null}
          <Button variant="ghost" onClick={() => copyToClipboard(e.id, "Exception ID copied")}>Copy ID</Button>
        </div>
      )}
    </div>
  );
}

function RequestForm({ onDone }: { onDone: () => void }) {
  const [d, setD] = useState({ title: "", description: "", type: "data_quality", category: "general", severity: "medium" });
  const create = useMutation({ mutationFn: () => createException(d), onSuccess: () => { toast.success("Exception raised"); onDone(); }, onError: (e) => toast.error((e as Error).message || "Not raised") });
  const valid = d.title.trim() && d.description.trim();
  return (
    <form className="ui-stack" style={{ gap: "var(--aurora-space-3)" }} onSubmit={(e) => { e.preventDefault(); if (valid) create.mutate(); }}>
      <Field label="Title" required>{({ controlId }) => <Input id={controlId} value={d.title} onChange={(e) => setD({ ...d, title: e.target.value })} placeholder="Brief summary" required />}</Field>
      <Field label="Description" required>{({ controlId }) => <Textarea id={controlId} value={d.description} onChange={(e) => setD({ ...d, description: e.target.value })} placeholder="What needs an exception, and why?" required />}</Field>
      <div className="ui-fields">
        <Field label="Type">{({ controlId }) => <Select id={controlId} options={TYPES} value={d.type} onValueChange={(v) => setD({ ...d, type: v })} />}</Field>
        <Field label="Category">{({ controlId }) => <Input id={controlId} value={d.category} onChange={(e) => setD({ ...d, category: e.target.value })} />}</Field>
        <Field label="Severity">{({ controlId }) => <Select id={controlId} options={SEVERITIES} value={d.severity} onValueChange={(v) => setD({ ...d, severity: v })} />}</Field>
      </div>
      <div className="ui-page-header__actions"><Button type="submit" disabled={!valid || create.isPending}>{create.isPending ? "Raising" : "Raise exception"}</Button></div>
    </form>
  );
}
