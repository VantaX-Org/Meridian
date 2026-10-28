"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Button, ConfirmDialog, DataTable, EmptyState, ErrorState, Field, Input, Notice, Pill, Skeleton, Switch, Async, toast } from "@/design";
import { getSystems } from "@/lib/api/connectivity";
import {
  getPurgeLog, getRetention, getRetentionPreview, previewRetentionDraft, updateRetention,
  type PurgeLogEntry, type RetentionPolicy, type RetentionPreviewItem, type RowsByTable,
} from "@/lib/api/retention";
import { SettingsSection } from "@/components/mdm/ledger";
import { apiErrorMessage, isListFailure, apiErrorState } from "@/lib/error";
import { formatDate } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";
import { TenantPurge } from "./tenant-purge";

const KIND_LABEL: Record<PurgeLogEntry["kind"], string> = {
  version: "Run", reports: "Reports", audit: "Audit log", tenant: "Whole tenant",
};

/** "1.2 MB" style, binary units, one decimal above KB. */
export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1; }
  return `${i === 0 ? v.toLocaleString() : v.toLocaleString(undefined, { maximumFractionDigits: 1 })} ${units[i]}`;
}

/** The rows a purge removes, as "findings 12, reports 1"; unlink and storage notes are left out of the count. */
function rowsSummary(rows: RowsByTable): string {
  const parts = Object.entries(rows)
    .filter((e): e is [string, number] => typeof e[1] === "number" && e[1] > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([t, n]) => `${t} ${n.toLocaleString()}`);
  return parts.length ? parts.join(", ") : "No rows";
}

const dayField = (v: number | null) => (v === null ? "" : String(v));

interface FormState { versions: string; reports: string; audit: string; keepBaseline: boolean; keepLatest: string }
const EMPTY_FORM: FormState = { versions: "", reports: "", audit: "", keepBaseline: true, keepLatest: "1" };
const toForm = (p: RetentionPolicy): FormState => ({
  versions: dayField(p.versions_days), reports: dayField(p.reports_days), audit: dayField(p.audit_days),
  keepBaseline: p.keep_baseline, keepLatest: String(p.keep_latest_per_system),
});
const MAX_DAYS = 3650;
const MAX_KEEP_LATEST = 100;

/** The inline error for a whole-number field, or undefined when it is in range. An empty
 *  days field means "keep for ever"; `0` is out of range, never "for ever". */
export function rangeError(raw: string, min: number, max: number, required = false): string | undefined {
  const t = raw.trim();
  if (t === "") return required ? `Between ${min} and ${max}` : undefined;
  const n = Number(t);
  if (!Number.isInteger(n) || n < min || n > max) return `Between ${min} and ${max}`;
  return undefined;
}
const parseDays = (s: string): number | null => (s.trim() === "" ? null : Number(s.trim()));

