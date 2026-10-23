"use client";

import { useQuery } from "@tanstack/react-query";
import { Button, ErrorState, Notice, PageHeader, Pill, Skeleton } from "@/design";
import { SettingsSection, SettingsSheet } from "@/components/mdm/ledger";
import { useRole } from "@/hooks/use-role";
import { useUpdateModal } from "@/context/update-modal-context";
import { getLicenceManifest } from "@/lib/api/licence";
import { getUpdateStatus } from "@/lib/api/system-update";
import { apiErrorMessage } from "@/lib/error";
import { formatModuleName, formatDate, labelOf } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";

export default function AdminLicencePage() {
  const q = useQuery({ queryKey: queryKeys.licenceManifest(), queryFn: getLicenceManifest });
  const l = q.data;
  const modules = l?.enabled_modules ?? [];
  const all = modules.includes("*");
  const seats = l?.features?.max_users ?? 0;
  const features = Object.entries(l?.features ?? {}).filter(([, v]) => typeof v === "boolean") as [string, boolean][];
  const days = l?.days_remaining;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Licence"
        meta="Granted by Meridian HQ; plan changes and invoices are managed there"
        status={l?.valid === false ? <Pill tone="no-go">Not valid</Pill> : l?.valid ? <Pill tone="go">Valid</Pill> : undefined}
      />

      {l?.valid === false ? (
        <Notice tone="danger">
          The licence is not valid. Meridian HQ reports status &ldquo;{labelOf(l.status)}&rdquo;. Renew it in Meridian HQ; this deployment keeps its data either way
        </Notice>
      ) : null}
      {l?.valid === null && l?.status ? (
        <Notice tone="info">
          Not validated yet: the deployment validates with Meridian HQ on a schedule; defaults apply until the next check
        </Notice>
      ) : null}

      {q.isLoading ? <Skeleton height={120} /> : null}
      {q.isError ? (
        <ErrorState message={apiErrorMessage(q.error) || "The licence could not be read"} onRetry={() => q.refetch()} />
      ) : null}

      {l ? (
        <SettingsSheet>
          <SettingsSection title="Licence detail">
            <dl className="grid grid-cols-[160px_1fr] gap-y-1 m-text-body">
              <dt className="m-ink-3">Tenant</dt><dd>{l.company_name ?? "Not set"}</dd>
              <dt className="m-ink-3">Tier</dt><dd>{l.tier ? labelOf(l.tier) : "Not validated yet"}</dd>
              <dt className="m-ink-3">Status</dt><dd>{labelOf(l.status)}</dd>
              <dt className="m-ink-3">Seats</dt><dd>{seats ? String(seats) : "Unlimited"}</dd>
              <dt className="m-ink-3">Days remaining</dt><dd className={days !== undefined && days !== null && days < 30 ? "[color:var(--m-medium)]" : undefined}>{days ?? "—"}</dd>
              <dt className="m-ink-3">Renews</dt><dd>{l.expiry_date ? formatDate(l.expiry_date) : "Not set"}</dd>
              <dt className="m-ink-3">Last validated</dt><dd>{l.last_validated ? formatDate(l.last_validated, "datetime") : "Not validated yet"}</dd>
              <dt className="m-ink-3">Language-model tier</dt><dd>{l.llm_config ? `tier ${l.llm_config.tier}, ${l.llm_config.model}` : "Not set"}</dd>
            </dl>
          </SettingsSection>

          <SettingsSection title="Modules" meta={all ? "every SAP module" : `${modules.length} enabled`}>
            <div className="flex gap-2 flex-wrap">
              {all ? <Pill tone="go">all modules</Pill> : modules.map((m) => <Pill key={m} tone="go">{formatModuleName(m)}</Pill>)}
              {!all && !modules.length ? (
                <p className="m-text-body m-ink-3">
                  {l.valid === null ? "Modules follow the licence once Meridian HQ has validated it." : "No modules enabled on this licence"}
                </p>
              ) : null}
            </div>
          </SettingsSection>

          {features.length ? (
            <SettingsSection title="Features">
              <div className="flex gap-2 flex-wrap">
                {features.map(([k, v]) => (
                  <Pill key={k} tone={v ? "go" : "neutral"}>{k.replace(/_/g, " ")}{v ? "" : ", off"}</Pill>
                ))}
              </div>
            </SettingsSection>
          ) : null}

          <PlatformVersion />
        </SettingsSheet>
      ) : null}
    </div>
  );
}

function PlatformVersion() {
  const isAdmin = useRole().can("manage_system");
  const { open } = useUpdateModal();
  const q = useQuery({ queryKey: queryKeys.systemUpdateStatus(), queryFn: getUpdateStatus, enabled: isAdmin, staleTime: 60_000 });
  if (!isAdmin) return null;
  const s = q.data;
  return (
    <SettingsSection title="Platform version" meta={s ? <Pill tone={s.update_available ? "at-risk" : "go"}>{s.update_available ? `${s.latest_version} available` : "up to date"}</Pill> : undefined}>
      {q.isLoading ? (
        <Skeleton height={48} />
      ) : q.isError || !s ? (
        <ErrorState message="The update status could not be read. The deployment itself is running" onRetry={() => q.refetch()} />
      ) : (
        <div className="flex flex-col gap-2">
          <dl className="grid grid-cols-[160px_1fr] gap-y-1 m-text-body">
            <dt className="m-ink-3">Running</dt><dd className="font-mono">{s.current_version}</dd>
          </dl>
          {s.update_available && s.updater_configured ? (
            <div><Button onClick={open}>View update {s.latest_version}</Button></div>
          ) : null}
          {s.update_available && !s.updater_configured ? (
            <Notice tone="warning">
              Version {s.latest_version} is available, but the auto-update sidecar is not configured on this deployment. Update with update.sh or contact support
            </Notice>
          ) : null}
        </div>
      )}
    </SettingsSection>
  );
}
