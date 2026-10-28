"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Button, Checkbox, DataTable, EmptyState, ErrorState, Field, Input, Mono, RowActionButton, Select, Skeleton, actionColumn } from "@/design";
import { useRole } from "@/hooks/use-role";
import { apiErrorMessage, apiErrorState } from "@/lib/error";
import { deleteValueMap, getFieldMap, getValueCandidates, getValueMap, saveValueMap, updateFieldMap } from "@/lib/api/migration";
import { formatModuleName } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";
import type { TransferFieldMapping, TransferValueMapping } from "@/types/api";
import { AddMappingForm, RemoveMappingDialog, SeedButton } from "./field-map-edit";

/**
 * `runAction` is the cockpit's Run now (absent without the analyse permission); `wavesAction` leads to the waves list.
 * `versionId` is the analysis the wave scored (the source of a seed); `runId` the migration run whose unmapped values
 * the value map offers.
 */
export function MappingTab({ modules, destType, runAction, wavesAction, versionId = null, runId = null }: {
  modules: string[]; destType: string; runAction?: ReactNode; wavesAction?: ReactNode; versionId?: string | null; runId?: string | null;
}) {
  const [module, setModule] = useState(modules[0] ?? "");
  const [targetField, setTargetField] = useState<string | null>(null);
  if (!modules.length) {
    return <EmptyState title="No objects in this wave" detail="Add the SAP objects this wave moves, then run it to map their fields." action={wavesAction} />;
  }
  return (
    <div className="flex flex-col gap-4">
      <p className="m-text-body m-ink-2">Which source field lands in which S/4HANA field. Tick a row once you have checked it; open a value map to translate codes.</p>
      <div className="max-w-[320px]">
        <Field label="Object">
          <Select value={module} onValueChange={(v) => { setModule(v); setTargetField(null); }}
            options={modules.map((m) => ({ value: m, label: formatModuleName(m) }))} />
        </Field>
      </div>
      <FieldMap module={module} destType={destType} onValueMap={setTargetField} runAction={runAction} versionId={versionId} />
      {targetField ? <ValueMap module={module} targetField={targetField} runId={runId} /> : null}
    </div>
  );
}

function FieldMap({ module, destType, onValueMap, runAction, versionId }: {
  module: string; destType: string; onValueMap: (f: string) => void; runAction?: ReactNode; versionId: string | null;
}) {
  const [removing, setRemoving] = useState<TransferFieldMapping | null>(null);
  const qc = useQueryClient();
  const { can } = useRole();
  const key = queryKeys.migrationFieldMap(module, destType);
  const map = useQuery({ queryKey: key, queryFn: () => getFieldMap(module, destType) });
  const confirm = useMutation({
    mutationFn: (m: TransferFieldMapping) => updateFieldMap(m.id, { is_confirmed: !m.is_confirmed }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: key }),
    onError: (e) => toast.error(apiErrorMessage(e)),
  });
  const columns: ColumnDef<TransferFieldMapping>[] = [
    { id: "src", header: "Source field", cell: ({ row }) => <Mono>{row.original.source_field}</Mono> },
    { id: "dst", header: "Target field", cell: ({ row }) => (
        <Mono>{row.original.dest_table ? `${row.original.dest_table}.${row.original.dest_field ?? ""}` : "Not migrated"}</Mono>) },
    { id: "origin", header: "Suggested by", cell: ({ row }) => labelOfOrigin(row.original.origin) },
    { id: "confirmed", header: "Confirmed", cell: ({ row }) => (
        <Checkbox aria-label={`Confirm ${row.original.source_field}`} checked={row.original.is_confirmed}
                  disabled={!can("analyse") || confirm.isPending} onChange={() => confirm.mutate(row.original)} />) },
    { id: "vm", header: "", cell: ({ row }) => row.original.value_map && row.original.dest_table ? (
        <Button variant="secondary" onClick={() => onValueMap(`${row.original.dest_table}.${row.original.dest_field ?? ""}`)}>
          Value map
        </Button>) : null },
    ...(can("analyse") ? [actionColumn<TransferFieldMapping>((m) => (
      <RowActionButton label={`Remove mapping of ${m.source_field}`} onClick={() => setRemoving(m)}>Remove</RowActionButton>))] : []),
  ];
  if (map.isPending) return <Skeleton height={200} />;
  if (map.isError) return <ErrorState {...apiErrorState(map.error)} onRetry={() => void map.refetch()} />;
  const editable = can("analyse");
  const edit = editable ? (
    <div className="flex flex-col gap-3">
      <AddMappingForm module={module} destType={destType} />
      <RemoveMappingDialog mapping={removing} module={module} destType={destType} onClose={() => setRemoving(null)} />
    </div>
  ) : null;
  if (!map.data?.length) {
    return (
      <div className="flex flex-col gap-4">
        <EmptyState title="No field map yet" detail="Seed one from the source data, add mappings by hand, or run the wave to seed it."
          action={editable ? <div className="flex gap-2"><SeedButton module={module} destType={destType} versionId={versionId} />{runAction}</div> : runAction} />
        {edit}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      {editable ? <div><SeedButton module={module} destType={destType} versionId={versionId} /></div> : null}
      <DataTable columns={columns} data={map.data} getRowId={(m) => m.id} />
      {edit}
    </div>
  );
}

