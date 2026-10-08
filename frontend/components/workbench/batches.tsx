"use client";

/**
 * Workbench, Fix batches: batches of record-level corrections drafted by a
 * rule, a steward, or the post-cleanup monitor. A batch needs one person to
 * accept or write its proposals and a second person to approve before it can
 * be exported — Meridian never posts to SAP, only hands a file to the
 * Migration Cockpit or a mass-change template.
 *
 * The monitoring section above the table compares each system's latest run
 * with its pinned post-cleanup baseline, so a steward sees regressions
 * before they open a batch.
 */

import { useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import {
  Banner, Button, DataTable, DetailDrawer, EmptyState, FilterBar, Input, KeyValue, Mono, Pager,
  PageHeader, Select, StatusBadge, TableSkeleton, Tally, useDrawerParam, type AuroraColumnMeta,
  type Status, CountChips, SectionCard,
} from "@/components/ui-core";
import { useAuth } from "@/context/auth-context";
import { useRole } from "@/hooks/use-role";
import { useUrlState } from "@/hooks/use-url-state";
import {
  acceptHighConfidence, approveBatch, errorText, exportBatch, getBatch, getBatchEvents, getMonitor, listBatches,
  patchItem, CONFIDENCE_LABEL, EVENT_LABEL, FORMAT_LABEL, RECON_LABEL, SOURCE_LABEL, STATUS_LABEL,
  type BatchItem, type BatchStatus, type BatchSummary, type ExportFormat, type MonitorItem,
} from "@/lib/api/remediation";
import { formatDate, relativeTime } from "@/lib/format";

const meta = (m: AuroraColumnMeta) => m;

/** A run older than this since the last check is stale: the monitor may not have seen recent SAP changes. */
const STALE_AFTER_MS = 36 * 60 * 60 * 1000;

const STATUS_TONE: Record<BatchStatus, Status> = { draft: "idle", approved: "running", exported: "ok" };

const ITEM_PAGE_SIZE = 100;

const FORMATS: { value: ExportFormat; label: string }[] = Object.entries(FORMAT_LABEL).map(([value, label]) => ({
  value: value as ExportFormat, label,
}));

function pct(n: number, total: number): number {
  return total ? Math.round((n / total) * 100) : 0;
}

/** "scope" is a system id or "upload"; show the system's own name instead. */
function scopeLabel(m: MonitorItem): string {
  return m.system_name ?? (m.scope === "upload" ? "Imported files" : m.scope);
}

/** The Fix batches surface: batch list with monitoring above it, and a batch's detail in a drawer. */
export function FixBatchesSurface() {
  const { user } = useAuth();
  const { can } = useRole();
  // Backend guards (api/routes/remediation.py): accept/approve need `approve`, export needs `export`.
  const canApprove = can("approve");
  const canExport = can("export");
  const [status, setStatus] = useUrlState("status");
  const [sort, setSort] = useUrlState("sort", "created_at:desc");
  const [search, setSearch] = useUrlState("q");
  const drawer = useDrawerParam("batch");

  const q = useQuery({ queryKey: ["remediation", "batches"], queryFn: listBatches });
  const batches = q.data?.items ?? [];

  const counts = batches.reduce((a, b) => ({ ...a, [b.status]: a[b.status] + 1 }), { draft: 0, approved: 0, exported: 0 } as Record<BatchStatus, number>);
  const waitingExport = batches.filter((b) => b.status === "approved").length;
  const stillFailing = batches.reduce((n, b) => n + (b.status === "exported" ? b.still_failing : 0), 0);

  const needle = search.trim().toLowerCase();
  const visible = batches
    .filter((b) => !status || b.status === status)
    .filter((b) => !needle || b.name.toLowerCase().includes(needle));

  const selected = drawer.value ? batches.find((b) => b.id === drawer.value) ?? null : null;

  const columns = useMemo<ColumnDef<BatchSummary, unknown>[]>(() => [
    { id: "name", header: "Batch", accessorFn: (b) => b.name, meta: meta({ sticky: "start", minWidth: 280 }) },
    { id: "status", header: "Status", accessorFn: (b) => STATUS_LABEL[b.status], meta: meta({ width: 130 }),
      cell: ({ row }) => <StatusBadge status={row.original.status === "exported" ? "ok" : STATUS_TONE[row.original.status]}>{STATUS_LABEL[row.original.status]}</StatusBadge> },
    { id: "items", header: "Items", accessorFn: (b) => b.items, meta: meta({ width: 90, align: "end", numeric: true }) },
    { id: "with_proposal", header: "With proposal", accessorFn: (b) => b.with_proposal, meta: meta({ width: 150, align: "end", numeric: true }),
      cell: ({ row }) => <>{row.original.with_proposal.toLocaleString()}<span className="ui-micro"> ({pct(row.original.with_proposal, row.original.items)}%)</span></> },
    { id: "auto_approvable", header: "Auto-approvable", accessorFn: (b) => b.auto_approvable, meta: meta({ width: 150, align: "end", numeric: true }) },
    { id: "fixed", header: "Fixed", accessorFn: (b) => (b.status === "exported" ? b.fixed : null), meta: meta({ width: 90, align: "end", numeric: true }),
      cell: ({ row }) => (row.original.status === "exported" ? row.original.fixed.toLocaleString() : "—") },
    { id: "still_failing", header: "Still failing", accessorFn: (b) => (b.status === "exported" ? b.still_failing : null), meta: meta({ width: 120, align: "end", numeric: true }),
      cell: ({ row }) => {
        if (row.original.status !== "exported") return "—";
        const n = row.original.still_failing;
        return n > 0 ? <span className="ui-delta-up">{n.toLocaleString()}</span> : "0";
      } },
    { id: "created_at", header: "Created", accessorFn: (b) => b.created_at, meta: meta({ width: 170, align: "end" }),
      cell: ({ row }) => formatDate(row.original.created_at, "datetime") },
  ], []);

  const sorted = (() => {
    if (!sort) return visible;
    const [key, dir] = sort.split(":");
    const sign = dir === "desc" ? -1 : 1;
    return [...visible].sort((a, b) => {
      const av = (a as unknown as Record<string, unknown>)[key];
      const bv = (b as unknown as Record<string, unknown>)[key];
      if (av == null || bv == null) return 0;
      return av < bv ? -sign : av > bv ? sign : 0;
    });
  })();

  return (
    <div className="ui-page">
      <PageHeader title="Fix batches"
        summary={q.data ? `${batches.length.toLocaleString()} fix batch${batches.length === 1 ? "" : "es"}. ${counts.draft} draft, ${waitingExport} waiting for export.` : undefined} />

      <MonitoringSection />

      <Tally level={2} label="Fix batches" figures={[
        { label: "Draft batches", value: q.isLoading ? null : counts.draft, loading: q.isLoading, verdict: counts.draft ? "Waiting for proposals to be accepted and approved." : "No batches in draft.", href: "/remediation?status=draft" },
        { label: "Waiting for export", value: q.isLoading ? null : waitingExport, loading: q.isLoading, tone: waitingExport ? "warning" : undefined, verdict: waitingExport ? "Approved but not exported yet." : "Nothing waiting for export.", href: "/remediation?status=approved" },
        { label: "Still failing after export", value: q.isLoading ? null : stillFailing, loading: q.isLoading, tone: stillFailing ? "warning" : undefined, verdict: stillFailing ? "Exported records that were checked again and still fail." : "No exported record is still failing.", href: "/remediation?status=exported" },
      ]} />

      <FilterBar search={{ value: search, onChange: setSearch, placeholder: "Search batches" }} onClear={status || search ? () => { setStatus(""); setSearch(""); } : undefined}>
        <CountChips value={status} onChange={setStatus} total={batches.length}
          options={(Object.keys(STATUS_LABEL) as BatchStatus[]).map((s) => ({ value: s, label: STATUS_LABEL[s], count: counts[s] }))} />
      </FilterBar>

      {q.isLoading ? <TableSkeleton rows={8} label="Loading fix batches" />
        : q.error ? <Banner tone="danger" title="Fix batches could not be read">{errorText(q.error)}</Banner>
        : sorted.length ? <DataTable columns={columns} data={sorted} getRowId={(b) => b.id} onRowActivate={(b) => drawer.open(b.id)}
            ariaLabel="Fix batches. Use j and k to move, Enter to open." maxHeight="56vh" sort={sort} onSortChange={setSort} />
        : <EmptyState action={needle || status ? <button type="button" className="ui-link-button" onClick={() => { setSearch(""); setStatus(""); }}>Show everything</button> : undefined}>
            {needle || status ? "Nothing in this view." : "No fix batches yet. A rule, a steward, or the monitor drafts one when records need a correction."}
          </EmptyState>}

      <DetailDrawer open={!!selected} onClose={drawer.close} ariaLabel="Batch details"
        header={selected ? (
          <div className="ui-drawer-head">
            <StatusBadge status={selected.status === "exported" ? "ok" : STATUS_TONE[selected.status]}>{STATUS_LABEL[selected.status]}</StatusBadge>
            <h2 className="ui-drawer-head__title">{selected.name}</h2>
          </div>) : null}>
        {selected ? <BatchDetailBody batchId={selected.id} currentUserId={user?.id ?? null} canApprove={canApprove} canExport={canExport} /> : null}
      </DetailDrawer>
    </div>
  );
}

const Part = ({ title, children }: { title: string; children: ReactNode }) => (
  <section className="ui-detail-part"><h3 className="ui-detail-part__title">{title}</h3>{children}</section>
);

function BatchDetailBody({ batchId, currentUserId, canApprove, canExport }: {
  batchId: string; currentUserId: string | null; canApprove: boolean; canExport: boolean;
}) {
  const qc = useQueryClient();
  const detail = useQuery({ queryKey: ["remediation", "batch", batchId], queryFn: () => getBatch(batchId) });
  const events = useQuery({ queryKey: ["remediation", "events", batchId], queryFn: () => getBatchEvents(batchId) });
  const [itemOffset, setItemOffset] = useState(0);
  const [editing, setEditing] = useState<string | null>(null);
  const [draftValue, setDraftValue] = useState("");
  const [format, setFormat] = useState<ExportFormat>("cockpit_xlsx");
  const [ask, setAsk] = useState<"approve" | "export" | null>(null);

  const refresh = () => qc.invalidateQueries({ queryKey: ["remediation"] });

  const accept = useMutation({
    mutationFn: () => acceptHighConfidence(batchId),
    onSuccess: (d) => { toast.success(`Accepted ${d.accepted.toLocaleString()} high-confidence proposal${d.accepted === 1 ? "" : "s"}`); refresh(); },
    onError: (e) => toast.error(errorText(e)),
  });
  const approve = useMutation({
    mutationFn: () => approveBatch(batchId),
    onSuccess: () => { toast.success("Batch approved"); setAsk(null); refresh(); },
    onError: (e) => toast.error(errorText(e)),
  });
  const patch = useMutation({
    mutationFn: ({ itemId, value }: { itemId: string; value: string | null }) => patchItem(batchId, itemId, value),
    onSuccess: () => { setEditing(null); refresh(); },
    onError: (e) => toast.error(errorText(e)),
  });
  const doExport = useMutation({
    mutationFn: () => exportBatch(batchId, format),
    onSuccess: () => { toast.success("Export ready"); setAsk(null); refresh(); },
    onError: (e) => toast.error(errorText(e)),
  });

  const columns: ColumnDef<BatchItem, unknown>[] = [
    { id: "record_key", header: "Record", accessorFn: (i) => i.record_key, meta: meta({ sticky: "start", width: 200 }), cell: ({ row }) => <Mono>{row.original.record_key}</Mono> },
    { id: "field", header: "Field", accessorFn: (i) => i.field ?? "", meta: meta({ width: 130 }), cell: ({ row }) => (row.original.field ? <Mono>{row.original.field}</Mono> : "—") },
    { id: "current_value", header: "Current", accessorFn: (i) => i.current_value ?? "", meta: meta({ width: 160 }), cell: ({ row }) => row.original.current_value ?? "—" },
    { id: "proposed_value", header: "Proposed", enableSorting: false, meta: meta({ minWidth: 200 }), cell: ({ row }) => {
      const i = row.original;
      if (editing === i.id) {
        return (
          <Input autoFocus value={draftValue} onChange={(e) => setDraftValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") patch.mutate({ itemId: i.id, value: draftValue || null });
              if (e.key === "Escape") setEditing(null);
            }}
            onBlur={() => setEditing(null)} />
        );
      }
      return (
        <button type="button" className="ui-link-button" disabled={i.accepted || !canApprove}
          title={i.accepted ? "An accepted proposal cannot be edited." : undefined}
          onClick={() => { setEditing(i.id); setDraftValue(i.proposed_value ?? ""); }}>
          {i.proposed_value ?? "—"}
        </button>
      );
    } },
    { id: "proposal_source", header: "Source", accessorFn: (i) => SOURCE_LABEL[i.proposal_source], meta: meta({ width: 100 }) },
    { id: "confidence", header: "Confidence", accessorFn: (i) => (i.confidence ? CONFIDENCE_LABEL[i.confidence] : ""), meta: meta({ width: 100 }),
      cell: ({ row }) => row.original.confidence ? CONFIDENCE_LABEL[row.original.confidence] : "—" },
    { id: "accepted", header: "Accepted", accessorFn: (i) => (i.accepted ? "Accepted" : "Not yet"), meta: meta({ width: 100 }) },
    { id: "recon_status", header: "Reconciled", accessorFn: (i) => (i.recon_status ? RECON_LABEL[i.recon_status] : ""), meta: meta({ width: 120 }),
      cell: ({ row }) => row.original.recon_status ? RECON_LABEL[row.original.recon_status] : "—" },
    { id: "updated_at", header: "Updated", accessorFn: (i) => i.updated_at, meta: meta({ width: 160, align: "end" }), cell: ({ row }) => relativeTime(row.original.updated_at) },
  ];

  if (detail.isLoading) return <TableSkeleton rows={6} label="Loading batch" />;
  if (detail.error) return <EmptyState>This batch could not be found. It may have been removed.</EmptyState>;
  if (!detail.data) return <EmptyState>This batch could not be found. It may have been removed.</EmptyState>;

  const { batch, items } = detail.data;
  const isCreator = !!currentUserId && batch.created_by === currentUserId;
  const highConfidence = items.filter((i) => i.auto_approvable && !i.accepted);
  const page = items.slice(itemOffset, itemOffset + ITEM_PAGE_SIZE);

  const approveTitle = isCreator
    ? "The person who drafted this batch cannot also approve it. Ask a second person to approve."
    : undefined;

  return (
    <div className="ui-detail">
      <KeyValue rows={[
        { k: "Name", v: batch.name },
        { k: "Status", v: STATUS_LABEL[batch.status] },
        { k: "Items", v: items.length.toLocaleString() },
        { k: "With proposal", v: items.filter((i) => i.proposed_value !== null).length.toLocaleString() },
        { k: "Accepted", v: items.filter((i) => i.accepted).length.toLocaleString() },
        { k: "Auto-approvable", v: items.filter((i) => i.auto_approvable).length.toLocaleString() },
        { k: "Created by", v: batch.created_by_label ?? "Meridian monitor" },
        { k: "Created", v: formatDate(batch.created_at, "datetime") },
        { k: "Approved by", v: batch.approved_by_label ?? "—" },
        { k: "Approved", v: batch.approved_at ? formatDate(batch.approved_at, "datetime") : "—" },
        { k: "Exported", v: batch.exported_at ? formatDate(batch.exported_at, "datetime") : "—" },
      ]} />

      {isCreator && batch.status === "draft" ? (
        <Banner tone="info" title="Four-eyes required">A second person must approve this batch before it can be exported.</Banner>
      ) : null}

      {ask ? (
        <Banner tone={ask === "approve" ? "info" : "neutral"}
          title={ask === "approve" ? "Approve this batch?" : "Export this batch?"}
          action={
            <div className="ui-page-header__actions">
              {ask === "export" ? <Select aria-label="Export format" value={format} onValueChange={(v) => setFormat(v as ExportFormat)} options={FORMATS} /> : null}
              <Button size="sm" onClick={() => (ask === "approve" ? approve : doExport).mutate()} disabled={approve.isPending || doExport.isPending}>
                {ask === "approve" ? (approve.isPending ? "Approving…" : "Approve") : (doExport.isPending ? "Preparing…" : "Export")}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setAsk(null)}>Not now</Button>
            </div>}>
          Meridian never posts to SAP. {ask === "export" ? "This hands a file to the Migration Cockpit or a mass-change template." : "This is Meridian's record only."}
        </Banner>
      ) : (
        <div className="ui-page-header__actions">
          {batch.status === "draft" && highConfidence.length && canApprove ? (
            <Button onClick={() => accept.mutate()} disabled={accept.isPending}>Accept {highConfidence.length.toLocaleString()} high-confidence proposal{highConfidence.length === 1 ? "" : "s"}</Button>
          ) : null}
          {batch.status === "draft" ? (
            <Button variant="secondary" disabled={!canApprove || isCreator} title={!canApprove ? "Approving needs the approve permission." : approveTitle} onClick={() => setAsk("approve")}>
              Approve batch
            </Button>
          ) : null}
          {batch.status === "approved" ? (
            <Button disabled={!canExport} title={!canExport ? "Exporting needs the export permission." : undefined} onClick={() => setAsk("export")}>
              Export batch
            </Button>
          ) : null}
          {batch.status === "exported" ? <p className="ui-micro">Exported. Load it with the Migration Cockpit or a mass-change template — Meridian never posts to SAP.</p> : null}
        </div>
      )}

      <Part title="Items">
        {items.length ? (
          <>
            <DataTable columns={columns} data={page} getRowId={(i) => i.id} ariaLabel="Batch items" maxHeight="40vh" sortable={false} />
            {items.length > ITEM_PAGE_SIZE ? <Pager offset={itemOffset} total={items.length} pageSize={ITEM_PAGE_SIZE} onChange={setItemOffset} noun="items" /> : null}
          </>
        ) : <EmptyState>No items in this batch.</EmptyState>}
      </Part>

      {events.data?.items.length ? (
        <Part title="History">
          <ul className="ui-plain-list">
            {events.data.items.map((e, idx) => (
              <li key={`${e.item_id}-${idx}`}>
                {EVENT_LABEL[e.action]}{e.user_label ? ` by ${e.user_label}` : ""}, <span className="ui-micro">{relativeTime(e.created_at)}</span>
              </li>
            ))}
          </ul>
        </Part>
      ) : null}
    </div>
  );
}

