"use client";

/**
 * The cleaning cycle of one object as five steps: pull, clean, upload, score, compare. The step the cycle is on is
 * marked; any step can be opened (`?step=`) and its sheet shows beside the list, under it at phone width.
 */
import type { ReactNode } from "react";
import { Stepper, type StepItem, type StepState } from "@/design/next/kit";
import { useObjectCycle, type CycleStep } from "@/lib/api/next/runs";
import type { RoundTripResult } from "@/lib/api/v2/roundtrip";
import { useUrlParam } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";
import { cycleLine, dqsOf, statusOf } from "./model";
import { PullStep } from "./cycle/PullStep";
import { CleanStep } from "./cycle/CleanStep";
import { UploadStep } from "./cycle/UploadStep";
import { ScoreStep } from "./cycle/ScoreStep";
import { CompareStep } from "./cycle/CompareStep";
import type { ObjectRun } from "./useObjectRun";

export const STEPS: readonly CycleStep[] = ["pull", "clean", "upload", "score", "compare"];

const LABEL: Record<CycleStep, () => string> = {
  pull: () => t("Pull from the system"),
  clean: () => t("Download and clean"),
  upload: () => t("Upload the cleaned workbook"),
  score: () => t("Score"),
  compare: () => t("Compare with the run before"),
};

export function CycleTab({ o, upload }: { o: ObjectRun; upload?: (file: File, parent?: string) => Promise<RoundTripResult> }) {
  const { cycle } = useObjectCycle(o.runId, o.module);
  const firstRun = !o.runs.isLoading && o.heads.length === 0;
  const at: CycleStep = firstRun ? "pull" : (cycle?.step ?? "pull");
  const [step, setStep] = useUrlParam<CycleStep>("step", at, STEPS);
  const running = o.run ? statusOf(o.run) === "running" : false;
  const failed = o.run ? statusOf(o.run) === "failed" : false;

  const steps: StepItem[] = STEPS.map((id, i) => {
    const pos = STEPS.indexOf(at);
    let state: StepState = i < pos ? "done" : i === pos ? "current" : "future";
    if (id === "score" && running) state = "running";
    if (id === "score" && failed) state = "failed";
    return { id, label: LABEL[id](), state };
  });

  const now = dqsOf(o.run, o.module);
  const before = dqsOf(o.previous, o.module);
  const parentNumber = o.run?.parent_version_id ? (o.previous?.run_number ?? null) : null;
  const line = cycleLine(cycle?.number ?? null, o.run?.run_number ?? null, parentNumber, now, now !== null && before !== null ? now - before : null);

  let sheet: ReactNode;
  if (step === "pull") sheet = <PullStep o={o} />;
  else if (step === "clean") sheet = <CleanStep o={o} />;
  else if (step === "upload") sheet = <UploadStep o={o} upload={upload} onScored={() => setStep("compare")} />;
  else if (step === "score") sheet = <ScoreStep o={o} />;
  else sheet = <CompareStep o={o} cycle={cycle?.number ?? null} onNextCycle={() => setStep("clean")} />;

  return (
    <div className="nx-cycle" data-testid="cycle-tab">
      {line ? <p className="nx-cycle-line nx-num" data-testid="cycle-line">{line}</p> : null}
      <div className="nx-cycle-body">
        <Stepper steps={steps} orientation="vertical" label={t("Steps of the cleaning cycle")} selectedId={step} onSelect={(id) => setStep(id as CycleStep)} />
        <div className="nx-cycle-sheet nx-card" data-testid={`cycle-sheet-${step}`}>
          <h2 className="nx-cycle-h">{LABEL[step]()}</h2>
          {sheet}
        </div>
      </div>
    </div>
  );
}
