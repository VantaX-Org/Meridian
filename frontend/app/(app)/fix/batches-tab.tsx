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
  Button, Card, DataTable, Drawer, EmptyState, ErrorState, Field, Mono, Notice, Pager, Pill, Select, Skeleton, Stat, Tooltip,
  type PillTone, type SelectOption, Input } from "@/design";
import { useAuth } from "@/context/auth-context";
import { GatedPrimary } from "@/components/gated-primary";
import { useRole } from "@/hooks/use-role";
import { oneOf, useUrlState } from "@/hooks/use-url-state";
import {
  acceptHighConfidence, approveBatch, errorText, exportBatch, getBatch, getBatchDiff, getBatchEvents,
  getBatchPackages, getMonitor, listBatches, patchItem,
  CONFIDENCE_LABEL, EVENT_LABEL, FORMAT_LABEL, RECON_LABEL, SOURCE_LABEL, STATUS_LABEL,
  type Batch, type BatchItem, type BatchStatus, type BatchSummary, type DiffChange, type DiffRecord,
  type ExportFormat, type ExportPackage, type MonitorItem,
} from "@/lib/api/remediation";
import { formatDate, relativeTime } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";

const SORT_COLS = ["name", "status", "items", "with_proposal", "auto_approvable", "fixed", "still_failing", "created_at"] as const;
const SORTS = SORT_COLS.flatMap((c) => [`${c}:asc`, `${c}:desc`]);
const STATUS_TONE: Record<BatchStatus, PillTone> = { draft: "neutral", approved: "at-risk", exported: "go" };
const FORMATS: SelectOption[] = Object.entries(FORMAT_LABEL).map(([value, label]) => ({ value, label }));
const ITEM_PAGE_SIZE = 100;

function pct(n: number, total: number): number {
  return total ? Math.round((n / total) * 100) : 0;
}

/** "scope" is a system id or "upload"; show the system's own name instead. */
/** One line on what monitoring found; the full picture lives on the Monitor tab. */
function MonitorSummaryNotice() {
  const monitor = useQuery({ queryKey: queryKeys.remediationMonitor(), queryFn: getMonitor, staleTime: 60_000 });
  const items = monitor.data?.items ?? [];
  if (!items.length) return null;
  const regressed = items.filter((m) => (m.monitor?.regressed_check_count ?? 0) > 0);
  return (
    <Notice tone={regressed.length ? "warning" : "info"} action={<Button variant="secondary" render={<Link href="?tab=monitor">Open monitor</Link>} />}>
      {regressed.length
        ? `${regressed.map(scopeLabel).join(", ")} regressed since the baseline.`
        : `${items.length} scope${items.length === 1 ? "" : "s"} holding since the baseline.`}
    </Notice>
  );
}

function scopeLabel(m: MonitorItem): string {
  return m.system_name ?? (m.scope === "upload" ? "Imported files" : m.scope);
}

/** Where an exported batch's effect can be seen: the latest run of its scope against the run it was cut from. */
export function compareHref(batch: Batch, monitor: MonitorItem[]): string | null {
  if (batch.status !== "exported") return null;
  const item = monitor.find((m) => m.scope === (batch.filter.scope ?? "upload"));
  if (!item) return null;
  const v1 = batch.filter.version_id ?? item.baseline.id;
  const v2 = item.latest.id;
  if (v1 === v2) return null;
  const q = batch.filter.module ? `?module=${encodeURIComponent(batch.filter.module)}` : "";
  return `/runs/${v2}/vs/${v1}${q}`;
}

