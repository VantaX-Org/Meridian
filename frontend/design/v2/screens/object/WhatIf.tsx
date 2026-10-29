"use client";

import { useMemo, useState } from "react";
import type { Receipt } from "@/lib/api/v2/types";
import { DQ_WORD, type StepView } from "@/lib/v2/process-tree";
import { f1, int } from "@/lib/v2/score";
import { failingRules, simulate } from "@/lib/v2/what-if";
import { Mono } from "../../parts";
import "../../roles.css";

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
    <section className="m2-sec m2-whatif" aria-label="What if these rules were fixed" data-testid="what-if">
      <h2 className="m2-h2">
        What if these rules were fixed <span className="m2-sim">Simulation</span>
      </h2>
      <p className="m2-rp m2-meta">{`Tick the rules to fix. The steps of ${label} are read again without their failures; nothing is changed and no data is read.`}</p>
      <ul className="m2-whatif-rules" aria-label="Failing rules">
        {rules.map((r) => (
          <li key={r.checkId}>
            <label className="m2-sw">
              <input type="checkbox" checked={picked.has(r.checkId)} onChange={() => toggle(r.checkId)} />
              <span>
                <Mono>{r.checkId}</Mono> {r.message}
                <small>{`${int(r.affected)} records at least, in ${r.steps} ${r.steps === 1 ? "step" : "steps"}`}</small>
              </span>
            </label>
          </li>
        ))}
      </ul>
      <div className="m2-whatif-out" role="status" data-testid="what-if-result">
        {picked.size === 0 ? (
          <span className="m2-meta">Choose at least one rule.</span>
        ) : (
          <>
            <span>{`Blocked steps: ${result.blockedBefore} now, ${result.blockedAfter} if fixed.`}</span>
            {result.released.length ? <span>{`Would open: ${result.released.map((s) => `${s.l1Id} step ${s.number} (${s.name})`).join(", ")}.`}</span> : <span className="m2-meta">No blocked step opens with these rules alone.</span>}
            {result.steps
              .filter((s) => s.before !== s.after && !(s.before === "red" && s.after !== "red"))
              .map((s) => (
                <span key={s.id} className="m2-meta">{`${s.l1Id} step ${s.number}: ${DQ_WORD[s.before]} to ${DQ_WORD[s.after]}`}</span>
              ))}
            {result.score && result.score.before !== null ? (
              <span>
                {result.score.capAfter === result.score.capBefore
                  ? `The score stays at ${f1(result.score.before)}: ${result.score.capAfter === null ? "it is not capped" : `still capped at ${result.score.capAfter}`}.`
                  : `The cap ${result.score.capBefore === null ? "" : `of ${result.score.capBefore} `}${result.score.capAfter === null ? "is released" : `becomes ${result.score.capAfter}`}: the score would show ${f1(result.score.after)} (measured ${f1(result.score.measured)}).`}
              </span>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}
