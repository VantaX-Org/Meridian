import type { ObjectSummary } from "./api/v1/objects";

export interface NarrativeInput {
  role: "lead" | "steward" | "basis";
  objects: ObjectSummary[];
}

function worstFirst(objects: ObjectSummary[]): ObjectSummary[] {
  return [...objects].sort((a, b) => (a.composite_score ?? 0) - (b.composite_score ?? 0));
}

/**
 * Deterministic, exactly-three-sentence narrative per spec section 6.
 * Sentence 1: overall state. Sentence 2: the single worst object. Sentence 3:
 * a role-specific call to action. Pure function of `objects` — no randomness,
 * no clock reads, so it is safe to unit test byte-for-byte.
 */
export function buildNarrative({ role, objects }: NarrativeInput): string {
  const sorted = worstFirst(objects);
  const failing = objects.filter((o) => o.readiness === "fail");
  const worst = sorted[0];

  const sentence1 = objects.length === 0
    ? "No objects have been analysed yet."
    : `${failing.length} of ${objects.length} objects are not ready for go-live.`;

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
