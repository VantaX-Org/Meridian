"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Button, Checkbox, DataTable, EmptyState, ErrorState, Field, Input, Mono, Select, Skeleton } from "@/design";
import { useRole } from "@/hooks/use-role";
import { apiErrorMessage, apiErrorState } from "@/lib/error";
import { getFieldMap, getValueMap, saveValueMap, updateFieldMap } from "@/lib/api/migration";
import { formatModuleName } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";
import type { TransferFieldMapping, TransferValueMapping } from "@/types/api";

/** `runAction` is the cockpit's Run now (absent without the analyse permission); `wavesAction` leads to the waves list. */
export function MappingTab({ modules, destType, runAction, wavesAction }: {
  modules: string[]; destType: string; runAction?: ReactNode; wavesAction?: ReactNode;
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
      <FieldMap module={module} destType={destType} onValueMap={setTargetField} runAction={runAction} />
      {targetField ? <ValueMap module={module} targetField={targetField} /> : null}
    </div>
  );
}

function FieldMap({ module, destType, onValueMap, runAction }: {
  module: string; destType: string; onValueMap: (f: string) => void; runAction?: ReactNode;
}) {
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
  ];
  if (map.isPending) return <Skeleton height={200} />;
  if (map.isError) return <ErrorState {...apiErrorState(map.error)} onRetry={() => void map.refetch()} />;
  if (!map.data?.length) return <EmptyState title="No field map yet" detail="Run the wave to seed one for this object." action={runAction} />;
  return <DataTable columns={columns} data={map.data} getRowId={(m) => m.id} />;
}

/** Where a mapping came from, in words; an origin we do not know reads as itself. */
const ORIGIN_LABEL: Record<string, string> = { identity: "Same field name", sap_standard: "SAP standard", steward: "A steward" };
const labelOfOrigin = (o: string) => ORIGIN_LABEL[o] ?? formatModuleName(o);

function ValueMap({ module, targetField }: { module: string; targetField: string }) {
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
  const columns: ColumnDef<TransferValueMapping>[] = [
    { id: "s", header: "Source value", cell: ({ row }) => <Mono>{row.original.source_value}</Mono> },
    { id: "t", header: "Target value", cell: ({ row }) => <Mono>{row.original.target_value}</Mono> },
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
