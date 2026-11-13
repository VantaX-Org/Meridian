"use client";

/**
 * The cleaning cycle of one object as a StepFlow: pull, clean, upload, score, compare. One task per screen, one primary
 * action, and every step is gated by a short check list (a fail blocks, a warning needs a confirm). `?step=` opens a step.
 */
import { useCallback, useState } from "react";
import { StepFlow, type FlowStep } from "@/design/next/kit";
import { useObjectCycle, type CycleStep } from "@/lib/api/next/runs";
import type { RoundTripResult } from "@/lib/api/v2/roundtrip";
import { useUrlParam } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";
import { cycleLine, dqsOf, statusOf } from "./model";
import { PullStep } from "./cycle/PullStep";
import { CleanStep } from "./cycle/CleanStep";
import { UploadStep, type UploadGate } from "./cycle/UploadStep";
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

type GateStatus = "pass" | "warn" | "fail";
interface Gate { id: string; status: GateStatus; text: string }

/** The checks that gate one step, in plain words. */
export function GateList({ gates }: { gates: Gate[] }) {
  if (gates.length === 0) return null;
  const word: Record<GateStatus, () => string> = { pass: () => t("Passed"), warn: () => t("Warning"), fail: () => t("Failed") };
  return (
    <ul className="nx-checks" data-testid="gate-list" aria-label={t("Checks before this step")}>
      {gates.map((g) => (
        <li key={g.id} data-status={g.status} data-testid={`gate-${g.id}`}>
          <span className="nx-checks-state">{word[g.status]()}</span> {g.text}
        </li>
      ))}
    </ul>
  );
}

export function CycleTab({ o, upload }: { o: ObjectRun; upload?: (file: File, parent?: string, confirmWarnings?: boolean) => Promise<RoundTripResult> }) {
  const { cycle } = useObjectCycle(o.runId, o.module);
  const firstRun = !o.runs.isLoading && o.heads.length === 0;
  const at: CycleStep = firstRun ? "pull" : (cycle?.step ?? "pull");
  const [asked] = useUrlParam<string>("step", "", ["", ...STEPS]);
  const [epoch, setEpoch] = useState(0);
  const [restart, setRestart] = useState(false);
  const [downloaded, setDownloaded] = useState(false);
  const [skipDownload, setSkipDownload] = useState(false);
  const [gate, setGate] = useState<UploadGate | null>(null);
  const onGate = useCallback((g: UploadGate) => setGate(g), []);

  const status = o.run ? statusOf(o.run) : null;
  const running = status === "running";
  const failed = status === "failed";
  const now = dqsOf(o.run, o.module);
  const before = dqsOf(o.previous, o.module);
  const parentNumber = o.run?.parent_version_id ? (o.previous?.run_number ?? null) : null;
  const line = cycleLine(cycle?.number ?? null, o.run?.run_number ?? null, parentNumber, now, now !== null && before !== null ? now - before : null);

  const haveDownload = downloaded || !!cycle?.downloaded_at;
  const noRun = !o.run;

  const pullGates: Gate[] = [{ id: "run", status: noRun ? "fail" : "pass", text: noRun ? t("There is no run of this object yet.") : t("A run of this object exists.") }];
  const cleanGates: Gate[] = [{ id: "download", status: haveDownload ? "pass" : "warn", text: haveDownload ? t("The cleaning workbook was downloaded.") : t("The cleaning workbook was not downloaded yet.") }];
  const scoreGates: Gate[] = [{ id: "score", status: failed ? "fail" : running ? "warn" : "pass", text: failed ? t("Scoring failed.") : running ? t("Scoring is still running.") : t("The run is scored.") }];

  const cleanBlocked = !haveDownload && !skipDownload ? t("Download the workbook, or confirm you already have it.") : undefined;

  const steps: FlowStep[] = [
    {
      id: "pull",
      label: LABEL.pull(),
      body: (<><GateList gates={pullGates} /><PullStep o={o} /></>),
      blocked: noRun ? t("Pull this object from the system first.") : undefined,
    },
    {
      id: "clean",
      label: LABEL.clean(),
      body: (
        <>
          <GateList gates={cleanGates} />
          <CleanStep o={o} onDownloaded={() => setDownloaded(true)} />
          {!haveDownload ? (
            <label className="nx-confirm-line">
              <input type="checkbox" checked={skipDownload} onChange={(e) => setSkipDownload(e.target.checked)} data-testid="confirm-skip-download" />{" "}
              {t("I already have the workbook")}
            </label>
          ) : null}
        </>
      ),
      blocked: cleanBlocked,
    },
    {
      id: "upload",
      label: LABEL.upload(),
      body: <UploadStep o={o} upload={upload} onScored={() => undefined} onGate={onGate} />,
      blocked: gate?.hold ?? undefined,
      next: { label: gate?.scored ? t("Next") : t("Upload and score"), run: () => gate?.submit() },
    },
    {
      id: "score",
      label: LABEL.score(),
      body: (<><GateList gates={scoreGates} /><ScoreStep o={o} /></>),
      blocked: running ? t("Scoring is still running.") : failed ? t("Scoring failed. Add the workbook again.") : undefined,
      failed,
    },
    {
      id: "compare",
      label: LABEL.compare(),
      body: <CompareStep o={o} cycle={cycle?.number ?? null} onNextCycle={() => { setRestart(true); setEpoch((e) => e + 1); }} />,
      next: { label: t("Start the next cycle") },
    },
  ];

  const seed: CycleStep = restart ? "clean" : asked !== "" ? (asked as CycleStep) : at;
  const ready = !o.runs.isLoading;

  return (
    <div className="nx-cycle" data-testid="cycle-tab">
      {line ? <p className="nx-cycle-line nx-num" data-testid="cycle-line">{line}</p> : null}
      {ready ? (
        <StepFlow
          key={`${epoch}:${asked}`}
          steps={steps}
          label={t("Steps of the cleaning cycle")}
          initial={STEPS.indexOf(seed)}
          onFinish={() => { setRestart(true); setSkipDownload(false); setDownloaded(false); setEpoch((e) => e + 1); }}
        />
      ) : null}
    </div>
  );
}
