"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button, DataTable, EmptyState, Field, Input, Mono, Notice, PageHeader, Pill, Select, Stat, Async } from "@/design";
import { LedgerHead } from "@/components/mdm/ledger";
import { useRole } from "@/hooks/use-role";
import { getFieldMappings, resetFieldMappings, updateFieldMapping, type FieldMapping } from "@/lib/api/field-mappings";
import { apiErrorMessage } from "@/lib/error";
import { formatModuleName } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";

type Draft = Pick<FieldMapping, "customer_field" | "customer_label" | "notes">;
interface DraftCtx { drafts: Record<string, Draft>; set: (m: FieldMapping, patch: Partial<Draft>) => void; write: boolean; onSaved: (id: string) => void }
const DraftsContext = createContext<DraftCtx>({ drafts: {}, set: () => {}, write: false, onSaved: () => {} });
const draftOf = (drafts: Record<string, Draft>, m: FieldMapping): Draft => drafts[m.id] ?? { customer_field: m.customer_field, customer_label: m.customer_label, notes: m.notes };
const isDirty = (d: Draft, m: FieldMapping) => d.customer_field !== m.customer_field || d.customer_label !== m.customer_label || d.notes !== m.notes;

function DraftInput({ m, field, label, mono }: { m: FieldMapping; field: keyof Draft; label: string; mono?: boolean }) {
  const { drafts, set, write } = useContext(DraftsContext);
  const d = draftOf(drafts, m);
  return (
    <Input value={d[field] ?? ""} aria-label={`${m.standard_field} ${label}`} disabled={!write} className={mono ? "font-mono" : undefined}
      placeholder={field === "customer_field" ? "Column header in the file" : undefined}
      onChange={(e) => set(m, { [field]: (field === "customer_field" ? e.target.value.trim() : e.target.value) || null })} />
  );
}

function SaveCell({ m }: { m: FieldMapping }) {
  const { drafts, write, onSaved } = useContext(DraftsContext);
  const d = draftOf(drafts, m);
  const save = useMutation({
    mutationFn: () => updateFieldMapping(m.id, {
      customer_field: d.customer_field ?? undefined, customer_label: d.customer_label ?? undefined,
      notes: d.notes ?? undefined, is_mapped: !!(d.customer_field && d.customer_field.trim()),
    }),
    onSuccess: () => { onSaved(m.id); toast.success(`${m.standard_field} saved`); },
    onError: (e) => toast.error(`${m.standard_field} not saved. ${apiErrorMessage(e)}`),
  });
  return write && isDirty(d, m) ? <Button onClick={() => save.mutate()} disabled={save.isPending}>Save</Button> : null;
}

const baseColumns: ColumnDef<FieldMapping, unknown>[] = [
  { id: "object", header: "Object", cell: ({ row }) => formatModuleName(row.original.module) },
  { id: "field", header: "Standard field", cell: ({ row }) => <span><Mono>{row.original.standard_field}</Mono><div className="m-text-label m-ink-3">{row.original.standard_label}</div></span> },
  { id: "type", header: "Type", cell: ({ row }) => <span className="font-mono m-text-meta">{row.original.data_type}</span> },
  { id: "col", header: "Customer column", cell: ({ row }) => <DraftInput m={row.original} field="customer_field" label="customer column" mono /> },
  { id: "label", header: "Customer label", cell: ({ row }) => <DraftInput m={row.original} field="customer_label" label="customer label" /> },
  { id: "notes", header: "Notes", cell: ({ row }) => <DraftInput m={row.original} field="notes" label="notes" /> },
  { id: "state", header: "State", cell: ({ row }) => <Pill tone={row.original.is_mapped ? "go" : "neutral"}>{row.original.is_mapped ? "Mapped" : "Not mapped"}</Pill> },
  { id: "save", header: "Action", cell: ({ row }) => <SaveCell m={row.original} /> },
];

