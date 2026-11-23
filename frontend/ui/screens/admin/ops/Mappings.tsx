"use client";

import { useState } from "react";
import { createFieldMapping, updateFieldMapping } from "@/lib/api/v2/admin";
import { useMappings } from "@/lib/v2/admin-queries";
import { t } from "@/lib/v2/i18n";
import { Button, Card, Code, DataTable, EmptyState, Field, Input, Select, Toggle } from "@/ui/kit";
import { Row, Sec, useAct } from "./shared";

export function Mappings() {
  const [module, setModule] = useState("");
  const [search, setSearch] = useState("");
  const q = useMappings({ module: module || undefined, search: search || undefined });
  const { run, busy } = useAct("mappings");
  const rows = q.data?.mappings ?? [];
  const self = q.data?.self_service_enabled ?? false;
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [add, setAdd] = useState({ module: "", standard_field: "", standard_label: "", customer_field: "", data_type: "string", is_mapped: true });
  const create = async () => {
    const b = add;
    const r = await run(() => createFieldMapping({ module: b.module.trim(), standard_field: b.standard_field.trim(), standard_label: b.standard_label.trim() || undefined, customer_field: b.customer_field.trim() || undefined, data_type: b.data_type, is_mapped: b.is_mapped }), t("Mapping added."));
    if (r) setAdd({ ...add, standard_field: "", standard_label: "", customer_field: "" });
  };
  return (
    <Sec title={t("Field mappings")} scope="mappings" q={[q]} context={t("Your field names against the standard fields.")}
      facts={[t("{n} mappings, {m} mapped.", { n: rows.length, m: rows.filter((r) => r.is_mapped).length })]}>
      <Row>
        <Field label={t("Object")}><Input value={module} onChange={(e) => setModule(e.target.value)} /></Field>
        <Field label={t("Search")}><Input value={search} onChange={(e) => setSearch(e.target.value)} /></Field>
        <Toggle label={t("Self service mapping")} checked={self} onChange={() => undefined} />
      </Row>
      <Card title={t("Mappings")} sub={t("{n} fields", { n: q.data?.total ?? rows.length })}>
        {rows.length === 0 ? <EmptyState heading={t("No field mappings yet.")} body={t("Add a mapping to link a source field to a target field.")} /> : (
          <DataTable label={t("Field mappings")} rows={rows} rowKey={(r) => r.id} height={420}
            columns={[
              { key: "module", label: t("Object"), render: (r) => r.module },
              { key: "std", label: t("Standard field"), render: (r) => <Code code={r.standard_field} description={r.standard_label ?? undefined} /> },
              { key: "cust", label: t("Your field"), render: (r) => self ? (
                <Row>
                  <Input aria-label={t("Your field for {f}", { f: r.standard_field })} value={draft[r.id] ?? r.customer_field ?? ""} onChange={(e) => setDraft({ ...draft, [r.id]: e.target.value })} />
                  <Button variant="ghost" disabled={draft[r.id] === undefined} onClick={() => run(() => updateFieldMapping(r.id, { customer_field: draft[r.id] }), t("Mapping saved."))}>{t("Save")}</Button>
                </Row>
              ) : (r.customer_field ?? "") },
              { key: "is_mapped", label: t("Mapped"), render: (r) => r.is_mapped ? t("Yes") : t("No") },
            ]} />
        )}
      </Card>
      {self && (
        <Card title={t("Add a mapping")} sub={t("Map one standard field to the name your system uses.")}>
          <form onSubmit={(e) => { e.preventDefault(); void create(); }}>
            <Row>
              <Field label={t("Object")}><Input value={add.module} onChange={(e) => setAdd({ ...add, module: e.target.value })} /></Field>
              <Field label={t("Standard field")}><Input value={add.standard_field} onChange={(e) => setAdd({ ...add, standard_field: e.target.value })} /></Field>
              <Field label={t("Standard label")} hint={t("Optional.")}><Input value={add.standard_label} onChange={(e) => setAdd({ ...add, standard_label: e.target.value })} /></Field>
              <Field label={t("Your field")} hint={t("Empty uses the standard field.")}><Input value={add.customer_field} onChange={(e) => setAdd({ ...add, customer_field: e.target.value })} /></Field>
              <Field label={t("Data type")}>
                <Select value={add.data_type} onChange={(e) => setAdd({ ...add, data_type: e.target.value })} options={[{ value: "string", label: t("Text") }, { value: "number", label: t("Number") }, { value: "date", label: t("Date") }, { value: "boolean", label: t("Yes or no") }]} />
              </Field>
              <Toggle label={t("Mapped")} checked={add.is_mapped} onChange={(v) => setAdd({ ...add, is_mapped: v })} />
              <Button variant="primary" type="submit" disabled={busy || !add.module.trim() || !add.standard_field.trim()}>{t("Add mapping")}</Button>
            </Row>
          </form>
        </Card>
      )}
    </Sec>
  );
}
