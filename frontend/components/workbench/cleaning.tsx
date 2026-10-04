"use client";

/**
 * Workbench → Cleaning: corrections the cleaning engine proposes for single
 * records. Confident ones are auto-applied and can be rolled back; the rest
 * wait for a steward's approval. The drawer shows before/after per field and
 * the job's audit trail.
 */

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import {
  Banner, Button, Chip, DataTable, Drawer, EmptyState, KpiRail, Select, Stack, Stat, Text, useDrawerParam, type AuroraColumnMeta, type ChipTone,
} from "@/components/aurora";
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
const TONE: Record<Bucket, ChipTone> = { auto: "success", approved: "info", review: "warning", closed: "neutral" };
const LABEL: Record<Bucket, string> = { auto: "auto-applied", approved: "approved · export", review: "needs review", closed: "closed" };
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
  if (m) return `${m[0]}: ${m[1].a} | ${m[1].b} → ${m[1].survivor}`;
  if (i.golden_field_value) return `→ ${i.golden_field_value}`;
  const changed = changedFields(i);
  return changed.length ? changed.map(([k, b, a]) => `${k}: ${b} → ${a}`).join(" · ") : "—";
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
    <Stack direction="row" gap={2} align="center">
      <Select aria-label="Corrections to export" value={chosen} onValueChange={setStatus}
        options={statuses.map((s) => ({ value: s.value, label: `${s.value.replace(/_/g, " ")} (${s.count.toLocaleString()})` }))} />
      <Select aria-label="File format" value={format} onValueChange={setFormat} options={FORMATS} />
      <Button variant="secondary" onClick={() => download.mutate()} disabled={!chosen || download.isPending}>
        {download.isPending ? "Preparing…" : "Export for SAP"}
      </Button>
    </Stack>
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
    onSuccess: (d) => { toast.success(`Auto-approved ${d.approved_count} correction${d.approved_count === 1 ? "" : "s"}${d.skipped_count ? ` · ${d.skipped_count} skipped` : ""}`); setConfirmAuto(false); refresh(); },
    onError: (e) => toast.error((e as Error).message || "Auto-jobs did not run"),
  });

  const counts = items.reduce((a, i) => ({ ...a, [bucket(i.status)]: a[bucket(i.status)] + 1 }), { auto: 0, approved: 0, review: 0, closed: 0 } as Record<Bucket, number>);
  const meanConf = items.length ? Math.round(items.reduce((a, i) => a + pct(i.confidence), 0) / items.length) : null;
  const selected = drawer.value ? items.find((i) => i.id === drawer.value) ?? null : null;

  const columns = useMemo<ColumnDef<CleaningQueueItem, unknown>[]>(() => [
    { id: "status", header: "Status", meta: meta({ sticky: "start", width: 130 }), cell: ({ row }) => <Chip tone={TONE[bucket(row.original.status)]}>{LABEL[bucket(row.original.status)]}</Chip> },
    { id: "record", header: "Record", meta: meta({ width: 200 }), cell: ({ row }) => (
      <span><strong className="aurora-number">{row.original.record_key}</strong>
        <Text variant="text-micro" tone="muted" as="div" className="aurora-number">{row.original.id.slice(0, 8)}</Text></span>) },
    { id: "object", header: "Object", meta: meta({ width: 150 }), cell: ({ row }) => formatModuleName(row.original.object_type) },
    { id: "change", header: "Proposed change", cell: ({ row }) => <span className="aurora-number">{preview(row.original)}</span> },
    { id: "conf", header: "Confidence", meta: meta({ width: 100, align: "end", numeric: true }), cell: ({ row }) => `${pct(row.original.confidence)}%` },
    { id: "when", header: "Detected", meta: meta({ width: 110 }), cell: ({ row }) => relativeTime(row.original.detected_at) },
  ], []);

  return (
    <Stack gap={5} className="aurora-page">
      <KpiRail>
        <Stat label="In queue" value={total} />
        <Stat label="Needs review" value={counts.review} tone={counts.review ? "warning" : "neutral"} />
        <Stat label="Auto-applied" value={counts.auto} tone={counts.auto ? "success" : "neutral"} />
        <Stat label="Mean confidence" value={meanConf ?? "—"} unit={meanConf === null ? undefined : "%"} />
      </KpiRail>
      <Stack direction="row" gap={2} wrap align="center">
        {VIEWS.map(([k, l]) => <Chip key={k} selected={view === k} onClick={() => setView(k)}>{l}</Chip>)}
        <span style={{ flex: 1 }} />
        {can("export") ? <SapExport /> : null}
        {canApprove ? <Button onClick={() => setConfirmAuto(true)} disabled={runAuto.isPending || confirmAuto}>Run auto-jobs</Button> : null}
      </Stack>
      {confirmAuto ? (
        <Banner tone="info" title="Approve every correction above the auto-approval threshold?" action={
          <Stack direction="row" gap={2}>
            <Button size="sm" onClick={() => runAuto.mutate()} disabled={runAuto.isPending}>{runAuto.isPending ? "Running…" : "Run auto-jobs"}</Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirmAuto(false)}>Not now</Button>
          </Stack>}>
          Up to 100 corrections whose confidence clears the threshold are approved and applied. The rest stay in review.
        </Banner>
      ) : null}
      {q.isLoading ? <Text tone="muted">Reading the cleaning queue.</Text>
        : q.error ? <Banner tone="danger" title="The cleaning queue could not be read">{(q.error as Error).message}</Banner>
        : items.length ? <DataTable columns={columns} data={items} getRowId={(i) => i.id} onRowActivate={(i) => drawer.open(i.id)} ariaLabel="Cleaning queue" maxHeight="60vh" />
        : <EmptyState title={view === "all" ? "Nothing to clean." : "Nothing in this view."} body="The cleaning engine proposes corrections after each analysis; they appear here with their confidence." />}

      <Drawer open={!!selected} onClose={drawer.close} ariaLabel="Correction details"
        header={selected ? <Stack direction="row" gap={2} align="center"><Chip tone={TONE[bucket(selected.status)]}>{LABEL[bucket(selected.status)]}</Chip><Text variant="text-lead" className="aurora-number">{selected.record_key}</Text></Stack> : null}>
        {selected ? (
          <JobDetail item={selected} canApprove={canApprove} canApply={canApply}
            busy={approve.isPending || reject.isPending || rollback.isPending}
            onApprove={() => approve.mutate(selected.id)} onReject={() => reject.mutate(selected.id)} onRollback={() => rollback.mutate(selected.id)} />
        ) : null}
      </Drawer>
    </Stack>
  );
}

