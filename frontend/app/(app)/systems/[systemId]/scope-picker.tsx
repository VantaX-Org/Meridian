"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Button, Card, Checkbox, ConfirmDialog, DataTable, EmptyState, Field, Input, Mono, Skeleton, toast } from "@/design";
import { environmentLabel } from "@/components/systems/connect-system-dialog";
import { getSystemObjects, startDownload, type DownloadScope, type ScopeKey } from "@/lib/api/system-objects";
import { apiErrorMessage } from "@/lib/error";
import { formatModuleName, relativeTime } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";

const SCOPE_LABEL: Record<ScopeKey, string> = {
  company_codes: "Company codes",
  plants: "Plants",
  sales_orgs: "Sales organisations",
  purchasing_orgs: "Purchasing organisations",
};
const list = (v: string) => v.split(/[\s,;]+/).map((x) => x.trim().toUpperCase()).filter(Boolean);
const Help = ({ children }: { children: React.ReactNode }) => <p className="m-text-meta m-ink-3">{children}</p>;
const objects_ = (n: number) => `${n.toLocaleString()} ${n === 1 ? "object" : "objects"}`;

/** Choose objects and scope, confirm, then extract into a new run. The one Extract drawer's body. */
export function ScopePicker({ id, system, onDownloaded }: {
  id: string;
  /** Named in the confirmation: which system and environment is about to be read. */
  system?: { name: string; environment: string };
  onDownloaded: (jobId: string) => void;
}) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: queryKeys.systemObjects(id), queryFn: () => getSystemObjects(id) });
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [scopeText, setScopeText] = useState<Partial<Record<ScopeKey, string>>>({});
  const [dates, setDates] = useState<{ date_from?: string; date_to?: string }>({});
  const [excludeDeleted, setExcludeDeleted] = useState(false);
  const [label, setLabel] = useState("");
  const [confirm, setConfirm] = useState<boolean | null>(null); // null = not asking; value = analyse flag

  const objects = useMemo(() => data?.objects ?? [], [data]);
  type Obj = (typeof objects)[number];
  const chosen = objects.filter((o) => picked.has(o.object));
  const filters = Array.from(new Set(chosen.flatMap((o) => o.scope_filters)));
  const windowed = chosen.flatMap((o) => o.date_window);
  const toggle = (o: string) => setPicked((p) => { const n = new Set(p); if (n.has(o)) n.delete(o); else n.add(o); return n; });

  const scope = (): DownloadScope => {
    const s: DownloadScope = { ...dates, ...(excludeDeleted ? { exclude_deleted: true } : {}) };
    for (const k of filters) {
      const v = list(scopeText[k] ?? "");
      if (v.length) s[k] = v;
    }
    return s;
  };
  const download = useMutation({
    mutationFn: (analyse: boolean) => startDownload(id, { objects: Array.from(picked), scope: scope(), label: label || undefined, analyse }),
    onSuccess: (job, analyse) => {
      toast.success(analyse ? "Extraction started. Analysis follows." : "Extraction started. A new run appears under Runs.");
      setPicked(new Set()); setConfirm(null);
      qc.invalidateQueries({ queryKey: queryKeys.systemVersions(id) });
      onDownloaded(job.job_id);
    },
    onError: (e) => toast.error(apiErrorMessage(e) || "Extraction refused"),
  });

  const columns = useMemo<ColumnDef<Obj, unknown>[]>(() => [
    { id: "pick", header: "", cell: ({ row }) => (
      <Checkbox checked={picked.has(row.original.object)} readOnly aria-label={`Select ${formatModuleName(row.original.object)}`} />) },
    { id: "object", header: "Object", cell: ({ row }) => formatModuleName(row.original.object) },
    { id: "tables", header: "Tables", cell: ({ row }) => {
      const t = row.original.tables;
      return <Mono>{t.slice(0, 5).join(", ")}{t.length > 5 ? ` +${t.length - 5}` : ""}</Mono>;
    } },
    { id: "last", header: "Last extracted", cell: ({ row }) => (row.original.last_download ? relativeTime(row.original.last_download.at) : "Never") },
    { id: "records", header: "Rows", cell: ({ row }) => row.original.last_download?.records?.toLocaleString() ?? "—" },
  ], [picked]);

  // The scope sentence of the confirmation: which filters narrow the read, or that it reads everything.
  const s = scope();
  const scopeParts = [
    ...filters.flatMap((k) => (s[k]?.length ? [`${SCOPE_LABEL[k].toLowerCase()} ${s[k]!.join(", ")}`] : [])),
    ...(s.date_from || s.date_to ? [`documents ${s.date_from ?? "the start"} to ${s.date_to ?? "today"}`] : []),
    ...(excludeDeleted ? ["records flagged for deletion skipped"] : []),
  ];
  const scopeSentence = scopeParts.length ? `Scope: ${scopeParts.join("; ")}.` : "Scope: everything, no organisational filter.";

  return (
    <Card title="Extract objects into a new run" meta={chosen.length ? `${chosen.length} selected` : undefined}>
      {isLoading ? <Skeleton height={160} />
        : !objects.length ? <EmptyState title="No objects to extract" detail="This system exposes no objects yet. Check the connection on the Health tab." action={<Button render={<Link href={`/systems/${id}?tab=health`}>Test connection</Link>} />} /> : (
        <div className="flex flex-col gap-4">
          <DataTable columns={columns} data={objects} getRowId={(o) => o.object} onRowClick={(o) => toggle(o.object)} height={340} />
          {chosen.length > 0 ? (
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {filters.map((k) => (
                  <div key={k} className="flex flex-col gap-1">
                    <Field label={SCOPE_LABEL[k]}>
                      <Input className="w-full" value={scopeText[k] ?? ""} placeholder="1000, 2000" onChange={(e) => setScopeText({ ...scopeText, [k]: e.target.value })} />
                    </Field>
                    <Help>Comma-separated; empty reads all</Help>
                  </div>
                ))}
                {windowed.length > 0 ? (
                  <>
                    <div className="flex flex-col gap-1">
                      <Field label="Documents from">
                        <Input className="w-full" type="date" value={dates.date_from ?? ""} onChange={(e) => setDates({ ...dates, date_from: e.target.value || undefined })} />
                      </Field>
                      <Help>Replaces the default window for {windowed.join(", ")}</Help>
                    </div>
                    <Field label="Documents to">
                      <Input className="w-full" type="date" value={dates.date_to ?? ""} onChange={(e) => setDates({ ...dates, date_to: e.target.value || undefined })} />
                    </Field>
                  </>
                ) : null}
                <div className="flex flex-col gap-1">
                  <Field label="Run label">
                    <Input className="w-full" value={label} maxLength={120} onChange={(e) => setLabel(e.target.value)} />
                  </Field>
                  <Help>Optional; names the run in every list</Help>
                </div>
              </div>
              <Help>
                Organisational filters restrict every table that carries the field. General data without it is read in full so no record loses its context.
              </Help>
              <label className="flex items-center gap-2 m-text-body m-ink">
                <Checkbox aria-label="Skip records flagged for deletion" checked={excludeDeleted} onChange={(e) => setExcludeDeleted(e.target.checked)} />
                Skip records flagged for deletion
              </label>
              <Help>Faster reads. Leave off for a full quality score, because inactive data is itself a finding.</Help>
              <div className="flex gap-2">
                <Button variant="secondary" onClick={() => setConfirm(false)}>{`Extract ${objects_(chosen.length)}`}</Button>
                <Button variant="secondary" onClick={() => setConfirm(true)}>Extract and analyse</Button>
              </div>
              <ConfirmDialog
                open={confirm !== null}
                onOpenChange={(o) => { if (!o) setConfirm(null); }}
                title={`Extract ${objects_(chosen.length)} from ${system ? `${system.name} (${environmentLabel(system.environment)})` : "this system"}${confirm ? " and analyse" : ""}`}
                body={`${chosen.map((o) => formatModuleName(o.object)).join(", ")}. ${scopeSentence} Only these are read, into a new run. Read-only: Meridian never writes to SAP.`}
                confirmLabel={confirm ? "Extract and analyse" : "Extract now"}
                cancelLabel="Keep scope"
                pending={download.isPending}
                onConfirm={() => download.mutate(confirm === true)}
              />
            </div>
          ) : <p className="m-text-body m-ink-2">Select the objects to extract.</p>}
        </div>
      )}
    </Card>
  );
}
