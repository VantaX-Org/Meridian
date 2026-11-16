"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { applyBalance, createDelegation, planBalance, revokeDelegation, type BalanceBy, type BalancePlan, type Delegation } from "@/lib/api/v2/roles";
import { formatDate } from "@/lib/format";
import { useAssignable } from "@/lib/v2/approvals-queries";
import { failureText } from "@/lib/v2/errors";
import { useV2Session } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";
import { labelText } from "@/lib/v2/labels";
import { notFound, refreshRoles, useMyDelegations } from "@/lib/v2/roles-queries";
import { int } from "@/lib/v2/score";
import { Button, Confirm, EmptyState, ErrorState, Skeleton } from "../../kit";
import { InspectorFrame, type BodyProps } from "./frame";
import { Dash, useDone } from "./panels-kit";

const day = (iso: string) => formatDate(`${iso.slice(0, 10)}T12:00:00Z`, "date");

/** `?open=away`: out of office. The person away's approvals, SLA breaches, mentions and assigned work are copied to the delegate. */
export function AwayBody({ onClose }: BodyProps) {
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
  const [asking, setAsking] = useState<Delegation | null>(null);
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
    setAsking(null);
    setError(null);
    try {
      await revokeDelegation(id);
      await refreshRoles(qc, "delegations");
    } catch (e) {
      setError(failureText(e));
    }
  };
  const row = (d: Delegation, text: string) => (
    <li key={d.id} className="nx-ib-row">
      <span>{text}</span>
      <span className="nx-pn-meta">{t("{day} to {day2}, {state}", { day: day(d.starts_on), day2: day(d.ends_on), state: d.state })}</span>
      {!readOnly && d.state !== "revoked" && d.state !== "ended" ? (
        <Button variant="secondary" size={32} onClick={() => setAsking(d)}>
          {t("End it")}
        </Button>
      ) : null}
    </li>
  );

  return (
    <InspectorFrame title={t("Out of office")} status={t("Delegation")} onClose={onClose}>
      {q.isError ? (
        notFound(q.error) ? (
          <Dash why={t("Out of office is not available on this server yet")} />
        ) : (
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        )
      ) : !q.data ? (
        <Skeleton lines={3} label={t("Out of office")} />
      ) : (
        <>
          <section className="nx-ib-sec">
            <h3>{t("Your delegations")}</h3>
            {q.data.away.length ? (
              <ul className="nx-ib-list">{q.data.away.map((d) => row(d, t("{to_name} covers for you{value}.", { to_name: d.to_name, value: d.reason ? `: ${d.reason}` : "" })))}</ul>
            ) : (
              <EmptyState heading={t("You have not set out of office.")} />
            )}
          </section>
          <section className="nx-ib-sec">
            <h3>{t("You cover for")}</h3>
            {q.data.covering.length ? (
              <ul className="nx-ib-list">{q.data.covering.map((d) => row(d, t("You cover for {from_name}.", { from_name: d.from_name })))}</ul>
            ) : (
              <p className="nx-pn-meta">{t("Nobody has handed you their work.")}</p>
            )}
          </section>
        </>
      )}
      <Confirm
        open={Boolean(asking)}
        title={t("End it")}
        consequence={asking ? t("{to_name} stops covering the approvals and assigned work of {from_name} from now on.", { to_name: asking.to_name, from_name: asking.from_name }) : ""}
        confirmLabel={t("End it")}
        danger
        onConfirm={() => asking && void end(asking.id)}
        onCancel={() => setAsking(null)}
      />
      <section className="nx-ib-sec">
        <h3>{t("Set out of office")}</h3>
        {readOnly ? (
          <p className="nx-pn-meta">{t("Read-only view.")}</p>
        ) : (
          <div className="nx-pn-form" data-testid="away-form">
            <label className="nx-pn-fld">
              <span>{t("Who covers")}</span>
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
            <label className="nx-pn-fld">
              <span>{t("First day")}</span>
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </label>
            <label className="nx-pn-fld">
              <span>{t("Last day")}</span>
              <input type="date" value={until} onChange={(e) => setUntil(e.target.value)} />
            </label>
            <label className="nx-pn-fld">
              <span>{t("Reason (optional)")}</span>
              <input type="text" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
            </label>
            <p className="nx-pn-note">{t("Your approvals, SLA breaches, mentions and assigned work are copied to them between these days. Four eyes still holds: nobody approves their own batch.")}</p>
            <span>
              <Button variant="primary" size={32} loading={busy} loadingLabel={t("Saving…")} disabled={!to || !from || !until} onClick={() => void save()}>
                {t("Set out of office")}
              </Button>
            </span>
          </div>
        )}
        {error ? (
          <p className="nx-pn-err" role="alert">
            {error}
          </p>
        ) : null}
        {done ? <p role="status">{done}</p> : null}
      </section>
    </InspectorFrame>
  );
}

