// The one "Do next" of a scope: Home's four sentences, the Insights overview and the executive summary all read it.
import type { StateObject } from "@/lib/current-state";
import { fixHref } from "@/lib/drill";
import { capRuleIds, formatModuleName } from "@/lib/format";

export interface DoNext {
  module: string;
  label: string;
  score: number;
  /** The first critical rule that caps the object's score, when one does. */
  rule: string | null;
  /** The run the object is read from. */
  runId: string;
  sentence: string;
  action: { label: string; href: string };
}

/**
 * The step that moves the score most directly, from the objects a page summarises (`stateObjects`: the current
 * state, or one run's objects). The score is the mean of the objects' scores, so the step is the lowest-scoring
 * object (ties: in object order, as `worstObjectsFirst` ranks them), and, when a critical rule caps it, that rule:
 * a cap holds the score down until the rule passes. The action opens the rule's failing records in Fix work, else
 * the object. `pinned` keeps a pinned run on the link; the current state needs none (Fix work opens on it).
 * Null when nothing is scored. Pure.
 */
export function doNext(objects: readonly StateObject[], { pinned = false }: { pinned?: boolean } = {}): DoNext | null {
  const scored = objects.filter((o) => o.summary.composite_score != null);
  if (!scored.length) return null;
  const worst = [...scored].sort((a, b) => (a.summary.composite_score ?? 0) - (b.summary.composite_score ?? 0) || a.module.localeCompare(b.module))[0];
  const score = worst.summary.composite_score ?? 0;
  const label = formatModuleName(worst.module);
  const rule = worst.summary.capped ? capRuleIds(worst.summary.cap_reason)[0] ?? null : null;
  const run = pinned ? worst.run.id : undefined;
  const at = `the lowest score at ${score.toFixed(1)}`;
  return {
    module: worst.module,
    label,
    score,
    rule,
    runId: worst.run.id,
    sentence: rule ? `Start with ${label}, ${at}: fix ${rule}, which caps it` : `Start with ${label}, ${at}`,
    action: rule
      ? { label: `Fix ${rule}`, href: fixHref({ run, module: worst.module, check: rule }) }
      : { label: `Open ${label}`, href: `/objects/${encodeURIComponent(worst.module)}${run ? `?run=${run}` : ""}` },
  };
}
