"use client";

import { Fragment, useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button, EmptyState, ErrorState, Mono, Pill, Select, Skeleton } from "@/design";
import { useRole } from "@/hooks/use-role";
import { getFieldMappings, resetFieldMappings, updateFieldMapping, type FieldMapping } from "@/lib/api/field-mappings";
import { apiErrorMessage } from "@/lib/api/optional";
import { formatModuleName } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";

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
      <td className="py-1"><Mono>{m.standard_field}</Mono><div className="text-[11px]" style={{ color: "var(--m-ink-3)" }}>{m.standard_label}</div></td>
      <td className="font-mono text-[12px]">{m.data_type}</td>
      <td style={{ width: 180 }}>
        <input value={d.customer_field ?? ""} aria-label={`${m.standard_field} customer column`} disabled={!write}
          className="font-mono" placeholder="Column header in the file"
          onChange={(e) => setD({ ...d, customer_field: e.target.value.trim() || null })} />
      </td>
      <td style={{ width: 180 }}>
        <input value={d.customer_label ?? ""} aria-label={`${m.standard_field} customer label`} disabled={!write}
          onChange={(e) => setD({ ...d, customer_label: e.target.value || null })} />
      </td>
      <td>
        <input value={d.notes ?? ""} aria-label={`${m.standard_field} notes`} disabled={!write}
          onChange={(e) => setD({ ...d, notes: e.target.value || null })} />
      </td>
      <td><Pill tone={m.is_mapped ? "go" : "neutral"}>{m.is_mapped ? "Mapped" : "Not mapped"}</Pill></td>
      <td>{write && dirty ? <Button onClick={() => save.mutate()} disabled={save.isPending}>Save</Button> : null}</td>
    </tr>
  );
}

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
  const refresh = () => qc.invalidateQueries({ queryKey: queryKeys.fieldMappings() });
  const reset = useMutation({
    mutationFn: () => resetFieldMappings(object || undefined),
    onSuccess: (r) => { refresh(); setConfirmReset(false); toast.success(`${r.reset_count} mappings reset to defaults`); },
    onError: (e) => toast.error(`Mappings not reset. ${apiErrorMessage(e)}`),
  });

  return (
    <div className="flex flex-col gap-6 p-6">
      <header>
        <strong className="text-[17px]">Field mapping</strong>
        <p className="text-[13px]" style={{ color: "var(--m-ink-3)" }}>
          Imported files are matched on these customer columns. A standard field with no customer column is skipped by every check that needs it.
        </p>
      </header>

      <div className="flex gap-4">
        <div className="flex flex-col gap-1">
          <span className="text-[12px]" style={{ color: "var(--m-ink-3)" }}>Mapped</span>
          <span className="text-[22px] font-semibold">{all.isLoading ? "–" : mapped}</span>
          <span className="text-[12px]" style={{ color: "var(--m-ink-3)" }}>Of {shown.length} standard fields.</span>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[12px]" style={{ color: "var(--m-ink-3)" }}>Unmapped</span>
          <span className="text-[22px] font-semibold">{all.isLoading ? "–" : shown.length - mapped}</span>
          <span className="text-[12px]" style={{ color: "var(--m-ink-3)" }}>
            {shown.length - mapped ? "Skipped by checks that need them." : "Every field has a customer column."}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search fields" aria-label="Search fields" />
        <Select
          value={object}
          onValueChange={setObject}
          options={[{ value: "", label: "All objects" }, ...objects.map((o) => ({ value: o, label: formatModuleName(o) }))]}
        />
        {object || search ? <Button variant="secondary" onClick={() => { setObject(""); setSearch(""); }}>Clear</Button> : null}
        {write ? (confirmReset ? (
          <>
            <span className="text-[12px]" style={{ color: "var(--m-ink-3)" }}>Reset {object ? formatModuleName(object) : "every object"} to the shipped mappings?</span>
            <Button variant="secondary" disabled={reset.isPending} onClick={() => reset.mutate()}>Reset</Button>
            <Button variant="ghost" onClick={() => setConfirmReset(false)}>Keep mappings</Button>
          </>
        ) : (
          <Button variant="secondary" onClick={() => setConfirmReset(true)}>Reset {object ? formatModuleName(object) : "all"} to defaults</Button>
        )) : null}
      </div>

      {all.isLoading ? <Skeleton height={320} />
        : all.isError ? (
          <ErrorState message={apiErrorMessage(all.error) || "Field mappings could not be read."} onRetry={() => all.refetch()} />
        ) : !shown.length ? (
          <EmptyState
            title={object || search ? "No standard field matches this filter." : "No field mappings."}
            action={!(object || search) ? <Button render={<Link href="/import">Import file</Link>} /> : undefined}
          />
        )
        : (
          <section>
            <h2 className="text-[13px] font-semibold mb-2">{object ? formatModuleName(object) : "All objects"} &mdash; {mapped} of {shown.length} mapped</h2>
            <div className="overflow-x-auto">
              <table className="text-[13px] w-full">
                <thead>
                  <tr>
                    <th className="text-left">Standard field</th><th className="text-left">Type</th><th className="text-left">Customer column</th>
                    <th className="text-left">Customer label</th><th className="text-left">Notes</th><th className="text-left">State</th>
                    <th><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {(object ? [object] : objects).map((o) => {
                    const rows = shown.filter((m) => m.module === o);
                    if (!rows.length) return null;
                    return (
                      <Fragment key={o}>
                        {!object ? <tr><th colSpan={7} className="text-left pt-3">{formatModuleName(o)}</th></tr> : null}
                        {rows.map((m) => <Row key={m.id} m={m} write={write} onSaved={refresh} />)}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}
    </div>
  );
}
