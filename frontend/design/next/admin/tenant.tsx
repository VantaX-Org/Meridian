"use client";

import { useState, type ComponentType } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { formatDate } from "@/lib/format";
import * as api from "@/lib/api/v2/admin";
import { refreshAdmin, useBilling, useLicence, useUpdateStatus } from "@/lib/v2/admin-queries";
import { fixed, v2Locale } from "@/lib/v2/format";
import { t } from "@/lib/v2/i18n";
import { labelText, moduleText } from "@/lib/v2/labels";
import { V2Link } from "@/design/v2/parts";
import { Button, Chip, EmptyState, Skeleton } from "../kit";
import { Block, Field, Kv, Loaded, NeedsPermission, Note, OutcomeNote, Page, Status, useCan, useOutcome } from "./tenant-kit";
import { SettingsSection } from "./tenant-settings";

/** Admin licence: what the deployment is licensed for and whether Meridian HQ has confirmed it. Embedded drops page padding for use inside a sheet. */
export function LicenceSection({ embedded }: { embedded?: boolean } = {}) {
  const can = useCan();
  const qc = useQueryClient();
  const q = useLicence();
  const update = useUpdateStatus(can("manage_system"));
  const { outcome, pending, run } = useOutcome();
  const canValidate = can("manage_system");
  const refresh = () =>
    void run("validate", async () => {
      const l = await api.validateLicence();
      await refreshAdmin(qc, "licence");
      return l.valid === false
        ? { tone: "fail", title: t("Meridian HQ reports the licence is not valid"), detail: t("Status: {status}.", { status: labelText(l.status) }) }
        : { tone: "ok", title: t("Licence checked with Meridian HQ") };
    });
  return (
    <Page
      embedded={embedded}
      lead={t("What this deployment is licensed for. Plan changes and invoices are handled in Meridian HQ; this deployment keeps its data either way.")}
      actions={
        canValidate ? (
          <Button disabled={pending !== null} loading={pending === "validate"} loadingLabel={t("Checking…")} onClick={refresh}>
            {t("Check with Meridian HQ now")}
          </Button>
        ) : undefined
      }
    >
      <OutcomeNote outcome={outcome} />
      <Loaded q={q} what={t("The licence")} rows={5}>
        {(l) => {
          const modules = l.enabled_modules ?? [];
          const all = modules.includes("*");
          const seats = l.features?.max_users ?? l.seats ?? 0;
          const used = l.seats_used;
          const days = l.days_remaining;
          const notValidated = l.valid === null;
          const grace = l.status === "offline_grace" && l.offline_grace?.active ? l.offline_grace : null;
          const features = Object.entries(l.features ?? {}).filter(([, v]) => typeof v === "boolean") as [string, boolean][];
          return (
            <>
              {l.valid === false ? <Note tone="bad">{t("The licence is not valid. Meridian HQ reports status \"{status}\". Renew it in Meridian HQ; module entitlements may be restricted until then.", { status: labelText(l.status) })}</Note> : null}
              {grace ? (
                <Note tone={grace.days_left <= 3 ? "bad" : "warn"}>
                  {t("Offline: the last signed licence is honoured until {date} ({days} {days, plural, one {day} other {days}} left).", { date: formatDate(grace.ends_at), days: grace.days_left })}{" "}
                  {t("Meridian HQ could not be reached. Check that this server can reach the licence service (outbound HTTPS, proxy and firewall); the licence is confirmed again on the next successful check.")}
                </Note>
              ) : null}
              {notValidated ? <Note tone="warn">{t("This deployment has not checked its licence with Meridian HQ, so default entitlements apply: no module list, seat count or expiry. It also checks on a schedule.")}</Note> : null}
              {days != null && days < 30 ? <Note tone={days < 7 ? "bad" : "warn"}>{days <= 0 ? t("The licence has expired. Renew it in Meridian HQ.") : t("The licence expires in {days} {days, plural, one {day} other {days}}. Renew it in Meridian HQ before then; a renewal shows here after the next check.", { days })}</Note> : null}
              {seats && used != null && used / seats >= 0.75 ? <Note tone={used >= seats ? "bad" : "warn"}>{t("{used} of {seats} seats are in use. {value}", { used, seats, value: used >= seats ? t("A new invitation fails until a user is suspended or the licence grants more seats.") : t("Add seats in Meridian HQ before the team grows further.") })}</Note> : null}
              <Block title={t("Detail")}>
                <Kv
                  rows={[
                    [t("Company"), l.company_name ?? t("Not set")],
                    [t("Status"), grace ? <Status tone="at-risk">{t("Offline grace")}</Status> : l.valid === false ? <Status tone="no-go">{labelText(l.status)}</Status> : l.valid ? <Status tone="go">{t("Valid")}</Status> : <Status tone="at-risk">{t("Not validated yet")}</Status>],
                    [t("Tier"), l.tier ? labelText(l.tier) : t("Not validated yet")],
                    [t("Seats"), seats ? (used != null ? t("{used} of {seats} in use", { used, seats }) : String(seats)) : notValidated ? t("Not validated yet") : t("Unlimited")],
                    [t("Valid until"), l.expiry_date ? `${formatDate(l.expiry_date)}${days != null ? t(", {days} {days, plural, one {day} other {days}} left", { days }) : ""}` : t("Not set")],
                    ...(grace ? [[t("Last signed licence"), t("Signed {date}, honoured for {graceDays} {graceDays, plural, one {day} other {days}}", { date: formatDate(grace.signed_at, "datetime"), graceDays: grace.grace_days })] as [string, string]] : []),
                    [t("Last checked"), l.last_validated ? formatDate(l.last_validated, "datetime") : t("Not checked yet")],
                    [t("Platform version"), update.data ? <>{update.data.current_version}{update.data.update_available ? <>{", "}<V2Link href="/admin/system">{t("{latest_version} is available", { latest_version: update.data.latest_version })}</V2Link></> : t(" (up to date)")}</> : <V2Link href="/admin/system">{t("See Jobs and system update")}</V2Link>],
                  ]}
                />
              </Block>
              <Block title={t("Modules")} hint={all ? t("Every SAP module is licensed.") : t("{modulesCount} enabled", { modulesCount: modules.length })}>
                <ul className="nx-tn-tags" aria-label={t("Licensed modules")}>
                  {all ? (
                    <li>
                      <Chip>{t("All modules")}</Chip>
                    </li>
                  ) : (
                    modules.map((m) => (
                      <li key={m}>
                        <Chip>{moduleText(m)}</Chip>
                      </li>
                    ))
                  )}
                </ul>
                {!all && modules.length === 0 ? <p className="nx-sub">{notValidated ? t("Modules follow the licence once Meridian HQ has confirmed it.") : t("No module is enabled on this licence.")}</p> : null}
              </Block>
              {features.length ? (
                <Block title={t("Features")}>
                  <ul className="nx-tn-tags" aria-label={t("Licensed features")}>
                    {features.map(([k, v]) => (
                      <li key={k}>
                        <Chip tone={v ? "neutral" : "warn"}>{`${labelText(k)}${v ? "" : t(", off")}`}</Chip>
                      </li>
                    ))}
                  </ul>
                </Block>
              ) : null}
            </>
          );
        }}
      </Loaded>
    </Page>
  );
}

