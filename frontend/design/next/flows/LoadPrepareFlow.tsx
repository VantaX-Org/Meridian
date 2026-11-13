"use client";

/**
 * The load as a six-step sheet: `?sheet=load:<runId>&step=n`. Choose target, Validate, Files, Approve, Load, Verify.
 * The step is in the URL; the target and objects are kept in sessionStorage so a refresh in the middle lands in the same place.
 */
import { useEffect, useState } from "react";
import { SegBar } from "@/design/next/kit/charts";
import { Button, EmptyState, ErrorState, ProgressBar, Sheet, Skeleton } from "@/design/next/kit";
import { exportLoadFiles } from "@/lib/api/v2/migration";
import { useLoadRuns, useLoadSimulation } from "@/lib/api/next/load";
import { readApproval } from "@/lib/api/next/load";
import { t } from "@/lib/v2/i18n";
import { loadBlock, loadReason } from "../load/approval";
import { ApprovePanel } from "../load/Approve";
import { ChooseTarget } from "../load/ChooseTarget";
import { Files } from "../load/Files";
import { PairedTrio } from "../load/PairedTrio";
import { loadSegs } from "../load/segs";
import { compactInt, Denied, StaleNudge, useGuard } from "../load/states";
import { type TargetId } from "../load/tabs";
import { Validate } from "../load/Validate";
import { useV2Session } from "@/lib/v2/hooks";

export const LOAD_STEPS = () => [t("Choose target"), t("Validate"), t("Files"), t("Approve"), t("Load"), t("Verify")];

interface Saved { target: TargetId; objects: string[] | null }
const key = (run: string) => `mn_next_load_flow_${run || "latest"}`;
export function readSaved(run: string): Saved | null {
  try { const v = window.sessionStorage.getItem(key(run)); return v ? (JSON.parse(v) as Saved) : null; } catch { return null; }
}
export function writeSaved(run: string, s: Saved) {
  try { window.sessionStorage.setItem(key(run), JSON.stringify(s)); } catch { /* storage may be blocked */ }
}

