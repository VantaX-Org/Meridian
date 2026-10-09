"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { Button, DataTable, EmptyState, Field, Mono, Skeleton } from "@/design";
import { getSystemObjects, startDownload, type DownloadScope, type ScopeKey } from "@/lib/api/system-objects";
import { formatModuleName, relativeTime } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";

const SCOPE_LABEL: Record<ScopeKey, string> = {
  company_codes: "Company codes",
  plants: "Plants",
  sales_orgs: "Sales organisations",
  purchasing_orgs: "Purchasing organisations",
};
const list = (v: string) => v.split(/[\s,;]+/).map((x) => x.trim().toUpperCase()).filter(Boolean);
const field = "w-full rounded border px-3 py-1.5 text-[13px]";
const fieldStyle = { borderColor: "var(--m-line)" };
const note = "text-[13px]";
const noteStyle = { color: "var(--m-ink-2)" };

/** Choose objects and scope, confirm inline, then extract into a new run. */
export function ScopePicker({ id, onDownloaded }: { id: string; onDownloaded: () => void }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: queryKeys.systemObjects(id), queryFn: () => getSystemObjects(id) });
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [scopeText, setScopeText] = useState<Partial<Record<ScopeKey, string>>>({});
  const [dates, setDates] = useState<{ date_from?: string; date_to?: string }>({});
  const [label, setLabel] = useState("");
  const [confirm, setConfirm] = useState<boolean | null>(null); // null = not asking; value = analyse flag

  const objects = useMemo(() => data?.objects ?? [], [data]);
  type Obj = (typeof objects)[number];
  const chosen = objects.filter((o) => picked.has(o.object));
  const filters = Array.from(new Set(chosen.flatMap((o) => o.scope_filters)));
  const windowed = chosen.flatMap((o) => o.date_window);
  const toggle = (o: string) => setPicked((p) => { const n = new Set(p); if (n.has(o)) n.delete(o); else n.add(o); return n; });

  const download = useMutation({
    mutationFn: (analyse: boolean) => {
      const scope: DownloadScope = { ...dates };
      for (const k of filters) {
        const v = list(scopeText[k] ?? "");
        if (v.length) scope[k] = v;
      }
      return startDownload(id, { objects: Array.from(picked), scope, label: label || undefined, analyse });
    },
    onSuccess: (_, analyse) => {
      toast.success(analyse ? "Extraction started. Analysis follows." : "Extraction started. A new run appears under Runs.");
      setPicked(new Set()); setConfirm(null);
      qc.invalidateQueries({ queryKey: queryKeys.systemVersions(id) });
      onDownloaded();
    },
    onError: (e) => toast.error((e as Error).message || "Extraction refused"),
  });

  const columns = useMemo<ColumnDef<Obj, unknown>[]>(() => [
    { id: "pick", header: "", cell: ({ row }) => (
      <input type="checkbox" checked={picked.has(row.original.object)} readOnly aria-label={`Select ${formatModuleName(row.original.object)}`} />) },
    { id: "object", header: "Object", cell: ({ row }) => formatModuleName(row.original.object) },
    { id: "tables", header: "Tables", cell: ({ row }) => {
      const t = row.original.tables;
      return <Mono>{t.slice(0, 5).join(", ")}{t.length > 5 ? ` +${t.length - 5}` : ""}</Mono>;
    } },
    { id: "last", header: "Last extraction", cell: ({ row }) => (row.original.last_download ? relativeTime(row.original.last_download.at) : "Never") },
    { id: "records", header: "Rows", cell: ({ row }) => row.original.last_download?.records?.toLocaleString() ?? "—" },
  ], [picked]);

  return (
    <div className="rounded border p-3" style={{ borderColor: "var(--m-line)" }}>
      <div className="flex items-center justify-between">
        <p className="text-[13px] font-medium" style={{ color: "var(--m-ink)" }}>Extract objects into a new run</p>
        {chosen.length ? <p className={note} style={noteStyle}>{chosen.length} selected</p> : null}
      </div>
      {isLoading ? <Skeleton height={160} />
        : !objects.length ? <EmptyState title="This system offers no objects yet." /> : (
        <div className="mt-2 flex flex-col gap-4">
          <DataTable columns={columns} data={objects} getRowId={(o) => o.object} onRowClick={(o) => toggle(o.object)} height={340} />
          {chosen.length > 0 ? (
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {filters.map((k) => (
                  <Field key={k} label={`${SCOPE_LABEL[k]} — comma-separated, empty reads all`}>
                    <input className={field} style={fieldStyle} value={scopeText[k] ?? ""} placeholder="1000, 2000" onChange={(e) => setScopeText({ ...scopeText, [k]: e.target.value })} />
                  </Field>
                ))}
                {windowed.length > 0 ? (
                  <>
                    <Field label={`Documents from — replaces the default window for ${windowed.join(", ")}`}>
                      <input className={field} style={fieldStyle} type="date" value={dates.date_from ?? ""} onChange={(e) => setDates({ ...dates, date_from: e.target.value || undefined })} />
                    </Field>
                    <Field label="Documents to">
                      <input className={field} style={fieldStyle} type="date" value={dates.date_to ?? ""} onChange={(e) => setDates({ ...dates, date_to: e.target.value || undefined })} />
                    </Field>
                  </>
                ) : null}
                <Field label="Run label — optional">
                  <input className={field} style={fieldStyle} value={label} maxLength={120} onChange={(e) => setLabel(e.target.value)} />
                </Field>
              </div>
              <p className={note} style={noteStyle}>
                Organisational filters restrict every table that carries the field. General data without it is read in full so no record loses its context.
              </p>
              {confirm === null ? (
                <div className="flex gap-2">
                  <Button variant="secondary" onClick={() => setConfirm(false)}>{`Extract ${chosen.length} object${chosen.length === 1 ? "" : "s"}`}</Button>
                  <Button variant="secondary" onClick={() => setConfirm(true)}>Extract and analyse</Button>
                </div>
              ) : (
                <div className="rounded border px-3 py-2 text-[13px]" style={{ borderColor: "var(--m-medium)", color: "var(--m-ink)" }}>
                  <p className="font-medium" style={{ color: "var(--m-medium)" }}>
                    {`Extract ${chosen.length} object${chosen.length === 1 ? "" : "s"}${confirm ? " and analyse" : ""}?`}
                  </p>
                  <p className="mt-1" style={noteStyle}>Only the selected objects and scope are read, into a new run.</p>
                  <div className="mt-2 flex gap-2">
                    <Button onClick={() => download.mutate(confirm)} disabled={download.isPending}>Confirm</Button>
                    <Button variant="ghost" onClick={() => setConfirm(null)}>Keep scope</Button>
                  </div>
                </div>
              )}
            </div>
          ) : <p className={note} style={noteStyle}>Select the objects to extract.</p>}
        </div>
      )}
    </div>
  );
}