export default function AdminMappingsPage() {
  const qc = useQueryClient();
  const write = useRole().can("manage_field_mappings");
  const [object, setObject] = useState("");
  const [search, setSearch] = useState("");
  const [confirmReset, setConfirmReset] = useState(false);
  const all = useQuery({ queryKey: queryKeys.fieldMappings(), queryFn: () => getFieldMappings() });
  const mappings = useMemo(() => all.data?.mappings ?? [], [all.data]);
  const objects = useMemo(() => Array.from(new Set(mappings.map((m) => m.module))).sort(), [mappings]);
  const term = search.trim().toLowerCase();
  const shown = mappings.filter((m) => (!object || m.module === object)
    && (!term || [m.standard_field, m.standard_label, m.customer_field, m.customer_label].some((v) => v?.toLowerCase().includes(term))));
  const mapped = shown.filter((m) => m.is_mapped).length;
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const refresh = () => qc.invalidateQueries({ queryKey: queryKeys.fieldMappings() });
  const set = useCallback((m: FieldMapping, patch: Partial<Draft>) => setDrafts((p) => ({ ...p, [m.id]: { ...draftOf(p, m), ...patch } })), []);
  const onSaved = useCallback((id: string) => { setDrafts((p) => { const n = { ...p }; delete n[id]; return n; }); void qc.invalidateQueries({ queryKey: queryKeys.fieldMappings() }); }, [qc]);
  const ctx = useMemo(() => ({ drafts, set, write, onSaved }), [drafts, set, write, onSaved]);
  const columns = useMemo(() => (object ? baseColumns.filter((c) => c.id !== "object") : baseColumns), [object]);
  const reset = useMutation({
    mutationFn: () => resetFieldMappings(object || undefined),
    onSuccess: (r) => { refresh(); setConfirmReset(false); toast.success(`${r.reset_count} mappings reset to defaults`); },
    onError: (e) => toast.error(`Mappings not reset. ${apiErrorMessage(e)}`),
  });

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Field mapping" meta="Imported files are matched on these customer columns" />
      <Notice tone="info">A standard field with no customer column is skipped by every check that needs it.</Notice>

      <div className="flex gap-4">
        <Stat label="Unmapped" value={all.isLoading ? undefined : shown.length - mapped} tone={shown.length - mapped ? "at-risk" : "go"} delta={all.isLoading ? undefined : `of ${shown.length} standard fields`} />
      </div>

      <div className="flex items-end gap-2 flex-wrap">
        <Field label="Search"><Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search fields" /></Field>
        <Select
          label="Object"
          value={object}
          onValueChange={setObject}
          options={[{ value: "", label: "All objects" }, ...objects.map((o) => ({ value: o, label: formatModuleName(o) }))]}
        />
        {object || search ? <Button variant="secondary" onClick={() => { setObject(""); setSearch(""); }}>Clear</Button> : null}
        {write ? (confirmReset ? (
          <>
            <span className="m-text-meta m-ink-3">Reset {object ? formatModuleName(object) : "every object"} to the shipped mappings?</span>
            <Button variant="secondary" disabled={reset.isPending} onClick={() => reset.mutate()}>Reset</Button>
            <Button variant="ghost" onClick={() => setConfirmReset(false)}>Keep mappings</Button>
          </>
        ) : (
          <Button variant="secondary" onClick={() => setConfirmReset(true)}>Reset {object ? formatModuleName(object) : "all"} to defaults</Button>
        )) : null}
      </div>

      <Async query={all} skeleton={320} notFoundIsEmpty>{!shown.length ? (
          object || search ? (
            <EmptyState title="No standard field matches" detail="Clear the filter to see every field." action={<Button variant="secondary" onClick={() => { setObject(""); setSearch(""); }}>Clear filter</Button>} />
          ) : (
            <EmptyState title="No field mappings" detail="Import a file to map its columns." action={<Button render={<Link href="/import">Import file</Link>} />} />
          )
        ) : (
          <section aria-label="Field mappings">
            <LedgerHead title={`${object ? formatModuleName(object) : "All objects"}`} meta={`${mapped} of ${shown.length} mapped`} />
            <DraftsContext.Provider value={ctx}>
              <DataTable columns={columns} data={shown} getRowId={(m) => m.id} />
            </DraftsContext.Provider>
          </section>
        )}</Async>
    </div>
  );
}
