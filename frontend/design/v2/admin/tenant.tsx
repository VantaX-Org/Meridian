"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { formatDate } from "@/lib/format";
import * as api from "@/lib/api/v2/admin";
import { refreshAdmin, useBilling, useLicence, useUpdateStatus } from "@/lib/v2/admin-queries";
import { fixed, v2Locale } from "@/lib/v2/format";
import { V2Link } from "../parts";
import { ResultFrame, useOutcome } from "../inspector/shared";
import { AdminPage, Block, Fld, Kv, Loaded, NeedsPermission, Note, StatusWord, useCan } from "./kit";
import { t as tr } from "@/lib/v2/i18n";
import { labelText, moduleText } from "@/lib/v2/labels";

/** Admin › Licence: what the deployment is licensed for and whether Meridian HQ has confirmed it. */
export function LicenceSection() {
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
      return { tone: l.valid === false ? "fail" : "ok", title: l.valid === false ? tr("Meridian HQ reports the licence is not valid") : tr("Licence checked with Meridian HQ"), detail: l.valid === false ? tr("Status: {status}.", { status: labelText(l.status) }) : undefined };
    });
  return (
    <AdminPage
      title={tr("Licence")}
      lead={tr("What this deployment is licensed for. Plan changes and invoices are handled in Meridian HQ; this deployment keeps its data either way.")}
      actions={
        canValidate ? (
          <button type="button" className="m2-btn" disabled={pending !== null} onClick={refresh}>
            {pending === "validate" ? tr("Checking…") : tr("Check with Meridian HQ now")}
          </button>
        ) : undefined
      }
    >
      {outcome ? <ResultFrame outcome={outcome} /> : null}
      <Loaded q={q} what={tr("The licence")} rows={5}>
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
              {l.valid === false ? <Note tone="bad">{tr("The licence is not valid. Meridian HQ reports status \"{status}\". Renew it in Meridian HQ; module entitlements may be restricted until then.", { status: labelText(l.status) })}</Note> : null}
              {grace ? (
                <Note tone={grace.days_left <= 3 ? "bad" : "warn"}>
                  {tr("Offline: the last signed licence is honoured until {date} ({days} {days, plural, one {day} other {days}} left).", { date: formatDate(grace.ends_at), days: grace.days_left })}{" "}
                  {tr("Meridian HQ could not be reached. Check that this server can reach the licence service (outbound HTTPS, proxy and firewall); the licence is confirmed again on the next successful check.")}
                </Note>
              ) : null}
              {notValidated ? <Note tone="warn">{tr("This deployment has not checked its licence with Meridian HQ, so default entitlements apply: no module list, seat count or expiry. It also checks on a schedule.")}</Note> : null}
              {days != null && days < 30 ? <Note tone={days < 7 ? "bad" : "warn"}>{days <= 0 ? tr("The licence has expired. Renew it in Meridian HQ.") : tr("The licence expires in {days} {days, plural, one {day} other {days}}. Renew it in Meridian HQ before then; a renewal shows here after the next check.", { days })}</Note> : null}
              {seats && used != null && used / seats >= 0.75 ? <Note tone={used >= seats ? "bad" : "warn"}>{tr("{used} of {seats} seats are in use. {value}", { used, seats, value: used >= seats ? tr("A new invitation fails until a user is suspended or the licence grants more seats.") : tr("Add seats in Meridian HQ before the team grows further.") })}</Note> : null}
              <Block title={tr("Detail")}>
                <Kv
                  rows={[
                    [tr("Company"), l.company_name ?? tr("Not set")],
                    [tr("Status"), grace ? <StatusWord tone="at-risk">{tr("Offline grace")}</StatusWord> : l.valid === false ? <StatusWord tone="no-go">{labelText(l.status)}</StatusWord> : l.valid ? <StatusWord tone="go">{tr("Valid")}</StatusWord> : <StatusWord tone="at-risk">{tr("Not validated yet")}</StatusWord>],
                    [tr("Tier"), l.tier ? labelText(l.tier) : tr("Not validated yet")],
                    [tr("Seats"), seats ? (used != null ? tr("{used} of {seats} in use", { used, seats }) : String(seats)) : notValidated ? tr("Not validated yet") : tr("Unlimited")],
                    [tr("Valid until"), l.expiry_date ? `${formatDate(l.expiry_date)}${days != null ? tr(", {days} {days, plural, one {day} other {days}} left", { days }) : ""}` : tr("Not set")],
                    ...(grace ? [[tr("Last signed licence"), tr("Signed {date}, honoured for {graceDays} {graceDays, plural, one {day} other {days}}", { date: formatDate(grace.signed_at, "datetime"), graceDays: grace.grace_days })] as [string, string]] : []),
                    [tr("Last checked"), l.last_validated ? formatDate(l.last_validated, "datetime") : tr("Not checked yet")],
                    [tr("Platform version"), update.data ? <>{update.data.current_version}{update.data.update_available ? <>{", "}<V2Link href="/admin/system">{tr("{latest_version} is available", { latest_version: update.data.latest_version })}</V2Link></> : tr(" (up to date)")}</> : <V2Link href="/admin/system">{tr("See Jobs and system update")}</V2Link>],
                  ]}
                />
              </Block>
              <Block title={tr("Modules")} hint={all ? tr("Every SAP module is licensed.") : tr("{modulesCount} enabled", { modulesCount: modules.length })}>
                <ul className="m2-tags" aria-label={tr("Licensed modules")}>
                  {all ? <li>{tr("All modules")}</li> : modules.map((m) => <li key={m}>{moduleText(m)}</li>)}
                </ul>
                {!all && modules.length === 0 ? <p className="m2-prov">{notValidated ? tr("Modules follow the licence once Meridian HQ has confirmed it.") : tr("No module is enabled on this licence.")}</p> : null}
              </Block>
              {features.length ? (
                <Block title={tr("Features")}>
                  <ul className="m2-tags" aria-label={tr("Licensed features")}>
                    {features.map(([k, v]) => (
                      <li key={k}>{`${labelText(k)}${v ? "" : tr(", off")}`}</li>
                    ))}
                  </ul>
                </Block>
              ) : null}
            </>
          );
        }}
      </Loaded>
    </AdminPage>
  );
}

