"use client";

import "../../step10.css";
import { t } from "@/lib/v2/i18n";
import { int } from "@/lib/v2/score";
import { bandWords, CONFIDENCE_WORD, moneyWords, queueWords } from "@/lib/v2/step10";
import { useRunPrediction } from "@/lib/v2/step10-queries";
import { Dash, Skeleton } from "../../parts";

/**
 * Before a run is started: how long it will take (the band from the tenant's own past runs), how many records it will
 * check, what it costs in the cost model (a dash when the model prices no run) and where it would queue
 * (GET /runs/predict). Deterministic; shown in every start-extraction and start-analysis form.
 */
export function RunForecast({ systemId, modules, delta = false, what }: { systemId: string | null; modules: readonly string[]; delta?: boolean; what: "extraction" | "analysis" }) {
  const q = useRunPrediction({ system_id: systemId, modules, delta }, Boolean(systemId));
  const p = q.data;
  return (
    <section className="m2-predict" aria-label={t("Prediction before you start")} data-testid="run-prediction">
      <h4>{what === "extraction" ? t("Before you start the extraction") : t("Before you start the analysis")}</h4>
      {q.isPending ? (
        <Skeleton width="100%" height={56} />
      ) : q.isError || !p ? (
        <p className="m2-meta" style={{ marginTop: 0 }}>
          {t("No prediction could be read. The run can still be started.")}{" "}
          <button type="button" className="m2-linkbtn" onClick={() => void q.refetch()}>
            {t("Retry")}
          </button>
        </p>
      ) : (
        <>
          <dl>
            <dt>{t("Duration")}</dt>
            <dd data-testid="prediction-duration">{bandWords(p.total) ? t("{band}, {confidence}", { band: bandWords(p.total) ?? "", confidence: CONFIDENCE_WORD[p.total.confidence] }) : <Dash why={CONFIDENCE_WORD.none} />}</dd>
            <dt>{t("Records")}</dt>
            <dd>{p.total.records == null ? <Dash why={CONFIDENCE_WORD.none} /> : int(p.total.records)}</dd>
            <dt>{t("Cost")}</dt>
            <dd data-testid="prediction-cost">
              {p.cost && p.cost.amount != null ? (
                p.cost.low != null && p.cost.high != null && Math.round(p.cost.low) !== Math.round(p.cost.high) ? t("{amount} ({low} to {high})", { amount: moneyWords(p.cost.amount, p.cost.currency), low: moneyWords(p.cost.low, p.cost.currency), high: moneyWords(p.cost.high, p.cost.currency) }) : moneyWords(p.cost.amount, p.cost.currency)
              ) : (
                <Dash why={t("The cost model prices no run: set the run cost per hour or per million records under Settings")} />
              )}
            </dd>
            <dt>{t("Queue")}</dt>
            <dd data-testid="prediction-queue">{t("{position}; {running} running, {queued} queued", { position: queueWords(p.queue.position), running: p.queue.running_jobs, queued: p.queue.queued_jobs })}</dd>
          </dl>
          <p>
            {p.objects.length
              ? t("From the last {n} finished runs of {objects} {objects, plural, one {object} other {objects}}{delta}. A rule result, not a model's guess.", { n: Math.max(0, ...p.objects.map((o) => o.runs)), objects: p.objects.length, delta: p.delta ? t(", changes only") : "" })
              : t("No object of this system has a finished run to predict from yet.")}
          </p>
        </>
      )}
    </section>
  );
}
