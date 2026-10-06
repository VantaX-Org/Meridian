"use client";

/**
 * Admin, Licence: what Meridian HQ has granted this deployment (tier, seats,
 * renewal, modules and features) and the running platform version.
 * Plan changes and invoices happen in Meridian HQ, never here.
 */

import { useQuery } from "@tanstack/react-query";
import { Banner, Button, Chip, KeyValue, PageHeader, SectionCard, TableSkeleton, Tally } from "@/components/ui-core";
import { useAuth } from "@/context/auth-context";
import { useUpdateModal } from "@/context/update-modal-context";
import { getLicenceManifest } from "@/lib/api/licence";
import { getUpdateStatus } from "@/lib/api/system-update";
import { formatModuleName, formatDate, labelOf } from "@/lib/format";

const HREF = "/admin?tab=licence";

export function LicenceSurface() {
  const q = useQuery({ queryKey: ["licence.manifest"], queryFn: getLicenceManifest });
  const l = q.data;
  const modules = l?.enabled_modules ?? [];
  const all = modules.includes("*");
  const seats = l?.features?.max_users ?? 0;
  const features = Object.entries(l?.features ?? {}).filter(([, v]) => typeof v === "boolean") as [string, boolean][];
  const days = l?.days_remaining;
  return (
    <div className="ui-page">
      <PageHeader title="Licence" summary="Granted by Meridian HQ. Plan changes and invoices are managed there." />
      <Tally level={4} label="Licence" figures={[
        { label: "Tier", value: null, text: l?.tier ? labelOf(l.tier) : undefined, loading: q.isLoading, tone: l?.valid === false ? "danger" : l?.valid ? "success" : undefined, verdict: l?.valid ? "Licence is valid." : l?.valid === false ? "Licence is not valid." : "Not validated yet.", href: HREF },
        { label: "Seats", value: l && seats ? seats : null, text: l && !seats ? "Unlimited" : undefined, loading: q.isLoading, verdict: "Users this licence allows.", href: HREF },
        { label: "Modules", value: l && !all ? modules.length : null, text: l && all ? "All" : undefined, loading: q.isLoading, verdict: all ? "Every SAP module." : "Enabled on this licence.", href: HREF },
        { label: "Days remaining", value: l ? days ?? null : null, loading: q.isLoading, tone: days !== undefined && days < 30 ? "warning" : undefined, verdict: l?.expiry_date ? `Renews ${formatDate(l.expiry_date)}.` : days === undefined || days === null ? "Not validated yet." : "No renewal date set.", href: HREF },
      ]} />
      {l?.valid === false ? <Banner tone="danger" title="The licence is not valid">Meridian HQ reports status “{labelOf(l.status)}”. Renew it in Meridian HQ; this deployment keeps its data either way.</Banner> : null}
      {l?.valid === null && l?.status ? <Banner tone="info" title="Not validated yet">The deployment validates with Meridian HQ on a schedule; defaults apply until the next check.</Banner> : null}
      {q.isLoading ? <TableSkeleton rows={4} label="Reading the licence" /> : null}
      {l ? (
        <SectionCard title="Licence detail">
          <KeyValue rows={[
            { k: "Tenant", v: l.company_name ?? "Not set" }, { k: "Tier", v: l.tier ? labelOf(l.tier) : "Not validated yet" }, { k: "Status", v: labelOf(l.status) },
            { k: "Seats", v: seats ? String(seats) : "Unlimited" }, { k: "Renews", v: l.expiry_date ? formatDate(l.expiry_date) : "Not set" },
            { k: "Last validated", v: l.last_validated ? formatDate(l.last_validated, "datetime") : "Not validated yet" }, { k: "Language-model tier", v: l.llm_config ? `tier ${l.llm_config.tier}, ${l.llm_config.model}` : "Not set" },
          ]} />
        </SectionCard>
      ) : null}
      {l ? (
        <SectionCard title="Modules" meta={all ? "every SAP module" : `${modules.length} enabled`}>
          <div className="ui-form__actions">
            {all ? <Chip tone="success">all modules</Chip> : modules.map((m) => <Chip key={m} tone="success">{formatModuleName(m)}</Chip>)}
            {!all && !modules.length ? <p className="ui-note">{l.valid === null ? "Modules follow the licence once Meridian HQ has validated it." : "No modules enabled on this licence."}</p> : null}
          </div>
        </SectionCard>
      ) : null}
      {features.length ? (
        <SectionCard title="Features">
          <div className="ui-form__actions">{features.map(([k, v]) => <Chip key={k} tone={v ? "success" : "neutral"}>{k.replace(/_/g, " ")}{v ? "" : ", off"}</Chip>)}</div>
        </SectionCard>
      ) : null}
      <PlatformVersion />
    </div>
  );
}

/**
 * Running Meridian version and the update entry point. The status endpoint
 * is admin-only, so this renders nothing for other roles.
 */
export function PlatformVersion() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const { open } = useUpdateModal();
  const q = useQuery({ queryKey: ["system-update-status"], queryFn: getUpdateStatus, enabled: isAdmin, staleTime: 60_000 });
  if (!isAdmin) return null;
  const s = q.data;
  return (
    <SectionCard title="Platform version" action={s ? <Chip tone={s.update_available ? "warning" : "success"}>{s.update_available ? `${s.latest_version} available` : "up to date"}</Chip> : undefined}>
      {q.isLoading ? <p className="ui-note">Reading the running version.</p>
        : q.error || !s ? <Banner tone="warning" title="The update status could not be read">The update-status endpoint did not answer; the deployment itself is running.</Banner>
        : (
          <div className="ui-detail">
            <KeyValue rows={[{ k: "Running", v: s.current_version, mono: true }]} />
            {s.update_available && s.updater_configured ? <div className="ui-form__actions"><Button onClick={open}>View update {s.latest_version}</Button></div> : null}
            {s.update_available && !s.updater_configured ? (
              <p className="ui-note">Version {s.latest_version} is available, but the auto-update sidecar is not configured on this deployment. Update with update.sh or contact support.</p>
            ) : null}
          </div>
        )}
    </SectionCard>
  );
}
