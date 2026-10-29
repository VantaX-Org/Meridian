"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { createDelegation, revokeDelegation, type Delegation } from "@/lib/api/v2/roles";
import { formatDate } from "@/lib/format";
import { useAssignable } from "@/lib/v2/approvals-queries";
import { failureText } from "@/lib/v2/errors";
import { useV2Session } from "@/lib/v2/hooks";
import { notFound, refreshRoles, useMyDelegations } from "@/lib/v2/roles-queries";
import { InspectorFrame } from "../Inspector";
import { Dash, Skeleton } from "../parts";
import "../roles.css";
import { t } from "@/lib/v2/i18n";

/**
 * Out of office (step 6c). While a delegation is active the person away's approvals, SLA breaches, mentions and
 * assigned work are copied to the delegate (api/services/delegation.py). The banner says so on the batch and person
 * inspectors, from both sides; the panel (`?open=away`) sets and ends it.
 */

const day = (iso: string): string => formatDate(`${iso.slice(0, 10)}T12:00:00Z`, "date");

/** One sentence per delegation that concerns this inspector: `personId` narrows to delegations naming that person. */
export function DelegationBanner({ personId }: { personId?: string }) {
  const q = useMyDelegations();
  if (!q.data) return null;
  const mine = (d: Delegation) => d.state === "active" && (!personId || d.from_user_id === personId || d.to_user_id === personId);
  const away = q.data.away.filter(mine);
  const covering = q.data.covering.filter(mine);
  if (!away.length && !covering.length) return null;
  return (
    <div data-testid="delegation-banner">
      {covering.map((d) => (
        <p key={d.id} className="m2-ibanner">{t("You cover for {from_name} until {day}: their approvals and assigned work come to you as well.", { from_name: d.from_name, day: day(d.ends_on) })}</p>
      ))}
      {away.map((d) => (
        <p key={d.id} className="m2-ibanner">{t("You are out of office until {day}. {to_name} covers your approvals and assigned work.", { day: day(d.ends_on), to_name: d.to_name })}</p>
      ))}
    </div>
  );
}

/** `?open=away`: set out of office, see who you cover for, end a delegation. */
export function OutOfOfficePanel({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const session = useV2Session();
  const q = useMyDelegations();
  const people = useAssignable(true);
  const [to, setTo] = useState("");
  const [from, setFrom] = useState("");
  const [until, setUntil] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const readOnly = session.shared || Boolean(session.viewAs);
  const save = async () => {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const d = await createDelegation({ to_user_id: to, starts_on: from, ends_on: until, reason: reason || undefined });
      setDone(t("{to_name} covers your approvals and assigned work from {day} to {day2}.", { to_name: d.to_name, day: day(d.starts_on), day2: day(d.ends_on) }));
      setTo("");
      await refreshRoles(qc, "delegations");
    } catch (e) {
      setError(failureText(e));
    } finally {
      setBusy(false);
    }
  };
  const end = async (id: string) => {
    try {
      await revokeDelegation(id);
      await refreshRoles(qc, "delegations");
    } catch (e) {
      setError(failureText(e));
    }
  };
  const row = (d: Delegation, text: string) => (
    <li key={d.id}>
      <span className="m2-meta">{t("{day} to {day2}, {state}", { day: day(d.starts_on), day2: day(d.ends_on), state: d.state })}</span>
      <span>{text}</span>
      {!readOnly && d.state !== "revoked" && d.state !== "ended" ? (
        <button type="button" className="m2-linkbtn2" onClick={() => void end(d.id)}>
          {t("End it")}
        </button>
      ) : null}
    </li>
  );
  return (
    <InspectorFrame title={t("Out of office")} status={t("Delegation")} onClose={onClose}>
      {q.isError && notFound(q.error) ? (
        <p className="m2-meta">
          <Dash why={t("Out of office is not available on this server yet")} />
        </p>
      ) : !q.data ? (
        <Skeleton width="60%" height={12} />
      ) : (
        <>
          <h3>{t("Your delegations")}</h3>
          {q.data.away.length ? <ul className="m2-rows">{q.data.away.map((d) => row(d, t("{to_name} covers for you{value}.", { to_name: d.to_name, value: d.reason ? `: ${d.reason}` : "" })))}</ul> : <p className="m2-meta">{t("You have not set out of office.")}</p>}
          <h3>{t("You cover for")}</h3>
          {q.data.covering.length ? <ul className="m2-rows">{q.data.covering.map((d) => row(d, t("You cover for {from_name}.", { from_name: d.from_name })))}</ul> : <p className="m2-meta">{t("Nobody has handed you their work.")}</p>}
        </>
      )}
      <h3>{t("Set out of office")}</h3>
      {readOnly ? (
        <p className="m2-meta">{t("Read-only view.")}</p>
      ) : (
        <div className="m2-compose" data-testid="away-form">
          <label className="m2-fld">
            <span className="m2-lbl">{t("Who covers")}</span>
            <select value={to} onChange={(e) => setTo(e.target.value)}>
              <option value="">{t("Choose a person")}</option>
              {(people.data ?? [])
                .filter((p) => p.id !== session.id)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </select>
          </label>
          <label className="m2-fld">
            <span className="m2-lbl">{t("First day")}</span>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="m2-fld">
            <span className="m2-lbl">{t("Last day")}</span>
            <input type="date" value={until} onChange={(e) => setUntil(e.target.value)} />
          </label>
          <label className="m2-fld">
            <span className="m2-lbl">{t("Reason (optional)")}</span>
            <input type="text" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
          </label>
          <p className="m2-meta">{t("Your approvals, SLA breaches, mentions and assigned work are copied to them between these days. Four eyes still holds: nobody approves their own batch.")}</p>
          <button type="button" className="m2-btn m2-strong m2-sm" disabled={busy || !to || !from || !until} onClick={() => void save()}>
            {busy ? t("Saving…") : t("Set out of office")}
          </button>
          {error ? (
            <span className="m2-err" role="alert">
              {error}
            </span>
          ) : null}
          {done ? <p role="status">{done}</p> : null}
        </div>
      )}
    </InspectorFrame>
  );
}