/** The retention policy, a dry-run preview of what it would purge now, and the purge log. */
export function RetentionPanel() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: queryKeys.retention(), queryFn: getRetention });
  const preview = useQuery({ queryKey: queryKeys.retentionPreview(), queryFn: getRetentionPreview, enabled: false });
  const log = useQuery({ queryKey: queryKeys.purgeLog(), queryFn: () => getPurgeLog(50) });

  const systemsQ = useQuery({ queryKey: queryKeys.systems(), queryFn: getSystems, retry: false, meta: { ignoreError: true } });
  const systemName = (id: string) => (id === "upload" ? "Upload" : systemsQ.data?.find((s) => s.id === id)?.name ?? "A removed system");
  const [confirming, setConfirming] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [loadedFrom, setLoadedFrom] = useState<RetentionPolicy | null>(null);

  // Load the saved policy into the form once per fetched document (state adjusted during
  // render, the React-documented pattern, so no effect is needed); edits stay until the next save.
  const policy = q.data?.policy;
  if (policy && policy !== loadedFrom) {
    setLoadedFrom(policy);
    setForm(toForm(policy));
  }
  const { versions, reports, audit, keepBaseline, keepLatest } = form;
  const set = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }));

  // No silent normalisation: an out-of-range field shows its error and blocks Save.
  const errors = {
    versions: rangeError(versions, 1, MAX_DAYS),
    reports: rangeError(reports, 1, MAX_DAYS),
    audit: rangeError(audit, 30, MAX_DAYS),
    keepLatest: rangeError(keepLatest, 0, MAX_KEEP_LATEST, true),
  };
  const invalid = Object.values(errors).some(Boolean);
  const draft: RetentionPolicy = {
    versions_days: parseDays(versions),
    reports_days: parseDays(reports),
    audit_days: parseDays(audit),
    keep_baseline: keepBaseline,
    keep_latest_per_system: Number(keepLatest.trim()),
  };
  const dirty = !!policy && !invalid && JSON.stringify(draft) !== JSON.stringify(policy);

  const save = useMutation({
    mutationFn: () => updateRetention(draft),
    onSuccess: (r) => {
      qc.setQueryData(queryKeys.retention(), r);
      setConfirming(false);
      toast("Retention policy saved");
      void qc.invalidateQueries({ queryKey: queryKeys.retentionPreview() });
    },
    onError: (e: unknown) => toast.error(apiErrorMessage(e) || "The policy could not be saved"),
  });

  const previewColumns: ColumnDef<RetentionPreviewItem, unknown>[] = [
    { id: "run", header: "Run", cell: ({ row }) => row.original.label ?? `Run of ${formatDate(row.original.run_at, "datetime")}` },
    { id: "run_at", header: "Started", cell: ({ row }) => formatDate(row.original.run_at, "datetime") },
    { id: "system", header: "System", cell: ({ row }) => systemName(row.original.system_id) },
    { id: "rows", header: "Rows", cell: ({ row }) => rowsSummary(row.original.rows_by_table) },
    { id: "bytes", header: "Storage", meta: { numeric: true }, cell: ({ row }) => formatBytes(row.original.bytes_freed) },
    {
      id: "outcome", header: "Outcome",
      cell: ({ row }) => (row.original.blocked_reason
        ? <span className="inline-flex items-center gap-2"><Pill tone="at-risk">Blocked</Pill><span className="m-text-meta">{row.original.blocked_reason}</span></span>
        : <Pill tone="no-go">Would be purged</Pill>),
    },
  ];

  const logColumns: ColumnDef<PurgeLogEntry, unknown>[] = [
    { id: "when", header: "When", cell: ({ row }) => formatDate(row.original.created_at, "datetime") },
    { id: "kind", header: "Kind", cell: ({ row }) => KIND_LABEL[row.original.kind] },
    { id: "target", header: "Target", cell: ({ row }) => (row.original.kind === "version" ? "One archived run" : row.original.kind === "tenant" ? "Whole tenant" : KIND_LABEL[row.original.kind]) },
    {
      id: "mode", header: "Mode",
      cell: ({ row }) => (row.original.blocked_reason
        ? <Pill tone="at-risk">Blocked</Pill>
        : row.original.dry_run ? <Pill tone="neutral">Dry run</Pill> : <Pill tone="no-go">Purged</Pill>),
    },
    { id: "rows", header: "Rows", cell: ({ row }) => row.original.blocked_reason ?? rowsSummary(row.original.rows_by_table) },
    { id: "bytes", header: "Storage", meta: { numeric: true }, cell: ({ row }) => formatBytes(row.original.bytes_freed) },
    { id: "actor", header: "By", cell: ({ row }) => row.original.actor_email ?? "Scheduler" },
  ];

  const enforcement = q.data?.enforcement;
  // Shortening a limit while purges are enforced deletes for real tonight: that save is confirmed, naming what goes.
  const shorter = (next: number | null, prev: number | null | undefined) => next !== null && (prev === null || prev === undefined || next < prev);
  const shortens = !!policy && (shorter(draft.versions_days, policy.versions_days) || shorter(draft.reports_days, policy.reports_days)
    || shorter(draft.audit_days, policy.audit_days) || draft.keep_latest_per_system < policy.keep_latest_per_system || (policy.keep_baseline && !draft.keep_baseline));
  const needsConfirm = !!enforcement?.enforced && shortens;
  // The confirm counts what the draft being saved selects, not the saved policy.
  const draftPreview = useMutation({ mutationFn: previewRetentionDraft });
  const purgeable = (draftPreview.data ?? []).filter((p) => !p.blocked_reason);
  const purgeSystems = Array.from(new Set(purgeable.map((p) => systemName(p.system_id))));
  const onSave = () => {
    if (!needsConfirm) { save.mutate(); return; }
    draftPreview.reset();
    draftPreview.mutate(draft);
    setConfirming(true);
  };
  const statusLine = (() => {
    if (!enforcement) return null;
    if (enforcement.enforced) return "Purges are enforced. The nightly task deletes what the policy selects.";
    const until = enforcement.dry_run_until
      ? `Dry run until ${formatDate(enforcement.dry_run_until, "date")}`
      : "Dry run until seven days after the first nightly run under this policy";
    return enforcement.flag_enabled
      ? `${until}. The nightly task writes dry-run rows to the purge log only.`
      : `${until}. Ask your platform operator to turn on enforced purges.`;
  })();

  return (
    <SettingsSection title="Retention" hint="How long runs, reports and audit rows are kept. Archived runs past the limit are purged for good by the nightly task">
        <Async query={q} skeleton={120}>{(
          <>
            {statusLine ? (
              <Notice tone={enforcement?.enforced ? "warning" : "info"}>
                <span>{statusLine}</span>
                {enforcement?.enforced ? null : <p className="m-text-meta mt-1">Dry run restarts when the policy changes</p>}
              </Notice>
            ) : null}
            <div className="flex flex-wrap items-end gap-3">
              <Field label="Keep runs for (days)" error={errors.versions}>
                <Input type="number" min={1} max={MAX_DAYS} inputMode="numeric" placeholder="For ever" value={versions} onChange={(e) => set({ versions: e.target.value })} />
              </Field>
              <Field label="Keep reports for (days)" error={errors.reports}>
                <Input type="number" min={1} max={MAX_DAYS} inputMode="numeric" placeholder="For ever" value={reports} onChange={(e) => set({ reports: e.target.value })} />
              </Field>
              <Field label="Keep audit rows for (days)" error={errors.audit}>
                <Input type="number" min={30} max={MAX_DAYS} inputMode="numeric" placeholder="For ever" value={audit} onChange={(e) => set({ audit: e.target.value })} />
              </Field>
              <Field label="Keep latest per system" error={errors.keepLatest}>
                <Input type="number" min={0} max={MAX_KEEP_LATEST} inputMode="numeric" value={keepLatest} onChange={(e) => set({ keepLatest: e.target.value })} />
              </Field>
              <Switch checked={keepBaseline} onCheckedChange={(v) => set({ keepBaseline: v })} label="Keep the baseline run" />
              <Button disabled={!dirty || invalid} pending={save.isPending} onClick={onSave}>Save policy</Button>
            </div>
            <p className="m-text-meta m-ink-3">
              Only archived runs are purged, never the baseline nor the newest runs of each system. Golden records, rules, glossary terms and contracts are never touched.
            </p>
          </>
        )}</Async>

        <div className="flex items-center justify-between gap-3">
          <h3 className="font-semibold m-text-h">Preview</h3>
          <Button variant="secondary" pending={preview.isFetching} onClick={() => preview.refetch()}>Preview what would be purged</Button>
        </div>
        {preview.isFetching && !preview.data ? <Skeleton height={64} /> : isListFailure(preview) ? (
          <ErrorState {...apiErrorState(preview.error)} onRetry={() => preview.refetch()} />
        ) : !preview.data ? (
          <p className="m-text-meta m-ink-3">Run the preview to see what the policy selects now. Nothing is deleted by a preview.</p>
        ) : preview.data.length === 0 ? (
          <EmptyState variant="inline" title="Nothing to purge" detail="No archived run is past the policy right now" action={<Button variant="ghost" onClick={() => preview.refetch()}>Check again</Button>} />
        ) : (
          <DataTable columns={previewColumns} data={preview.data} getRowId={(r) => r.version_id} tableId="retention-preview" hideToolbar />
        )}

        <ConfirmDialog
          open={confirming}
          onOpenChange={setConfirming}
          title="Shorten retention while purges are enforced"
          tone="danger"
          body={draftPreview.isPending || draftPreview.isIdle
            ? "Counting the runs this policy selects…"
            : draftPreview.isError
              ? "The runs this policy selects could not be counted. Saving lets the nightly task purge archived runs past it, for good."
              : purgeable.length
              ? `${purgeable.length.toLocaleString()} ${purgeable.length === 1 ? "run" : "runs"} from ${purgeSystems.join(", ")} will be purged nightly, for good. Golden records, rules and contracts are never touched.`
              : "No archived run is past this policy today; runs that pass it later are purged nightly, for good."}
          confirmLabel="Save policy"
          cancelLabel="Keep the current policy"
          pending={save.isPending}
          onConfirm={() => save.mutate()}
        />

        <h3 className="font-semibold m-text-h">Purge log</h3>
        <Async query={log} skeleton={64} notFoundIsEmpty>{!log.data?.length ? (
          <EmptyState variant="inline" title="No purge yet" detail="Dry runs and purges appear here with the rows removed per table" action={<Button variant="ghost" onClick={() => log.refetch()}>Refresh</Button>} />
        ) : (
          <DataTable columns={logColumns} data={log.data} getRowId={(r) => r.id} tableId="purge-log" hideToolbar />
        )}</Async>

        <TenantPurge />
    </SettingsSection>
  );
}