const thisMonth = () => new Date().toISOString().slice(0, 7);
const money = (n: number, currency: string): string => {
  try {
    return new Intl.NumberFormat(v2Locale(), { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
  } catch {
    return `${currency} ${fixed(n, 2)}`;
  }
};

/** Admin › Billing: what resolved exceptions cost in a month, read only. Plan changes and invoices live in Meridian HQ. */
export function BillingSection() {
  const can = useCan();
  const allowed = can("manage_settings");
  const [period, setPeriod] = useState(thisMonth);
  const q = useBilling(period, allowed);
  if (!allowed) return <AdminPage title={tr("Billing")}><NeedsPermission what={tr("Reading billing")} permission="manage_settings" /></AdminPage>;
  const b = q.data;
  return (
    <AdminPage title={tr("Billing")} lead={tr("Resolved exceptions by billing tier, on top of the base fee. Read only: the plan and the invoices are in Meridian HQ.")}>
      <div className="m2-fbar">
        <Fld label={tr("Month")}>
          <input type="month" value={period} max={thisMonth()} onChange={(e) => setPeriod(e.target.value)} />
        </Fld>
      </div>
      {q.isError ? (
        <div className="m2-empty">
          <p>{tr("No billing figures for this month. Try an earlier month, or check back after the next billing run.")}</p>
          <button type="button" className="m2-btn" onClick={() => setPeriod(thisMonth())}>
            {tr("Back to this month")}
          </button>
        </div>
      ) : !b ? (
        <p className="m2-prov" aria-busy="true">{tr("Reading the month…")}</p>
      ) : (
        <>
          <Kv rows={[[tr("Total"), <b key="t">{money(b.total_amount, b.currency)}</b>], [tr("Meridian base fee"), money(b.base_fee, b.currency)], [tr("Currency"), b.currency], [tr("Invoice"), b.stripe_invoice_id ? tr("Invoiced; the invoice is in Meridian HQ") : tr("Not invoiced yet")]]} />
          <Block title={tr("Resolved exceptions by tier")}>
            <div className="m2-frame" tabIndex={0}>
              <table className="m2-tbl" aria-label={tr("Billing by tier")}>
                <thead>
                  <tr>
                    <th scope="col">{tr("Tier")}</th>
                    <th scope="col" className="m2-r">{tr("Resolved")}</th>
                    <th scope="col" className="m2-r">{tr("Amount ({currency})", { currency: b.currency })}</th>
                  </tr>
                </thead>
                <tbody>
                  {([1, 2, 3, 4] as const).map((t) => (
                    <tr key={t}>
                      <th scope="row">{tr("Tier {t}", { t })}</th>
                      <td className="m2-r">{b[`tier${t}_count`]}</td>
                      <td className="m2-r">{money(b[`tier${t}_amount`], b.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Block>
        </>
      )}
    </AdminPage>
  );
}
