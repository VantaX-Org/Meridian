"use client";

/**
 * Admin → Settings: the deployment at a glance — health doctor, running
 * version, licence and language-model posture — with the way into each
 * settings tab. Only tabs the role and licence allow are offered.
 */

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { AdminDoctorCard, Banner, Chip, KpiRail, Panel, Stack, Stat, Text } from "@/components/aurora";
import { useNavGate } from "@/hooks/use-nav";
import { useRole } from "@/hooks/use-role";
import { getDoctor } from "@/lib/api/admin-doctor";
import { getLicenceManifest } from "@/lib/api/licence";
import { getLLMConfig } from "@/lib/api/llm-settings";
import { isItemVisible, SETTINGS_ITEMS } from "@/lib/nav";
import { PlatformVersion } from "./platform-version";

const TABS: Record<string, { tab: string; blurb: string }> = {
  "/settings/rules": { tab: "rules", blurb: "Built-in and custom checks; enable or disable per tenant." },
  "/settings/field-mapping": { tab: "field-mapping", blurb: "Source-to-standard field maps per object." },
  "/settings/ai": { tab: "ai", blurb: "Language-model provider, model and connection test." },
  "/settings/licence": { tab: "licence", blurb: "Tier, seats, renewal and enabled modules." },
};

export function SettingsSurface() {
  const { can } = useRole();
  const gate = useNavGate();
  const items = SETTINGS_ITEMS.filter((i) => isItemVisible(i, gate) && TABS[i.href]);
  const licence = useQuery({ queryKey: ["licence.manifest"], queryFn: getLicenceManifest });
  const llm = useQuery({ queryKey: ["llm.config"], queryFn: getLLMConfig, enabled: can("manage_llm") });
  const doctor = useQuery({ queryKey: ["admin.doctor"], queryFn: getDoctor, enabled: can("manage_system"), refetchInterval: 30_000 });
  const l = licence.data;
  const failing = doctor.data?.items.filter((i) => i.status !== "ok").length ?? 0;

  return (
    <Stack gap={5} className="aurora-page">
      <KpiRail>
        <Stat label="Licence" value={l?.tier ?? "—"} tone={l?.valid ? "success" : l?.valid === false ? "danger" : "neutral"} />
        <Stat label="Days to renewal" value={l?.days_remaining ?? "—"} tone={l?.days_remaining !== undefined && l.days_remaining < 30 ? "warning" : "neutral"} />
        <Stat label="Modules enabled" value={l ? ((l.enabled_modules ?? []).includes("*") ? "all" : (l.enabled_modules ?? []).length) : "—"} />
        <Stat label="Language model" value={llm.data ? (llm.data.provider.replace(/_/g, " ") || "not set") : can("manage_llm") ? "—" : "admin only"} tone={llm.data && !llm.data.provider ? "warning" : "neutral"} />
        {can("manage_system") ? <Stat label="Health checks not passing" value={doctor.data ? failing : "—"} tone={failing ? "warning" : doctor.data ? "success" : "neutral"} /> : null}
      </KpiRail>
      {l?.valid === false ? <Banner tone="danger" title="The licence is not valid">Meridian HQ reports status “{l.status}”. Analyses still run; module entitlements may be restricted until the licence is renewed.</Banner> : null}
      <div className="aurora-linkcards">
        {items.map((i) => (
          <Link key={i.href} href={`/admin?tab=${TABS[i.href].tab}`} className="aurora-linkcard aurora-focus-ring">
            <Text variant="text-lead">{i.label}</Text>
            <Text variant="text-small" tone="secondary">{TABS[i.href].blurb}</Text>
          </Link>
        ))}
        {can("manage_users") ? (
          <Link href="/admin?tab=users" className="aurora-linkcard aurora-focus-ring">
            <Text variant="text-lead">Users &amp; audit</Text>
            <Text variant="text-small" tone="secondary">Seats, roles, invitations and the audit log.</Text>
          </Link>
        ) : null}
        <Link href="/admin?tab=scoring" className="aurora-linkcard aurora-focus-ring">
          <Text variant="text-lead">Scoring &amp; alerts</Text>
          <Text variant="text-small" tone="secondary">DQS weights, alert thresholds and planner assumptions.</Text>
        </Link>
      </div>
      {can("manage_system") && doctor.data ? (
        <AdminDoctorCard items={doctor.data.items} lastChecked={new Date(doctor.data.last_checked).toLocaleTimeString()} onRefresh={() => doctor.refetch()} />
      ) : null}
      <PlatformVersion />
      {l?.llm_config ? (
        <Panel title="Language-model tier on this licence" action={<Chip>tier {l.llm_config.tier}</Chip>}>
          <Text variant="text-small" tone="secondary">{l.llm_config.model}{l.llm_config.notes ? ` · ${l.llm_config.notes}` : ""}</Text>
        </Panel>
      ) : null}
    </Stack>
  );
}
