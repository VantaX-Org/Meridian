"use client";

/**
 * Fix batches: persisted batches of record-level corrections drafted by a rule, a
 * steward, or the post-cleanup monitor. One person drafts or accepts proposals, a
 * second person approves (four-eyes) before export — Meridian never posts to SAP,
 * only hands a file to the Migration Cockpit or a mass-change template.
 *
 * The monitoring section compares each system's latest run with its pinned
 * post-cleanup baseline, so a steward sees regressions before opening a batch.
 *
 * Ported from the legacy components/workbench/batches.tsx, PR 411, onto @/design.
 */

import Link from "next/link";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef, SortingState } from "@tanstack/react-table";
import { toast } from "sonner";
import {
  Button, DataTable, Delta, Drawer, EmptyState, ErrorState, Field, Mono, Pager, Pill, Select, Skeleton, Stat,
  type PillTone, type SelectOption,
} from "@/design";
import { useAuth } from "@/context/auth-context";
import { useNowSec } from "@/hooks/use-now";
import { useRole } from "@/hooks/use-role";
import { useUrlState } from "@/hooks/use-url-state";
import {
  acceptHighConfidence, approveBatch, errorText, exportBatch, getBatch, getBatchEvents, getMonitor, listBatches,
  patchItem, CONFIDENCE_LABEL, EVENT_LABEL, FORMAT_LABEL, RECON_LABEL, SOURCE_LABEL, STATUS_LABEL,
  type BatchItem, type BatchStatus, type BatchSummary, type ExportFormat, type MonitorItem,
} from "@/lib/api/remediation";
import { formatDate, relativeTime } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";

const STATUS_TONE: Record<BatchStatus, PillTone> = { draft: "neutral", approved: "at-risk", exported: "go" };
const FORMATS: SelectOption[] = Object.entries(FORMAT_LABEL).map(([value, label]) => ({ value, label }));
const ITEM_PAGE_SIZE = 100;
/** A run older than this since the last check is stale: the monitor may not have seen recent SAP changes. */
const STALE_AFTER_MS = 36 * 60 * 60 * 1000;

function pct(n: number, total: number): number {
  return total ? Math.round((n / total) * 100) : 0;
}

/** "scope" is a system id or "upload"; show the system's own name instead. */
function scopeLabel(m: MonitorItem): string {
  return m.system_name ?? (m.scope === "upload" ? "Imported files" : m.scope);
}

