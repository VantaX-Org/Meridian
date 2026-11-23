"use client";

import { decideAccessRequest } from "@/lib/api/v2/admin";
import { useAccessRequests } from "@/lib/v2/admin-queries";
import { t } from "@/lib/v2/i18n";
import { Button, Card, Code, DataTable, EmptyState } from "@/ui/kit";
import { Row, Sec, useAct, when } from "./shared";

export function Access() {
  const q = useAccessRequests();
  const { run, busy } = useAct("users");
  const rows = q.data ?? [];
  return (
    <Sec title={t("Access requests")} scope="access" q={[q]} context={t("{n} open", { n: rows.length })}
      facts={[t("{n} access requests are open.", { n: rows.length })]}>
      <Card title={t("Open requests")}>
        {rows.length === 0 ? <EmptyState heading={t("No open access requests.")} body={t("A request appears here when a person asks for access.")} /> : (
          <DataTable label={t("Open access requests")} rows={rows} rowKey={(r) => r.id} height={360}
            columns={[
              { key: "created_at", label: t("Asked"), render: (r) => when(r.created_at), sort: (r) => r.created_at },
              { key: "resource", label: t("Resource"), render: (r) => <Code code={r.resource} description={r.action} /> },
              { key: "scope", label: t("System and object"), render: (r) => [r.system_id, r.module].filter(Boolean).join(" / ") },
              { key: "reason", label: t("Reason"), render: (r) => r.reason ?? "" },
              { key: "act", label: t("Decision"), render: (r) => (
                <Row>
                  <Button variant="primary" disabled={busy} onClick={() => run(() => decideAccessRequest(r.id, { decision: "granted" }), t("Access granted."))}>{t("Grant")}</Button>
                  <Button variant="ghost" disabled={busy} onClick={() => run(() => decideAccessRequest(r.id, { decision: "declined" }), t("Request declined."))}>{t("Decline")}</Button>
                </Row>
              ) },
            ]} />
        )}
      </Card>
    </Sec>
  );
}
