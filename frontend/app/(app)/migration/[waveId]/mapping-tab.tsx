"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { useState } from "react";
import { toast } from "sonner";
import { Button, DataTable, EmptyState, Mono } from "@/design";
import { useRole } from "@/hooks/use-role";
import { apiErrorMessage } from "@/lib/api/optional";
import { getFieldMap, getValueMap, saveValueMap, updateFieldMap } from "@/lib/api/migration";
import { formatModuleName } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";
import type { TransferFieldMapping, TransferValueMapping } from "@/types/api";

export function MappingTab({ modules, destType }: { modules: string[]; destType: string }) {
  const [module, setModule] = useState(modules[0] ?? "");
  const [targetField, setTargetField] = useState<string | null>(null);
  if (!modules.length) return <EmptyState title="Add modules to this wave to edit their mapping." />;
  return (
    <div className="flex flex-col gap-4">
      <label className="flex items-center gap-2 text-[12px]" style={{ color: "var(--m-ink-2)" }}>
        Module
        <select className="rounded-md border px-2 py-1 text-[13px]" style={{ borderColor: "var(--m-line)" }}
                value={module} onChange={(e) => { setModule(e.target.value); setTargetField(null); }}>
          {modules.map((m) => <option key={m} value={m}>{formatModuleName(m)}</option>)}
        </select>
      </label>
      <FieldMap module={module} destType={destType} onValueMap={setTargetField} />
      {targetField ? <ValueMap module={module} targetField={targetField} /> : null}
    </div>
  );
}

function FieldMap({ module, destType, onValueMap }: { module: string; destType: string; onValueMap: (f: string) => void }) {
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
    { id: "origin", header: "Origin", cell: ({ row }) => row.original.origin },
    { id: "confirmed", header: "Confirmed", cell: ({ row }) => (
        <input type="checkbox" aria-label={`Confirm ${row.original.source_field}`} checked={row.original.is_confirmed}
               disabled={!can("analyse") || confirm.isPending} onChange={() => confirm.mutate(row.original)} />) },
    { id: "vm", header: "", cell: ({ row }) => row.original.value_map && row.original.dest_table ? (
        <Button variant="secondary" onClick={() => onValueMap(`${row.original.dest_table}.${row.original.dest_field ?? ""}`)}>
          Value map
        </Button>) : null },
  ];
  if (map.isPending) return null;
  if (!map.data?.length) return <EmptyState title="No field map for this module yet. Run the wave to seed one." />;
  return <DataTable columns={columns} data={map.data} getRowId={(m) => m.id} />;
}

function ValueMap({ module, targetField }: { module: string; targetField: string }) {
  const qc = useQueryClient();
  const { can } = useRole();
  const key = queryKeys.migrationValueMap(module);
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
      <p className="text-[13px] font-semibold" style={{ color: "var(--m-ink)" }}>Value map for <Mono>{targetField}</Mono></p>
      <DataTable columns={columns} data={rows} getRowId={(e) => e.id} />
      {can("analyse") ? (
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
          <input aria-label="Source value" className="rounded-md border px-2 py-1 text-[13px]"
                 style={{ borderColor: "var(--m-line)" }} value={src} onChange={(e) => setSrc(e.target.value)} />
          <input aria-label="Target value" className="rounded-md border px-2 py-1 text-[13px]"
                 style={{ borderColor: "var(--m-line)" }} value={dst} onChange={(e) => setDst(e.target.value)} />
          <Button type="submit" disabled={!src || !dst || save.isPending}>Add mapping</Button>
        </form>
      ) : null}
    </div>
  );
}