/** The Fix batches tab: batch list with monitoring above it, and a batch's detail in a drawer. */
export function BatchesTab() {
  const { user } = useAuth();
  const { can } = useRole();
  // Backend guards (api/routes/remediation.py): accept/approve need `approve`, export needs `export`.
  const canApprove = can("approve");
  const canExport = can("export");
  // Deliberately URL-synced (unlike rules/page.tsx's local-state drawer): the
  // Monitoring section below links straight to a specific batch's drawer, including
  // across navigation from elsewhere, which local state cannot survive.
  const [batchId, setBatchId] = useUrlState("batch", "");
  const [status, setStatus] = useUrlState("status", "");
  const [search, setSearch] = useUrlState("q", "");
  const [sort, setSort] = useUrlState("sort", "created_at:desc");

  const q = useQuery({ queryKey: queryKeys.remediationBatches(), queryFn: listBatches });
  const batches = useMemo(() => q.data?.items ?? [], [q.data]);
  const counts = batches.reduce(
    (a, b) => ({ ...a, [b.status]: a[b.status] + 1 }),
    { draft: 0, approved: 0, exported: 0 } as Record<BatchStatus, number>,
  );
  const stillFailing = batches.reduce((n, b) => n + (b.status === "exported" ? b.still_failing : 0), 0);
  const selected = batchId ? batches.find((b) => b.id === batchId) ?? null : null;

  const needle = search.trim().toLowerCase();
  const visible = useMemo(
    () => batches.filter((b) => !status || b.status === status).filter((b) => !needle || b.name.toLowerCase().includes(needle)),
    [batches, status, needle],
  );
  const [sortKey, sortDir] = sort.split(":");
  const sorting: SortingState = sortKey ? [{ id: sortKey, desc: sortDir === "desc" }] : [];
  const onSortingChange = (next: SortingState) => {
    const first = next[0];
    setSort(first ? `${first.id}:${first.desc ? "desc" : "asc"}` : "");
  };

  const columns: ColumnDef<BatchSummary>[] = [
    { accessorKey: "name", header: "Batch" },
    {
      id: "status",
      accessorFn: (b) => STATUS_LABEL[b.status],
      header: "Status",
      cell: ({ row }) => <Pill tone={STATUS_TONE[row.original.status]}>{STATUS_LABEL[row.original.status]}</Pill>,
    },
    { accessorKey: "items", header: "Items" },
    {
      id: "with_proposal",
      accessorFn: (b) => b.with_proposal,
      header: "With proposal",
      cell: ({ row }) => `${row.original.with_proposal.toLocaleString()} (${pct(row.original.with_proposal, row.original.items)}%)`,
    },
    { accessorKey: "auto_approvable", header: "Auto-approvable" },
    {
      id: "fixed",
      accessorFn: (b) => (b.status === "exported" ? b.fixed : -1),
      header: "Fixed",
      cell: ({ row }) => (row.original.status === "exported" ? row.original.fixed.toLocaleString() : "—"),
    },
    {
      id: "still_failing",
      accessorFn: (b) => (b.status === "exported" ? b.still_failing : -1),
      header: "Still failing",
      cell: ({ row }) =>
        row.original.status !== "exported" ? "—" : row.original.still_failing > 0 ? (
          <span style={{ color: "var(--m-critical)" }}>{row.original.still_failing.toLocaleString()}</span>
        ) : "0",
    },
    { id: "created_at", accessorFn: (b) => b.created_at, header: "Created", cell: ({ row }) => formatDate(row.original.created_at, "datetime") },
  ];

  const clearFilters = () => { setStatus(""); setSearch(""); };
  const filtered = !!(status || search);

  return (
    <div className="flex flex-col gap-6">
      <MonitoringSection onOpenBatch={setBatchId} />

      <div className="flex flex-col gap-2">
        <div className="flex gap-6">
          <Link href="?tab=batches&status=draft" className="text-left">
            <Stat label="Draft batches" value={counts.draft}
              delta={counts.draft ? "Waiting for proposals to be accepted and approved." : "No batches in draft."} />
          </Link>
          <Link href="?tab=batches&status=approved" className="text-left">
            <Stat label="Waiting for export" value={counts.approved}
              delta={counts.approved
                ? <Pill tone="at-risk">Approved but not exported yet.</Pill>
                : "Nothing waiting for export."} />
          </Link>
          <Link href="?tab=batches&status=exported" className="text-left">
            <Stat label="Still failing after export" value={stillFailing}
              delta={stillFailing
                ? <Pill tone="at-risk">Exported records that were checked again and still fail.</Pill>
                : "No exported record is still failing."} />
          </Link>
        </div>
        <p className="text-[13px]" style={{ color: "var(--m-ink-2)" }}>
          {q.data
            ? `${batches.length.toLocaleString()} fix batch${batches.length === 1 ? "" : "es"}. ${counts.draft} draft, ${counts.approved} waiting for export.`
            : null}
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <Field label="Search">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search batches"
            className="rounded border px-3 py-1.5 text-[13px]"
            style={{ borderColor: "var(--m-line)", background: "var(--m-sheet)", color: "var(--m-ink)" }}
          />
        </Field>
        <div className="flex items-end gap-2">
          {(["", ...Object.keys(STATUS_LABEL)] as (BatchStatus | "")[]).map((s) => (
            <Button key={s || "all"} variant={status === s ? "primary" : "secondary"} onClick={() => setStatus(s)}>
              {s ? STATUS_LABEL[s] : "All"} {s ? `(${counts[s]})` : `(${batches.length})`}
            </Button>
          ))}
        </div>
        {filtered ? <Button variant="ghost" onClick={clearFilters}>Clear filters</Button> : null}
      </div>

      {q.isLoading ? (
        <Skeleton height={240} />
      ) : q.isError ? (
        <ErrorState message={errorText(q.error)} onRetry={() => q.refetch()} />
      ) : batches.length === 0 ? (
        <EmptyState title="No fix batches yet. A rule, a steward, or the monitor drafts one when records need a correction." />
      ) : visible.length === 0 ? (
        <EmptyState title="Nothing in this view." action={<Button variant="ghost" onClick={clearFilters}>Show everything</Button>} />
      ) : (
        <DataTable
          columns={columns}
          data={visible}
          getRowId={(b) => b.id}
          onRowClick={(b) => setBatchId(b.id)}
          sorting={sorting}
          onSortingChange={onSortingChange}
        />
      )}

      <Drawer open={!!selected} onOpenChange={(open) => { if (!open) setBatchId(""); }} title={selected?.name ?? "Batch"}>
        {selected ? (
          <BatchDetailBody batchId={selected.id} currentUserId={user?.id ?? null} canApprove={canApprove} canExport={canExport} />
        ) : null}
      </Drawer>
    </div>
  );
}

