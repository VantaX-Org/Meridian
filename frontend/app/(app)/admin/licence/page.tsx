"use client";

import { useQuery } from "@tanstack/react-query";
import { Button, Pill, Skeleton } from "@/design";
import { useAuth } from "@/context/auth-context";
import { useUpdateModal } from "@/context/update-modal-context";
import { getLicenceManifest } from "@/lib/api/licence";
import { getUpdateStatus } from "@/lib/api/system-update";
import { apiErrorMessage } from "@/lib/api/optional";
import { formatModuleName, formatDate, labelOf } from "@/lib/format";

export default function AdminLicencePage() {
  const q = useQuery({ queryKey: ["licence.manifest"], queryFn: getLicenceManifest });
  const l = q.data;
  const modules = l?.enabled_modules ?? [];
  const all = modules.includes("*");
  const seats = l?.features?.max_users ?? 0;
  const features = Object.entries(l?.features ?? {}).filter(([, v]) => typeof v === "boolean") as [string, boolean][];
  const days = l?.days_remaining;

  return (
    <div className="flex flex-col gap-6 p-6">
      <header>
        <strong className="text-[17px]">Licence</strong>
        <p className="text-[13px]" style={{ color: "var(--m-ink-3)" }}>
          Granted by Meridian HQ. Plan changes and invoices are managed there.
        </p>
      </header>

      <div className="flex gap-4 flex-wrap">
        <div className="flex flex-col gap-1">
          <span className="text-[12px]" style={{ color: "var(--m-ink-3)" }}>Tier</span>
          <span className="text-[18px] font-semibold">{q.isLoading ? "–" : l?.tier ? labelOf(l.tier) : "Not validated yet"}</span>
          <span className="text-[12px]" style={{ color: l?.valid === false ? "var(--m-critical)" : "var(--m-ink-3)" }}>
            {l?.valid ? "Licence is valid." : l?.valid === false ? "Licence is not valid." : "Not validated yet."}
          </span>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[12px]" style={{ color: "var(--m-ink-3)" }}>Seats</span>
          <span className="text-[18px] font-semibold">{q.isLoading ? "–" : seats ? seats : "Unlimited"}</span>
          <span className="text-[12px]" style={{ color: "var(--m-ink-3)" }}>Users this licence allows.</span>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[12px]" style={{ color: "var(--m-ink-3)" }}>Modules</span>
          <span className="text-[18px] font-semibold">{q.isLoading ? "–" : all ? "All" : modules.length}</span>
          <span className="text-[12px]" style={{ color: "var(--m-ink-3)" }}>{all ? "Every SAP module." : "Enabled on this licence."}</span>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[12px]" style={{ color: "var(--m-ink-3)" }}>Days remaining</span>
          <span className="text-[18px] font-semibold" style={{ color: days !== undefined && days < 30 ? "var(--m-medium)" : undefined }}>
            {q.isLoading ? "–" : l ? days ?? "—" : "—"}
          </span>
          <span className="text-[12px]" style={{ color: "var(--m-ink-3)" }}>
            {l?.expiry_date ? `Renews ${formatDate(l.expiry_date)}.` : days === undefined || days === null ? "Not validated yet." : "No renewal date set."}
          </span>
        </div>
      </div>

      {l?.valid === false ? (
        <div role="alert" className="text-[13px] rounded border p-3" style={{ borderColor: "var(--m-critical)", color: "var(--m-critical)" }}>
          The licence is not valid. Meridian HQ reports status &ldquo;{labelOf(l.status)}&rdquo;. Renew it in Meridian HQ; this deployment keeps its data either way.
        </div>
      ) : null}
      {l?.valid === null && l?.status ? (
        <div className="text-[13px] rounded border p-3" style={{ borderColor: "var(--m-line)", color: "var(--m-ink-3)" }}>
          Not validated yet. The deployment validates with Meridian HQ on a schedule; defaults apply until the next check.
        </div>
      ) : null}

      {q.isLoading ? <Skeleton height={120} /> : null}
      {q.error ? (
        <div role="alert" className="text-[13px]" style={{ color: "var(--m-critical)" }}>
          The licence could not be read. {apiErrorMessage(q.error)}
        </div>
      ) : null}

      {l ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-[13px] font-semibold">Licence detail</h2>
          <dl className="grid grid-cols-[160px_1fr] gap-y-1 text-[13px]">
            <dt style={{ color: "var(--m-ink-3)" }}>Tenant</dt><dd>{l.company_name ?? "Not set"}</dd>
            <dt style={{ color: "var(--m-ink-3)" }}>Tier</dt><dd>{l.tier ? labelOf(l.tier) : "Not validated yet"}</dd>
            <dt style={{ color: "var(--m-ink-3)" }}>Status</dt><dd>{labelOf(l.status)}</dd>
            <dt style={{ color: "var(--m-ink-3)" }}>Seats</dt><dd>{seats ? String(seats) : "Unlimited"}</dd>
            <dt style={{ color: "var(--m-ink-3)" }}>Renews</dt><dd>{l.expiry_date ? formatDate(l.expiry_date) : "Not set"}</dd>
            <dt style={{ color: "var(--m-ink-3)" }}>Last validated</dt><dd>{l.last_validated ? formatDate(l.last_validated, "datetime") : "Not validated yet"}</dd>
            <dt style={{ color: "var(--m-ink-3)" }}>Language-model tier</dt><dd>{l.llm_config ? `tier ${l.llm_config.tier}, ${l.llm_config.model}` : "Not set"}</dd>
          </dl>
        </section>
      ) : null}

      {l ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-[13px] font-semibold">Modules <span className="text-[12px] font-normal" style={{ color: "var(--m-ink-3)" }}>{all ? "every SAP module" : `${modules.length} enabled`}</span></h2>
          <div className="flex gap-2 flex-wrap">
            {all ? <Pill tone="go">all modules</Pill> : modules.map((m) => <Pill key={m} tone="go">{formatModuleName(m)}</Pill>)}
            {!all && !modules.length ? (
              <p className="text-[13px]" style={{ color: "var(--m-ink-3)" }}>
                {l.valid === null ? "Modules follow the licence once Meridian HQ has validated it." : "No modules enabled on this licence."}
              </p>
            ) : null}
          </div>
        </section>
      ) : null}

      {features.length ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-[13px] font-semibold">Features</h2>
          <div className="flex gap-2 flex-wrap">
            {features.map(([k, v]) => (
              <Pill key={k} tone={v ? "go" : "neutral"}>{k.replace(/_/g, " ")}{v ? "" : ", off"}</Pill>
            ))}
          </div>
        </section>
      ) : null}

      <PlatformVersion />
    </div>
  );
}

