"use client";

import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { FieldMapping } from "@/lib/api/field-mappings";
import * as api from "@/lib/api/v2/admin";
import { apiErrorMessage } from "@/lib/error";
import { useOpenItem } from "@/lib/v2/hooks";
import { refreshAdmin, useMappings } from "@/lib/v2/admin-queries";
import { t } from "@/lib/v2/i18n";
import { moduleText } from "@/lib/v2/labels";
import { Button, Chip, Code, Confirm, DataTable, type Column } from "../kit";
import { Mono } from "@/design/v2/parts";
import { DataBlock, DataPage, Dash, Field, useAct, useCan } from "./data-parts";

const isDefault = (m: FieldMapping, key: "customer_field" | "customer_label"): boolean => !m.is_mapped && m[key] === (key === "customer_field" ? m.standard_field : m.standard_label);
const shownValue = (m: FieldMapping, key: "customer_field" | "customer_label"): string => (isDefault(m, key) ? "" : (m[key] ?? ""));

const columns = (): Column<FieldMapping>[] => [
  { id: "object", label: t("Object"), cell: (m) => moduleText(m.module), compare: (a, b) => a.module.localeCompare(b.module) },
  { id: "field", label: t("Standard field"), cell: (m) => <Code code={m.standard_field} text={m.standard_label || undefined} />, compare: (a, b) => a.standard_field.localeCompare(b.standard_field) },
  { id: "type", label: t("Type"), cell: (m) => <Mono>{m.data_type}</Mono> },
  { id: "column", label: t("Customer column"), cell: (m) => (shownValue(m, "customer_field") ? <Mono>{shownValue(m, "customer_field")}</Mono> : <Dash why={t("Not mapped: the standard column is read")} />) },
  { id: "label", label: t("Customer label"), cell: (m) => shownValue(m, "customer_label") || <Dash /> },
  { id: "notes", label: t("Notes"), hidden: true, cell: (m) => m.notes ?? <Dash /> },
  { id: "state", label: t("State"), cell: (m) => (m.is_mapped ? <Chip tone="good">{t("Mapped")}</Chip> : <Chip tone="neutral">{t("Not mapped")}</Chip>) },
];

