import type { ObjectSummary } from "./api/v1/objects";
import { plural } from "./format";

export interface NarrativeInput {
  role: "lead" | "steward" | "basis";
  objects: ObjectSummary[];
}

function worstFirst(objects: ObjectSummary[]): ObjectSummary[] {
  // Unanalysed objects (composite_score null) have no score to rank by, so
  // they sort after every scored object rather than being treated as the
  // worst (which a `?? 0` fallback would do).
  return [...objects].sort((a, b) => {
    if (a.composite_score == null) return b.composite_score == null ? 0 : 1;
    if (b.composite_score == null) return -1;
    return a.composite_score - b.composite_score;
  });
}

/**
 * Deterministic, exactly-three-sentence narrative per spec section 6.
 * Sentence 1: overall state. Sentence 2: the single worst object. Sentence 3:
 * a role-specific call to action. Pure function of `objects` — no randomness,
 * no clock reads, so it is safe to unit test byte-for-byte.
 */
/** Sentence 1 alone: the overall state, used as the home verdict: "N of M objects are not ready for go-live, K at risk." */
export function verdictSentence(objects: Pick<ObjectSummary, "readiness">[]): string {
  const failing = objects.filter((o) => o.readiness === "fail").length;
  const atRisk = objects.filter((o) => o.readiness === "warn").length;
  if (objects.length === 0) return "No objects have been analysed yet.";
  if (failing === 0 && atRisk === 0) return objects.length === 1 ? "The one object is ready for go-live." : `All ${objects.length.toLocaleString("en-US")} objects are ready for go-live.`;
  const total = plural(objects.length, "object");
  if (failing === 0) return `${atRisk.toLocaleString("en-US")} of ${total} ${atRisk === 1 ? "is" : "are"} at risk for go-live.`;
  return `${failing.toLocaleString("en-US")} of ${total} ${failing === 1 ? "is" : "are"} not ready for go-live${atRisk ? `, ${atRisk.toLocaleString("en-US")} at risk` : ""}.`;
}

export function buildNarrative({ role, objects }: NarrativeInput): string {
  const sorted = worstFirst(objects);
  const worst = sorted[0];

  const sentence1 = verdictSentence(objects);

  const sentence2 = worst
    ? `${worst.label} is the furthest behind, with ${worst.failing_checks} failing checks affecting ${worst.affected_records} records.`
    : "There is no object to call out yet.";

  const actions: Record<NarrativeInput["role"], string> = {
    lead: "Start with the objects list to see every object's readiness at a glance.",
    steward: "Open the objects list and work the highest-severity rule first.",
    basis: "Check the latest run's step history for any failed extraction before re-running.",
  };

  return `${sentence1} ${sentence2} ${actions[role]}`;
}
