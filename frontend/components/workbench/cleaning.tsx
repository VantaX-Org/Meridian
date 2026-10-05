"use client";

/**
 * Workbench, Cleaning: corrections the cleaning engine proposes for single
 * records. Confident ones are auto-applied and can be rolled back; the rest
 * wait for a steward's approval. The drawer shows before and after per field
 * and the job's audit trail.
 */

import { useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import {
  Banner, Button, Chip, DataTable, DetailDrawer, EmptyState, FilterBar, KeyValue, Mono,
  PageHeader, Select, StatusBadge, TableSkeleton, Tally, useDrawerParam, type AuroraColumnMeta, type Status,
} from "@/components/ui-core";
import { useRole } from "@/hooks/use-role";
import { useUrlState } from "@/hooks/use-url-state";
import {
  approveCleaning, bulkApprove, downloadCleaningExport, getCleaningExportOptions, getCleaningQueue, rejectCleaning, rollbackCleaning,
  type CleaningQueueItem, type ExportFormat,
} from "@/lib/api/cleaning";
import { formatModuleName, relativeTime } from "@/lib/format";

const meta = (m: AuroraColumnMeta) => m;
/** Confidence is 0..1 from the detector and 0..100 once stored; show one scale. */
const pct = (c: number): number => Math.round(c <= 1 ? c * 100 : c);
const APPLIED = new Set(["auto_approved", "applied", "verified"]);
type Bucket = "auto" | "approved" | "review" | "closed";
const bucket = (s: string): Bucket =>
  APPLIED.has(s) ? "auto" : s === "approved" ? "approved" : s === "rejected" || s === "rolled_back" ? "closed" : "review";
const STATUS: Record<Bucket, Status> = { auto: "ok", approved: "low", review: "medium", closed: "idle" };
const LABEL: Record<Bucket, string> = { auto: "Auto-applied", approved: "Approved, ready to export", review: "Needs review", closed: "Closed" };
const VIEWS = [["all", "All"], ["review", "Needs review"], ["auto", "Auto-applied"]] as const;
const text = (v: unknown): string => (v === null || v === undefined || v === "" ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v));

function changedFields(i: CleaningQueueItem): [string, string, string][] {
  const before = i.record_data_before ?? {}, after = i.record_data_after ?? {};
  return Array.from(new Set([...Object.keys(before), ...Object.keys(after)]))
    .filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]))
    .map((k) => [k, text(before[k]), text(after[k])]);
}
function preview(i: CleaningQueueItem): string {
  const m = i.merge_preview ? Object.entries(i.merge_preview)[0] : undefined;
  if (m) return `${m[0]}: keep ${m[1].survivor}`;
  if (i.golden_field_value) return `Set to ${i.golden_field_value}`;
  const changed = changedFields(i);
  if (!changed.length) return "—";
  const [k, b, a] = changed[0];
  return `${k}: ${b} to ${a}${changed.length > 1 ? `, and ${changed.length - 1} more` : ""}`;
}

const FORMATS: { value: ExportFormat; label: string }[] = [
  { value: "lsmw", label: "LSMW flat file" }, { value: "bapi", label: "BAPI (JSON)" }, { value: "idoc", label: "IDoc (JSON)" },
  { value: "xlsx", label: "Excel review" }, { value: "csv", label: "CSV review" },
];

/** Corrections as a file SAP can load (LSMW / BAPI / IDoc) or a reviewer can read — Meridian never writes to SAP. */
function SapExport() {
  const opts = useQuery({ queryKey: ["cleaning.export-options"], queryFn: getCleaningExportOptions });
  const statuses = opts.data?.statuses ?? [];
  const [status, setStatus] = useState("");
  const [format, setFormat] = useState<ExportFormat>("lsmw");
  const chosen = status || (statuses.find((s) => s.value === "approved") ?? statuses[0])?.value || "";
  const download = useMutation({
    mutationFn: () => downloadCleaningExport(format, chosen),
    onError: (e) => toast.error((e as Error).message || "Export failed"),
  });
  if (!statuses.length) return null;
  return (
    <div className="ui-page-header__actions">
      <Select aria-label="Corrections to export" value={chosen} onValueChange={setStatus}
        options={statuses.map((s) => ({ value: s.value, label: `${s.value.replace(/_/g, " ")} (${s.count.toLocaleString()})` }))} />
      <Select aria-label="File format" value={format} onValueChange={setFormat} options={FORMATS} />
      <Button variant="secondary" onClick={() => download.mutate()} disabled={!chosen || download.isPending}>
        {download.isPending ? "Preparing…" : "Export for SAP"}
      </Button>
    </div>
  );
}

