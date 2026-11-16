"use client";

import { getReason, type CausalRisk, type Reason as RS } from "@/lib/api/v2/aletheia-engine";
import { t } from "@/lib/v2/i18n";
import { f1, int } from "@/lib/v2/score";
import { Code, DataTable, type Column } from "../kit";
import { ChartCard, cardState } from "../more/ChartCard";
import { QueryView } from "../more/states";
import { AreaTrend } from "../viz";
import { Banner, Block, DeviationTable, ENGINE_OFF, EvidencePanel, HBars, Mark, runTrend, status, useLift } from "./parts";

/**
 * Aletheia reason (GET /aletheia/reason): runs that fell out of line and the rules and dimensions whose change moved
 * the composite, each with its evidence. Deterministic first; the engine layer says why when it is off.
 */

const riskCols = (): Column<CausalRisk>[] => [
  { id: "driver", label: t("Driver"), cell: (r) => <Code code={r.driver} text={r.name} /> },
  { id: "kind", label: t("Kind"), cell: (r) => (r.kind === "rule" ? t("Rule") : t("Dimension")) },
  { id: "change", label: t("Change in latest run"), align: "end", cell: (r) => f1(r.change) },
  { id: "effect", label: t("Effect on the composite"), align: "end", cell: (r) => f1(r.effect), compare: (a, b) => (a.effect ?? 0) - (b.effect ?? 0) },
  { id: "conf", label: t("Confidence"), align: "end", cell: (r) => t("{n} out of 100", { n: int(r.confidence) }), compare: (a, b) => a.confidence - b.confidence },
];

function Anomalies({ d }: { d: RS }) {
  const det = d.deterministic;
  return (
    <Block title={t("Runs that fell out of line")} meta={t("Each run against the runs before it, deterministic")} testId="rs-anomalies">
      {!det.available ? <p className="nx-sub">{t("Four scored runs are needed before runs can be compared with their history.")}</p>
        : det.anomalies.length === 0 ? <p className="nx-sub">{t("Every run is in line with the runs before it.")}</p>
          : <DeviationTable rows={det.anomalies} labels={d.labels} caption={t("Runs that fell out of line")} />}
      <EvidencePanel ev={det.anomaly_evidence} testId="rs-anomaly-evidence" />
    </Block>
  );
}

function Risks({ d }: { d: RS }) {
  const det = d.deterministic;
  return (
    <Block title={t("What is pulling the score down")} meta={t("Rules and dimensions ranked by their effect on the composite")} testId="rs-risks">
      {!det.available ? <p className="nx-sub">{t("Four scored runs are needed before drivers can be ranked.")}</p>
        : det.risks.length === 0 ? <p className="nx-sub">{t("No rule or dimension is pulling the score down in the latest run.")}</p> : (
          <>
            <HBars label={t("Effect on the composite")} testId="rs-risk-bars" bars={det.risks.slice(0, 8).map((r) => ({
              key: `${r.kind}-${r.driver}`, label: r.name, value: r.effect ?? 0, text: f1(r.effect), tone: (r.effect ?? 0) < 0 ? "bad" : "good",
            }))} />
            <DataTable rows={det.risks} columns={riskCols()} rowKey={(r) => `${r.kind}-${r.driver}`} rowLabel={(r) => r.name} caption={t("What is pulling the score down")} />
          </>
        )}
      <EvidencePanel ev={det.risk_evidence} testId="rs-risk-evidence" />
    </Block>
  );
}

function Engine({ d }: { d: RS }) {
  const e = d.engine;
  const why = e.reason === "too_few_runs" ? t("Four scored runs are needed before the engine can reason about the runs.") : (ENGINE_OFF[e.reason ?? "engine_error"] ?? ENGINE_OFF.engine_error)();
  return (
    <Block title={t("What the engine reasons")} meta={t("Aletheia reasoning over run-level scores and counts only")} testId="rs-engine">
      <Mark />
      {e.available && e.anomalies.length + e.risks.length > 0
        ? <p className="nx-sub" data-testid="rs-engine-count">{t("{a} anomalies and {r} causal risks from the engine", { a: int(e.anomalies.length), r: int(e.risks.length) })}</p>
        : <p className="nx-sub">{e.available ? t("The engine found nothing beyond the results above.") : why}</p>}
      <EvidencePanel ev={e.evidence} testId="rs-engine-evidence" />
    </Block>
  );
}

export function Reason() {
  const q = useLift(["aletheia", "reason"], () => getReason(), null as RS | null);
  const d = q.data;
  const worst = d?.deterministic.risks[0];
  const trend = d ? runTrend(d.runs) : [];
  return (
    <div className="nx-body" data-testid="ins-reason">
      <p className="nx-sub">{t("Which runs fell out of line and which rules and dimensions moved the composite score, each with its evidence. The results are deterministic; the Aletheia engine adds its own reasoning from run-level scores and counts only.")}</p>
      {q.isError && status(q.error) === 403 ? <p className="nx-sub" role="alert">{t("Your role cannot read the Aletheia reasoning.")}</p> : (
      <QueryView loading={q.isLoading} error={q.isError ? t("The Aletheia reasoning could not be read.") : null} onRetry={() => void q.refetch()} empty={!d || d.runs.length === 0}
        emptyHeading={t("No runs yet. Run an analysis, then come back to see what moved the score.")} label={t("Reason")}>
        {d ? (
          <>
            <Banner
              eyebrow={t("Reason")}
              headline={!d.deterministic.available ? t("Not enough runs to reason about the score") : d.deterministic.anomalies.length === 0 ? t("Every run is in line with its history") : t("Some runs fell out of line with their history")}
              verdict={!d.deterministic.available ? undefined : d.deterministic.anomalies.some((a) => a.severity === "high") ? "at-risk" : "go"}
              why={worst ? t("Biggest driver: {driver}.", { driver: worst.name }) : t("No rule or dimension is pulling the score down.")}
              figs={[
                { label: t("Runs out of line"), value: d.deterministic.available ? d.deterministic.anomalies.length : null },
                { label: t("Drivers found"), value: d.deterministic.available ? d.deterministic.risks.length : null },
                { label: t("Biggest effect"), value: worst?.effect ?? null, format: f1, note: worst ? t("{n} out of 100", { n: int(worst.confidence) }) : undefined },
                { label: t("Runs read"), value: d.runs.length },
              ]}
              testId="rs-banner"
            />
            <div className="nx-chartcards">
              <ChartCard title={t("Composite score per run")} state={cardState(q, trend.length === 0)} figure={trend.length ? f1(trend[trend.length - 1].value) : undefined}
                emptyLine={t("Four scored runs are needed before runs can be compared with their history.")}
                chart={<AreaTrend points={trend} label={t("Composite score per run")} empty={t("Four scored runs are needed before runs can be compared with their history.")} />} />
            </div>
            <Anomalies d={d} />
            <Risks d={d} />
            <Engine d={d} />
          </>
        ) : null}
      </QueryView>
      )}
    </div>
  );
}
