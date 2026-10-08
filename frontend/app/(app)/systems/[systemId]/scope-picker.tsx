"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { Banner, Button, DataTable, Field, Input, Stack, type AuroraColumnMeta } from "@/components/aurora";
import { EmptyState, Mono, SectionCard, TableSkeleton } from "@/components/ui-core";
import { getSystemObjects, startDownload, type DownloadScope, type ScopeKey } from "@/lib/api/system-objects";
import { formatModuleName, relativeTime } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";

const SCOPE_LABEL: Record<ScopeKey, string> = {
  company_codes: "Company codes",
  plants: "Plants",
  sales_orgs: "Sales organisations",
  purchasing_orgs: "Purchasing organisations",
};
const meta = (m: AuroraColumnMeta) => m;
const list = (v: string) => v.split(/[\s,;]+/).map((x) => x.trim().toUpperCase()).filter(Boolean);

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
    { id: "pick", header: "", meta: meta({ width: 44 }), cell: ({ row }) => (
      <input type="checkbox" checked={picked.has(row.original.object)} readOnly aria-label={`Select ${formatModuleName(row.original.object)}`} />) },
    { id: "object", header: "Object", meta: meta({ width: 220 }), cell: ({ row }) => formatModuleName(row.original.object) },
    { id: "tables", header: "Tables", cell: ({ row }) => {
      const t = row.original.tables;
      return <Mono>{t.slice(0, 5).join(", ")}{t.length > 5 ? ` +${t.length - 5}` : ""}</Mono>;
    } },
    { id: "last", header: "Last extraction", meta: meta({ width: 140 }), cell: ({ row }) => (row.original.last_download ? relativeTime(row.original.last_download.at) : "Never") },
    { id: "records", header: "Rows", meta: meta({ numeric: true, width: 110 }), cell: ({ row }) => row.original.last_download?.records?.toLocaleString() ?? "—" },
  ], [picked]);

  return (
    <SectionCard title="Extract objects into a new run" meta={chosen.length ? `${chosen.length} selected` : undefined}>
      {isLoading ? <TableSkeleton rows={4} label="Reading which objects this system offers" />
        : !objects.length ? <EmptyState>This system offers no objects yet.</EmptyState> : (
        <Stack gap={4}>
          <DataTable columns={columns} data={objects} getRowId={(o) => o.object} onRowActivate={(o) => toggle(o.object)} ariaLabel="Objects to extract" maxHeight="40vh" />
          {chosen.length > 0 ? (
            <Stack gap={3}>
              <div className="mn-charts">
                {filters.map((k) => (
                  <Field key={k} label={SCOPE_LABEL[k]} helper="Comma-separated. Empty reads all.">
                    {({ controlId }) => <Input id={controlId} value={scopeText[k] ?? ""} placeholder="1000, 2000" onChange={(e) => setScopeText({ ...scopeText, [k]: e.target.value })} />}
                  </Field>
                ))}
                {windowed.length > 0 ? (
                  <>
                    <Field label="Documents from" helper={`Replaces the default window for ${windowed.join(", ")}`}>
                      {({ controlId }) => <Input id={controlId} type="date" value={dates.date_from ?? ""} onChange={(e) => setDates({ ...dates, date_from: e.target.value || undefined })} />}
                    </Field>
                    <Field label="Documents to">
                      {({ controlId }) => <Input id={controlId} type="date" value={dates.date_to ?? ""} onChange={(e) => setDates({ ...dates, date_to: e.target.value || undefined })} />}
                    </Field>
                  </>
                ) : null}
                <Field label="Run label" helper="Optional">
                  {({ controlId }) => <Input id={controlId} value={label} maxLength={120} onChange={(e) => setLabel(e.target.value)} />}
                </Field>
              </div>
              <p className="ui-note">
                Organisational filters restrict every table that carries the field. General data without it is read in full so no record loses its context.
              </p>
              {confirm === null ? (
                <Stack direction="row" gap={2}>
                  <Button variant="secondary" onClick={() => setConfirm(false)}>{`Extract ${chosen.length} object${chosen.length === 1 ? "" : "s"}`}</Button>
                  <Button variant="secondary" onClick={() => setConfirm(true)}>Extract and analyse</Button>
                </Stack>
              ) : (
                <Banner tone="warning" title={`Extract ${chosen.length} object${chosen.length === 1 ? "" : "s"}${confirm ? " and analyse" : ""}?`} action={
                  <Stack direction="row" gap={2}>
                    <Button size="sm" onClick={() => download.mutate(confirm)} disabled={download.isPending}>Confirm</Button>
                    <Button size="sm" variant="ghost" onClick={() => setConfirm(null)}>Keep scope</Button>
                  </Stack>}>
                  Only the selected objects and scope are read, into a new run.
                </Banner>
              )}
            </Stack>
          ) : <p className="ui-note">Select the objects to extract.</p>}
        </Stack>
      )}
    </SectionCard>
  );
}
