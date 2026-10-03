"use client";

/**
 * Admin → Licence: what Meridian HQ has granted this deployment — tier,
 * seats, renewal, modules and features — and the running platform version.
 * Plan changes and invoices happen in Meridian HQ, never here.
 */

import { useQuery } from "@tanstack/react-query";
import { Banner, Chip, KpiRail, Panel, Stack, Stat, Text } from "@/components/aurora";
import { getLicenceManifest } from "@/lib/api/licence";
import { formatModuleName } from "@/lib/format";
import { PlatformVersion } from "./platform-version";

export function LicenceSurface() {
  const q = useQuery({ queryKey: ["licence.manifest"], queryFn: getLicenceManifest });
  const l = q.data;
  const modules = l?.enabled_modules ?? [];
  const all = modules.includes("*");
  const seats = l?.features?.max_users ?? 0;
  const features = Object.entries(l?.features ?? {}).filter(([, v]) => typeof v === "boolean") as [string, boolean][];
  return (
    <Stack gap={5} className="aurora-page">
      <KpiRail>
        <Stat label="Tier" value={l?.tier ?? "—"} tone={l?.valid ? "success" : l?.valid === false ? "danger" : "neutral"} />
        <Stat label="Seats" value={seats || "unlimited"} />
        <Stat label="Modules" value={all ? "all" : modules.length} />
        <Stat label="Renews" value={l?.expiry_date ?? "—"} />
        <Stat label="Days remaining" value={l?.days_remaining ?? "—"} tone={l?.days_remaining !== undefined && l.days_remaining < 30 ? "warning" : "neutral"} />
      </KpiRail>
      {q.isLoading ? <Text tone="muted">Reading the licence.</Text> : null}
      {l?.valid === false ? <Banner tone="danger" title="The licence is not valid">Meridian HQ reports status “{l.status}”. Renew it in Meridian HQ; this deployment keeps its data either way.</Banner> : null}
      {l?.valid === null && l?.status ? <Banner tone="info" title="Licence not yet validated">Status “{l.status}”. The deployment validates with Meridian HQ on a schedule; defaults apply until then.</Banner> : null}
      {l ? (
        <Panel title="Licence detail">
          <table className="aurora-exec__table"><tbody>
            {([["Tenant", l.company_name ?? "—"], ["Tier", l.tier ?? "—"], ["Status", l.status], ["Seats", seats ? String(seats) : "unlimited"], ["Renews", l.expiry_date ?? "—"],
              ["Last validated", l.last_validated ?? "—"], ["Language-model tier", l.llm_config ? `tier ${l.llm_config.tier} · ${l.llm_config.model}` : "—"]] as [string, string][])
              .map(([k, v]) => <tr key={k}><td>{k}</td><td className="aurora-number">{v}</td></tr>)}
          </tbody></table>
          <Text variant="text-micro" tone="muted" style={{ marginTop: "var(--aurora-space-3)" }}>Plan changes and invoices are managed in Meridian HQ.</Text>
        </Panel>
      ) : null}
      {l ? (
        <Panel title="Modules" action={<Text variant="text-small" tone="secondary">{all ? "every SAP module" : `${modules.length} enabled`}</Text>}>
          <Stack direction="row" gap={1} wrap>
            {all ? <Chip tone="success">all modules</Chip> : modules.map((m) => <Chip key={m} tone="success">{formatModuleName(m)}</Chip>)}
            {!all && !modules.length ? <Text tone="muted">{l.valid === null ? "Modules follow the licence once Meridian HQ has validated it." : "No modules enabled on this licence."}</Text> : null}
          </Stack>
        </Panel>
      ) : null}
      {features.length ? (
        <Panel title="Features">
          <Stack direction="row" gap={1} wrap>{features.map(([k, v]) => <Chip key={k} tone={v ? "success" : "neutral"}>{k.replace(/_/g, " ")}{v ? "" : " · off"}</Chip>)}</Stack>
        </Panel>
      ) : null}
      <PlatformVersion />
    </Stack>
  );
}
