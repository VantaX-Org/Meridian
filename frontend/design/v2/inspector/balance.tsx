"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { applyBalance, planBalance, type BalanceBy, type BalancePlan } from "@/lib/api/v2/roles";
import { failureText } from "@/lib/v2/errors";
import { int } from "@/lib/v2/score";
import { labelText as labelOf } from "@/lib/v2/labels";
import { useV2Session } from "@/lib/v2/hooks";
import { InspectorFrame } from "../Inspector";
import { useToast } from "../Toast";
import "../roles.css";
import { t } from "@/lib/v2/i18n";

/**
 * `?open=balance`: Balance work (step 6c). Proposes moving open record issues between the people who fix them, by
 * even counts, by whole objects, or to the stewards the assignment template names per slice; shows before and after
 * per person and every move; Apply assigns them in one change that Undo takes back (POST /actions/undo).
 */
const BY: { value: BalanceBy; label: string; hint: string }[] = [
  { value: "owner", get label() { return t("Even counts"); }, get hint() { return t("Every person ends within one record of the others."); } },
  { value: "object", get label() { return t("Whole objects"); }, get hint() { return t("A person keeps all of one object's records together."); } },
  { value: "slice", get label() { return t("By the assignment template"); }, get hint() { return t("Each record goes to the steward named for its object and plant, company code or organisation."); } },
];

export function BalancePanel({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const session = useV2Session();
  const toast = useToast();
  const [by, setBy] = useState<BalanceBy>("owner");
  const [plan, setPlan] = useState<BalancePlan | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
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
      setError(failureText(e));
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
      if (r.action_id) toast.done({ ids: [r.action_id], label });
      setPlan(null);
      await qc.invalidateQueries({ queryKey: ["v2"] });
    } catch (e) {
      setError(failureText(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <InspectorFrame title={t("Balance work")} status={t("An assignment plan, applied with undo")} onClose={onClose}>
      {!allowed ? (
        <p className="m2-meta" data-testid="needs-permission">{t("Balancing work needs the assign permission.")}</p>
      ) : (
        <>
          <fieldset className="m2-compose" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="m2-lbl">{t("How to balance")}</legend>
            {BY.map((b) => (
              <label key={b.value} className="m2-sw">
                <input type="radio" name="balance-by" checked={by === b.value} onChange={() => setBy(b.value)} />
                <span>
                  {b.label}
                  <small>{b.hint}</small>
                </span>
              </label>
            ))}
          </fieldset>
          <button type="button" className="m2-btn m2-sm" disabled={busy !== null} onClick={() => void propose()}>
            {busy === "plan" ? t("Working out a plan…") : t("Propose a plan")}
          </button>
        </>
      )}
      {error ? (
        <p className="m2-err" role="alert">
          {error}
        </p>
      ) : null}
      {applied ? <p role="status">{applied}</p> : null}
      {plan ? (
        <section data-testid="balance-plan" aria-label={t("The plan")}>
          <h3>{t("Open records per person")}</h3>
          <table className="m2-tbl m2-tmpl">
            <thead>
              <tr>
                <th scope="col">{t("Person")}</th>
                <th scope="col" className="m2-r">
                  {t("Now")}
                </th>
                <th scope="col" className="m2-r">
                  {t("After")}
                </th>
              </tr>
            </thead>
            <tbody>
              {Object.keys(plan.before).map((p) => (
                <tr key={p}>
                  <th scope="row">{name(p)}</th>
                  <td className="m2-r">{int(plan.before[p])}</td>
                  <td className="m2-r">{int(plan.after[p])}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <h3>{plan.moves.length ? t("{movesCount} {movesCount, plural, one {move} other {moves}}, {moved} records", { movesCount: plan.moves.length, moved: int(plan.moved) }) : t("Nothing to move")}</h3>
          <ul className="m2-rows">
            {plan.moves.map((m, i) => (
              <li key={`${m.from}-${m.to}-${m.module}-${i}`}>{t("{count} {replace} records from {name} to {name2}", { count: int(m.count), replace: labelOf(m.module), name: name(m.from), name2: name(m.to) })}</li>
            ))}
          </ul>
          <button type="button" className="m2-btn m2-strong" disabled={!plan.moves.length || busy !== null} onClick={() => void apply()}>
            {busy === "apply" ? t("Applying…") : t("Apply the plan")}
          </button>
          <p className="m2-meta">{t("Undo puts every record back for ten minutes after you apply.")}</p>
        </section>
      ) : null}
    </InspectorFrame>
  );
}
