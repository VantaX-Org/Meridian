"use client";

import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { FieldMapping } from "@/lib/api/field-mappings";
import * as api from "@/lib/api/v2/admin";
import { formatDate } from "@/lib/format";
import { refreshAdmin, useMappings } from "@/lib/v2/admin-queries";
import { failureText } from "@/lib/v2/errors";
import { useV2Session } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";
import { moduleText } from "@/lib/v2/labels";
import { Button, Chip, Code, Confirm, DataTable, Sheet, type Column, useToast } from "../kit";
import type { SheetCtx } from "../shell/SheetHost";
import { QueryView, useSubmitGuard } from "./states";
import "./journey.css";

type Shown = "customer_field" | "customer_label";
/** The customer value, or "" while the row still carries the standard default. */
const shownValue = (m: FieldMapping, key: Shown): string =>
  !m.is_mapped && m[key] === (key === "customer_field" ? m.standard_field : m.standard_label) ? "" : (m[key] ?? "");

/**
 * Field mappings in the new interface (GET/POST /field-mappings, PATCH/DELETE /field-mappings/{id}, POST /field-mappings/reset).
 * One sheet kind, "field-mappings": id "" lists them, "new" adds one, any other id is one mapping.
 * Writing needs manage_field_mappings and a licence with self-service mapping; everyone else reads.
 */

const DATA_TYPES = ["string", "number", "date", "boolean"] as const;

function useWrite(selfService: boolean) {
  return useV2Session().can("manage_field_mappings") && selfService;
}