function BatchDetailBody({ batchId, currentUserId, canApprove, canExport }: {
  batchId: string; currentUserId: string | null; canApprove: boolean; canExport: boolean;
}) {
  const qc = useQueryClient();
  const detail = useQuery({ queryKey: queryKeys.remediationBatch(batchId), queryFn: () => getBatch(batchId) });
  const events = useQuery({ queryKey: queryKeys.remediationEvents(batchId), queryFn: () => getBatchEvents(batchId) });
  const [itemPage, setItemPage] = useState(1);
  const [editing, setEditing] = useState<string | null>(null);
  const [draftValue, setDraftValue] = useState("");
  const [format, setFormat] = useState<ExportFormat>("cockpit_xlsx");
  const [ask, setAsk] = useState<"approve" | "export" | null>(null);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: queryKeys.remediationBatches() });
    qc.invalidateQueries({ queryKey: queryKeys.remediationBatch(batchId) });
    qc.invalidateQueries({ queryKey: queryKeys.remediationEvents(batchId) });
    qc.invalidateQueries({ queryKey: queryKeys.remediationMonitor() });
  };

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

  if (detail.isLoading) return <Skeleton height={240} />;
  if (detail.isError || !detail.data) return <EmptyState title="This batch could not be found. It may have been removed." />;

  const { batch, items } = detail.data;
  const isCreator = !!currentUserId && batch.created_by === currentUserId;
  const highConfidence = items.filter((i) => i.auto_approvable && !i.accepted);
  const pageCount = Math.max(1, Math.ceil(items.length / ITEM_PAGE_SIZE));
  const page = items.slice((itemPage - 1) * ITEM_PAGE_SIZE, itemPage * ITEM_PAGE_SIZE);

  const columns: ColumnDef<BatchItem>[] = [
    { id: "record_key", header: "Record", cell: ({ row }) => <Mono>{row.original.record_key}</Mono> },
    { id: "field", header: "Field", cell: ({ row }) => (row.original.field ? <Mono>{row.original.field}</Mono> : "—") },
    { id: "current_value", header: "Current", cell: ({ row }) => row.original.current_value ?? "—" },
    {
      id: "proposed_value",
      header: "Proposed",
      cell: ({ row }) => {
        const i = row.original;
        if (editing === i.id) {
          return (
            <input
              autoFocus
              aria-label="Proposed value"
              value={draftValue}
              onChange={(e) => setDraftValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") patch.mutate({ itemId: i.id, value: draftValue || null });
                if (e.key === "Escape") setEditing(null);
              }}
              onBlur={() => setEditing(null)}
              onClick={(e) => e.stopPropagation()}
              className="rounded border px-2 py-1 text-[13px]"
              style={{ borderColor: "var(--m-line)" }}
            />
          );
        }
        return (
          <Button
            type="button"
            variant="ghost"
            className="underline disabled:no-underline"
            disabled={i.accepted || !canApprove}
            title={i.accepted ? "An accepted proposal cannot be edited." : undefined}
            onClick={(e) => { e.stopPropagation(); setEditing(i.id); setDraftValue(i.proposed_value ?? ""); }}
          >
            {i.proposed_value ?? "—"}
          </Button>
        );
      },
    },
    { id: "proposal_source", header: "Source", cell: ({ row }) => SOURCE_LABEL[row.original.proposal_source] },
    { id: "confidence", header: "Confidence", cell: ({ row }) => (row.original.confidence ? CONFIDENCE_LABEL[row.original.confidence] : "—") },
    { id: "accepted", header: "Accepted", cell: ({ row }) => (row.original.accepted ? "Accepted" : "Not yet") },
    { id: "recon_status", header: "Reconciled", cell: ({ row }) => (row.original.recon_status ? RECON_LABEL[row.original.recon_status] : "—") },
    { id: "updated_at", header: "Updated", cell: ({ row }) => relativeTime(row.original.updated_at) },
  ];

  const approveTitle = isCreator
    ? "The person who drafted this batch cannot also approve it. Ask a second person to approve."
    : !canApprove
      ? "Approving needs the approve permission."
      : undefined;

  return (
    <div className="flex flex-col gap-4">
      <dl className="grid grid-cols-2 gap-2 text-[13px]">
        <div><dt style={{ color: "var(--m-ink-2)" }}>Status</dt><dd>{STATUS_LABEL[batch.status]}</dd></div>
        <div><dt style={{ color: "var(--m-ink-2)" }}>Items</dt><dd>{items.length.toLocaleString()}</dd></div>
        <div><dt style={{ color: "var(--m-ink-2)" }}>With proposal</dt><dd>{items.filter((i) => i.proposed_value !== null).length.toLocaleString()}</dd></div>
        <div><dt style={{ color: "var(--m-ink-2)" }}>Accepted</dt><dd>{items.filter((i) => i.accepted).length.toLocaleString()}</dd></div>
        <div><dt style={{ color: "var(--m-ink-2)" }}>Auto-approvable</dt><dd>{items.filter((i) => i.auto_approvable).length.toLocaleString()}</dd></div>
        <div><dt style={{ color: "var(--m-ink-2)" }}>Created by</dt><dd>{batch.created_by_label ?? "Meridian monitor"}</dd></div>
        <div><dt style={{ color: "var(--m-ink-2)" }}>Created</dt><dd>{formatDate(batch.created_at, "datetime")}</dd></div>
        <div><dt style={{ color: "var(--m-ink-2)" }}>Approved by</dt><dd>{batch.approved_by_label ?? "—"}</dd></div>
        <div><dt style={{ color: "var(--m-ink-2)" }}>Approved</dt><dd>{batch.approved_at ? formatDate(batch.approved_at, "datetime") : "—"}</dd></div>
        <div><dt style={{ color: "var(--m-ink-2)" }}>Exported</dt><dd>{batch.exported_at ? formatDate(batch.exported_at, "datetime") : "—"}</dd></div>
      </dl>

      {isCreator && batch.status === "draft" ? (
        <p className="text-[13px]" style={{ color: "var(--m-ink-2)" }}>
          Four-eyes required: a second person must approve this batch before it can be exported.
        </p>
      ) : null}

      {ask ? (
        <div className="flex flex-col gap-2 rounded border p-3" style={{ borderColor: "var(--m-line)" }}>
          <p className="text-[13px]">
            Meridian never posts to SAP. {ask === "export" ? "This hands a file to the Migration Cockpit or a mass-change template." : "This is Meridian's record only."}
          </p>
          <div className="flex items-center gap-2">
            {ask === "export" ? <Select value={format} onValueChange={(v) => setFormat(v as ExportFormat)} options={FORMATS} /> : null}
            <Button onClick={() => (ask === "approve" ? approve : doExport).mutate()} disabled={approve.isPending || doExport.isPending}>
              {ask === "approve" ? (approve.isPending ? "Approving…" : "Approve") : doExport.isPending ? "Preparing…" : "Export"}
            </Button>
            <Button variant="ghost" onClick={() => setAsk(null)}>Not now</Button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          {batch.status === "draft" && highConfidence.length > 0 && canApprove ? (
            <Button onClick={() => accept.mutate()} disabled={accept.isPending}>
              Accept {highConfidence.length.toLocaleString()} high-confidence proposal{highConfidence.length === 1 ? "" : "s"}
            </Button>
          ) : null}
          {batch.status === "draft" ? (
            <Button variant="secondary" disabled={!canApprove || isCreator} title={approveTitle} onClick={() => setAsk("approve")}>
              Approve batch
            </Button>
          ) : null}
          {batch.status === "approved" ? (
            <Button disabled={!canExport} title={!canExport ? "Exporting needs the export permission." : undefined} onClick={() => setAsk("export")}>
              Export batch
            </Button>
          ) : null}
          {batch.status === "exported" ? (
            <p className="text-[13px]" style={{ color: "var(--m-ink-2)" }}>
              Exported. Load it with the Migration Cockpit or a mass-change template — Meridian never posts to SAP.
            </p>
          ) : null}
        </div>
      )}

      <section>
        <h3 className="text-[13px] font-semibold">Items</h3>
        {items.length ? (
          <>
            <DataTable columns={columns} data={page} getRowId={(i) => i.id} />
            {items.length > ITEM_PAGE_SIZE ? <Pager page={itemPage} pageCount={pageCount} onPageChange={setItemPage} /> : null}
          </>
        ) : (
          <EmptyState title="No items in this batch." />
        )}
      </section>

      {events.data?.items.length ? (
        <section>
          <h3 className="text-[13px] font-semibold">History</h3>
          <ul className="flex flex-col gap-1">
            {events.data.items.map((e, idx) => (
              <li key={`${e.item_id}-${idx}`} className="text-[13px]" style={{ color: "var(--m-ink-2)" }}>
                {EVENT_LABEL[e.action]}{e.user_label ? ` by ${e.user_label}` : ""}, {relativeTime(e.created_at)}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

/** Each monitored system's latest run against its pinned post-cleanup baseline. */
function MonitoringSection({ onOpenBatch }: { onOpenBatch: (id: string) => void }) {
  const monitor = useQuery({ queryKey: queryKeys.remediationMonitor(), queryFn: getMonitor, staleTime: 60_000 });
  const items = monitor.data?.items ?? [];
  const newestCheck = items.reduce<string | null>(
    (max, m) => (!max || (m.latest.run_at && m.latest.run_at > max) ? m.latest.run_at : max),
    null,
  );

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h3 className="text-[13px] font-semibold">Monitoring since cleanup</h3>
        {newestCheck ? (
          <span className="text-[13px]" style={{ color: "var(--m-ink-2)" }}>Checked {relativeTime(newestCheck)}</span>
        ) : null}
      </div>
      {monitor.isLoading ? (
        <Skeleton height={120} />
      ) : monitor.isError ? (
        <ErrorState message={errorText(monitor.error)} onRetry={() => monitor.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState title="No system has a pinned baseline yet. Pin a run after a cleanup to start monitoring it." />
      ) : (
        <div className="flex flex-col gap-3">
          {items.map((m) => <MonitorRow key={m.scope} item={m} onOpenBatch={onOpenBatch} />)}
        </div>
      )}
    </section>
  );
}

function MonitorRow({ item: m, onOpenBatch }: { item: MonitorItem; onOpenBatch: (id: string) => void }) {
  // Not ticking: a static "now" read once per render is enough for a staleness threshold in hours.
  const nowMs = useNowSec(false) * 1000;
  const stale = m.latest.run_at ? nowMs - new Date(m.latest.run_at).getTime() > STALE_AFTER_MS : true;
  const changed = m.monitor;
  const delta = m.baseline.dqs != null && m.latest.dqs != null ? Math.round((m.latest.dqs - m.baseline.dqs) * 10) / 10 : null;
  return (
    <div className="flex flex-col gap-1 rounded border p-3" style={{ borderColor: "var(--m-line)" }}>
      <div className="flex items-center justify-between">
        <strong className="text-[13px]">{scopeLabel(m)}</strong>
        <span className="text-[12px]" style={{ color: "var(--m-ink-2)" }}>
          Baseline {m.baseline.run_at ? formatDate(m.baseline.run_at, "datetime") : "—"}
        </span>
      </div>
      <p className="text-[13px]" style={{ color: "var(--m-ink-2)" }}>
        <Link href={`/runs/${m.baseline.id}`} className="underline">Baseline {m.baseline.dqs != null ? m.baseline.dqs.toFixed(1) : "—"}</Link>
        {" to "}
        <Link href={`/runs/${m.latest.id}`} className="underline">latest {m.latest.dqs != null ? m.latest.dqs.toFixed(1) : "—"}</Link>
        {delta != null ? <> (<Delta value={delta} />)</> : null}
      </p>
      {!changed ? (
        <span className="text-[13px]" style={{ color: "var(--m-ink-2)" }}>No regressions since the baseline.</span>
      ) : changed.batch_id ? (
        (() => {
          const batchIdToOpen = changed.batch_id;
          return (
            <Button type="button" variant="ghost" className="underline self-start justify-start" onClick={() => onOpenBatch(batchIdToOpen)}>
              {changed.new_records.toLocaleString()} record{changed.new_records === 1 ? "" : "s"} regressed, {changed.batch_items.toLocaleString()} in a new fix batch
            </Button>
          );
        })()
      ) : (
        <span className="text-[13px]" style={{ color: "var(--m-ink-2)" }}>
          {changed.new_records.toLocaleString()} record{changed.new_records === 1 ? "" : "s"} regressed. Already in an open fix batch.
        </span>
      )}
      {stale ? (
        <p className="text-[13px] flex items-center gap-2">
          <Pill tone="at-risk">Stale check</Pill>
          <span style={{ color: "var(--m-ink-2)" }}>This system has not been checked in over 36 hours. The comparison above may not reflect recent SAP changes.</span>
        </p>
      ) : null}
    </div>
  );
}
