"use client";

import { useState } from "react";
import { updateFieldMapping } from "@/lib/api/v2/admin";
import { useMappings } from "@/lib/v2/admin-queries";
import { t } from "@/lib/v2/i18n";
import { Button, Card, Code, DataTable, Field, Input, Toggle } from "@/ui/kit";
import { Row, Sec, useAct } from "./shared";

export function Mappings() {
  const [module, setModule] = useState("");
  const [search, setSearch] = useState("");
  const q = useMappings({ module: module || undefined, search: search || undefined });
  const { run } = useAct("mappings");
  const rows = q.data?.mappings ?? [];
  const self = q.data?.self_service_enabled ?? false;
  const [draft, setDraft] = useState<Record<string, string>>({});
  return (
    <Sec title={t("Field mappings")} scope="mappings" q={[q]} context={t("Your field names against the standard fields.")}
      facts={[t("{n} mappings, {m} mapped.", { n: rows.length, m: rows.filter((r) => r.is_mapped).length })]}>
      <Row>
        <Field label={t("Object")}><Input value={module} onChange={(e) => setModule(e.target.value)} /></Field>
        <Field label={t("Search")}><Input value={search} onChange={(e) => setSearch(e.target.value)} /></Field>
        <Toggle label={t("Self service mapping")} checked={self} onChange={() => undefined} />
      </Row>
      <Card title={t("Mappings")} sub={t("{n} fields", { n: q.data?.total ?? rows.length })}>
        {rows.length === 0 ? <p className="mx-muted">{t("No field mappings yet.")}</p> : (
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
    </Sec>
  );
}
