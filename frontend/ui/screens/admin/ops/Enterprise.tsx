"use client";

import { useCompliance, useScimToken, useStatusPage, useThemeSettings } from "@/lib/v2/enterprise-queries";
import { t } from "@/lib/v2/i18n";
import { Card, Code, DataTable, SeverityPill, StatTile } from "@/ui/kit";
import { day, Sec, when } from "./shared";

const SEV = { up: "low", degraded: "medium", down: "critical", not_configured: "info" } as const;

export function Enterprise() {
  const status = useStatusPage();
  const theme = useThemeSettings();
  const comp = useCompliance();
  const scim = useScimToken();
  const s = status.data;
  const c = comp.data;
  return (
    <Sec title={t("Enterprise")} scope="enterprise" q={[status, theme, comp, scim]} context={t("Status page, branding, compliance and provisioning.")}
      facts={[s ? t("Platform status is {s}.", { s: s.status }) : ""]}>
      <div className="mx-tiles">
        <StatTile label={t("Platform status")} value={s?.status ?? ""} />
        <StatTile label={t("Uptime")} value={s?.uptime.overall_pct != null ? `${s.uptime.overall_pct}%` : ""} note={t("Last {n} days", { n: s?.uptime.days ?? 0 })} />
        <StatTile label={t("Open incidents")} value={String(s?.incidents.length ?? 0)} />
      </div>
      <Card title={t("Components")}>
        <DataTable label={t("Components")} rows={s?.components ?? []} rowKey={(r) => r.id} height={280}
          columns={[
            { key: "id", label: t("Component"), render: (r) => <Code code={r.id} description={r.label} /> },
            { key: "status", label: t("Status"), render: (r) => <SeverityPill sev={SEV[r.status]} label={r.status} /> },
            { key: "lat", label: t("Latency"), align: "end", render: (r) => (r.latency_ms == null ? "" : t("{n} ms", { n: r.latency_ms })) },
          ]} />
      </Card>
      <Card title={t("Maintenance windows")}>
        {(s?.maintenance.length ?? 0) === 0 ? <p className="mx-muted">{t("No maintenance is planned.")}</p> : (
          <DataTable label={t("Maintenance windows")} rows={s?.maintenance ?? []} rowKey={(r) => r.id ?? r.starts_at} height={200}
            columns={[
              { key: "title", label: t("Title"), render: (r) => r.title },
              { key: "from", label: t("From"), render: (r) => when(r.starts_at) },
              { key: "to", label: t("To"), render: (r) => when(r.ends_at) },
            ]} />
        )}
      </Card>
      <Card title={t("Branding")}>
        <p>{theme.data?.product_name_override ?? t("Default product name")}</p>
        <p className="mx-muted">{theme.data?.accent ?? t("Default accent")}</p>
      </Card>
      <Card title={t("Retention and residency")} sub={c ? day(c.generated_at) : ""}>
        <DataTable label={t("Retention families")} rows={c?.retention.families ?? []} rowKey={(r) => r.family} height={200}
          columns={[
            { key: "f", label: t("Data"), render: (r) => <Code code={r.family} description={r.label} /> },
            { key: "d", label: t("Kept for days"), align: "end", render: (r) => (r.days == null ? t("For ever") : r.days) },
          ]} />
      </Card>
      <Card title={t("SCIM provisioning")}>
        <p>{scim.data?.configured ? t("Token {p} is active.", { p: scim.data.token_prefix ?? "" }) : t("No SCIM token is set.")}</p>
        <p className="mx-muted">{scim.data?.base_url}</p>
      </Card>
    </Sec>
  );
}