/** Each monitored system's latest run against its pinned post-cleanup baseline. */
function MonitoringSection() {
  const monitor = useQuery({ queryKey: ["remediation", "monitor"], queryFn: getMonitor, staleTime: 60_000 });
  const items = monitor.data?.items ?? [];
  const newestCheck = items.reduce<string | null>((max, m) => (!max || (m.latest.run_at && m.latest.run_at > max) ? m.latest.run_at : max), null);

  return (
    <SectionCard title="Monitoring since cleanup" meta={newestCheck ? `Checked ${relativeTime(newestCheck)}` : undefined}>
      {monitor.isLoading ? <TableSkeleton rows={3} label="Loading monitoring" />
        : monitor.error ? <Banner tone="danger" title="Monitoring could not be read">{errorText(monitor.error)}</Banner>
        : items.length === 0 ? <EmptyState>No system has a pinned baseline yet. Pin a run after a cleanup to start monitoring it.</EmptyState>
        : <div className="ui-plain-list">{items.map((m) => <MonitorRow key={m.scope} item={m} />)}</div>}
    </SectionCard>
  );
}

function MonitorRow({ item: m }: { item: MonitorItem }) {
  const [now] = useState(() => Date.now());
  const stale = m.latest.run_at ? now - new Date(m.latest.run_at).getTime() > STALE_AFTER_MS : true;
  const changed = m.monitor;
  const delta = m.baseline.dqs != null && m.latest.dqs != null ? Math.round((m.latest.dqs - m.baseline.dqs) * 10) / 10 : null;
  return (
    <div className="ui-monitor-row">
      <div className="ui-monitor-row__identity">
        <strong>{scopeLabel(m)}</strong>
        <span className="ui-micro">Baseline {m.baseline.run_at ? formatDate(m.baseline.run_at, "datetime") : "—"}</span>
      </div>
      <p className="ui-micro">
        <a href={`/versions?v2=${m.baseline.id}`} className="ui-link-button">Baseline {m.baseline.dqs != null ? m.baseline.dqs.toFixed(1) : "—"}</a>
        {" to "}
        <a href={`/versions?v2=${m.latest.id}`} className="ui-link-button">latest {m.latest.dqs != null ? m.latest.dqs.toFixed(1) : "—"}</a>
        {delta != null ? <span className={delta < 0 ? "ui-delta-down" : "ui-delta-up"}> ({delta > 0 ? "+" : ""}{delta})</span> : null}
      </p>
      <div className="ui-monitor-row__changed">
        {!changed ? (
          <span className="ui-micro">No regressions since the baseline.</span>
        ) : changed.batch_id ? (
          <a href={`/workbench?tab=batches&batch=${changed.batch_id}`} className="ui-link-button">
            {changed.new_records.toLocaleString()} record{changed.new_records === 1 ? "" : "s"} regressed, {changed.batch_items.toLocaleString()} in a new fix batch
          </a>
        ) : (
          <span className="ui-micro">{changed.new_records.toLocaleString()} record{changed.new_records === 1 ? "" : "s"} regressed. Already in an open fix batch.</span>
        )}
      </div>
      {stale ? <Banner tone="warning" title="Stale check">This system has not been checked in over 36 hours. The comparison above may not reflect recent SAP changes.</Banner> : null}
    </div>
  );
}
