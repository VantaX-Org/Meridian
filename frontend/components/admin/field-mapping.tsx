"use client";

/**
 * Admin, Field mapping: which customer column carries each standard field,
 * per object, for file imports. Edit inline, save per row, or reset an
 * object to the shipped defaults. Saves need manage_field_mappings.
 */

import { Fragment, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Banner, Button, EmptyState, FilterBar, Input, Mono, PageHeader, SectionCard, Select, StatusBadge, TableSkeleton, Tally,
} from "@/components/ui-core";
import { useRole } from "@/hooks/use-role";
import { getFieldMappings, resetFieldMappings, updateFieldMapping, type FieldMapping } from "@/lib/api/field-mappings";
import { apiErrorMessage } from "@/lib/api/optional";
import { formatModuleName } from "@/lib/format";

const HREF = "/admin?tab=field-mapping";
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
    onError: (e) => toast.error(`${m.standard_field} not saved. ${apiErrorMessage(e)}`),
  });
  return (
    <tr>
      <td><Mono>{m.standard_field}</Mono><div className="ui-micro">{m.standard_label}</div></td>
      <td className="ui-mono">{m.data_type}</td>
      <td style={{ width: 200 }}>
        <Input value={d.customer_field ?? ""} aria-label={`${m.standard_field} customer column`} disabled={!write} className="ui-mono"
          placeholder="Column header in the file" onChange={(e) => setD({ ...d, customer_field: e.target.value.trim() || null })} />
      </td>
      <td style={{ width: 200 }}>
        <Input value={d.customer_label ?? ""} aria-label={`${m.standard_field} customer label`} disabled={!write}
          onChange={(e) => setD({ ...d, customer_label: e.target.value || null })} />
      </td>
      <td>
        <Input value={d.notes ?? ""} aria-label={`${m.standard_field} notes`} disabled={!write}
          onChange={(e) => setD({ ...d, notes: e.target.value || null })} />
      </td>
      <td>{m.is_mapped ? <StatusBadge status="ok">Mapped</StatusBadge> : <StatusBadge status="idle">Not mapped</StatusBadge>}</td>
      <td>{write && dirty ? <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>Save</Button> : null}</td>
    </tr>
  );
}

export function FieldMappingSettings() {
  const qc = useQueryClient();
  const write = useRole().can("manage_field_mappings");
  const [object, setObject] = useState("");
  const [search, setSearch] = useState("");
  const [confirmReset, setConfirmReset] = useState(false);
  const all = useQuery({ queryKey: ["field-mappings"], queryFn: () => getFieldMappings() });
  const mappings = useMemo(() => all.data?.mappings ?? [], [all.data]);
  const objects = useMemo(() => Array.from(new Set(mappings.map((m) => m.module))).sort(), [mappings]);
  const term = search.trim().toLowerCase();
  const shown = mappings.filter((m) => (!object || m.module === object)
    && (!term || [m.standard_field, m.standard_label, m.customer_field, m.customer_label].some((v) => v?.toLowerCase().includes(term))));
  const mapped = shown.filter((m) => m.is_mapped).length;
  const refresh = () => qc.invalidateQueries({ queryKey: ["field-mappings"] });
  const scope = object ? formatModuleName(object) : "every object";
  const reset = useMutation({
    mutationFn: () => resetFieldMappings(object || undefined),
    onSuccess: (r) => { refresh(); setConfirmReset(false); toast.success(`${r.reset_count} mappings reset to defaults`); },
    onError: (e) => toast.error(`Mappings not reset. ${apiErrorMessage(e)}`),
  });

  return (
    <div className="ui-page">
      <PageHeader title="Field mapping"
        summary="Imported files are matched on these customer columns. A standard field with no customer column is skipped by every check that needs it." />
      <Tally level={4} label="Mapping coverage" figures={[
        { label: "Mapped", value: all.isLoading ? null : mapped, loading: all.isLoading, tone: "success", verdict: `Of ${shown.length} standard fields.`, href: HREF },
        { label: "Unmapped", value: all.isLoading ? null : shown.length - mapped || "None", loading: all.isLoading, tone: shown.length - mapped ? "warning" : undefined, verdict: shown.length - mapped ? "Skipped by checks that need them." : "Every field has a customer column.", href: HREF },
      ]} />
      <FilterBar search={{ value: search, onChange: setSearch, placeholder: "Search fields" }}
        onClear={object || search ? () => { setObject(""); setSearch(""); } : undefined}
        actions={write ? (confirmReset ? (
          <>
            <span className="ui-micro">Reset {scope} to the shipped mappings?</span>
            <Button size="sm" variant="danger" disabled={reset.isPending} onClick={() => reset.mutate()}>Reset</Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirmReset(false)}>Keep mappings</Button>
          </>
        ) : <Button size="sm" variant="secondary" onClick={() => setConfirmReset(true)}>Reset {object ? formatModuleName(object) : "all"} to defaults</Button>) : null}>
        <Select placeholder="All objects" aria-label="Object" value={object} options={[{ value: "", label: "All objects" }, ...objects.map((o) => ({ value: o, label: formatModuleName(o) }))]}
          onValueChange={setObject} />
      </FilterBar>
      {all.isLoading ? <TableSkeleton rows={10} label="Loading field mappings" />
        : all.error ? <Banner tone="danger" title="Field mappings could not be read">{apiErrorMessage(all.error)}</Banner>
        : !shown.length ? <EmptyState>No standard field matches this filter.</EmptyState>
        : (
          <SectionCard title={object ? formatModuleName(object) : "All objects"} meta={`${mapped} of ${shown.length} mapped`} flush>
            <div style={{ overflowX: "auto" }}>
              <table className="ui-mini-table">
                <thead><tr><th>Standard field</th><th>Type</th><th>Customer column</th><th>Customer label</th><th>Notes</th><th>State</th>
                  <th><span className="ui-visually-hidden">Actions</span></th></tr></thead>
                <tbody>
                  {(object ? [object] : objects).map((o) => {
                    const rows = shown.filter((m) => m.module === o);
                    if (!rows.length) return null;
                    return (
                      <Fragment key={o}>
                        {!object ? <tr><th colSpan={7} scope="colgroup">{formatModuleName(o)}</th></tr> : null}
                        {rows.map((m) => <Row key={m.id} m={m} write={write} onSaved={refresh} />)}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </SectionCard>
        )}
    </div>
  );
}
