"use client";

/**
 * A golden record's fields with the survivorship rule that chose each value, and the steward override:
 * an approver sets a field's value by hand, with a reason, and survivorship keeps it until the override is cleared
 * (POST /master-records/{id}/overrides, permission `approve`).
 */

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";
import { ConfirmDialog, DataTable, EmptyState, Field, Input, Mono, Pill, Textarea, toast } from "@/design";
import { useRole } from "@/hooks/use-role";
import { apiErrorMessage } from "@/lib/error";
import { labelOf } from "@/lib/format";
import { getMergeExplanation, setStewardOverrides } from "@/lib/api/merge-explain";
import { LedgerHead, RowButton, actionColumn } from "./ledger";
import { show } from "./match-review-model";

export type GoldenFieldRow = { field: string; value: unknown; rule: string | null; source: string | null; overridden: boolean };

/** A blank value reads "None", as the record's other tables print it. */
const valueText = (v: unknown) => show(v) || "None";

/** The query key MergedRecords shares, so the page reads the explanation once. */
export const mergeExplainKey = (id: string) => ["mdm", "merge-explain", id] as const;

/** One editing session: the field, and whether the steward is setting a value or clearing their override. */
type Editing = { field: string; current: unknown; clear: boolean };

export function GoldenFields({ id, fields, onChanged }: { id: string; fields: Record<string, unknown>; onChanged: () => void }) {
  const qc = useQueryClient();
  const canOverride = useRole().can("approve");
  // Without the explanation the values still read; only the rule column and the override stay empty.
  const ex = useQuery({ queryKey: mergeExplainKey(id), queryFn: () => getMergeExplanation(id), retry: false, meta: { ignoreError: true } });
  const [editing, setEditing] = useState<Editing | null>(null);
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const close = () => { setEditing(null); setValue(""); setReason(""); };

  const save = useMutation({
    mutationFn: (e: Editing) => setStewardOverrides(id, { [e.field]: e.clear ? null : value }, reason.trim()),
    onSuccess: (_r, e) => {
      toast.success(e.clear ? `Override on ${e.field} cleared; survivorship picks its value again` : `${e.field} set by steward override`);
      close();
      void qc.invalidateQueries({ queryKey: mergeExplainKey(id) });
      onChanged();
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  });

  const overrides = ex.data?.steward_overrides ?? {};
  const survivorship = ex.data?.survivorship ?? {};
  const rows: GoldenFieldRow[] = Object.entries(fields).map(([field, v]) => ({
    field,
    value: v,
    rule: survivorship[field]?.rule ?? null,
    source: survivorship[field]?.winner_key ?? null,
    overridden: field in overrides,
  }));
  const editable = canOverride && ex.isSuccess;

  // Stable columns: a cell redefined on every render remounts, and its button loses the click.
  const cols = useMemo<ColumnDef<GoldenFieldRow>[]>(() => [
    { id: "field", header: "Field", cell: ({ row }) => <Mono>{row.original.field}</Mono> },
    { id: "value", header: "Value", accessorFn: (r) => valueText(r.value) },
    {
      id: "rule",
      header: "Chosen by",
      cell: ({ row }) => row.original.overridden
        ? <Pill tone="info">Steward override</Pill>
        : <span className="m-ink-2">{row.original.rule ? labelOf(row.original.rule) : ""}{row.original.source ? <> from <Mono inline>{row.original.source}</Mono></> : null}</span>,
    },
    actionColumn((r) => (editable ? (
      <RowButton label={r.overridden ? `Clear the override on ${r.field}` : `Override ${r.field}`}
        onClick={() => { setValue(r.overridden ? "" : show(r.value)); setEditing({ field: r.field, current: r.value, clear: r.overridden }); }}>
        {r.overridden ? "Clear override" : "Override"}
      </RowButton>
    ) : null)),
  ], [editable]);

  const ready = editing ? !!reason.trim() && (editing.clear || !!value.trim()) : false;

  return (
    <section aria-label="Golden fields">
      <LedgerHead title="Golden fields" meta={String(rows.length)} />
      {rows.length === 0 ? (
        <EmptyState variant="inline" title="No golden fields recorded" detail="Fields fill in when the golden record is built from its sources." action={<Link className="m-ink-accent-ink hover:underline" href="/mdm/survivorship">Survivorship rules</Link>} />
      ) : (
        <DataTable columns={cols} getRowId={(r) => r.field} data={rows} height="auto" />
      )}
      <ConfirmDialog
        open={!!editing}
        onOpenChange={(o) => { if (!o) close(); }}
        title={editing ? (editing.clear ? `Clear the override on ${editing.field}?` : `Override ${editing.field}`) : ""}
        confirmLabel={editing?.clear ? "Clear override" : "Save override"}
        cancelLabel="Keep"
        pending={save.isPending}
        confirmDisabled={!ready}
        onConfirm={() => { if (editing && ready) save.mutate(editing); }}
        body={editing ? (
          <div className="flex flex-col gap-3 m-text-body">
            <p className="m-ink-2">
              {editing.clear
                ? <>The survivorship rule picks <Mono inline>{editing.field}</Mono> from the merged records again.</>
                : <>Survivorship keeps this value for <Mono inline>{editing.field}</Mono> until the override is cleared. Now: <Mono inline>{valueText(editing.current)}</Mono></>}
            </p>
            {editing.clear ? null : (
              <Field label="New value">
                <Input value={value} onChange={(e) => setValue(e.target.value)} autoFocus aria-required="true" />
              </Field>
            )}
            <Field label="Reason (required), kept in the merge history">
              <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="Confirmed with the vendor master owner" aria-required="true" />
            </Field>
            {ready ? null : <p className="m-text-meta m-ink-3">{editing.clear || value.trim() ? "Give a reason" : "Give a value and a reason"}</p>}
          </div>
        ) : null}
      />
    </section>
  );
}
