"use client";

import { useQuery } from "@tanstack/react-query";
import { Banner, KeyValue, Metric, MetricStrip, PageHeader, SectionCard, StatusBadge, TableSkeleton } from "@/components/ui-core";
import { PlatformVersionCard } from "@/components/platform-version-card";
import { getLicenceManifest } from "@/lib/api/licence";
import { apiErrorMessage } from "@/lib/api/optional";
import { formatModuleName } from "@/lib/format";

const day = (iso: string) => new Date(iso).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" });

export default function SettingsLicencePage() {
  const { data, isLoading, error } = useQuery({ queryKey: ["licence.manifest"], queryFn: getLicenceManifest });

  if (isLoading) {
    return <div className="ui-page"><PageHeader title="Licence" /><TableSkeleton rows={6} label="Loading licence" /></div>;
  }
  if (error || !data) {
    return (
      <div className="ui-page">
        <PageHeader title="Licence" />
        <Banner tone="danger" title="Licence could not be read">{error ? apiErrorMessage(error) : "The server returned no licence."}</Banner>
      </div>
    );
  }

  const modules = data.enabled_modules ?? [];
  const seats = data.features?.max_users ?? 0;
  const days = data.days_remaining;
  const features = Object.entries(data.features ?? {}).filter(([, v]) => typeof v === "boolean") as [string, boolean][];
  const renewTone = days !== undefined && days < 30 ? "warning" : "default";

  return (
    <div className="ui-page">
      <PageHeader title="Licence"
        summary={<>{data.tier ?? "Unknown tier"}{data.expiry_date ? <>, renews {day(data.expiry_date)}</> : null}{days !== undefined ? <> ({days} days)</> : null}. Plan changes and invoices are handled in Meridian HQ.</>} />
      <MetricStrip label="Licence">
        <Metric label="Tier" value={data.tier ?? "—"} />
        <Metric label="Seats" value={seats || "Unlimited"} />
        <Metric label="Modules" value={modules.length} />
        <Metric label="Days to renewal" value={days ?? "—"} tone={renewTone} />
      </MetricStrip>
      <div className="ui-columns">
        <div className="ui-stack">
          <SectionCard title="Detail">
            <KeyValue rows={[
              { k: "Status", v: <StatusBadge status={data.valid ? "ok" : data.valid === false ? "failed" : "idle"}>{data.valid ? "Valid" : data.valid === false ? "Not valid" : "Not checked"}</StatusBadge> },
              { k: "Licensed to", v: data.company_name ?? "—" },
              { k: "Tier", v: data.tier ?? "—" },
              { k: "Seats", v: seats || "Unlimited" },
              { k: "Renews", v: data.expiry_date ? day(data.expiry_date) : "—" },
              { k: "Last validated", v: data.last_validated ? new Date(data.last_validated).toLocaleString("en-ZA") : "—" },
            ]} />
          </SectionCard>
          <PlatformVersionCard />
        </div>
        <div className="ui-stack">
          <SectionCard title="Modules" meta={`${modules.length} enabled`}>
            {modules.length ? (
              <ul className="ui-plain-list">
                {modules.map((m) => <li key={m}>{m === "*" ? "All modules" : formatModuleName(m)}</li>)}
              </ul>
            ) : <p className="ui-note">No modules are enabled on this licence.</p>}
          </SectionCard>
          {features.length ? (
            <SectionCard title="Features">
              <table className="ui-mini-table">
                <tbody>
                  {features.map(([k, v]) => (
                    <tr key={k}><td>{k.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase())}</td><td>{v ? "Included" : "Not included"}</td></tr>
                  ))}
                </tbody>
              </table>
            </SectionCard>
          ) : null}
        </div>
      </div>
    </div>
  );
}