const BY: { value: BalanceBy; label: () => string; hint: () => string }[] = [
  { value: "owner", label: () => t("Even counts"), hint: () => t("Every person ends within one record of the others.") },
  { value: "object", label: () => t("Whole objects"), hint: () => t("A person keeps all of one object's records together.") },
  { value: "slice", label: () => t("By the assignment template"), hint: () => t("Each record goes to the steward named for its object and plant, company code or organisation.") },
];

/** `?open=balance`: proposes moving open record issues between the people who fix them; Apply assigns them with undo. */
export function BalanceBody({ onClose }: BodyProps) {
  const qc = useQueryClient();
  const session = useV2Session();
  const done = useDone();
  const [by, setBy] = useState<BalanceBy>("owner");
  const [plan, setPlan] = useState<BalancePlan | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [applied, setApplied] = useState<string | null>(null);
  const allowed = session.can("assign") && !session.shared && !session.viewAs;
  const name = (id: string | null) => (id === null ? t("Unassigned") : (plan?.people.find((p) => p.id === id)?.name ?? id));

  const propose = async () => {
    setBusy("plan");
    setError(null);
    setApplied(null);
    try {
      setPlan(await planBalance(by));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  };
  const apply = async () => {
    if (!plan) return;
    setBusy("apply");
    setError(null);
    try {
      const r = await applyBalance(plan.by, plan.moves);
      const label = t("Balanced work: {moved} records moved", { moved: int(r.moved) });
      setApplied(`${label}${r.skipped ? t(", {skipped} had moved since and were left", { skipped: int(r.skipped) }) : ""}.`);
      if (r.action_id) done({ ids: [r.action_id], label });
      setPlan(null);
      await qc.invalidateQueries({ queryKey: ["v2"] });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  };

  return (
    <InspectorFrame title={t("Balance work")} status={t("An assignment plan, applied with undo")} onClose={onClose}>
      {!allowed ? (
        <p className="nx-pn-meta" data-testid="needs-permission">
          {t("Balancing work needs the assign permission.")}
        </p>
      ) : (
        <section className="nx-ib-sec">
          <fieldset className="nx-pn-set">
            <legend>{t("How to balance")}</legend>
            {BY.map((b) => (
              <label key={b.value} className="nx-pn-opt">
                <input type="radio" name="balance-by" checked={by === b.value} onChange={() => setBy(b.value)} />
                <span>
                  {b.label()}
                  <small>{b.hint()}</small>
                </span>
              </label>
            ))}
          </fieldset>
          <span>
            <Button variant="secondary" size={32} loading={busy === "plan"} loadingLabel={t("Working out a plan…")} disabled={busy !== null} onClick={() => void propose()}>
              {t("Propose a plan")}
            </Button>
          </span>
        </section>
      )}
      {error ? <ErrorState sentence={failureText(error)} error={error} onRetry={() => void (plan ? apply() : propose())} /> : null}
      {applied ? <p role="status">{applied}</p> : null}
      {plan ? (
        <section className="nx-ib-sec" data-testid="balance-plan" aria-label={t("The plan")}>
          <h3>{t("Open records per person")}</h3>
          <div className="nx-pn-scroll">
            <table className="nx-pn-table">
              <thead>
                <tr>
                  <th scope="col">{t("Person")}</th>
                  <th scope="col" className="nx-pn-num">
                    {t("Now")}
                  </th>
                  <th scope="col" className="nx-pn-num">
                    {t("After")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {Object.keys(plan.before).map((p) => (
                  <tr key={p}>
                    <th scope="row">{name(p)}</th>
                    <td className="nx-pn-num">{int(plan.before[p])}</td>
                    <td className="nx-pn-num">{int(plan.after[p])}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h3>{plan.moves.length ? t("{movesCount} {movesCount, plural, one {move} other {moves}}, {moved} records", { movesCount: plan.moves.length, moved: int(plan.moved) }) : t("Nothing to move")}</h3>
          <ul className="nx-ib-list">
            {plan.moves.map((m, i) => (
              <li key={`${m.from}-${m.to}-${m.module}-${i}`} className="nx-ib-row">
                {t("{count} {replace} records from {name} to {name2}", { count: int(m.count), replace: labelText(m.module), name: name(m.from), name2: name(m.to) })}
              </li>
            ))}
          </ul>
          <span>
            <Button variant="primary" size={40} loading={busy === "apply"} loadingLabel={t("Applying…")} disabled={!plan.moves.length || busy !== null} onClick={() => void apply()}>
              {t("Apply the plan")}
            </Button>
          </span>
          <p className="nx-pn-meta">{t("Undo puts every record back for ten minutes after you apply.")}</p>
        </section>
      ) : null}
    </InspectorFrame>
  );
}
