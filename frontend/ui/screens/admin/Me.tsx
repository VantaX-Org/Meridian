"use client";

import { useQuery } from "@tanstack/react-query";
import { getMyDeliveries, sendTestNotification } from "@/lib/api/v2/admin";
import { useFixture } from "@/lib/api/v2/fixture";
import { t } from "@/lib/v2/i18n";
import { Button, Card, Code, DataTable, SeverityPill, useSheet } from "@/ui/kit";
import { PrefsForm } from "./PrefsForm";
import { Row, Sec, useAct, when } from "./ops/shared";

const SEV = { sent: "low", failed: "critical" } as Record<string, "low" | "critical" | "medium">;

/** Me: my settings, my delivery log, and links to my inbox, licence, help and version. */
export function Me() {
  const f = useFixture();
  const sheet = useSheet();
  const d = useQuery({ queryKey: ["v2", "admin", f, "me", "deliveries"], queryFn: () => getMyDeliveries(20) });
  const { run, busy } = useAct("me");
  const rows = d.data?.items ?? [];
  return (
    <Sec title={t("Me")} scope="me" q={[d]} context={t("Your settings and notifications")}
      facts={[t("{n} notifications were sent to you lately.", { n: rows.length })]}
      actions={<Button variant="secondary" href="/n/me/notifications">{t("Inbox")}</Button>}>
      <Card title={t("Preferences")}><PrefsForm /></Card>
      <Card title={t("Notification log")} action={<Button variant="ghost" disabled={busy} onClick={() => run(() => sendTestNotification(), t("Test notification sent."))}>{t("Send a test")}</Button>}>
        {rows.length === 0 ? <p className="mx-muted">{t("Nothing has been sent to you yet.")}</p> : (
          <DataTable label={t("Notification log")} rows={rows} rowKey={(r) => r.id} height={280}
            columns={[
              { key: "kind", label: t("Kind"), render: (r) => <Code code={r.kind} description={r.channel} /> },
              { key: "status", label: t("Status"), render: (r) => <SeverityPill sev={SEV[r.status] ?? "medium"} label={r.status} /> },
              { key: "err", label: t("Detail"), render: (r) => r.error ?? "" },
              { key: "at", label: t("Sent"), render: (r) => when(r.created_at) },
            ]} />
        )}
      </Card>
      <Card title={t("More")}>
        <Row>
          <Button variant="secondary" onClick={() => sheet.open("licence")}>{t("Licence")}</Button>
          <Button variant="secondary" onClick={() => sheet.open("update")}>{t("Version")}</Button>
          <Button variant="secondary" onClick={() => sheet.open("help")}>{t("Help")}</Button>
          <Button variant="secondary" onClick={() => sheet.open("notify")}>{t("Notification settings")}</Button>
        </Row>
      </Card>
    </Sec>
  );
}