export function LoadPrepareFlow({ id, step, setStep, close, under, setRun }: { id: string; step: number; setStep: (n: number) => void; close: () => void; under: boolean; setRun?: (id: string) => void }) {
  const session = useV2Session();
  const runs = useLoadRuns();
  const list = runs.data ?? [];
  const run = list.find((r) => r.id === id) ?? (id ? null : list[0] ?? null);
  const [target, setTarget] = useState<TargetId>("s4");
  const [objects, setObjects] = useState<string[] | null>(null);
  const [loadedId, setLoadedId] = useState<string | null>(null);
  const restored = loadedId === id;
  const guard = useGuard();
  const [handed, setHanded] = useState(0);
  const [failed, setFailed] = useState(false);
  const labels = LOAD_STEPS();
  const n = Math.min(Math.max(step, 1), 6);
  const runId = run?.id ?? "";
  const sim = useLoadSimulation(n >= 5 ? runId || null : null);

  if (loadedId !== id) {
    // The saved choice for this run is read once per run, while rendering, so no frame shows the defaults first.
    const s = readSaved(id);
    setLoadedId(id);
    if (s) { setTarget(s.target); setObjects(s.objects); }
  }
  useEffect(() => { if (restored) writeSaved(id, { target, objects }); }, [restored, id, target, objects]);

  const chosen = objects ?? run?.modules ?? [];
  const newest = list[0];
  const stale = newest && run && newest.id !== run.id ? newest.id : null;
  const approval = restored && runId ? readApproval(runId) : null;
  const block = approval ? (loadBlock(approval) ? loadReason(approval) : undefined) : t("The first approval is not given yet.");

  if (!session.can("export")) return <Sheet open onClose={close} title={t("Load")} size="medium" under={under}><Denied right={t("export")} /></Sheet>;

  const handOver = () =>
    guard.run(async () => {
      setFailed(false);
      setHanded(0);
      try {
        await exportLoadFiles(runId, "xlsx");
        setHanded(1);
      } catch {
        setFailed(true);
      }
    });

  let body;
  if (runs.isLoading || !restored) body = <Skeleton lines={5} label={t("Loading the runs")} />;
  else if (runs.isError) body = <ErrorState sentence={t("The runs could not be loaded.")} error={runs.error} onRetry={() => void runs.refetch()} />;
  else if (!run) body = <div data-testid="load-no-run"><EmptyState heading={t("No run to load from")}>{t("Run an analysis first. Its result is what the files are built from.")}</EmptyState></div>;
  else if (n === 1) {
    body = <ChooseTarget runs={list} target={target} runId={runId} objects={chosen} onTarget={setTarget} onRun={(r) => { setObjects(null); setRun?.(r); }} onObjects={setObjects} onNext={() => setStep(2)} onWorkbook={close} />;
  } else if (n === 2) body = <Validate runId={runId} objects={chosen} release={run.target_release ?? "s4hana"} onBack={() => setStep(1)} onBuild={() => setStep(3)} />;
  else if (n === 3) body = <Files runId={runId} objects={chosen} onBack={() => setStep(2)} />;
  else if (n === 4) body = <ApprovePanel runId={runId} />;
  else if (n === 5) {
    const none = sim.data && sim.data.totals.would_load === 0;
    body = (
      <section className="nx-ld-step" data-testid="load-run">
        <p className="nx-ld-lede">{t("The target loads the files with its own tool. Meridian hands the files over and keeps the count it expects.")}</p>
        {none ? <p data-testid="load-zero">{t("Nothing would load. Go back and fix the rejected rows.")}</p> : null}
        {sim.data ? <SegBar segs={loadSegs(sim.data.totals)} format={compactInt} testid="run-bar" /> : null}
        <ProgressBar value={handed} label={t("Files handed over")} text={handed ? t("Handed over") : failed ? t("Failed") : t("Not started")} />
        {failed ? <ErrorState sentence={t("The files could not be built. Try again.")} onRetry={() => void handOver()} /> : null}
        <Button variant="primary" icon="download" loading={guard.busy} disabled={Boolean(block) || Boolean(none)} reason={block ?? (none ? t("Nothing would load.") : undefined)} onClick={() => void handOver()}>{t("Hand over the files")}</Button>
      </section>
    );
  } else {
    body = (
      <section className="nx-ld-step" data-testid="load-verify">
        {sim.isLoading ? <Skeleton lines={2} label={t("Loading the expected count")} /> : (
          <>
            {sim.data ? <SegBar segs={loadSegs(sim.data.totals)} format={compactInt} testid="verify-bar" /> : null}
            <p className="nx-num">{t("Expected after the load: {n} rows", { n: compactInt(sim.data?.totals.would_load ?? 0) })}</p>
          </>
        )}
        <p className="nx-ld-lede">{t("Read the same objects back from the target. The actual target DQS below fills in when that read has run.")}</p>
        <PairedTrio />
      </section>
    );
  }

  const inBody = n <= 3;
  return (
    <Sheet
      open
      onClose={close}
      title={t("Load")}
      meta={run?.id}
      size="large"
      steps={labels.map((l, i) => ({ id: String(i), label: l }))}
      step={n}
      onStep={(s) => (s === 1 || run) && setStep(s)}
      under={under}
      primary={inBody ? undefined : n === 4 ? <Button variant="primary" disabled={Boolean(block)} reason={block} onClick={() => setStep(5)}>{t("Next: {step}", { step: labels[4] })}</Button> : n === 5 ? <Button variant="primary" disabled={handed === 0} reason={t("Hand over the files first.")} onClick={() => setStep(6)}>{t("Next: {step}", { step: labels[5] })}</Button> : <Button variant="primary" onClick={close}>{t("Done")}</Button>}
      secondary={n > 3 ? <Button variant="secondary" onClick={() => setStep(n - 1)}>{t("Back")}</Button> : undefined}
    >
      <div data-testid={`load-step-${n}`}>
        {stale ? <StaleNudge newer={stale} onOpen={() => setRun?.(stale)} /> : null}
        {body}
      </div>
    </Sheet>
  );
}