/** Admin › Field mappings: which column in the customer's files holds each standard SAP field. */
export function MappingsSection() {
  const can = useCan();
  const qc = useQueryClient();
  const { openItem } = useOpenItem();
  const [search, setSearch] = useState("");
  const [object, setObject] = useState("");
  const [resetting, setResetting] = useState(false);
  const [adding, setAdding] = useState(false);
  const { pending, act } = useAct();
  const write = can("manage_field_mappings");
  const all = useMappings({});
  const q = useMappings({ module: object || undefined, search: search.trim() || undefined });
  const objects = useMemo(() => [...new Set((all.data?.mappings ?? []).map((m) => m.module))].sort(), [all.data]);
  const rows = q.data?.mappings ?? [];
  const mapped = rows.filter((m) => m.is_mapped).length;
  const custom = rows.filter((m) => m.customer_field || m.customer_label || m.notes).length;
  const selfService = q.data?.self_service_enabled ?? true;
  return (
    <DataPage
      lead={t("{value}Name the column in your files that holds each standard SAP field, then save the row. Open a row to edit it.", { value: rows.length ? t("{mapped} of {rowsCount} standard fields are mapped. ", { mapped, rowsCount: rows.length }) : "" })}
      actions={
        write && selfService ? (
          <>
            <Button variant="primary" disabled={adding} onClick={() => setAdding(true)} data-testid="mapping-add">
              {t("Add a mapping")}
            </Button>
            <Button disabled={custom === 0 || pending !== null} onClick={() => setResetting(true)} data-testid="mapping-reset">
              {object ? t("Reset {object} to defaults", { object: moduleText(object) }) : t("Reset all to defaults")}
            </Button>
          </>
        ) : undefined
      }
    >
      {!write ? <p className="nx-note">{t("Read only for your role. Changing mappings needs the manage field mappings permission.")}</p> : !selfService ? <p className="nx-note">{t("Field mapping self-service is not part of this licence, so mappings are read only.")}</p> : null}
      {adding ? <NewMapping objects={objects} initial={object} onDone={(m) => (setAdding(false), m ? openItem({ kind: "mapping", id: m.id }) : undefined)} /> : null}
      <DataBlock title={t("Field mappings")}>
        <div className="nx-data-form" role="search" aria-label={t("Filter mappings")}>
          <Field label={t("Search")}>
            <input className="nx-input" type="search" value={search} placeholder={t("Field, label or column")} onChange={(e) => setSearch(e.target.value)} />
          </Field>
          <Field label={t("Object")}>
            <select className="nx-input" value={object} onChange={(e) => setObject(e.target.value)}>
              <option value="">{t("All objects")}</option>
              {objects.map((o) => (
                <option key={o} value={o}>
                  {moduleText(o)}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <DataTable<FieldMapping>
          caption={t("Field mappings")}
          columns={columns()}
          rows={rows}
          rowKey={(m) => m.id}
          rowLabel={(m) => m.standard_field}
          loading={q.isPending}
          error={q.isError ? { sentence: t("The mappings could not be read. {apiErrorMessage}", { apiErrorMessage: apiErrorMessage(q.error) }), onRetry: () => void q.refetch() } : undefined}
          empty={{ heading: t("No field matches. Clear the search or choose another object.") }}
          onOpenRow={(m) => openItem({ kind: "mapping", id: m.id })}
        />
      </DataBlock>
      <Confirm
        open={resetting}
        title={object ? t("Reset {object} to defaults", { object: moduleText(object) }) : t("Reset all mappings to defaults")}
        consequence={t("{custom} {custom, plural, one {field loses its} other {fields lose their}} customer column, label and note. The standard SAP columns are read again.", { custom })}
        confirmLabel={t("Reset to defaults")}
        danger
        onCancel={() => setResetting(false)}
        onConfirm={() =>
          void act("reset", async () => {
            const r = await api.resetFieldMappings(object || undefined);
            await refreshAdmin(qc, "mappings");
            setResetting(false);
            return t("{reset_count} {reset_count, plural, one {mapping} other {mappings}} reset to defaults", { reset_count: r.reset_count });
          })
        }
      />
    </DataPage>
  );
}

const DATA_TYPES = ["string", "number", "date", "boolean"] as const;

/** Adds a mapping for a field the standard catalogue does not hold, or one that was deleted. */
function NewMapping({ objects, initial, onDone }: { objects: string[]; initial: string; onDone: (m: FieldMapping | null) => void }) {
  const qc = useQueryClient();
  const [module, setModule] = useState(initial);
  const [field, setField] = useState("");
  const [label, setLabel] = useState("");
  const [col, setCol] = useState("");
  const [type, setType] = useState<string>("string");
  const [notes, setNotes] = useState("");
  const { pending, act } = useAct();
  const ready = module.trim() !== "" && field.trim() !== "";
  return (
    <DataBlock title={t("Add a mapping")} testid="mapping-new">
      <div className="nx-data-form">
        <Field label={t("Object")}>
          <input className="nx-input" value={module} list="nx-mapping-objects" onChange={(e) => setModule(e.target.value)} placeholder="material_master" />
          <datalist id="nx-mapping-objects">
            {objects.map((o) => (
              <option key={o} value={o}>
                {moduleText(o)}
              </option>
            ))}
          </datalist>
        </Field>
        <Field label={t("Standard field")}>
          <input className="nx-input" value={field} onChange={(e) => setField(e.target.value)} placeholder="MARA.MATNR" />
        </Field>
        <Field label={t("Meaning")}>
          <input className="nx-input" value={label} onChange={(e) => setLabel(e.target.value)} />
        </Field>
        <Field label={t("Column header in your file")}>
          <input className="nx-input" value={col} onChange={(e) => setCol(e.target.value)} />
        </Field>
        <Field label={t("Type")}>
          <select className="nx-input" value={type} onChange={(e) => setType(e.target.value)}>
            {DATA_TYPES.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("Notes")}>
          <input className="nx-input" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </div>
      <div className="nx-data-actions">
        <Button
          variant="primary"
          disabled={!ready || pending !== null}
          loading={pending === "add"}
          loadingLabel={t("Saving…")}
          onClick={() =>
            void act("add", async () => {
              const m = await api.createFieldMapping({ module: module.trim(), standard_field: field.trim(), standard_label: label.trim() || undefined, customer_field: col.trim() || undefined, data_type: type, is_mapped: col.trim() !== "", notes: notes.trim() || undefined });
              await refreshAdmin(qc, "mappings");
              onDone(m);
              return t("Mapping added");
            })
          }
        >
          {t("Add the mapping")}
        </Button>
        <Button disabled={pending !== null} onClick={() => onDone(null)}>
          {t("Cancel")}
        </Button>
      </div>
    </DataBlock>
  );
}
