"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, ErrorState, Notice, PageHeader, Pill, Skeleton, toast } from "@/design";
import { SettingsSection, SettingsSheet } from "@/components/mdm/ledger";
import { useRole } from "@/hooks/use-role";
import { useUpdateModal } from "@/context/update-modal-context";
import { getLicenceManifest, validateLicence } from "@/lib/api/licence";
import { getUpdateStatus } from "@/lib/api/system-update";
import { apiErrorMessage } from "@/lib/error";
import { formatModuleName, formatDate, labelOf } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";

export default function AdminLicencePage() {
  const qc = useQueryClient();
  const canValidate = useRole().can("manage_system");
  const q = useQuery({ queryKey: queryKeys.licenceManifest(), queryFn: getLicenceManifest });
  const validate = useMutation({
    mutationFn: validateLicence,
    onSuccess: () => { toast.success("Licence checked with Meridian HQ"); void qc.invalidateQueries({ queryKey: queryKeys.licenceManifest() }); },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });
  const l = q.data;
  const modules = l?.enabled_modules ?? [];
  const all = modules.includes("*");
  const seats = l?.features?.max_users ?? 0;
  const features = Object.entries(l?.features ?? {}).filter(([, v]) => typeof v === "boolean") as [string, boolean][];
  const days = l?.days_remaining;
  // Seat use against the grant: a warning at 75% and 90%, danger when every seat is taken.
  const used = l?.seats_used;
  const usePct = seats && used != null ? used / seats : null;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Licence"
        meta="What this deployment is licensed for: objects, seats and features. Plan changes and invoices are handled in Meridian HQ"
        status={l?.valid === false ? <Pill tone="no-go">Not valid</Pill> : l?.valid ? <Pill tone="go">Valid</Pill> : undefined}
        actions={canValidate ? <Button variant="secondary" pending={validate.isPending} onClick={() => validate.mutate()}>Validate now</Button> : undefined}
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

      {days !== undefined && days !== null && days < 30 ? (
        <Notice tone={days < 7 ? "danger" : "warning"} title={days <= 0 ? "Expired" : `Expires in ${days.toLocaleString()} ${days === 1 ? "day" : "days"}`}>
          {days <= 0 ? "The licence has expired. Renew it in Meridian HQ; this deployment keeps its data either way." : "Renew it in Meridian HQ before then."} The deployment validates with Meridian HQ on a schedule, so a renewal shows here after the next check
        </Notice>
      ) : null}

      {usePct != null && usePct >= 0.75 ? (
        <Notice tone={usePct >= 1 ? "danger" : "warning"} title={`${used!.toLocaleString()} of ${seats.toLocaleString()} seats in use`}>
          {usePct >= 1 ? "Every seat is taken: a new invite fails until a user is removed or the licence grants more seats" : "Add seats in Meridian HQ before the team grows further, or remove users who no longer need access"}
        </Notice>
      ) : null}

      {q.isLoading ? <Skeleton height={120} /> : null}
      {q.isError ? (
        <ErrorState message={apiErrorMessage(q.error)} onRetry={() => q.refetch()} />
      ) : null}

      {l ? (
        <SettingsSheet>
          <SettingsSection title="Licence detail">
            <dl className="grid grid-cols-[160px_1fr] gap-y-1 m-text-body">
              <dt className="m-ink-3">Tenant</dt><dd>{l.company_name ?? "Not set"}</dd>
              <dt className="m-ink-3">Tier</dt><dd>{l.tier ? labelOf(l.tier) : "Not validated yet"}</dd>
              <dt className="m-ink-3">Status</dt><dd>{labelOf(l.status)}</dd>
              <dt className="m-ink-3">Seats</dt><dd>{seats ? (used != null ? `${used.toLocaleString()} of ${seats.toLocaleString()} in use` : seats.toLocaleString()) : l.valid === null ? "Not validated yet" : "Unlimited"}</dd>
              <dt className="m-ink-3">Days remaining</dt><dd className={days !== undefined && days !== null && days < 30 ? "[color:var(--m-medium)]" : undefined}>{days ?? "—"}</dd>
              <dt className="m-ink-3">Renews</dt><dd>{l.expiry_date ? formatDate(l.expiry_date) : "Not set"}</dd>
              <dt className="m-ink-3">Last validated</dt><dd>{l.last_validated ? formatDate(l.last_validated, "datetime") : "Not validated yet"}</dd>
              <dt className="m-ink-3">Language-model tier</dt><dd>{l.llm_config ? `tier ${l.llm_config.tier}, ${l.llm_config.model}` : "Not set"}</dd>
            </dl>
          </SettingsSection>

          <SettingsSection title="Modules" meta={all ? "Every SAP module" : `${modules.length} enabled`}>
            <div className="flex gap-2 flex-wrap">
              {all ? <Pill tone="go">All modules</Pill> : modules.map((m) => <Pill key={m} tone="go">{formatModuleName(m)}</Pill>)}
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
                  <Pill key={k} tone={v ? "go" : "neutral"}>{labelOf(k)}{v ? "" : ", off"}</Pill>
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
    <SettingsSection title="Platform version" meta={s ? <Pill tone={s.update_available ? "at-risk" : "go"}>{s.update_available ? `${s.latest_version} available` : "Up to date"}</Pill> : undefined}>
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
              Version {s.latest_version} is available, but automatic updates are not set up on this deployment. Ask your administrator to run the update script, or contact support
            </Notice>
          ) : null}
        </div>
      )}
    </SettingsSection>
  );
}
