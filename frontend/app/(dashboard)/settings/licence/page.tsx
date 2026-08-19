"use client";

import { useQuery } from "@tanstack/react-query";
import { PageHead, KPI, SectionHeader, StatusDot } from "@/components/meridian/atoms";
import { Skeleton } from "@/components/ui/skeleton";
import { getLicenceManifest } from "@/lib/api/licence";
import { PlatformVersionCard } from "@/components/platform-version-card";

export default function SettingsLicencePage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["licence.manifest"],
    queryFn: getLicenceManifest,
  });

  if (isLoading) {
    return (
      <>
        <PageHead title="Licence" route="Settings · /settings/licence" sub="Loading…" />
        <Skeleton className="h-[420px] rounded-[10px]" />
      </>
    );
  }
  if (error || !data) {
    return (
      <>
        <PageHead title="Licence" route="Settings · /settings/licence" sub="Failed to load." />
        <div className="mn-card mn-card-pad" style={{ color: "var(--mn-neg)" }}>
          Could not reach <code>/api/v1/licence</code>.
        </div>
      </>
    );
  }

  const licence = data;
  const enabledModules = licence.enabled_modules ?? [];
  const seatsMax = licence.features?.max_users ?? 0;

  return (
    <>
      <PageHead
        title="Licence"
        route="Settings · /settings/licence"
        sub={
          <>
            <strong style={{ color: "var(--mn-ink-700)" }}>{licence.tier ?? "—"}</strong>
            {licence.expiry_date && (
              <>
                {" "}· renews{" "}
                <span style={{ font: "500 12px/1 'JetBrains Mono', monospace", color: "var(--mn-ink-500)" }}>
                  {licence.expiry_date}
                </span>
              </>
            )}
            {licence.days_remaining !== undefined && (
              <>
                {" "}({licence.days_remaining} days remaining)
              </>
            )}
            .
          </>
        }
      />

      <div className="mn-row mn-stagger" style={{ gridTemplateColumns: "repeat(4, minmax(0, 1fr))", marginBottom: 18 }}>
        <KPI label="Tier" value={licence.tier ?? "—"} hint={licence.company_name ?? "—"} />
        <KPI label="Max seats" value={seatsMax || "∞"} />
        <KPI label="Modules" value={enabledModules.length} />
        <KPI
          label="Renews"
          value={licence.expiry_date ?? "—"}
          hint={licence.days_remaining !== undefined ? `${licence.days_remaining} days` : ""}
          tone={licence.valid ? "pos" : undefined}
        />
      </div>

      <div className="mn-row mn-row-12">
        <div className="mn-col-5" style={{ gridColumn: "span 5" }}>
          <div className="mn-card mn-card-pad">
            <SectionHeader title="Licence detail" caption="Tier, seats, renewal" />
            <div className="mn-row" style={{ gridTemplateColumns: "1fr 1fr", gap: 14, marginTop: 12 }}>
              <div><div className="mn-eyebrow">Tier</div><div className="mn-licence v">{licence.tier ?? "—"}</div></div>
              <div><div className="mn-eyebrow">Tenant</div><div className="mn-licence v">{licence.company_name ?? "—"}</div></div>
              <div><div className="mn-eyebrow">Seats</div><div className="mn-licence v mn-tabular">{seatsMax || "∞"}</div></div>
              <div><div className="mn-eyebrow">Renews</div><div className="mn-licence v mn-tabular">{licence.expiry_date ?? "—"}</div></div>
              <div>
                <div className="mn-eyebrow">Status</div>
                <div className="mn-licence v">
                  <StatusDot status={licence.valid ? "healthy" : licence.valid === false ? "down" : "scheduled"} />
                </div>
              </div>
              <div>
                <div className="mn-eyebrow">Last validated</div>
                <div className="mn-licence v mn-tabular">{licence.last_validated ?? "—"}</div>
              </div>
            </div>
            <p style={{ marginTop: 16, fontSize: 11.5, color: "var(--mn-ink-400)" }}>
              Plan changes and invoices are managed centrally in Meridian HQ.
            </p>
          </div>
        </div>

        <div className="mn-col-7" style={{ gridColumn: "span 7" }}>
          <div className="mn-card mn-card-pad">
            <SectionHeader title="Modules" caption="SAP modules enabled on this licence" />
            <div className="mn-modlist">
              {enabledModules.map((name) => (
                <div key={name} className="mn-modrow">
                  <span style={{ fontWeight: 500, color: "var(--mn-ink-900)", textTransform: "capitalize" }}>
                    {name.replace(/_/g, " ")}
                  </span>
                  <span className="mn-toggle on" aria-hidden>
                    <span className="thumb" />
                  </span>
                </div>
              ))}
              {enabledModules.length === 0 && (
                <div style={{ color: "var(--mn-ink-400)", padding: 8 }}>No modules enabled.</div>
              )}
            </div>
            {licence.features && (
              <div style={{ marginTop: 18 }}>
                <div className="mn-eyebrow">Features</div>
                <div className="mn-chip-row" style={{ marginTop: 8 }}>
                  {Object.entries(licence.features)
                    .filter(([, v]) => typeof v === "boolean")
                    .map(([k, v]) => (
                      <span
                        key={k}
                        style={{
                          display: "inline-flex",
                          padding: "3px 8px",
                          borderRadius: 4,
                          background: v ? "var(--mn-pos-bg)" : "rgba(15,23,42,0.06)",
                          color: v ? "var(--mn-pos)" : "var(--mn-ink-500)",
                          font: "600 11px/1 'JetBrains Mono', monospace",
                          letterSpacing: "0.04em",
                        }}
                      >
                        {v ? "✓ " : ""}
                        {k.replace(/_/g, " ")}
                      </span>
                    ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <PlatformVersionCard />
    </>
  );
}
