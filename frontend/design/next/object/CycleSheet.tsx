"use client";

/**
 * The cleaning cycle as a sheet: `?sheet=cycle:<system>/<module>&step=n`. Five steps (pull, clean, upload, score,
 * compare), each with the checks that must hold before it. The step bodies are the same components the Cycle tab uses.
 */
import { useMemo } from "react";
import { Button, Sheet } from "@/design/next/kit";
import { useObjectCycle } from "@/lib/api/next/runs";
import { useV2Session } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";
import { STEPS } from "./CycleTab";
import { statusOf } from "./model";
import { CleanStep } from "./cycle/CleanStep";
import { CompareStep } from "./cycle/CompareStep";
import { GateList, type CheckRow } from "./cycle/CheckList";
import { PullStep } from "./cycle/PullStep";
import { ScoreStep, useScoreNow } from "./cycle/ScoreStep";
import { UploadStep } from "./cycle/UploadStep";
import { useObjectRun, type ObjectRun } from "./useObjectRun";

const LABEL = [() => t("Pull from the system"), () => t("Download and clean"), () => t("Upload the cleaned workbook"), () => t("Score"), () => t("Compare with the run before")];

/** The checks before each step. A fail names what is missing; a warning does not stop the step. */
export function gatesOf(i: number, o: ObjectRun, rights: { pull: boolean; analyse: boolean }): CheckRow[] {
  const hasRun = Boolean(o.runId);
  const running = o.run ? statusOf(o.run) === "running" : false;
  const row = (id: string, label: string, ok: boolean, warn = false): CheckRow => ({ id, label, status: ok ? "pass" : warn ? "warn" : "fail" });
  const run = row("run", t("The object has a run"), hasRun);
  const idle = row("idle", t("The run is not being scored"), !running, true);
  if (i === 0) return [row("system", t("The system is found"), Boolean(o.systemId)), row("right", t("You may pull a new run"), rights.pull, true)];
  if (i === 1) return [run, idle];
  if (i === 2) return [run, row("right", t("You may upload a cleaned workbook"), rights.analyse)];
  if (i === 3) return [run, idle];
  return [run, row("two", t("There is an earlier run to compare with"), o.heads.length >= 2, true)];
}

/** Split at the last slash: the system segment may itself hold a slash-free name, the module segment never does. */
export function splitCycleId(id: string): [string, string] {
  const k = id.lastIndexOf("/");
  return k < 0 ? [id, ""] : [id.slice(0, k), id.slice(k + 1)];
}

export function CycleSheet({ id, step, setStep, close, under }: { id: string; step: number; setStep: (n: number) => void; close: () => void; under: boolean }) {
  const [sys, mod] = splitCycleId(id);
  const o = useObjectRun(sys, mod);
  const { cycle } = useObjectCycle(o.runId, o.module);
  const session = useV2Session();
  const n = Math.min(Math.max(step, 1), STEPS.length);
  const score = useScoreNow(o);
  const gates = useMemo(() => gatesOf(n - 1, o, { pull: session.can("pull"), analyse: session.can("analyse") }), [n, o, session]);
  const blocked = gates.some((g) => g.status === "fail");

  let body;
  if (n === 1) body = <PullStep o={o} />;
  else if (n === 2) body = <CleanStep o={o} />;
  else if (n === 3) body = <UploadStep o={o} onScored={() => setStep(4)} />;
  else if (n === 4) body = <ScoreStep o={o} />;
  else body = <CompareStep o={o} cycle={cycle?.number ?? null} onNextCycle={() => setStep(2)} />;

  const back = n > 1 && n < 5 ? <Button variant="secondary" onClick={() => setStep(n - 1)}>{t("Back")}</Button> : null;
  let primary;
  if (n < 3) primary = <Button variant="primary" disabled={blocked} reason={blocked ? t("A check before this step failed.") : undefined} onClick={() => setStep(n + 1)}>{t("Next: {step}", { step: LABEL[n]() })}</Button>;
  else if (n === 3) primary = <Button variant="secondary" onClick={() => setStep(4)}>{t("Next: {step}", { step: LABEL[3]() })}</Button>;
  else if (n === 4) primary = <Button variant="primary" loading={score.busy} loadingLabel={t("Starting")} disabled={Boolean(score.reason)} reason={score.reason} onClick={() => void score.score()}>{t("Score now")}</Button>;
  else primary = <Button variant="primary" onClick={() => setStep(2)}>{t("Repeat the cycle")}</Button>;
  const secondary = n === 5 ? <Button variant="secondary" onClick={close}>{t("Done")}</Button> : back;

  return (
    <Sheet
      open
      onClose={close}
      title={t("Clean {object}", { object: o.label })}
      meta={o.systemName}
      size="large"
      steps={STEPS.map((s, i) => ({ id: s, label: LABEL[i]() }))}
      step={n}
      onStep={setStep}
      primary={primary}
      secondary={secondary}
      under={under}
    >
      <div data-testid={`cycle-step-${STEPS[n - 1]}`}>
        <GateList rows={gates} />
        {n === 1 && o.heads.length > 0 ? <p><Button variant="quiet" onClick={() => setStep(2)}>{t("Use the last pull")}</Button></p> : null}
        {body}
      </div>
    </Sheet>
  );
}