function MappingForm({ objects, onDone }: { objects: string[]; onDone: (m: FieldMapping | null) => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [x, setX] = useState({ module: "", field: "", label: "", col: "", type: "string", notes: "" });
  const { busy, run } = useSubmitGuard();
  const set = (k: keyof typeof x, v: string) => setX((cur) => ({ ...cur, [k]: v }));
  const ready = x.module.trim() !== "" && x.field.trim() !== "";
  const save = () =>
    run(async () => {
      try {
        const m = await api.createFieldMapping({ module: x.module.trim(), standard_field: x.field.trim(), standard_label: x.label.trim() || undefined, customer_field: x.col.trim() || undefined, data_type: x.type, is_mapped: x.col.trim() !== "", notes: x.notes.trim() || undefined });
        await refreshAdmin(qc, "mappings");
        toast({ text: t("Mapping added"), tone: "good" });
        onDone(m);
      } catch (e) {
        toast({ text: failureText(e), tone: "bad" });
      }
    });
  return (
    <div className="nx-form" data-testid="mapping-form">
      <label className="nx-field">
        {t("Object")}
        <input className="nx-input" value={x.module} list="nx-mapping-objects" onChange={(e) => set("module", e.target.value)} placeholder="material_master" />
        <datalist id="nx-mapping-objects">
          {objects.map((o) => <option key={o} value={o}>{moduleText(o)}</option>)}
        </datalist>
      </label>
      <label className="nx-field">
        {t("Standard field")}
        <input className="nx-input" value={x.field} onChange={(e) => set("field", e.target.value)} placeholder="MARA.MATNR" />
      </label>
      <label className="nx-field">
        {t("Meaning")}
        <input className="nx-input" value={x.label} onChange={(e) => set("label", e.target.value)} />
      </label>
      <label className="nx-field">
        {t("Column header in your file")}
        <input className="nx-input" value={x.col} onChange={(e) => set("col", e.target.value)} />
      </label>
      <label className="nx-field">
        {t("Type")}
        <select className="nx-input" value={x.type} onChange={(e) => set("type", e.target.value)}>
          {DATA_TYPES.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
      </label>
      <label className="nx-field">
        {t("Notes")}
        <input className="nx-input" value={x.notes} onChange={(e) => set("notes", e.target.value)} />
      </label>
      <div className="nx-row">
        <Button variant="primary" loading={busy} loadingLabel={t("Saving…")} disabled={!ready} onClick={() => void save()}>{t("Add the mapping")}</Button>
        <Button variant="secondary" disabled={busy} onClick={() => onDone(null)}>{t("Cancel")}</Button>
      </div>
    </div>
  );
}

function MappingView({ m, selfService, ctx }: { m: FieldMapping; selfService: boolean; ctx: SheetCtx }) {
  const qc = useQueryClient();
  const toast = useToast();
  const edit = useWrite(selfService);
  const [col, setCol] = useState(shownValue(m, "customer_field"));
  const [label, setLabel] = useState(shownValue(m, "customer_label"));
  const [notes, setNotes] = useState(m.notes ?? "");
  const [deleting, setDeleting] = useState(false);
  const { busy, run } = useSubmitGuard();
  const dirty = col.trim() !== shownValue(m, "customer_field") || label.trim() !== shownValue(m, "customer_label") || notes.trim() !== (m.notes ?? "");
  const write = (body: Parameters<typeof api.updateFieldMapping>[1], text: string) =>
    run(async () => {
      try {
        await api.updateFieldMapping(m.id, body);
        await refreshAdmin(qc, "mappings");
        toast({ text: `${text}: ${m.standard_field}`, tone: "good" });
      } catch (e) {
        toast({ text: failureText(e), tone: "bad" });
      }
    });
  return (
    <div className="nx-form">
      <dl className="nx-jfacts" data-testid="mapping-facts">
        <dt className="nx-sub">{t("Object")}</dt><dd>{moduleText(m.module)}</dd>
        <dt className="nx-sub">{t("Standard field")}</dt><dd><Code code={m.standard_field} text={m.standard_label ?? undefined} /></dd>
        <dt className="nx-sub">{t("Type")}</dt><dd><Code code={m.data_type} /></dd>
        <dt className="nx-sub">{t("State")}</dt><dd>{m.is_mapped ? t("Mapped") : t("Not mapped: the standard column is read")}</dd>
        <dt className="nx-sub">{t("Changed")}</dt><dd>{formatDate(m.updated_at, "datetime")}</dd>
      </dl>
      <h3 className="nx-jh">{t("Your column")}</h3>
      <label className="nx-field">
        {t("Column header in your file")}
        <input className="nx-input" value={col} disabled={!edit} onChange={(e) => setCol(e.target.value)} placeholder={t("Default {standard_field}", { standard_field: m.standard_field })} />
      </label>
      <label className="nx-field">
        {t("Label")}
        <input className="nx-input" value={label} disabled={!edit} onChange={(e) => setLabel(e.target.value)} placeholder={m.standard_label ?? ""} />
      </label>
      <label className="nx-field">
        {t("Notes")}
        <input className="nx-input" value={notes} disabled={!edit} onChange={(e) => setNotes(e.target.value)} />
      </label>
      {edit ? (
        <div className="nx-row nx-row-wrap">
          <Button variant="primary" loading={busy} loadingLabel={t("Saving…")} disabled={!dirty} onClick={() => void write({ customer_field: col.trim(), customer_label: label.trim(), notes: notes.trim(), is_mapped: col.trim() !== "" }, t("Mapping saved"))}>{t("Save the mapping")}</Button>
          <Button disabled={busy || (!m.is_mapped && !m.customer_field && !m.notes)} onClick={() => { setCol(""); setLabel(""); setNotes(""); void write({ customer_field: "", customer_label: "", notes: "", is_mapped: false }, t("Mapping cleared")); }}>{t("Clear the mapping")}</Button>
          <Button variant="danger" disabled={busy} onClick={() => setDeleting(true)}>{t("Delete the mapping")}</Button>
        </div>
      ) : (
        <p className="nx-note">{t("Editing mappings needs the manage field mappings permission and a licence with self-service mapping.")}</p>
      )}
      <Confirm
        open={deleting}
        title={t("Delete the mapping")}
        consequence={t("{standard_field} leaves the mapping list. Rules on this object read the standard column again.", { standard_field: m.standard_field })}
        confirmLabel={t("Delete the mapping")}
        danger
        onCancel={() => setDeleting(false)}
        onConfirm={() =>
          void run(async () => {
            try {
              await api.deleteFieldMapping(m.id);
              setDeleting(false);
              await refreshAdmin(qc, "mappings");
              toast({ text: t("Mapping deleted"), tone: "good" });
              ctx.open({ kind: "field-mappings", id: "" });
            } catch (e) {
              toast({ text: failureText(e), tone: "bad" });
            }
          })
        }
      />
    </div>
  );
}

const COLUMNS: Column<FieldMapping>[] = [
  { id: "o", get label() { return t("Object"); }, cell: (m) => moduleText(m.module) },
  { id: "f", get label() { return t("Standard field"); }, cell: (m) => <Code code={m.standard_field} text={m.standard_label ?? undefined} /> },
  { id: "c", get label() { return t("Customer column"); }, cell: (m) => shownValue(m, "customer_field") || t("Not mapped: the standard column is read") },
  { id: "l", get label() { return t("Customer label"); }, cell: (m) => shownValue(m, "customer_label") || "-" },
  { id: "s", get label() { return t("State"); }, cell: (m) => <Chip tone={m.is_mapped ? "good" : "neutral"}>{m.is_mapped ? t("Mapped") : t("Not mapped")}</Chip> },
];

function MappingList({ ctx }: { ctx: SheetCtx }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [search, setSearch] = useState("");
  const [object, setObject] = useState("");
  const [resetting, setResetting] = useState(false);
  const { busy, run } = useSubmitGuard();
  const all = useMappings({});
  const q = useMappings({ module: object || undefined, search: search.trim() || undefined });
  const objects = useMemo(() => [...new Set((all.data?.mappings ?? []).map((m) => m.module))].sort(), [all.data]);
  const rows = q.data?.mappings ?? [];
  const mapped = rows.filter((m) => m.is_mapped).length;
  const custom = rows.filter((m) => m.customer_field || m.customer_label || m.notes).length;
  const selfService = q.data?.self_service_enabled ?? true;
  const write = useWrite(selfService);
  const canManage = useV2Session().can("manage_field_mappings");
  return (
    <div className="nx-form">
      <p className="nx-sub">{t("{value}Name the column in your files that holds each standard SAP field, then save the row. Open a row to edit it.", { value: rows.length ? t("{mapped} of {rowsCount} standard fields are mapped. ", { mapped, rowsCount: rows.length }) : "" })}</p>
      {!canManage ? <p className="nx-note" data-testid="mappings-readonly">{t("Read only for your role. Changing mappings needs the manage field mappings permission.")}</p> : !selfService ? <p className="nx-note">{t("Field mapping self-service is not part of this licence, so mappings are read only.")}</p> : null}
      {write ? (
        <div className="nx-row nx-row-wrap">
          <Button variant="primary" onClick={() => ctx.open({ kind: "field-mappings", id: "new" })}>{t("Add a mapping")}</Button>
          <Button disabled={custom === 0 || busy} onClick={() => setResetting(true)}>{object ? t("Reset {object} to defaults", { object: moduleText(object) }) : t("Reset all to defaults")}</Button>
        </div>
      ) : null}
      <div className="nx-row nx-row-wrap" role="search" aria-label={t("Filter mappings")}>
        <label className="nx-field">
          {t("Search")}
          <input className="nx-input" type="search" value={search} placeholder={t("Field, label or column")} onChange={(e) => setSearch(e.target.value)} />
        </label>
        <label className="nx-field">
          {t("Object")}
          <select className="nx-input" value={object} onChange={(e) => setObject(e.target.value)}>
            <option value="">{t("All objects")}</option>
            {objects.map((o) => <option key={o} value={o}>{moduleText(o)}</option>)}
          </select>
        </label>
      </div>
      <div data-testid="mappings-list">
        <DataTable
          caption={t("Field mappings")}
          rows={rows}
          columns={[...COLUMNS, { id: "open", label: t("Open"), cell: (m) => <Button variant="quiet" size={32} onClick={() => ctx.open({ kind: "field-mappings", id: m.id })}>{t("Open")}</Button> }]}
          rowKey={(m) => m.id}
          rowLabel={(m) => m.standard_field}
          loading={q.isPending}
          error={q.isError ? { sentence: t("The mappings could not be read."), onRetry: () => void q.refetch() } : undefined}
          empty={{ heading: t("Field mappings"), text: t("No field matches. Clear the search or choose another object.") }}
        />
      </div>
      <Confirm
        open={resetting}
        title={object ? t("Reset {object} to defaults", { object: moduleText(object) }) : t("Reset all mappings to defaults")}
        consequence={t("{custom} {custom, plural, one {field loses its} other {fields lose their}} customer column, label and note. The standard SAP columns are read again.", { custom })}
        confirmLabel={t("Reset to defaults")}
        danger
        onCancel={() => setResetting(false)}
        onConfirm={() =>
          void run(async () => {
            try {
              const r = await api.resetFieldMappings(object || undefined);
              await refreshAdmin(qc, "mappings");
              setResetting(false);
              toast({ text: t("{reset_count} {reset_count, plural, one {mapping} other {mappings}} reset to defaults", { reset_count: r.reset_count }), tone: "good" });
            } catch (e) {
              toast({ text: failureText(e), tone: "bad" });
            }
          })
        }
      />
    </div>
  );
}

export function FieldMappingsSheet({ ctx }: { ctx: SheetCtx }) {
  const q = useMappings({});
  const id = ctx.id;
  const m = id && id !== "new" ? q.data?.mappings.find((x) => x.id === id) : undefined;
  const selfService = q.data?.self_service_enabled ?? true;
  const write = useWrite(selfService);
  const objects = useMemo(() => [...new Set((q.data?.mappings ?? []).map((x) => x.module))].sort(), [q.data]);
  const title = id === "new" ? t("Add a mapping") : m ? m.standard_field : t("Field mappings");
  return (
    <Sheet open onClose={ctx.close} title={title} meta={m ? moduleText(m.module) : undefined} size="large" under={ctx.under}
      secondary={id ? <Button variant="secondary" onClick={() => ctx.open({ kind: "field-mappings", id: "" })}>{t("Field mappings")}</Button> : <Button variant="secondary" onClick={ctx.close}>{t("Done")}</Button>}>
      {id === "new" ? (
        write ? <MappingForm objects={objects} onDone={(x) => ctx.open({ kind: "field-mappings", id: x ? x.id : "" })} /> : <p className="nx-note">{t("Read only for your role. Changing mappings needs the manage field mappings permission.")}</p>
      ) : id ? (
        <QueryView loading={q.isPending} error={q.isError ? t("The mappings could not be read.") : null} onRetry={() => void q.refetch()} empty={!m} emptyHeading={t("This mapping does not exist. It may have been deleted.")} label={t("Field mappings")}>
          {m ? <MappingView key={m.updated_at} m={m} selfService={selfService} ctx={ctx} /> : null}
        </QueryView>
      ) : (
        <MappingList ctx={ctx} />
      )}
    </Sheet>
  );
}