/** Where a mapping came from, in words; an origin we do not know reads as itself. */
const ORIGIN_LABEL: Record<string, string> = { identity: "Same field name", sap_standard: "SAP standard", steward: "A steward" };
const labelOfOrigin = (o: string) => ORIGIN_LABEL[o] ?? formatModuleName(o);

function ValueMap({ module, targetField, runId }: { module: string; targetField: string; runId: string | null }) {
  const qc = useQueryClient();
  const { can } = useRole();
  const key = queryKeys.migrationValueMap(module, targetField);
  const entries = useQuery({ queryKey: key, queryFn: () => getValueMap(module, targetField) });
  const [src, setSrc] = useState("");
  const [dst, setDst] = useState("");
  const save = useMutation({
    mutationFn: () => saveValueMap({ module, target_field: targetField, entries: [{ source_value: src, target_value: dst }] }),
    onSuccess: () => { setSrc(""); setDst(""); void qc.invalidateQueries({ queryKey: key }); },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteValueMap(id),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: key }); void qc.invalidateQueries({ queryKey: candidatesKey }); },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });
  // Source values the last run found with no target yet (value_unmapped gaps), most records first.
  const candidatesKey = ["migration", "value-candidates", runId, targetField] as const;
  const candidates = useQuery({ queryKey: candidatesKey, queryFn: () => getValueCandidates(runId ?? "", targetField), enabled: !!runId && can("analyse") });
  const columns: ColumnDef<TransferValueMapping>[] = [
    { id: "s", header: "Source value", cell: ({ row }) => <Mono>{row.original.source_value}</Mono> },
    { id: "t", header: "Target value", cell: ({ row }) => <Mono>{row.original.target_value}</Mono> },
    ...(can("analyse") ? [actionColumn<TransferValueMapping>((e) => (
      <RowActionButton label={`Remove the mapping of ${e.source_value}`} onClick={() => remove.mutate(e.id)} disabled={remove.isPending}>Remove</RowActionButton>))] : []),
  ];
  const rows = (entries.data ?? []).filter((e) => e.target_field === targetField);
  return (
    <div className="flex flex-col gap-2">
      <p className="m-text-body font-semibold m-ink">Value map for <Mono>{targetField}</Mono></p>
      <p className="m-text-body m-ink-2">Each source code is replaced by its target code when the records load.</p>
      {entries.isPending ? <Skeleton height={120} /> : entries.isError ? (
        <ErrorState {...apiErrorState(entries.error)} onRetry={() => void entries.refetch()} />
      ) : rows.length ? <DataTable columns={columns} data={rows} getRowId={(e) => e.id} /> : (
        <p className="m-text-body m-ink-3">No values mapped yet{can("analyse") ? ". Add the first pair below" : ""}.</p>
      )}
      {can("analyse") && runId ? (
        candidates.isPending ? <Skeleton height={32} /> : candidates.isError ? (
          <ErrorState {...apiErrorState(candidates.error)} onRetry={() => void candidates.refetch()} />
        ) : candidates.data?.length ? (
          <div className="flex flex-col gap-1">
            <p className="m-text-body m-ink-2">Values the last run could not translate. Pick one to map it.</p>
            <ul className="flex flex-wrap gap-2" aria-label="Unmapped source values">
              {candidates.data.map((c) => (
                <li key={c.source_value}>
                  <Button variant="secondary" onClick={() => setSrc(c.source_value)} aria-label={`Map ${c.source_value}, ${c.records.toLocaleString()} ${c.records === 1 ? "record" : "records"}`}>
                    <Mono inline>{c.source_value}</Mono> {c.records.toLocaleString()}
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        ) : <p className="m-text-body m-ink-3">Every source value in the last run has a target</p>
      ) : null}
      {can("analyse") ? (
        <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
          <Field label="Source value"><Input value={src} onChange={(e) => setSrc(e.target.value)} /></Field>
          <Field label="Target value"><Input value={dst} onChange={(e) => setDst(e.target.value)} /></Field>
          <Button type="submit" variant="secondary" disabled={!src || !dst} pending={save.isPending}>Add mapping</Button>
        </form>
      ) : null}
    </div>
  );
}
