import { Stepper } from "./Stepper";

/** The clean cycle, in order. Screens label them with their own translated words. */
export const CYCLE_STEPS = ["pull", "clean", "upload", "score", "compare"] as const;
export type CycleStepId = (typeof CYCLE_STEPS)[number];

/** The five clean-cycle steps with the current one marked. A `null` step shows none done. */
export function CycleStepper({ step, labels, label }: { step: CycleStepId | null; labels: Record<CycleStepId, string>; label: string }) {
  return <Stepper label={label} current={step ? CYCLE_STEPS.indexOf(step) : 0} steps={CYCLE_STEPS.map((s) => ({ id: s, label: labels[s] }))} />;
}
