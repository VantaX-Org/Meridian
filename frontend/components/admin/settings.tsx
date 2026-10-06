"use client";

/**
 * Admin, Settings: the deployment at a glance (licence, language model) and
 * the health checks, each with a Fix link. The rail already lists every tab.
 * No Tally on this tab.
 */

import { useQuery } from "@tanstack/react-query";
import { Banner, KeyValue, PageHeader, SectionCard } from "@/components/ui-core";
import { useRole } from "@/hooks/use-role";
import { getDoctor } from "@/lib/api/admin-doctor";
import { getLicenceManifest } from "@/lib/api/licence";
import { DoctorCard } from "./parts";
import { formatDate, labelOf } from "@/lib/format";

export function SettingsSurface() {
  const { can } = useRole();
  const licence = useQuery({ queryKey: ["licence.manifest"], queryFn: getLicenceManifest });
  const doctor = useQuery({ queryKey: ["admin.doctor"], queryFn: getDoctor, enabled: can("manage_system"), refetchInterval: 30_000 });
  const l = licence.data;

  return (
    <div className="ui-page">
      <PageHeader title="Settings" summary="The way into each setting, and whether this deployment is healthy." />
      {l?.valid === false ? <Banner tone="danger" title="The licence is not valid">Meridian HQ reports status “{labelOf(l.status)}”. Analyses still run; module entitlements may be restricted until the licence is renewed.</Banner> : null}
      <SectionCard title="Deployment">
        <KeyValue rows={[
          { k: "Tenant", v: l?.company_name ?? "Not set" },
          { k: "Licence tier", v: l?.tier ? labelOf(l.tier) : "Not validated yet" },
          { k: "Licence status", v: l ? labelOf(l.status) : "Loading" },
          { k: "Language model", v: l?.llm_config ? `${l.llm_config.model}, tier ${l.llm_config.tier}` : "Not configured" },
        ]} />
      </SectionCard>
      {can("manage_system") && doctor.data ? (
        <DoctorCard items={doctor.data.items} lastChecked={formatDate(doctor.data.last_checked, "datetime")} onRefresh={() => doctor.refetch()} />
      ) : null}
    </div>
  );
}
