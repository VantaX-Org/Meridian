"use client";

/**
 * Admin → Field mapping: which customer column carries each standard field,
 * per object, for file imports. Edit inline, save per row, or reset an
 * object to the shipped defaults. Saves need manage_field_mappings.
 */

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button, Chip, Input, KpiRail, Select, Stack, Stat, Text } from "@/components/aurora";
import { useRole } from "@/hooks/use-role";
import { getFieldMappings, resetFieldMappings, updateFieldMapping, type FieldMapping } from "@/lib/api/field-mappings";
import { formatModuleName } from "@/lib/format";

type Draft = Pick<FieldMapping, "customer_field" | "customer_label" | "notes">;

function Row({ m, write, onSaved }: { m: FieldMapping; write: boolean; onSaved: () => void }) {
  const [d, setD] = useState<Draft>({ customer_field: m.customer_field, customer_label: m.customer_label, notes: m.notes });
  const dirty = d.customer_field !== m.customer_field || d.customer_label !== m.customer_label || d.notes !== m.notes;
  const save = useMutation({
    mutationFn: () => updateFieldMapping(m.id, {
      customer_field: d.customer_field ?? undefined, customer_label: d.customer_label ?? undefined,
      notes: d.notes ?? undefined, is_mapped: !!(d.customer_field && d.customer_field.trim()),
    }),
    onSuccess: () => { onSaved(); toast.success(`${m.standard_field} saved`); },
    onError: (e) => toast.error((e as Error).message || "Not saved"),
  });
  return (
    <tr>
      <td><span className="aurora-number">{m.standard_field}</span><Text variant="text-micro" tone="muted" as="div">{m.standard_label}</Text></td>
      <td className="aurora-number">{m.data_type}</td>
      <td style={{ width: 200 }}>
        <Input value={d.customer_field ?? ""} aria-label={`${m.standard_field} customer column`} disabled={!write} className="aurora-number"
          placeholder="column header in the file" onChange={(e) => setD({ ...d, customer_field: e.target.value.trim() || null })} />
      </td>
      <td style={{ width: 200 }}>
        <Input value={d.customer_label ?? ""} aria-label={`${m.standard_field} customer label`} disabled={!write}
          onChange={(e) => setD({ ...d, customer_label: e.target.value || null })} />
      </td>
      <td>
        <Input value={d.notes ?? ""} aria-label={`${m.standard_field} notes`} disabled={!write}
          onChange={(e) => setD({ ...d, notes: e.target.value || null })} />
      </td>
      <td><Chip tone={m.is_mapped ? "success" : "neutral"}>{m.is_mapped ? "mapped" : "unmapped"}</Chip></td>
      <td>{write && dirty ? <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>Save</Button> : null}</td>
    </tr>
  );
}

export function FieldMappingSettings() {
  const qc = useQueryClient();
  const { can } = useRole();
  const write = can("manage_field_mappings");
  const [object, setObject] = useState("");
  const [search, setSearch] = useState("");
  const all = useQuery({ queryKey: ["field-mappings", { search }], queryFn: () => getFieldMappings(search ? { search } : undefined) });
  const mappings = useMemo(() => all.data?.mappings ?? [], [all.data]);
  const objects = useMemo(() => Array.from(new Set(mappings.map((m) => m.module))).sort(), [mappings]);
  const shown = object ? mappings.filter((m) => m.module === object) : mappings;
  const mapped = shown.filter((m) => m.is_mapped).length;
  const refresh = () => qc.invalidateQueries({ queryKey: ["field-mappings"] });
  const reset = useMutation({
    mutationFn: () => resetFieldMappings(object || undefined),
    onSuccess: (r) => { refresh(); toast.success(`${r.reset_count} mappings reset to defaults`); },
    onError: (e) => toast.error((e as Error).message || "Reset failed"),
  });

  return (
    <Stack gap={5} className="aurora-page">
      <KpiRail>
        <Stat label="Standard fields" value={shown.length} />
        <Stat label="Mapped" value={mapped} tone={mapped === shown.length && shown.length ? "success" : "neutral"} />
        <Stat label="Unmapped" value={shown.length - mapped} tone={shown.length - mapped ? "warning" : "neutral"} />
        <Stat label="Objects" value={objects.length} />
      </KpiRail>
      <Stack direction="row" gap={3} align="center" wrap className="aurora-filters">
        <Select placeholder="All objects" aria-label="Object" value={object} options={objects.map((o) => ({ value: o, label: formatModuleName(o) }))}
          onValueChange={setObject} />
        <Input placeholder="Search field (Enter)" aria-label="Search" defaultValue={search}
          onKeyDown={(e) => e.key === "Enter" && setSearch(e.currentTarget.value)} />
        {write ? (
          <Button variant="secondary" disabled={reset.isPending}
            onClick={() => { if (confirm(`Reset ${object ? formatModuleName(object) : "every object"} to the shipped mappings?`)) reset.mutate(); }}>
            Reset {object ? formatModuleName(object) : "all"} to defaults
          </Button>
        ) : null}
      </Stack>
      <Text variant="text-small" tone="secondary">
        Imported files are matched on these customer columns; a standard field with no customer column is skipped by every check that needs it.
      </Text>
      {all.isLoading ? <Text tone="muted">Reading the mapping catalogue.</Text> : (
        <table className="aurora-exec__table">
          <thead><tr><th>Standard field</th><th>Type</th><th>Customer column</th><th>Customer label</th><th>Notes</th><th>State</th><th /></tr></thead>
          <tbody>
            {(object ? [object] : objects).map((o) => (
              <>
                <tr key={`h-${o}`}><td colSpan={7}><Text variant="text-micro" tone="muted" className="aurora-exec__eyebrow">{formatModuleName(o)}</Text></td></tr>
                {shown.filter((m) => m.module === o).map((m) => <Row key={m.id} m={m} write={write} onSaved={refresh} />)}
              </>
            ))}
          </tbody>
        </table>
      )}
    </Stack>
  );
}