function useAction(fn: (id: string) => Promise<unknown>, done: string, onDone: () => void) {
  return useMutation({ mutationFn: fn, onSuccess: () => { toast.success(done); onDone(); }, onError: (e) => toast.error((e as Error).message || "Action failed") });
}

export function CleaningSurface() {
  const qc = useQueryClient();
  const { can } = useRole();
  // Backend guards (api/routes/cleaning.py): approve/reject/bulk-approve need `approve`, roll back needs `apply`.
  const canApprove = can("approve");
  const canApply = can("apply");
  const [view, setView] = useUrlState("view", "all");
  const drawer = useDrawerParam("job");
  const [confirmAuto, setConfirmAuto] = useState(false);
  const [search, setSearch] = useState("");

  const q = useQuery({
    queryKey: ["cleaning.queue", { view }],
    queryFn: () => getCleaningQueue({ per_page: 100, status: view === "auto" ? "auto_approved" : view === "review" ? "recommended" : undefined }),
  });
  const items = useMemo(() => q.data?.items ?? [], [q.data]);
  const total = q.data?.total ?? items.length;
  const refresh = () => qc.invalidateQueries({ queryKey: ["cleaning.queue"] });
  const approve = useAction((id) => approveCleaning(id), "Correction approved", refresh);
  const reject = useAction((id) => rejectCleaning(id, "Reviewed and rejected"), "Correction rejected", refresh);
  const rollback = useAction(rollbackCleaning, "Correction rolled back", refresh);
  const runAuto = useMutation({
    mutationFn: () => bulkApprove({ max_count: 100 }),
    onSuccess: (d) => { toast.success(`Approved ${d.approved_count} correction${d.approved_count === 1 ? "" : "s"}${d.skipped_count ? `, skipped ${d.skipped_count}` : ""}`); setConfirmAuto(false); refresh(); },
    onError: (e) => toast.error((e as Error).message || "Auto-approval did not run"),
  });

  const counts = items.reduce((a, i) => ({ ...a, [bucket(i.status)]: a[bucket(i.status)] + 1 }), { auto: 0, approved: 0, review: 0, closed: 0 } as Record<Bucket, number>);
  const meanConf = items.length ? Math.round(items.reduce((a, i) => a + pct(i.confidence), 0) / items.length) : null;
  const needle = search.trim().toLowerCase();
  const visible = needle ? items.filter((i) => `${i.record_key} ${i.object_type} ${preview(i)}`.toLowerCase().includes(needle)) : items;
  const selected = drawer.value ? items.find((i) => i.id === drawer.value) ?? null : null;

  const columns = useMemo<ColumnDef<CleaningQueueItem, unknown>[]>(() => [
    { id: "status", header: "Status", meta: meta({ sticky: "start", width: 140 }), cell: ({ row }) => {
      const b = bucket(row.original.status);
      return <StatusBadge status={STATUS[b]}>{LABEL[b]}</StatusBadge>;
    } },
    { id: "record", header: "Record", meta: meta({ width: 220 }), cell: ({ row }) => <Mono>{row.original.record_key}</Mono> },
    { id: "object", header: "Object", meta: meta({ width: 150 }), cell: ({ row }) => formatModuleName(row.original.object_type) },
    { id: "change", header: "Proposed change", meta: meta({ minWidth: 260 }), cell: ({ row }) => <Mono>{preview(row.original)}</Mono> },
    { id: "conf", header: "Confidence", meta: meta({ width: 104, align: "end", numeric: true }), cell: ({ row }) => `${pct(row.original.confidence)}%` },
    { id: "when", header: "Detected", meta: meta({ width: 110, align: "end" }), cell: ({ row }) => relativeTime(row.original.detected_at) },
  ], []);

  return (
    <div className="ui-page">
      <PageHeader title="Cleaning"
        summary={q.data ? `${total.toLocaleString()} corrections proposed for single records. ${counts.review} wait for review.` : undefined}
        actions={<>
          {can("export") ? <SapExport /> : null}
          {canApprove ? <Button onClick={() => setConfirmAuto(true)} disabled={runAuto.isPending || confirmAuto}>Approve confident corrections</Button> : null}
        </>} />
      <Tally level={2} label="Cleaning queue" figures={[
        { label: "In queue", value: q.isLoading ? null : total, loading: q.isLoading, verdict: total ? "Corrections proposed for single records." : "None.", href: "/cleaning" },
        { label: "Needs review", value: q.isLoading ? null : counts.review, loading: q.isLoading, tone: counts.review ? "warning" : undefined, verdict: counts.review ? "Waiting for a steward." : "None.", href: "/cleaning?view=review" },
        { label: "Auto-applied", value: q.isLoading ? null : counts.auto, loading: q.isLoading, verdict: counts.auto ? "Can be rolled back." : "None.", href: "/cleaning?view=auto" },
        { label: "Mean confidence", value: meanConf, unit: meanConf === null ? undefined : "%", loading: q.isLoading, verdict: meanConf === null ? "None." : "Across the queue.", href: "/cleaning" },
      ]} />
      {confirmAuto ? (
        <Banner tone="info" title="Approve every correction above the auto-approval threshold?" action={
          <div className="ui-page-header__actions">
            <Button size="sm" onClick={() => runAuto.mutate()} disabled={runAuto.isPending}>{runAuto.isPending ? "Approving" : "Approve corrections"}</Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirmAuto(false)}>Not now</Button>
          </div>}>
          Up to 100 corrections whose confidence clears the threshold are approved and applied. The rest stay in review.
        </Banner>
      ) : null}
      <FilterBar search={{ value: search, onChange: setSearch, placeholder: "Search records" }}>
        {VIEWS.map(([k, l]) => <Chip key={k} selected={view === k} onClick={() => setView(k)}>{l}</Chip>)}
      </FilterBar>
      {q.isLoading ? <TableSkeleton rows={8} label="Loading the cleaning queue" />
        : q.error ? <Banner tone="danger" title="The cleaning queue could not be read">{(q.error as Error).message}</Banner>
        : visible.length ? <DataTable columns={columns} data={visible} getRowId={(i) => i.id} onRowActivate={(i) => drawer.open(i.id)}
            ariaLabel="Cleaning queue. Use j and k to move, Enter to open." maxHeight="62vh" />
        : <EmptyState action={needle || view !== "all" ? <button type="button" className="ui-link-button" onClick={() => { setSearch(""); setView("all"); }}>Show everything</button> : undefined}>
            {needle || view !== "all" ? "Nothing in this view." : "Nothing to clean. The cleaning engine proposes corrections after each analysis."}
          </EmptyState>}

      <DetailDrawer open={!!selected} onClose={drawer.close} ariaLabel="Correction details"
        header={selected ? (
          <div className="ui-drawer-head">
            <StatusBadge status={STATUS[bucket(selected.status)]}>{LABEL[bucket(selected.status)]}</StatusBadge>
            <h2 className="ui-drawer-head__title"><Mono>{selected.record_key}</Mono></h2>
          </div>) : null}>
        {selected ? (
          <JobDetail item={selected} canApprove={canApprove} canApply={canApply}
            busy={approve.isPending || reject.isPending || rollback.isPending}
            onApprove={() => approve.mutate(selected.id)} onReject={() => reject.mutate(selected.id)} onRollback={() => rollback.mutate(selected.id)} />
        ) : null}
      </DetailDrawer>
    </div>
  );
}

