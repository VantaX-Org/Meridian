"use client";

import { downloadDiagnostics } from "@/lib/api/v2/enterprise";
import { useDoctor, useHealth, useUpdateStatus } from "@/lib/v2/admin-queries";
import { t } from "@/lib/v2/i18n";
import { Button, Card, Code, DataTable, SeverityPill, StatTile, useSheet, ExportMenu } from "@/ui/kit";
import { Sec, when } from "./shared";


const SEV = { ok: "low", warn: "medium", fail: "critical" } as const;

/** System health. The update block is display only: Meridian never starts an update from this screen. */
export function System() {
  const sheet = useSheet();
  const doc = useDoctor();
  const upd = useUpdateStatus();
  const health = useHealth();
  const items = doc.data?.items ?? [];
  const bad = items.filter((i) => i.status !== "ok").length;
  const u = upd.data;
  return (
    <Sec title={t("System")} scope="system" q={[doc, upd, health]} context={t("Health checks, version and support bundle.")}
      facts={[bad ? t("{n} health checks need attention.", { n: bad }) : t("All health checks pass.")]}
      actions={<ExportMenu formats={[{ id: "bundle", label: t("Diagnostics bundle"), hint: t("Health, versions and recent errors") }]} onExport={() => downloadDiagnostics()} />}>
      <dl className="mx-tiles">
        <StatTile label={t("Version")} value={u?.current_version ?? health.data?.version ?? ""} note={u?.update_available ? t("Update {v} is available", { v: u.latest_version }) : t("Up to date")} />
        <StatTile label={t("Checks needing attention")} value={String(bad)} />
        <StatTile label={t("Last checked")} value={doc.data ? when(doc.data.last_checked) : ""} />
      </dl>
      <Card title={t("Health checks")} action={<Button variant="ghost" onClick={() => sheet.open("update")}>{t("Version details")}</Button>}>
        <DataTable label={t("Health checks")} rows={items} rowKey={(r) => r.id} height={320}
          columns={[
            { key: "id", label: t("Check"), render: (r) => <Code code={r.id} description={r.label} /> },
            { key: "status", label: t("Status"), render: (r) => <SeverityPill sev={SEV[r.status]} label={r.status} /> },
            { key: "detail", label: t("Detail"), render: (r) => r.detail ?? "" },
          ]} />
      </Card>
    </Sec>
  );
}
