"use client";

/**
 * Workbench, Remediation batches: group open record issues into a batch,
 * set the value each field should hold, have a second person approve it,
 * then export a file to load into SAP. Meridian never writes to SAP; the
 * next extraction reconciles each item as fixed or still failing.
 */

import { useDeferredValue, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import {
  Banner, Button, DataTable, DetailDrawer, EmptyState, Input, KeyValue, Metric, MetricStrip, Mono, PageHeader,
  StatusBadge, TableSkeleton, useDrawerParam, type AuroraColumnMeta, type Status,
} from "@/components/ui-core";
import { Field, Select } from "@/components/aurora";
import { useAuth } from "@/context/auth-context";
import { useRole } from "@/hooks/use-role";
import { getIssues, type IssueFilter } from "@/lib/api/issues";
import {
  approveBatch, createBatch, errorDetail, exportBatch, getBatch, getBatchEvents, listBatches, proposeValue,
  type BatchItem, type BatchStatus, type BatchSummary, type ExportFormat,
} from "@/lib/api/remediation";
import { formatModuleName, relativeTime } from "@/lib/format";

const meta = (m: AuroraColumnMeta) => m;
const STATUS: Record<BatchStatus, [Status, string]> = { draft: ["idle", "Draft"], approved: ["running", "Approved"], exported: ["ok", "Exported"] };
const FORMATS: [ExportFormat, string][] = [["cockpit_xlsx", "Migration cockpit workbook"], ["cockpit_csv", "Migration cockpit CSV"], ["mass_change_csv", "Mass change CSV"]];
const ANY = [{ value: "", label: "Any" }];
const SEVERITIES = [...ANY, ...["critical", "high", "medium", "low"].map((v) => ({ value: v, label: v[0].toUpperCase() + v.slice(1) }))];
const STATUSES = [...ANY, { value: "open", label: "Open" }, { value: "in_progress", label: "In progress" }];
const PAGE = 200;

export function RemediationSurface() {
  const { can } = useRole();
  const drawer = useDrawerParam("batch");
  const [creating, setCreating] = useState(false);
  const q = useQuery({ queryKey: ["remediation.batches"], queryFn: listBatches });
  const batches = q.data?.items ?? [];
  const count = (s: BatchStatus) => batches.filter((b) => b.status === s).length;

  const columns = useMemo<ColumnDef<BatchSummary, unknown>[]>(() => [
    { id: "name", header: "Batch", meta: meta({ sticky: "start", minWidth: 220 }), cell: ({ row }) => row.original.name },
    { id: "status", header: "Status", meta: meta({ width: 120 }), cell: ({ row }) => {
      const [s, l] = STATUS[row.original.status];
      return <StatusBadge status={s}>{l}</StatusBadge>;
    } },
    { id: "items", header: "Items", meta: meta({ width: 90, align: "end", numeric: true }), cell: ({ row }) => row.original.items.toLocaleString() },
    { id: "proposal", header: "With a value", meta: meta({ width: 120, align: "end", numeric: true }), cell: ({ row }) => row.original.with_proposal.toLocaleString() },
    { id: "fixed", header: "Fixed", meta: meta({ width: 90, align: "end", numeric: true }), cell: ({ row }) => row.original.fixed.toLocaleString() },
    { id: "failing", header: "Still failing", meta: meta({ width: 120, align: "end", numeric: true }), cell: ({ row }) => row.original.still_failing.toLocaleString() },
    { id: "by", header: "Built by", meta: meta({ width: 160 }), cell: ({ row }) => row.original.created_by_label ?? "—" },
    { id: "when", header: "Built", meta: meta({ width: 110, align: "end" }), cell: ({ row }) => relativeTime(row.original.created_at) },
  ], []);

  const unavailable = q.data && !q.data.available;
  return (
    <div className="ui-page">
      <PageHeader title="Remediation batches"
        summary={q.data?.available ? `${batches.length} batch${batches.length === 1 ? "" : "es"}. ${count("draft")} in draft, ${count("approved")} approved and waiting for export.` : undefined}
        actions={can("apply") && !unavailable ? <Button onClick={() => setCreating(true)}>Build a batch</Button> : null} />
      <p className="ui-notice">
        <span>Meridian produces files for you to load into SAP. It never writes to SAP. After the load, the next extraction marks each item fixed or still failing.</span>
      </p>
      {q.data?.available ? (
        <MetricStrip label="Batches">
          <Metric label="Draft" value={count("draft")} />
          <Metric label="Approved" value={count("approved")} />
          <Metric label="Exported" value={count("exported")} />
          <Metric label="Items fixed" value={batches.reduce((a, b) => a + b.fixed, 0)} />
          <Metric label="Still failing" value={batches.reduce((a, b) => a + b.still_failing, 0)} tone={batches.some((b) => b.still_failing) ? "danger" : "default"} />
        </MetricStrip>
      ) : null}
      {q.isLoading ? <TableSkeleton rows={6} label="Loading remediation batches" />
        : q.error ? <Banner tone="danger" title="Remediation batches could not be read">{errorDetail(q.error)}</Banner>
        : unavailable ? <EmptyState>Remediation batches are not available on this server yet. Update Meridian to build correction files.</EmptyState>
        : batches.length ? <DataTable columns={columns} data={batches} getRowId={(b) => b.id} onRowActivate={(b) => drawer.open(b.id)}
            ariaLabel="Remediation batches. Use j and k to move, Enter to open." maxHeight="62vh" />
        : <EmptyState action={can("apply") ? <button type="button" className="ui-link-button" onClick={() => setCreating(true)}>Build a batch</button> : undefined}>
            No batches yet. Build one from the open record issues you want to correct.
          </EmptyState>}

      <DetailDrawer open={creating} onClose={() => setCreating(false)} ariaLabel="Build a batch"
        header={<div className="ui-drawer-head"><h2 className="ui-drawer-head__title">Build a batch</h2></div>}>
        {creating ? <CreateBatch onDone={(id) => { setCreating(false); drawer.open(id); }} /> : null}
      </DetailDrawer>
      <DetailDrawer open={!!drawer.value && !creating} onClose={drawer.close} ariaLabel="Batch details"
        header={<BatchHead id={drawer.value} />}>
        {drawer.value ? <BatchDetail id={drawer.value} /> : null}
      </DetailDrawer>
    </div>
  );
}

function CreateBatch({ onDone }: { onDone: (id: string) => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [f, setF] = useState<IssueFilter>({ status: "open" });
  const filter = useDeferredValue(f);
  // Drop empty fields so the preview and the batch see the same filter.
  const clean = useMemo(() => Object.fromEntries(Object.entries(filter).filter(([, v]) => v)) as IssueFilter, [filter]);
  const preview = useQuery({ queryKey: ["issues", "count", clean], queryFn: () => getIssues({ ...clean, limit: 1 }) });
  const create = useMutation({
    mutationFn: () => createBatch({ name: name.trim(), filter: clean }),
    onSuccess: (d) => {
      toast.success(`Batch built with ${d.items.toLocaleString()} item${d.items === 1 ? "" : "s"}, ${d.with_proposal.toLocaleString()} with a proposed value`);
      qc.invalidateQueries({ queryKey: ["remediation.batches"] });
      onDone(d.id);
    },
    onError: (e) => toast.error(errorDetail(e)),
  });
  const set = (k: keyof IssueFilter) => (v: string) => setF({ ...f, [k]: v });
  const n = preview.data?.total;
  return (
    <form className="ui-detail" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
      <Field label="Name" required>{({ controlId }) => <Input id={controlId} value={name} maxLength={200} required onChange={(e) => setName(e.target.value)} placeholder="Vendor tax numbers, company code 1000" />}</Field>
      <p className="ui-note">Pick the record issues to correct. Rule-based fixes fill in proposed values; you can edit them while the batch is a draft.</p>
      <div className="ui-fields">
        <Field label="Issue status">{({ controlId }) => <Select id={controlId} options={STATUSES} value={f.status ?? ""} onValueChange={set("status")} />}</Field>
        <Field label="Severity">{({ controlId }) => <Select id={controlId} options={SEVERITIES} value={f.severity ?? ""} onValueChange={set("severity")} />}</Field>
      </div>
      <div className="ui-fields">
        <Field label="Object">{({ controlId }) => <Input id={controlId} value={f.module ?? ""} onChange={(e) => set("module")(e.target.value)} placeholder="vendor_master" />}</Field>
        <Field label="Check ID">{({ controlId }) => <Input id={controlId} value={f.check_id ?? ""} onChange={(e) => set("check_id")(e.target.value)} />}</Field>
      </div>
      <Field label="Record key contains">{({ controlId }) => <Input id={controlId} value={f.search ?? ""} onChange={(e) => set("search")(e.target.value)} />}</Field>
      <p className="ui-note" aria-live="polite">
        {preview.isLoading ? "Counting matching issues." : preview.error ? errorDetail(preview.error)
          : n === 0 ? "No issues match this filter." : n != null ? `${n.toLocaleString()} issue${n === 1 ? "" : "s"} match.${n > 50000 ? " A batch holds at most 50,000; narrow the filter." : ""}` : null}
      </p>
      <div className="ui-page-header__actions">
        <Button type="submit" disabled={!name.trim() || !n || n > 50000 || create.isPending}>{create.isPending ? "Building" : "Build batch"}</Button>
      </div>
    </form>
  );
}

function useBatch(id: string | null) {
  return useQuery({ queryKey: ["remediation.batch", id], queryFn: () => getBatch(id!), enabled: !!id });
}

function BatchHead({ id }: { id: string | null }) {
  const b = useBatch(id).data?.batch;
  if (!b) return <div className="ui-drawer-head"><h2 className="ui-drawer-head__title">Batch</h2></div>;
  const [s, l] = STATUS[b.status];
  return <div className="ui-drawer-head"><StatusBadge status={s}>{l}</StatusBadge><h2 className="ui-drawer-head__title">{b.name}</h2></div>;
}

const Part = ({ title, children }: { title: string; children: ReactNode }) => (
  <section className="ui-detail-part"><h3 className="ui-detail-part__title">{title}</h3>{children}</section>
);

function BatchDetail({ id }: { id: string }) {
  const qc = useQueryClient();
  const { can } = useRole();
  const { user } = useAuth();
  const [shown, setShown] = useState(PAGE);
  const q = useBatch(id);
  const events = useQuery({ queryKey: ["remediation.events", id], queryFn: () => getBatchEvents(id) });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["remediation.batch", id] });
    qc.invalidateQueries({ queryKey: ["remediation.events", id] });
    qc.invalidateQueries({ queryKey: ["remediation.batches"] });
  };
  const approve = useMutation({ mutationFn: () => approveBatch(id), onSuccess: () => { toast.success("Batch approved"); refresh(); }, onError: (e) => toast.error(errorDetail(e)) });
  const exp = useMutation({ mutationFn: (f: ExportFormat) => exportBatch(id, f), onSuccess: () => { toast.success("File exported"); refresh(); }, onError: (e) => toast.error(errorDetail(e)) });

  if (q.isLoading) return <TableSkeleton rows={6} label="Loading the batch" />;
  if (q.error) return <Banner tone="danger" title="This batch could not be read">{errorDetail(q.error)}</Banner>;
  if (!q.data) return <EmptyState>This batch no longer exists.</EmptyState>;
  const { batch: b, items } = q.data;
  const draft = b.status === "draft";
  const editable = draft && can("apply");
  const own = !!user && user.id === b.created_by;
  const missing = items.filter((i) => i.proposed_value == null).length;
  const fixed = items.filter((i) => i.recon_status === "fixed").length;
  const failing = items.filter((i) => i.recon_status === "still_failing").length;

  return (
    <div className="ui-detail">
      <KeyValue rows={[
        { k: "Items", v: `${items.length.toLocaleString()}, ${(items.length - missing).toLocaleString()} with a proposed value` },
        { k: "Built by", v: `${b.created_by_label ?? "Unknown"}, ${relativeTime(b.created_at)}` },
        { k: "Approved by", v: b.approved_at ? `${b.approved_by_label ?? "Unknown"}, ${relativeTime(b.approved_at)}` : "Not yet" },
        { k: "Exported", v: b.exported_at ? relativeTime(b.exported_at) : "Not yet" },
        { k: "Reconciled", v: fixed || failing ? `${fixed} fixed, ${failing} still failing` : "After the next extraction" },
      ]} />

      {draft ? (
        <Part title="Approval">
          {missing ? <p className="ui-note">{missing.toLocaleString()} item{missing === 1 ? " has" : "s have"} no proposed value and will be left out of the file.</p> : null}
          {own ? <p className="ui-note">You built this batch. Another approver must approve it.</p> : null}
          {can("approve") ? (
            <div className="ui-page-header__actions">
              <Button onClick={() => approve.mutate()} disabled={own || approve.isPending}>{approve.isPending ? "Approving" : "Approve batch"}</Button>
            </div>
          ) : <p className="ui-micro">Approving needs the approver role.</p>}
        </Part>
      ) : null}

      {!draft ? (
        <Part title="Export">
          <p className="ui-note">Download a file and load it into SAP with your usual tool. Meridian does not send it anywhere.</p>
          {can("export") ? (
            <div className="ui-page-header__actions">
              {FORMATS.map(([f, l]) => <Button key={f} variant="secondary" onClick={() => exp.mutate(f)} disabled={exp.isPending}>{l}</Button>)}
            </div>
          ) : <p className="ui-micro">Exporting needs the export permission.</p>}
        </Part>
      ) : null}

      <Part title="Items">
        {!draft ? <p className="ui-micro">Proposed values are locked once a batch is approved.</p> : null}
        <div className="ui-matrix-scroll"><table className="ui-mini-table">
          <thead><tr>
            <th scope="col">Record</th><th scope="col">Field</th><th scope="col">Current</th><th scope="col">Proposed</th><th scope="col">Result</th>
          </tr></thead>
          <tbody>{items.slice(0, shown).map((i) => (
            <tr key={i.id}>
              <td><div className="ui-cell-stack"><Mono>{i.record_key}</Mono><span className="ui-micro">{formatModuleName(i.module)}, {i.check_id}</span></div></td>
              <td><Mono>{i.field ?? "—"}</Mono></td>
              <td><Mono>{i.current_value ?? "—"}</Mono></td>
              <td>{editable ? <ProposedCell batchId={id} item={i} onSaved={refresh} /> : <Mono>{i.proposed_value ?? "—"}</Mono>}</td>
              <td>{i.recon_status === "fixed" ? <StatusBadge status="ok">Fixed</StatusBadge>
                : i.recon_status === "still_failing" ? <StatusBadge status="failed">Still failing</StatusBadge>
                : <span className="ui-micro">Pending</span>}</td>
            </tr>
          ))}</tbody>
        </table></div>
        {items.length > shown ? (
          <button type="button" className="ui-link-button" onClick={() => setShown(shown + PAGE)}>
            Show {Math.min(PAGE, items.length - shown)} more of {(items.length - shown).toLocaleString()}
          </button>
        ) : null}
      </Part>

      <Part title="History">
        {events.data?.length ? (
          <ul className="ui-plain-list">{events.data.map((e, n) => (
            <li key={n}>
              {e.user_label ?? "Meridian"} {e.action}
              {e.from_value || e.to_value ? <>{e.action === "proposed" ? " a value" : ""} from <Mono>{e.from_value ?? "none"}</Mono> to <Mono>{e.to_value ?? "none"}</Mono></> : null}
              , <span className="ui-micro">{relativeTime(e.created_at)}</span>
            </li>
          ))}</ul>
        ) : <p className="ui-micro">{events.isLoading ? "Loading history." : "No history yet."}</p>}
      </Part>
    </div>
  );
}

function ProposedCell({ batchId, item, onSaved }: { batchId: string; item: BatchItem; onSaved: () => void }) {
  const [v, setV] = useState(item.proposed_value ?? "");
  const save = useMutation({
    mutationFn: () => proposeValue(batchId, item.id, v.trim() === "" ? null : v),
    onSuccess: () => { toast.success("Proposed value saved"); onSaved(); },
    onError: (e) => { toast.error(errorDetail(e)); setV(item.proposed_value ?? ""); },
  });
  const commit = () => { if (v !== (item.proposed_value ?? "")) save.mutate(); };
  return (
    <Input aria-label={`Proposed value for ${item.record_key} ${item.field ?? ""}`} value={v} disabled={save.isPending}
      onChange={(e) => setV(e.target.value)} onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") setV(item.proposed_value ?? ""); }} />
  );
}