const Part = ({ title, children }: { title: string; children: ReactNode }) => (
  <section className="ui-detail-part"><h3 className="ui-detail-part__title">{title}</h3>{children}</section>
);

function JobDetail({ item: i, canApprove, canApply, busy, onApprove, onReject, onRollback }: {
  item: CleaningQueueItem; canApprove: boolean; canApply: boolean; busy: boolean; onApprove: () => void; onReject: () => void; onRollback: () => void;
}) {
  const [ask, setAsk] = useState<"approve" | "reject" | "rollback" | null>(null);
  const b = bucket(i.status);
  const changed = changedFields(i);
  // fields that differ between the two records first; identical ones carry no decision
  const merge = Object.entries(i.merge_preview ?? {}).sort(([, x], [, y]) => Number(x.a === x.b) - Number(y.a === y.b));
  return (
    <div className="ui-detail">
      <KeyValue rows={[
        { k: "Object", v: formatModuleName(i.object_type) },
        { k: "Status", v: i.status.replace(/_/g, " ") },
        { k: "Confidence", v: `${pct(i.confidence)}%` },
        { k: "Priority", v: String(i.priority) },
        { k: "Detected", v: relativeTime(i.detected_at) },
        { k: "Applied", v: i.applied_at ? relativeTime(i.applied_at) : "—" },
        { k: "Roll back until", v: i.rollback_deadline ? new Date(i.rollback_deadline).toLocaleString() : "—" },
        { k: "Rule", v: i.rule_id ?? "—", mono: !!i.rule_id },
        { k: "Golden record", v: i.golden_record_exists ? i.golden_record_id ?? "Exists" : "None", mono: !!i.golden_record_id },
      ]} />
      {changed.length ? (
        <Part title="Fields that change">
          <div className="ui-matrix-scroll"><table className="ui-mini-table">
            <thead><tr><th scope="col">Field</th><th scope="col">Before</th><th scope="col">After</th></tr></thead>
            <tbody>{changed.map(([k, before, after]) => <tr key={k}><td><Mono>{k}</Mono></td><td><Mono>{before}</Mono></td><td><Mono>{after}</Mono></td></tr>)}</tbody>
          </table></div>
        </Part>
      ) : null}
      {merge.length ? (
        <Part title="Merge preview">
          <div className="ui-matrix-scroll"><table className="ui-mini-table">
            <thead><tr><th scope="col">Field</th><th scope="col">A</th><th scope="col">B</th><th scope="col">Survivor</th></tr></thead>
            <tbody>{merge.map(([k, m]) => <tr key={k}><td><Mono>{k}</Mono></td><td><Mono>{m.a}</Mono></td><td><Mono>{m.b}</Mono></td><td><Mono>{m.survivor}</Mono></td></tr>)}</tbody>
          </table></div>
        </Part>
      ) : null}
      {!changed.length && !merge.length && i.golden_field_value ? <p className="ui-note">Golden value: <Mono>{i.golden_field_value}</Mono></p> : null}
      {i.audit?.length ? (
        <Part title="Audit trail">
          <ul className="ui-plain-list">{i.audit.map((a) => (
            <li key={a.id}>{a.actor_name} {a.action.replace(/_/g, " ")}, <span className="ui-micro">{relativeTime(a.created_at)}</span></li>
          ))}</ul>
        </Part>
      ) : null}
      {ask ? (
        <Banner tone={ask === "approve" ? "info" : "danger"}
          title={ask === "approve" ? "Approve this correction?" : ask === "reject" ? "Reject this correction?" : "Roll this correction back?"}
          action={
            <div className="ui-page-header__actions">
              <Button size="sm" variant={ask === "approve" ? "primary" : "danger"} disabled={busy}
                onClick={() => { (ask === "approve" ? onApprove : ask === "reject" ? onReject : onRollback)(); setAsk(null); }}>
                {ask === "approve" ? "Approve" : ask === "reject" ? "Reject" : "Roll back"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setAsk(null)}>Not now</Button>
            </div>}>
          This changes Meridian&apos;s data only. Nothing is written to SAP.
        </Banner>
      ) : (
        <div className="ui-page-header__actions">
          {b === "review" && canApprove ? <><Button onClick={() => setAsk("approve")} disabled={busy}>Approve</Button><Button variant="ghost" onClick={() => setAsk("reject")} disabled={busy}>Reject</Button></> : null}
          {b === "auto" && canApply ? <Button variant="danger" onClick={() => setAsk("rollback")} disabled={busy}>Roll back</Button> : null}
          {b === "approved" ? <p className="ui-micro">Approved. Load it into SAP with Export for SAP.</p> : null}
          {b === "closed" ? <p className="ui-micro">This correction is closed.</p> : null}
        </div>
      )}
    </div>
  );
}
