"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Button, ErrorState, Pill } from "@/design";
import { useRole } from "@/hooks/use-role";
import { getDoctor, type DoctorItem } from "@/lib/api/admin-doctor";
import { getLicenceManifest } from "@/lib/api/licence";
import { apiErrorMessage } from "@/lib/error";
import { formatDate, labelOf, humanizeIds } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";
import { AlertChannelsPanel } from "./alert-channels-panel";

// ponytail: FIX_HREF kept local to this page (only consumer); legacy version lived in
// the legacy admin surface, pointing at hash-tab routes (/admin?tab=ai, /admin?tab=licence)
// which no longer exist — updated to the real standalone pages built in Task 15.
const FIX_HREF: Record<string, string> = { llm: "/admin/ai", licence: "/admin/licence" };
const doctorLabel = (s: string) => s.replace(/\s*\(\s*\)/g, "").trim();
const doctorDetail = (s: string) => humanizeIds(s
  .replace(/no api key\s*[-—]\s*AI features degrade/i, "No API key stored. AI features are reduced.")
  .replace(/api key present/i, "API key stored")
  .replace(/^expires (\S+)$/, (_m, d) => `Expires ${formatDate(d)}`)
  .replace(/^licence cache empty$/i, "Not validated yet"));
const DOCTOR_TONE: Record<DoctorItem["status"], "go" | "at-risk" | "no-go"> = { ok: "go", warn: "at-risk", fail: "no-go" };

export default function AdminSettingsPage() {
  const { can } = useRole();
  const licence = useQuery({ queryKey: queryKeys.licenceManifest(), queryFn: getLicenceManifest });
  const doctor = useQuery({ queryKey: queryKeys.adminDoctor(), queryFn: getDoctor, enabled: can("manage_system"), refetchInterval: 30_000 });
  const l = licence.data;

  if (licence.isError) {
    return (
      <div className="flex flex-col gap-6 p-6">
        <ErrorState message={apiErrorMessage(licence.error) || "The licence could not be read."} onRetry={() => licence.refetch()} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <header>
        <strong className="text-[17px]">Settings</strong>
        <p className="text-[13px]" style={{ color: "var(--m-ink-3)" }}>
          The way into each setting, and whether this deployment is healthy.
        </p>
      </header>

      {l?.valid === false ? (
        <div role="alert" className="text-[13px] rounded border p-3" style={{ borderColor: "var(--m-critical)", color: "var(--m-critical)" }}>
          The licence is not valid. Meridian HQ reports status &ldquo;{labelOf(l.status)}&rdquo;. Analyses still run; module entitlements may be restricted until the licence is renewed.
        </div>
      ) : null}

      <section className="flex flex-col gap-2">
        <h2 className="text-[13px] font-semibold">Deployment</h2>
        <dl className="grid grid-cols-[160px_1fr] gap-y-1 text-[13px]">
          <dt style={{ color: "var(--m-ink-3)" }}>Tenant</dt><dd>{l?.company_name ?? "Not set"}</dd>
          <dt style={{ color: "var(--m-ink-3)" }}>Licence tier</dt><dd>{l?.tier ? labelOf(l.tier) : "Not validated yet"}</dd>
          <dt style={{ color: "var(--m-ink-3)" }}>Licence status</dt><dd>{l ? labelOf(l.status) : "Loading"}</dd>
          <dt style={{ color: "var(--m-ink-3)" }}>Language model</dt><dd>{l?.llm_config ? `${l.llm_config.model}, tier ${l.llm_config.tier}` : "Not configured"}</dd>
        </dl>
      </section>

      {can("manage_settings") ? <AlertChannelsPanel /> : null}

      {can("manage_system") && doctor.isError ? (
        <ErrorState message={apiErrorMessage(doctor.error) || "Health checks could not be read."} onRetry={() => doctor.refetch()} />
      ) : null}
      {can("manage_system") && doctor.data ? (
        <section className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <h2 className="text-[13px] font-semibold">Health checks</h2>
            <span className="text-[12px]" style={{ color: "var(--m-ink-3)" }}>Last checked {formatDate(doctor.data.last_checked, "datetime")}</span>
          </div>
          {(() => {
            const items = doctor.data.items;
            const warn = items.filter((i) => i.status === "warn").length;
            const fail = items.filter((i) => i.status === "fail").length;
            const ok = items.length - warn - fail;
            return (
              <p className="text-[13px]" role="status">
                {ok} passing{warn ? `, ${warn} warning` : ""}{fail ? `, ${fail} failing` : ""}
              </p>
            );
          })()}
          <ul className="flex flex-col gap-2">
            {doctor.data.items.map((i) => (
              <li key={i.id} className="flex items-center gap-3">
                <Pill tone={DOCTOR_TONE[i.status]}>{doctorLabel(i.label)}</Pill>
                {i.detail ? <span className="text-[12px]" style={{ color: "var(--m-ink-3)" }}>{doctorDetail(i.detail)}</span> : null}
                {i.status !== "ok" && FIX_HREF[i.id] ? (
                  <Link href={FIX_HREF[i.id]} className="text-[12px] underline" style={{ color: "var(--m-accent)" }}>Fix</Link>
                ) : null}
              </li>
            ))}
          </ul>
          <div><Button variant="ghost" onClick={() => doctor.refetch()}>Check again</Button></div>
        </section>
      ) : null}
    </div>
  );
}
