"use client";

/**
 * Admin, Settings: the deployment at a glance (health checks and the
 * language-model tier on this licence) with the way into each settings tab.
 * Only tabs the role and licence allow are offered. No Tally on this tab.
 */

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Banner, Chip, PageHeader, SectionCard } from "@/components/ui-core";
import { useNavGate } from "@/hooks/use-nav";
import { useRole } from "@/hooks/use-role";
import { getDoctor } from "@/lib/api/admin-doctor";
import { getLicenceManifest } from "@/lib/api/licence";
import { isItemVisible, SETTINGS_ITEMS } from "@/lib/nav";
import { DoctorCard } from "./parts";

const TABS: Record<string, { tab: string; blurb: string }> = {
  "/settings/rules": { tab: "rules", blurb: "Built-in and custom checks; enable or disable per tenant." },
  "/settings/field-mapping": { tab: "field-mapping", blurb: "Source-to-standard field maps per object." },
  "/settings/ai": { tab: "ai", blurb: "Language-model provider, model and connection test." },
  "/settings/licence": { tab: "licence", blurb: "Tier, seats, renewal, modules and platform version." },
};

export function SettingsSurface() {
  const { can } = useRole();
  const gate = useNavGate();
  const items = SETTINGS_ITEMS.filter((i) => isItemVisible(i, gate) && TABS[i.href]);
  const licence = useQuery({ queryKey: ["licence.manifest"], queryFn: getLicenceManifest });
  const doctor = useQuery({ queryKey: ["admin.doctor"], queryFn: getDoctor, enabled: can("manage_system"), refetchInterval: 30_000 });
  const l = licence.data;

  return (
    <div className="ui-page">
      <PageHeader title="Settings" summary="The way into each setting, and whether this deployment is healthy." />
      {l?.valid === false ? <Banner tone="danger" title="The licence is not valid">Meridian HQ reports status “{l.status}”. Analyses still run; module entitlements may be restricted until the licence is renewed.</Banner> : null}
      <ul className="ui-linklist">
        {items.map((i) => (
          <li key={i.href}><Link href={`/admin?tab=${TABS[i.href].tab}`}><strong>{i.label}</strong><span className="ui-micro">{TABS[i.href].blurb}</span></Link></li>
        ))}
        {can("manage_users") ? <li><Link href="/admin?tab=users"><strong>Users and audit</strong><span className="ui-micro">Roles, invitations and the audit log.</span></Link></li> : null}
        <li><Link href="/admin?tab=scoring"><strong>Scoring and alerts</strong><span className="ui-micro">DQS weights, alert thresholds and planner assumptions.</span></Link></li>
      </ul>
      {can("manage_system") && doctor.data ? (
        <DoctorCard items={doctor.data.items} lastChecked={new Date(doctor.data.last_checked).toLocaleTimeString()} onRefresh={() => doctor.refetch()} />
      ) : null}
      {l?.llm_config ? (
        <SectionCard title="Language-model tier on this licence" action={<Chip>tier {l.llm_config.tier}</Chip>}>
          <p className="ui-note">{l.llm_config.model}{l.llm_config.notes ? `. ${l.llm_config.notes}` : ""}</p>
        </SectionCard>
      ) : null}
    </div>
  );
}