function JobDetail({ item: i, canApprove, canApply, busy, onApprove, onReject, onRollback }: {
  item: CleaningQueueItem; canApprove: boolean; canApply: boolean; busy: boolean; onApprove: () => void; onReject: () => void; onRollback: () => void;
}) {
  const b = bucket(i.status);
  const changed = changedFields(i);
  // fields that differ between the two records first; identical ones carry no decision
  const merge = Object.entries(i.merge_preview ?? {}).sort(([, x], [, y]) => Number(x.a === x.b) - Number(y.a === y.b));
  const rows: [string, string][] = [
    ["Object", formatModuleName(i.object_type)], ["Status", i.status.replace(/_/g, " ")], ["Confidence", `${pct(i.confidence)}%`], ["Priority", String(i.priority)],
    ["Detected", relativeTime(i.detected_at)], ["Applied", i.applied_at ? relativeTime(i.applied_at) : "—"],
    ["Roll back until", i.rollback_deadline ? new Date(i.rollback_deadline).toLocaleString() : "—"],
    ["Rule", i.rule_id ?? "—"], ["Golden record", i.golden_record_exists ? i.golden_record_id ?? "exists" : "none"],
  ];
  return (
    <Stack gap={4}>
      <table className="aurora-exec__table"><tbody>{rows.map(([k, v]) => <tr key={k}><td>{k}</td><td className="aurora-number">{v}</td></tr>)}</tbody></table>
      {changed.length ? (
        <Stack gap={2}>
          <Text variant="text-micro" tone="muted" className="aurora-exec__eyebrow">Fields that change</Text>
          <table className="aurora-exec__table">
            <thead><tr><th>Field</th><th>Before</th><th>After</th></tr></thead>
            <tbody>{changed.map(([k, before, after]) => <tr key={k}><td className="aurora-number">{k}</td><td className="aurora-number">{before}</td><td className="aurora-number">{after}</td></tr>)}</tbody>
          </table>
        </Stack>
      ) : null}
      {merge.length ? (
        <Stack gap={2}>
          <Text variant="text-micro" tone="muted" className="aurora-exec__eyebrow">Merge preview</Text>
          <table className="aurora-exec__table">
            <thead><tr><th>Field</th><th>A</th><th>B</th><th>Survivor</th></tr></thead>
            <tbody>{merge.map(([k, m]) => <tr key={k}><td className="aurora-number">{k}</td><td className="aurora-number">{m.a}</td><td className="aurora-number">{m.b}</td><td className="aurora-number">{m.survivor}</td></tr>)}</tbody>
          </table>
        </Stack>
      ) : null}
      {!changed.length && !merge.length && i.golden_field_value ? <Text variant="text-small" tone="secondary">Golden value: <span className="aurora-number">{i.golden_field_value}</span></Text> : null}
      {i.audit?.length ? (
        <Stack gap={2}>
          <Text variant="text-micro" tone="muted" className="aurora-exec__eyebrow">Audit trail</Text>
          {i.audit.map((a) => <Text key={a.id} variant="text-small" tone="secondary">{relativeTime(a.created_at)} · {a.actor_name} · {a.action.replace(/_/g, " ")}</Text>)}
        </Stack>
      ) : null}
      <Stack direction="row" gap={2} wrap>
        {b === "review" && canApprove ? <><Button onClick={onApprove} disabled={busy}>Approve</Button><Button variant="ghost" onClick={onReject} disabled={busy}>Reject</Button></> : null}
        {b === "auto" && canApply ? <Button variant="danger" onClick={onRollback} disabled={busy}>Roll back</Button> : null}
        {b === "approved" ? <Text variant="text-small" tone="muted">Approved — load it into SAP with Export for SAP.</Text> : null}
        {b === "closed" ? <Text variant="text-small" tone="muted">This correction is closed.</Text> : null}
      </Stack>
    </Stack>
  );
}
