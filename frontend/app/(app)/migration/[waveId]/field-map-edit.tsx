"use client";

/** Editing the field map: seed it from the source data, add a mapping by hand, remove one. All need `analyse`. */

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button, Checkbox, ConfirmDialog, Field, Input } from "@/design";
import { createFieldMap, deleteFieldMap, seedFieldMap } from "@/lib/api/migration";
import { apiErrorMessage } from "@/lib/error";
import { formatModuleName } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";
import type { TransferFieldMapping } from "@/types/api";

/** "MARA.MATNR" parts, or null when the text is not TABLE.FIELD. */
export function splitTableField(text: string): { table: string; field: string } | null {
  const m = /^([A-Za-z0-9_/]+)\.([A-Za-z0-9_/]+)$/.exec(text.trim());
  return m ? { table: m[1].toUpperCase(), field: m[2].toUpperCase() } : null;
}

export function useFieldMapEdits(module: string, destType: string) {
  const qc = useQueryClient();
  const key = queryKeys.migrationFieldMap(module, destType);
  const refresh = () => void qc.invalidateQueries({ queryKey: key });
  const fail = (e: unknown) => toast.error(apiErrorMessage(e));
  return {
    seed: useMutation({
      mutationFn: (versionId: string | null) => seedFieldMap({ module, dest_system_type: destType, source_version_id: versionId }),
      onSuccess: (r) => { toast.success(`${r.seeded.toLocaleString()} ${r.seeded === 1 ? "mapping" : "mappings"} seeded for ${formatModuleName(module)}`); refresh(); },
      onError: fail,
    }),
    create: useMutation({ mutationFn: (body: Parameters<typeof createFieldMap>[0]) => createFieldMap(body), onSuccess: refresh, onError: fail }),
    remove: useMutation({ mutationFn: (id: string) => deleteFieldMap(id), onSuccess: refresh, onError: fail }),
  };
}

/** "Seed from source" re-reads the source data and keeps every steward mapping. */
export function SeedButton({ module, destType, versionId }: { module: string; destType: string; versionId: string | null }) {
  const { seed } = useFieldMapEdits(module, destType);
  return <Button variant="secondary" pending={seed.isPending} onClick={() => seed.mutate(versionId)}>Seed from source</Button>;
}

export function AddMappingForm({ module, destType }: { module: string; destType: string }) {
  const { create } = useFieldMapEdits(module, destType);
  const [source, setSource] = useState("");
  const [target, setTarget] = useState("");
  const [valueMap, setValueMap] = useState(false);
  const src = splitTableField(source);
  // An empty target is allowed: the field is intentionally not migrated.
  const dst = target.trim() ? splitTableField(target) : null;
  const targetBad = target.trim() !== "" && !dst;
  const submit = () => {
    if (!src || targetBad) return;
    create.mutate(
      { module, dest_system_type: destType, source_field: `${src.table}.${src.field}`, dest_table: dst?.table ?? null, dest_field: dst?.field ?? null, value_map: valueMap && !!dst },
      { onSuccess: () => { setSource(""); setTarget(""); setValueMap(false); toast.success("Mapping added"); } },
    );
  };
  return (
    <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <Field label="Source field (TABLE.FIELD)">
        <Input value={source} onChange={(e) => setSource(e.target.value)} />
      </Field>
      <Field label="Target field (empty: not migrated)" error={targetBad ? "Use TABLE.FIELD" : undefined}>
        <Input value={target} onChange={(e) => setTarget(e.target.value)} />
      </Field>
      <label className="flex items-center gap-2 m-text-body m-ink-2">
        <Checkbox aria-label="Translate codes with a value map" checked={valueMap} disabled={!dst} onChange={() => setValueMap((v) => !v)} />
        Translate codes with a value map
      </label>
      <Button type="submit" variant="secondary" disabled={!src || targetBad} pending={create.isPending}>Add mapping</Button>
    </form>
  );
}

export function RemoveMappingDialog({ mapping, module, destType, onClose }: {
  mapping: TransferFieldMapping | null; module: string; destType: string; onClose: () => void;
}) {
  const { remove } = useFieldMapEdits(module, destType);
  return (
    <ConfirmDialog
      open={mapping !== null}
      onOpenChange={(o) => { if (!o) onClose(); }}
      title="Remove this mapping?"
      tone="danger"
      body={mapping ? `${mapping.source_field} stops landing in ${mapping.dest_table ? `${mapping.dest_table}.${mapping.dest_field ?? ""}` : "any target field"}. Seed from source brings the suggestion back.` : ""}
      confirmLabel="Remove mapping"
      cancelLabel="Keep mapping"
      pending={remove.isPending}
      onConfirm={() => mapping && remove.mutate(mapping.id, { onSuccess: onClose })}
    />
  );
}
