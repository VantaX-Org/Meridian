"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { formatDate, formatModuleName, labelOf } from "@/lib/format";
import * as api from "@/lib/api/v2/admin";
import { refreshAdmin, useBilling, useLicence, useUpdateStatus } from "@/lib/v2/admin-queries";
import { fixed, v2Locale } from "@/lib/v2/format";
import { V2Link } from "../parts";
import { ResultFrame, useOutcome } from "../inspector/shared";
import { AdminPage, Block, Fld, Kv, Loaded, NeedsPermission, Note, StatusWord, useCan } from "./kit";

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
      return { tone: l.valid === false ? "fail" : "ok", title: l.valid === false ? "Meridian HQ reports the licence is not valid" : "Licence checked with Meridian HQ", detail: l.valid === false ? `Status: ${labelOf(l.status)}.` : undefined };
    });
  return (
    <AdminPage
      title="Licence"
      lead="What this deployment is licensed for. Plan changes and invoices are handled in Meridian HQ; this deployment keeps its data either way."
      actions={
        canValidate ? (
          <button type="button" className="m2-btn" disabled={pending !== null} onClick={refresh}>
            {pending === "validate" ? "Checking…" : "Check with Meridian HQ now"}
          </button>
        ) : undefined
      }
    >
      {outcome ? <ResultFrame outcome={outcome} /> : null}
      <Loaded q={q} what="The licence" rows={5}>
        {(l) => {
          const modules = l.enabled_modules ?? [];
          const all = modules.includes("*");
          const seats = l.features?.max_users ?? l.seats ?? 0;
          const used = l.seats_used;
          const days = l.days_remaining;
          const notValidated = l.valid === null;
          const features = Object.entries(l.features ?? {}).filter(([, v]) => typeof v === "boolean") as [string, boolean][];
          return (
            <>
              {l.valid === false ? <Note tone="bad">{`The licence is not valid. Meridian HQ reports status "${labelOf(l.status)}". Renew it in Meridian HQ; module entitlements may be restricted until then.`}</Note> : null}
              {notValidated ? <Note tone="warn">This deployment has not checked its licence with Meridian HQ, so default entitlements apply: no module list, seat count or expiry. It also checks on a schedule.</Note> : null}
              {days != null && days < 30 ? <Note tone={days < 7 ? "bad" : "warn"}>{days <= 0 ? "The licence has expired. Renew it in Meridian HQ." : `The licence expires in ${days} ${days === 1 ? "day" : "days"}. Renew it in Meridian HQ before then; a renewal shows here after the next check.`}</Note> : null}
              {seats && used != null && used / seats >= 0.75 ? <Note tone={used >= seats ? "bad" : "warn"}>{`${used} of ${seats} seats are in use. ${used >= seats ? "A new invitation fails until a user is suspended or the licence grants more seats." : "Add seats in Meridian HQ before the team grows further."}`}</Note> : null}
              <Block title="Detail">
                <Kv
                  rows={[
                    ["Company", l.company_name ?? "Not set"],
                    ["Status", l.valid === false ? <StatusWord tone="no-go">{labelOf(l.status)}</StatusWord> : l.valid ? <StatusWord tone="go">Valid</StatusWord> : <StatusWord tone="at-risk">Not validated yet</StatusWord>],
                    ["Tier", l.tier ? labelOf(l.tier) : "Not validated yet"],
                    ["Seats", seats ? (used != null ? `${used} of ${seats} in use` : String(seats)) : notValidated ? "Not validated yet" : "Unlimited"],
                    ["Valid until", l.expiry_date ? `${formatDate(l.expiry_date)}${days != null ? `, ${days} ${days === 1 ? "day" : "days"} left` : ""}` : "Not set"],
                    ["Last checked", l.last_validated ? formatDate(l.last_validated, "datetime") : "Not checked yet"],
                    ["Platform version", update.data ? <>{update.data.current_version}{update.data.update_available ? <>{", "}<V2Link href="/v2/admin/system">{`${update.data.latest_version} is available`}</V2Link></> : " (up to date)"}</> : <V2Link href="/v2/admin/system">See Jobs and system update</V2Link>],
                  ]}
                />
              </Block>
              <Block title="Modules" hint={all ? "Every SAP module is licensed." : `${modules.length} enabled`}>
                <ul className="m2-tags" aria-label="Licensed modules">
                  {all ? <li>All modules</li> : modules.map((m) => <li key={m}>{formatModuleName(m)}</li>)}
                </ul>
                {!all && modules.length === 0 ? <p className="m2-prov">{notValidated ? "Modules follow the licence once Meridian HQ has confirmed it." : "No module is enabled on this licence."}</p> : null}
              </Block>
              {features.length ? (
                <Block title="Features">
                  <ul className="m2-tags" aria-label="Licensed features">
                    {features.map(([k, v]) => (
                      <li key={k}>{`${labelOf(k)}${v ? "" : ", off"}`}</li>
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
  if (!allowed) return <AdminPage title="Billing"><NeedsPermission what="Reading billing" permission="manage_settings" /></AdminPage>;
  const b = q.data;
  return (
    <AdminPage title="Billing" lead="Resolved exceptions by billing tier, on top of the base fee. Read only: the plan and the invoices are in Meridian HQ.">
      <div className="m2-fbar">
        <Fld label="Month">
          <input type="month" value={period} max={thisMonth()} onChange={(e) => setPeriod(e.target.value)} />
        </Fld>
      </div>
      {q.isError ? (
        <div className="m2-empty">
          <p>No billing figures for this month. Try an earlier month, or check back after the next billing run.</p>
          <button type="button" className="m2-btn" onClick={() => setPeriod(thisMonth())}>
            Back to this month
          </button>
        </div>
      ) : !b ? (
        <p className="m2-prov" aria-busy="true">Reading the month…</p>
      ) : (
        <>
          <Kv rows={[["Total", <b key="t">{money(b.total_amount, b.currency)}</b>], ["Meridian base fee", money(b.base_fee, b.currency)], ["Currency", b.currency], ["Invoice", b.stripe_invoice_id ? "Invoiced; the invoice is in Meridian HQ" : "Not invoiced yet"]]} />
          <Block title="Resolved exceptions by tier">
            <div className="m2-frame" tabIndex={0}>
              <table className="m2-tbl" aria-label="Billing by tier">
                <thead>
                  <tr>
                    <th scope="col">Tier</th>
                    <th scope="col" className="m2-r">Resolved</th>
                    <th scope="col" className="m2-r">{`Amount (${b.currency})`}</th>
                  </tr>
                </thead>
                <tbody>
                  {([1, 2, 3, 4] as const).map((t) => (
                    <tr key={t}>
                      <th scope="row">{`Tier ${t}`}</th>
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