function BeforeAfter({ batch, monitor }: { batch: Batch; monitor: MonitorItem[] }) {
  if (batch.status !== "exported") return null;
  const href = compareHref(batch, monitor);
  if (!href) {
    return (
      <Tooltip label="No run since export" render={<Button variant="secondary" aria-disabled="true" onClick={() => undefined} />}>
        Before vs after
      </Tooltip>
    );
  }
  return <Link href={href} onClick={(e) => e.stopPropagation()}>Before vs after</Link>;
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
  const [statusRaw, setStatus] = useUrlState("status", "");
  const status = oneOf(statusRaw, ["draft", "approved", "exported"], "") as BatchStatus | "";
  const [search, setSearch] = useUrlState("q", "");
  const [sortRaw, setSort] = useUrlState("sort", "created_at:desc");
  const sort = oneOf(sortRaw, SORTS, "created_at:desc");

  const q = useQuery({ queryKey: queryKeys.remediationBatches(), queryFn: listBatches });
  const monitor = useQuery({ queryKey: queryKeys.remediationMonitor(), queryFn: getMonitor, staleTime: 60_000 });
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
      cell: ({ row }) => <Pill tone={STATUS_TONE[row.original.status]} variant="solid">{STATUS_LABEL[row.original.status]}</Pill>,
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
          <span className="m-ink-critical">{row.original.still_failing.toLocaleString()}</span>
        ) : "0",
    },
    { id: "created_at", accessorFn: (b) => b.created_at, header: "Created", cell: ({ row }) => formatDate(row.original.created_at, "datetime") },
    {
      id: "compare",
      header: "",
      enableSorting: false,
      cell: ({ row }) => (
        <span className="inline-flex items-center justify-end gap-3" onClick={(e) => e.stopPropagation()}>
          <BeforeAfter batch={row.original} monitor={monitor.data?.items ?? []} />
          <Link href={`?tab=batches&batch=${row.original.id}`} aria-label={`Review ${row.original.name}`} className="m-ink-accent">Review</Link>
        </span>
      ),
    },
  ];

  const clearFilters = () => { setStatus(""); setSearch(""); };
  const filtered = !!(status || search);

  return (
    <div className="flex flex-col gap-6">
      <MonitorSummaryNotice />

      <div className="m-stat-grid m-motion-stagger @5xl:[grid-template-columns:repeat(3,minmax(0,360px))]" data-tour="fix-batches">
        <Link href="?tab=batches&status=draft" className="text-left">
          <Stat label="Draft batches" value={counts.draft} hint={counts.draft ? "waiting for proposals to be accepted and approved" : "none in draft"} />
        </Link>
        <Link href="?tab=batches&status=approved" className="text-left">
          <Stat label="Waiting for export" value={counts.approved} tone={counts.approved ? "at-risk" : "go"} hint={counts.approved ? "approved, not exported yet" : "nothing waiting"} />
        </Link>
        <Link href="?tab=batches&status=exported" className="text-left">
          <Stat label="Still failing after export" value={stillFailing} tone={stillFailing ? "no-go" : "go"} hint={stillFailing ? "exported records that fail again" : "none still failing"} />
        </Link>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <Field label="Search">
          <Input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search batches"
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
        <EmptyState
          title="No batches"
          detail="Approve proposals in the cleaning queue to create a batch."
          action={<Button render={<Link href="/fix?tab=cleaning">Cleaning queue</Link>} />}
        />
      ) : visible.length === 0 ? (
        <EmptyState title="Nothing in this view" action={<Button variant="ghost" onClick={clearFilters}>Show everything</Button>} />
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
  const monitor = useQuery({ queryKey: queryKeys.remediationMonitor(), queryFn: getMonitor, staleTime: 60_000 });
  const diff = useQuery({ queryKey: queryKeys.remediationDiff(batchId), queryFn: () => getBatchDiff(batchId) });
  const packages = useQuery({
    queryKey: queryKeys.remediationPackages(batchId), queryFn: () => getBatchPackages(batchId), enabled: canExport,
  });
  const [itemPage, setItemPage] = useState(1);
  const [editing, setEditing] = useState<string | null>(null);
  const [draftValue, setDraftValue] = useState("");
  const [format, setFormat] = useState<ExportFormat>("cockpit_xlsx");
  const [crType, setCrType] = useState("");
  const [failure, setFailure] = useState<string | null>(null);
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
    onMutate: async () => {
      setFailure(null);
      await qc.cancelQueries({ queryKey: queryKeys.remediationBatch(batchId) });
      const prev = qc.getQueryData<typeof detail.data>(queryKeys.remediationBatch(batchId));
      if (prev) qc.setQueryData(queryKeys.remediationBatch(batchId), { ...prev, batch: { ...prev.batch, status: "approved" } });
      setAsk(null);
      return { prev };
    },
    onSuccess: () => { toast.success("Batch approved"); },
    onError: (e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(queryKeys.remediationBatch(batchId), ctx.prev);
      setFailure(`Batch not approved: ${errorText(e)}`);
    },
    onSettled: () => refresh(),
  });
  const patch = useMutation({
    mutationFn: ({ itemId, value }: { itemId: string; value: string | null }) => patchItem(batchId, itemId, value),
    onSuccess: () => { setEditing(null); refresh(); },
    onError: (e) => toast.error(errorText(e)),
  });
  const doExport = useMutation({
    mutationFn: () => exportBatch(batchId, format, format === "mdg_cr_json" ? crType.trim() || undefined : undefined),
    onSuccess: () => {
      toast.success("Export ready");
      setAsk(null);
      refresh();
      qc.invalidateQueries({ queryKey: queryKeys.remediationPackages(batchId) });
    },
    onError: (e) => toast.error(errorText(e)),
  });

  if (detail.isLoading) return <Skeleton height={240} />;
  if (detail.isError || !detail.data) return <EmptyState title="Batch not found" detail="It may have been removed" action={<Button variant="secondary" render={<Link href="?tab=batches">Back to batches</Link>} />} />;

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
            <Input
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
  const exportTitle = isCreator ? "The batch creator cannot export it. Ask a second person to export." : undefined;
  const crTypeMissing = format === "mdg_cr_json" && crType.trim() === "";

  return (
    <div className="flex flex-col gap-4">
      <dl className="grid grid-cols-2 gap-2 m-text-body">
        <div><dt className="m-ink-2">Status</dt><dd>{STATUS_LABEL[batch.status]}</dd></div>
        <div><dt className="m-ink-2">Items</dt><dd>{items.length.toLocaleString()}</dd></div>
        <div><dt className="m-ink-2">With proposal</dt><dd>{items.filter((i) => i.proposed_value !== null).length.toLocaleString()}</dd></div>
        <div><dt className="m-ink-2">Accepted</dt><dd>{items.filter((i) => i.accepted).length.toLocaleString()}</dd></div>
        <div><dt className="m-ink-2">Auto-approvable</dt><dd>{items.filter((i) => i.auto_approvable).length.toLocaleString()}</dd></div>
        <div><dt className="m-ink-2">Created by</dt><dd>{batch.created_by_label ?? "Meridian monitor"}</dd></div>
        <div><dt className="m-ink-2">Created</dt><dd>{formatDate(batch.created_at, "datetime")}</dd></div>
        <div><dt className="m-ink-2">Approved by</dt><dd>{batch.approved_by_label ?? "—"}</dd></div>
        <div><dt className="m-ink-2">Approved</dt><dd>{batch.approved_at ? formatDate(batch.approved_at, "datetime") : "—"}</dd></div>
        <div><dt className="m-ink-2">Exported</dt><dd>{batch.exported_at ? formatDate(batch.exported_at, "datetime") : "—"}</dd></div>
      </dl>

      <BeforeAfter batch={batch} monitor={monitor.data?.items ?? []} />

      {isCreator && batch.status === "draft" ? (
        <p className="m-text-body m-ink-2">
          Four-eyes required: a second person must approve this batch before it can be exported.
        </p>
      ) : null}

      {failure ? <Notice tone="danger">{failure}</Notice> : null}
      {ask ? (
        <Card padding="sm">
          <p className="m-text-body">
            Meridian never posts to SAP. {ask === "export" ? "This hands a file to the Migration Cockpit or a mass-change template." : "This is Meridian's record only."}
          </p>
          <div className="flex items-center gap-2">
            {ask === "export" ? <Select label="Export format" value={format} onValueChange={(v) => setFormat(v as ExportFormat)} options={FORMATS} /> : null}
            {ask === "export" && format === "mdg_cr_json" ? (
              <Field label="Change request type">
                <Input
                  aria-label="Change request type"
                  value={crType}
                  onChange={(e) => setCrType(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, "").slice(0, 40))}
                />
              </Field>
            ) : null}
            <Button
              onClick={() => (ask === "approve" ? approve : doExport).mutate()}
              disabled={approve.isPending || doExport.isPending || (ask === "export" && crTypeMissing)}
              title={ask === "export" && crTypeMissing ? "Enter a change request type to export." : undefined}
            >
              {ask === "approve" ? (approve.isPending ? "Approving…" : "Approve") : doExport.isPending ? "Preparing…" : "Export"}
            </Button>
            <Button variant="ghost" onClick={() => setAsk(null)}>Not now</Button>
          </div>
        </Card>
      ) : (
        <div className="flex items-center gap-2">
          {batch.status === "draft" && highConfidence.length > 0 && canApprove ? (
            <Button onClick={() => accept.mutate()} disabled={accept.isPending}>
              Accept {highConfidence.length.toLocaleString()} high-confidence proposal{highConfidence.length === 1 ? "" : "s"}
            </Button>
          ) : null}
          {batch.status === "draft" ? (
            <GatedPrimary kind="approve" allowed={canApprove} variant="secondary" disabled={isCreator} title={approveTitle} onClick={() => setAsk("approve")}>
              Approve batch
            </GatedPrimary>
          ) : null}
          {batch.status === "approved" && canExport ? (
            <Button disabled={isCreator} title={exportTitle} onClick={() => setAsk("export")}>
              Export batch
            </Button>
          ) : null}
          {batch.status === "exported" ? (
            <p className="m-text-body m-ink-2">
              Exported. Load it with the Migration Cockpit or a mass-change template — Meridian never posts to SAP.
            </p>
          ) : null}
        </div>
      )}

      <section>
        <h3 className="m-text-body font-semibold">Items</h3>
        {items.length ? (
          <>
            <DataTable columns={columns} data={page} getRowId={(i) => i.id} />
            {items.length > ITEM_PAGE_SIZE ? <Pager page={itemPage} pageCount={pageCount} pageSize={ITEM_PAGE_SIZE} total={items.length} onPageChange={setItemPage} /> : null}
          </>
        ) : (
          <EmptyState title="No items in this batch" detail="Proposals are added when a cleanup run creates them" action={<Button variant="secondary" render={<Link href="?tab=batches">Back to batches</Link>} />} />
        )}
      </section>

      <DiffSection records={diff.data?.records} />

      {canExport ? <PackagesSection items={packages.data?.items} /> : null}

      {events.data?.items.length ? (
        <section>
          <h3 className="m-text-body font-semibold">History</h3>
          <ul className="flex flex-col gap-1">
            {events.data.items.map((e, idx) => (
              <li key={`${e.item_id}-${idx}`} className="m-text-body m-ink-2">
                {EVENT_LABEL[e.action]}{e.user_label ? ` by ${e.user_label}` : ""}, {relativeTime(e.created_at)}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

interface DiffRow extends DiffChange {
  id: string;
  record_key: string;
  table: string;
}

/** Before/after per changed field, flattened from the batch diff for the table. */
function DiffSection({ records }: { records: DiffRecord[] | undefined }) {
  const rows: DiffRow[] = (records ?? []).flatMap((r) =>
    r.changes.map((c) => ({ id: `${r.record_key}|${r.table}.${c.field}`, record_key: r.record_key, table: r.table, ...c })),
  );
  const columns: ColumnDef<DiffRow>[] = [
    { id: "record_key", header: "Record", cell: ({ row }) => <Mono>{row.original.record_key}</Mono> },
    { id: "field", header: "Field", cell: ({ row }) => <Mono>{row.original.table}.{row.original.field}</Mono> },
    { id: "before", header: "Before", cell: ({ row }) => <Mono>{row.original.before ?? "—"}</Mono> },
    { id: "after", header: "After", cell: ({ row }) => <Mono>{row.original.after}</Mono> },
  ];
  if (!rows.length) return null;
  return (
    <section>
      <h3 className="m-text-body font-semibold">Before and after</h3>
      <DataTable columns={columns} data={rows} getRowId={(r) => r.id} />
    </section>
  );
}

/** Audit trail of every file this batch has exported: format, who, and the sha256 to verify the file against. */
function PackagesSection({ items }: { items: ExportPackage[] | undefined }) {
  if (!items?.length) return null;
  return (
    <section className="flex flex-col gap-2">
      <h3 className="m-text-body font-semibold">Exported files</h3>
      <ul className="flex flex-col gap-1">
        {items.map((p) => (
          <li key={p.id} className="m-text-body flex items-center gap-2">
            <span>{FORMAT_LABEL[p.format]}</span>
            <Tooltip label={p.sha256}>
              <span className="m-ink-2"><Mono>{p.sha256.slice(0, 12)}</Mono></span>
            </Tooltip>
            <span className="m-ink-3">
              {p.created_by_label ? `exported by ${p.created_by_label}` : "exported"}
              {p.approved_by_label ? `, approved by ${p.approved_by_label}` : ""}, {relativeTime(p.created_at)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