/** The licence section without page chrome, for the licence flow sheet. */
export function LicenceSectionNative() {
  return <LicenceSection embedded />;
}

const thisMonth = () => new Date().toISOString().slice(0, 7);
const money = (n: number, currency: string): string => {
  try {
    return new Intl.NumberFormat(v2Locale(), { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
  } catch {
    return `${currency} ${fixed(n, 2)}`;
  }
};

/** Admin billing: what resolved exceptions cost in a month, read only. Plan changes and invoices live in Meridian HQ. */
export function BillingSection() {
  const can = useCan();
  const allowed = can("manage_settings");
  const [period, setPeriod] = useState(thisMonth);
  const q = useBilling(period, allowed);
  if (!allowed)
    return (
      <Page>
        <NeedsPermission what={t("Reading billing")} permission="manage_settings" />
      </Page>
    );
  const b = q.data;
  return (
    <Page lead={t("Resolved exceptions by billing tier, on top of the base fee. Read only: the plan and the invoices are in Meridian HQ.")}>
      <div className="nx-tn-form">
        <Field label={t("Month")}>
          <input className="nx-input" type="month" value={period} max={thisMonth()} onChange={(e) => setPeriod(e.target.value)} />
        </Field>
      </div>
      {q.isError ? (
        <EmptyState heading={t("No billing figures for this month. Try an earlier month, or check back after the next billing run.")} action={<Button onClick={() => setPeriod(thisMonth())}>{t("Back to this month")}</Button>} />
      ) : !b ? (
        <Skeleton lines={4} label={t("Reading the month…")} />
      ) : (
        <>
          <Kv rows={[[t("Total"), <b key="t">{money(b.total_amount, b.currency)}</b>], [t("Meridian base fee"), money(b.base_fee, b.currency)], [t("Currency"), b.currency], [t("Invoice"), b.stripe_invoice_id ? t("Invoiced; the invoice is in Meridian HQ") : t("Not invoiced yet")]]} />
          <Block title={t("Resolved exceptions by tier")}>
            <table className="nx-table" aria-label={t("Billing by tier")}>
              <thead>
                <tr>
                  <th scope="col">{t("Tier")}</th>
                  <th scope="col" className="nx-tn-num">{t("Resolved")}</th>
                  <th scope="col" className="nx-tn-num">{t("Amount ({currency})", { currency: b.currency })}</th>
                </tr>
              </thead>
              <tbody>
                {([1, 2, 3, 4] as const).map((n) => (
                  <tr key={n}>
                    <th scope="row">{t("Tier {t}", { t: n })}</th>
                    <td className="nx-tn-num">{b[`tier${n}_count`]}</td>
                    <td className="nx-tn-num">{money(b[`tier${n}_amount`], b.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Block>
        </>
      )}
    </Page>
  );
}

/** Registry for Admin.tsx: slug to section. */
export const TENANT_SECTIONS: Record<string, ComponentType> = {
  licence: () => <LicenceSection />,
  billing: BillingSection,
  settings: SettingsSection,
};
