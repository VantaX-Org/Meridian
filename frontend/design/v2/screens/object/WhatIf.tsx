"use client";

import { useMemo, useState } from "react";
import type { Receipt } from "@/lib/api/v2/types";
import { DQ_WORD, type StepView } from "@/lib/v2/process-tree";
import { f1, int } from "@/lib/v2/score";
import { failingRules, simulate } from "@/lib/v2/what-if";
import { Mono } from "../../parts";
import "../../roles.css";
import { t } from "@/lib/v2/i18n";

/** What happens to the cap, as the head of a sentence. */
function capSentence(before: number | null, after: number | null): string {
  if (after === null) return before === null ? t("The cap is released") : t("The cap of {capBefore} is released", { capBefore: before });
  return before === null ? t("The cap becomes {capAfter}", { capAfter: after }) : t("The cap of {capBefore} becomes {capAfter}", { capBefore: before, capAfter: after });
}

/**
 * The Processes tab's simulation (step 6c): tick the rules to fix and see which blocked steps would open and what the
 * score cap would become. It is a simulation over this run's process document and receipt (lib/v2/what-if.ts), never
 * a forecast, and it says so.
 */
export function WhatIfPanel({ steps, receipt, label }: { steps: readonly StepView[]; receipt: Receipt | null | undefined; label: string }) {
  const rules = useMemo(() => failingRules(steps), [steps]);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const result = useMemo(() => simulate(steps, picked, receipt ?? null), [steps, picked, receipt]);
  if (!rules.length) return null;
  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  return (
    <section className="m2-sec m2-whatif" aria-label={t("What if these rules were fixed")} data-testid="what-if">
      <h2 className="m2-h2">
        {t("What if these rules were fixed")}{" "}<span className="m2-sim">{t("Simulation")}</span>
      </h2>
      <p className="m2-rp m2-meta">{t("Tick the rules to fix. The steps of {label} are read again without their failures; nothing is changed and no data is read.", { label })}</p>
      <ul className="m2-whatif-rules" aria-label={t("Failing rules")}>
        {rules.map((r) => (
          <li key={r.checkId}>
            <label className="m2-sw">
              <input type="checkbox" checked={picked.has(r.checkId)} onChange={() => toggle(r.checkId)} />
              <span>
                <Mono>{r.checkId}</Mono> {r.message}
                <small>{t("{affected} records at least, in {steps} {steps, plural, one {step} other {steps}}", { affected: int(r.affected), steps: r.steps })}</small>
              </span>
            </label>
          </li>
        ))}
      </ul>
      <div className="m2-whatif-out" role="status" data-testid="what-if-result">
        {picked.size === 0 ? (
          <span className="m2-meta">{t("Choose at least one rule.")}</span>
        ) : (
          <>
            <span>{t("Blocked steps: {blockedBefore} now, {blockedAfter} if fixed.", { blockedBefore: result.blockedBefore, blockedAfter: result.blockedAfter })}</span>
            {result.released.length ? <span>{t("Would open: {map}.", { map: result.released.map((s) => t("{l1Id} step {number} ({name})", { l1Id: s.l1Id, number: s.number, name: s.name })).join(", ") })}</span> : <span className="m2-meta">{t("No blocked step opens with these rules alone.")}</span>}
            {result.steps
              .filter((s) => s.before !== s.after && !(s.before === "red" && s.after !== "red"))
              .map((s) => (
                <span key={s.id} className="m2-meta">{t("{l1Id} step {number}: {DQ_WORD} to {DQ_WORD2}", { l1Id: s.l1Id, number: s.number, DQ_WORD: DQ_WORD[s.before], DQ_WORD2: DQ_WORD[s.after] })}</span>
              ))}
            {result.score && result.score.before !== null ? (
              <span>
                {result.score.capAfter === result.score.capBefore
                  ? t("The score stays at {before}: {value}.", { before: f1(result.score.before), value: result.score.capAfter === null ? t("it is not capped") : t("still capped at {capAfter}", { capAfter: result.score.capAfter }) })
                  : t("{capText}: the score would show {after} (measured {measured}).", { capText: capSentence(result.score.capBefore, result.score.capAfter), after: f1(result.score.after), measured: f1(result.score.measured) })}
              </span>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}