function PlatformVersion() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const { open } = useUpdateModal();
  const q = useQuery({ queryKey: ["system-update-status"], queryFn: getUpdateStatus, enabled: isAdmin, staleTime: 60_000 });
  if (!isAdmin) return null;
  const s = q.data;
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-[13px] font-semibold flex items-center gap-2">
        Platform version
        {s ? <Pill tone={s.update_available ? "at-risk" : "go"}>{s.update_available ? `${s.latest_version} available` : "up to date"}</Pill> : null}
      </h2>
      {q.isLoading ? (
        <p className="text-[13px]" style={{ color: "var(--m-ink-3)" }}>Reading the running version.</p>
      ) : q.error || !s ? (
        <div className="text-[13px] rounded border p-3" style={{ borderColor: "var(--m-medium)", color: "var(--m-medium)" }}>
          The update status could not be read. The update-status endpoint did not answer; the deployment itself is running.
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <dl className="grid grid-cols-[160px_1fr] gap-y-1 text-[13px]">
            <dt style={{ color: "var(--m-ink-3)" }}>Running</dt><dd className="font-mono">{s.current_version}</dd>
          </dl>
          {s.update_available && s.updater_configured ? (
            <div><Button onClick={open}>View update {s.latest_version}</Button></div>
          ) : null}
          {s.update_available && !s.updater_configured ? (
            <p className="text-[13px]" style={{ color: "var(--m-ink-3)" }}>
              Version {s.latest_version} is available, but the auto-update sidecar is not configured on this deployment. Update with update.sh or contact support.
            </p>
          ) : null}
        </div>
      )}
    </section>
  );
}
