"use client";

import { useState } from "react";
import { exportAudit } from "@/lib/api/v2/admin";
import { useAudit, useAuditActors } from "@/lib/v2/admin-queries";
import { t } from "@/lib/v2/i18n";
import { Button, Card, Code, DataTable, Field, Input, Select, EmptyState } from "@/ui/kit";
import { errText, Row, Sec, when } from "./shared";
import { useToast } from "@/ui/kit";

const PAGE = 50;

export function Audit() {
  const toast = useToast();
  const [actor, setActor] = useState("");
  const [action, setAction] = useState("");
  const [entity, setEntity] = useState("");
  const [offset, setOffset] = useState(0);
  const params = { actor_user_id: actor || undefined, action: action || undefined, entity_type: entity || undefined, limit: PAGE, offset };
  const q = useAudit(params);
  const actors = useAuditActors();
  const rows = q.data?.entries ?? [];
  const total = q.data?.total ?? 0;
  const exp = (f: "csv" | "xlsx") => exportAudit(f, params).catch((e) => toast(errText(e), "bad"));
  return (
    <Sec title={t("Audit log")} scope="audit" q={[q]} context={t("{n} entries", { n: total })}
      facts={[t("{n} audit entries match the filter.", { n: total })]}
      actions={<><Button variant="secondary" onClick={() => exp("csv")}>{t("Export CSV")}</Button><Button variant="secondary" onClick={() => exp("xlsx")}>{t("Export Excel")}</Button></>}>
      <Row>
        <Field label={t("Actor")}>
          <Select value={actor} onChange={(e) => { setActor(e.target.value); setOffset(0); }}
            options={[{ value: "", label: t("Everyone") }, ...(actors.data?.actors ?? []).map((a) => ({ value: a.id, label: a.name }))]} />
        </Field>
        <Field label={t("Action")}><Input value={action} onChange={(e) => { setAction(e.target.value); setOffset(0); }} /></Field>
        <Field label={t("Entity type")}><Input value={entity} onChange={(e) => { setEntity(e.target.value); setOffset(0); }} /></Field>
      </Row>
      <Card title={t("Entries")} sub={t("{from} to {to} of {total}", { from: total ? offset + 1 : 0, to: Math.min(offset + PAGE, total), total })}>
        {rows.length === 0 ? <EmptyState heading={t("No audit entries match.")} body={t("Change the filter or the dates to see more entries.")} /> : (
          <DataTable label={t("Audit entries")} rows={rows} rowKey={(r) => r.id} height={420}
            columns={[
              { key: "created_at", label: t("When"), render: (r) => when(r.created_at), sort: (r) => r.created_at },
              { key: "actor", label: t("Actor"), render: (r) => r.actor_email ?? t("System") },
              { key: "action", label: t("Action"), render: (r) => <Code code={r.action} description={`${r.method} ${r.path}`} /> },
              { key: "entity", label: t("Entity"), render: (r) => r.entity_type ? <Code code={r.entity_type} description={r.entity_id ?? ""} /> : "" },
              { key: "status", label: t("Status"), align: "end", render: (r) => r.status_code },
            ]} />
        )}
        <Row>
          <Button variant="ghost" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>{t("Previous")}</Button>
          <Button variant="ghost" disabled={offset + PAGE >= total} onClick={() => setOffset(offset + PAGE)}>{t("Next")}</Button>
        </Row>
      </Card>
    </Sec>
  );
}
