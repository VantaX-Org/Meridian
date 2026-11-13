"use client";

/** The approval of one load as a sheet: review the totals, then the two approvals. `?sheet=approve:<runId>&step=n` */
import { SegBar } from "@/design/next/kit/charts";
import { Button, EmptyState, ErrorState, Sheet, Skeleton } from "@/design/next/kit";
import { useLoadApproval, useLoadRuns, useLoadSimulation } from "@/lib/api/next/load";
import { t } from "@/lib/v2/i18n";
import { loadBlock, loadReason } from "../load/approval";
import { ApprovePanel } from "../load/Approve";
import { loadSegs } from "../load/segs";
import { compactInt, StaleNudge } from "../load/states";

export const APPROVE_STEPS = () => [t("Review the totals"), t("Approve")];

export function ApproveFlow({ id, step, setStep, close, under, onLoad }: { id: string; step: number; setStep: (n: number) => void; close: () => void; under: boolean; onLoad?: () => void }) {
  const sim = useLoadSimulation(id || null);
  const runs = useLoadRuns();
  const state = useLoadApproval(id || null).data ?? null;
  const n = Math.min(Math.max(step, 1), 2);
  const newest = runs.data?.[0];
  const stale = newest && id && newest.id !== id ? newest.id : null;
  const labels = APPROVE_STEPS();
  const reason = state ? (loadBlock(state) ? loadReason(state) : undefined) : t("The first approval is not given yet.");

  let body;
  if (!id) body = <EmptyState heading={t("No run to approve")}>{t("Choose a run on the Load page first.")}</EmptyState>;
  else if (n === 1) {
    if (sim.isLoading) body = <Skeleton lines={4} label={t("Loading the totals")} />;
    else if (sim.isError) body = <ErrorState sentence={t("The totals could not be loaded.")} error={sim.error} onRetry={() => void sim.refetch()} />;
    else {
      const tot = sim.data?.totals;
      body = tot && tot.records > 0 ? (
        <div className="nx-stack">
        <SegBar segs={loadSegs(tot)} format={compactInt} testid="approve-bar" />
        <dl className="nx-ld-trio nx-num" data-testid="approve-totals">
          <div><dt>{t("Rows")}</dt><dd>{compactInt(tot.records)}</dd></div>
          <div><dt>{t("Would load")}</dt><dd>{compactInt(tot.would_load)}</dd></div>
          <div><dt>{t("Would be rejected")}</dt><dd>{compactInt(tot.would_fail)}</dd></div>
          <div><dt>{t("With a warning")}</dt><dd>{compactInt(tot.provisional)}</dd></div>
        </dl>
        </div>
      ) : <div data-testid="approve-nothing"><EmptyState heading={t("Nothing to load")}>{t("This run has no rows to load. Check that the objects were scored.")}</EmptyState></div>;
    }
  } else body = <ApprovePanel runId={id} />;

  return (
    <Sheet
      open
      onClose={close}
      title={t("Approve the load")}
      size="medium"
      steps={labels.map((l, i) => ({ id: String(i), label: l }))}
      step={n}
      onStep={setStep}
      under={under}
      primary={n === 1
        ? <Button variant="primary" disabled={!id} onClick={() => setStep(2)}>{t("Next: {step}", { step: labels[1] })}</Button>
        : <Button variant="primary" disabled={Boolean(reason)} reason={reason} onClick={() => onLoad?.()}>{t("Go to the load")}</Button>}
      secondary={n === 2 ? <Button variant="secondary" onClick={() => setStep(1)}>{t("Back")}</Button> : undefined}
    >
      <div data-testid={`approve-step-${n}`}>
        {stale ? <StaleNudge newer={stale} onOpen={close} /> : null}
        {body}
      </div>
    </Sheet>
  );
}
