import type { BusinessProcessL5Field } from "@/types/api";
import type { Receipt } from "@/lib/api/v2/types";
import { worstOf, type DQ, type StepView } from "./process-tree";

/**
 * "If these rules were fixed": a deterministic simulation on the Processes tab (step 6c). Nothing is recomputed from
 * data; the API's own process document and receipt are re-read with the chosen rules' failures taken away:
 *
 *   a field whose failing rule is fixed reads green; a step is blocked while any other field it writes is red, at
 *   risk while one is amber, else ready (process-tree.ts's colouring, the API's)
 *   the score cap follows the receipt's rule: one critical breach caps at 85, two or more at 70; fixing the breaching
 *   rules releases the cap and the shown score becomes the measured one. The measured score itself is not moved:
 *   pass rates would need the data.
 */

export interface StepOutcome {
  id: string;
  name: string;
  number: number;
  l1Id: string;
  before: DQ;
  after: DQ;
  /** The most records any one remaining failing rule fails (a floor), after the fix. */
  recordsAfter: number;
}

export interface WhatIf {
  fixed: string[];
  blockedBefore: number;
  blockedAfter: number;
  /** Steps that were blocked and are not any more. */
  released: StepOutcome[];
  steps: StepOutcome[];
  score: { before: number | null; after: number | null; capBefore: number | null; capAfter: number | null; measured: number | null } | null;
}

const fieldAfter = (f: BusinessProcessL5Field, fixed: ReadonlySet<string>): DQ => (f.check_id && fixed.has(f.check_id) ? "green" : f.dq_status);

export function capFor(criticalBreaches: number): number | null {
  return criticalBreaches >= 2 ? 70 : criticalBreaches === 1 ? 85 : null;
}

export function simulate(steps: readonly StepView[], fixedRules: Iterable<string>, receipt?: Receipt | null): WhatIf {
  const fixed = new Set(fixedRules);
  const out: StepOutcome[] = steps.map((s) => {
    const after = s.fields.length ? worstOf(s.fields.map((f) => fieldAfter(f, fixed))) : s.status;
    const recordsAfter = s.rules.filter((r) => !fixed.has(r.checkId)).reduce((m, r) => Math.max(m, r.affected), 0);
    return { id: s.id, name: s.name, number: s.number, l1Id: s.l1Id, before: s.status, after: s.fields.length ? after : s.status, recordsAfter };
  });
  let score: WhatIf["score"] = null;
  if (receipt) {
    const remaining = receipt.breaches.filter((b) => !fixed.has(b.check_id)).length;
    const capAfter = capFor(remaining);
    const measured = receipt.measured;
    score = {
      before: receipt.score,
      measured,
      capBefore: receipt.cap_level,
      capAfter,
      after: measured === null ? null : capAfter === null ? measured : Math.min(measured, capAfter),
    };
  }
  return {
    fixed: [...fixed].sort(),
    blockedBefore: out.filter((s) => s.before === "red").length,
    blockedAfter: out.filter((s) => s.after === "red").length,
    released: out.filter((s) => s.before === "red" && s.after !== "red"),
    steps: out,
    score,
  };
}

/** The failing rules of the steps, most records first, once each: what the simulation offers to fix. */
export function failingRules(steps: readonly StepView[]): { checkId: string; message: string; affected: number; steps: number }[] {
  const by = new Map<string, { checkId: string; message: string; affected: number; steps: number }>();
  for (const s of steps) {
    for (const r of s.rules) {
      const prior = by.get(r.checkId);
      if (prior) {
        prior.affected = Math.max(prior.affected, r.affected);
        prior.steps += 1;
      } else by.set(r.checkId, { checkId: r.checkId, message: r.message, affected: r.affected, steps: 1 });
    }
  }
  return [...by.values()].sort((a, b) => b.affected - a.affected || a.checkId.localeCompare(b.checkId));
}
