"use client";

import { useQuery } from "@tanstack/react-query";
import { getReason, type Reason } from "@/lib/api/v2/aletheia-engine";
import { useFixture } from "@/lib/api/v2/fixture";
import { formatDate } from "@/lib/format";
import { t } from "@/lib/v2/i18n";
import { labelText } from "@/lib/v2/labels";
import { f1, int } from "@/lib/v2/score";
import { ChartFrame, DeltaBar, niceTicks, TrendChart } from "../charts";
import { Coded, EmptyFrame, PageTitle } from "../parts";
import { Lede } from "../RunParts";
import { CcBanner, CcPage } from "./cc-parts";
import { EvidencePanel, Mark } from "./AletheiaForesight";
import { ENGINE_OFF } from "./Insights";
import { retry, Section, Table } from "./WorkAnalytics";

/**
 * Aletheia reason (api/routes/aletheia_engine.py, GET /aletheia/reason): the runs that fell out of line and the rules
 * and dimensions whose change moved the composite score, each with its evidence. Both lists are deterministic and answer
 * without the engine; the engine layer says why when it is off. Only scores and per-rule counts are ever sent.
 */

const metricName = (d: Reason, m: string) => <Coded code={m} text={m.startsWith("dimension:") ? t("{dimension} dimension", { dimension: labelText(m.slice(10)) }) : d.labels[m]} />;

function useReason() {
  const fixture = useFixture();
  return useQuery({ queryKey: ["aletheia", "reason", fixture], queryFn: getReason, staleTime: 60_000, retry });
}

function AnomalyPanel({ q }: { q: ReturnType<typeof useReason> }) {
  return (
    <Section q={q} title={t("Runs that fell out of line")} meta={t("Each run against the runs before it, deterministic")} testId="rs-anomalies">
      {(d) => {
        const det = d.deterministic;
        if (!det.available) return <><EmptyFrame>{t("Four scored runs are needed before runs can be compared with their history.")}</EmptyFrame><EvidencePanel ev={det.anomaly_evidence} testId="rs-anomaly-evidence" /></>;
        const pts = d.runs.filter((r) => r.composite != null).map((r, i) => ({ id: r.version_id ?? String(i), label: formatDate(r.run_at), title: r.label ?? formatDate(r.run_at), value: r.composite as number }));
        const ticks = niceTicks(Math.max(0, Math.min(...pts.map((p) => p.value)) - 2), Math.min(100, Math.max(...pts.map((p) => p.value)) + 2));
        const first = det.anomalies[0];
        const at = first ? pts.findIndex((p) => p.id === first.version_id) : -1;
        const title = t("Composite score per run");
        return (
          <>
            <ChartFrame title={title} height={160}>
              <TrendChart points={pts} domain={[ticks[0], ticks[ticks.length - 1]] as const} ticks={ticks} height={160} label={title} yLabel={t("score")} format={f1} marker={at >= 0 ? { index: at, label: first.label ?? "" } : null} />
            </ChartFrame>
            {det.anomalies.length === 0 ? <EmptyFrame>{t("Every run is in line with the runs before it.")}</EmptyFrame> : (
              <Table title={t("Runs that fell out of line")} head={[t("Run"), t("Measure"), t("Expected"), t("Observed"), t("Deviation"), t("Severity")]}>
                {det.anomalies.map((a) => (
                  <tr key={`${a.version_id}-${a.metric}`}>
                    <th scope="row" className="m2-card-lead">{a.label ?? formatDate(a.run_at)}</th>
                    <td data-label={t("Measure")}>{metricName(d, a.metric)}</td>
                    <td data-label={t("Expected")} className="m2-num">{f1(a.expected)}</td>
                    <td data-label={t("Observed")} className="m2-num">{f1(a.observed)}</td>
                    <td data-label={t("Deviation")} className="m2-num">{a.z == null ? f1(null) : a.z.toFixed(1)}</td>
                    <td data-label={t("Severity")}>{a.severity === "high" ? t("High") : t("Medium")}</td>
                  </tr>
                ))}
              </Table>
            )}
            <EvidencePanel ev={det.anomaly_evidence} testId="rs-anomaly-evidence" />
          </>
        );
      }}
    </Section>
  );
}

function RiskPanel({ q }: { q: ReturnType<typeof useReason> }) {
  return (
    <Section q={q} title={t("What is pulling the score down")} meta={t("Rules and dimensions ranked by their effect on the composite")} testId="rs-risks">
      {(d) => {
        const det = d.deterministic;
        if (!det.available) return <><EmptyFrame>{t("Four scored runs are needed before drivers can be ranked.")}</EmptyFrame><EvidencePanel ev={det.risk_evidence} testId="rs-risk-evidence" /></>;
        return (
          <>
            {det.risks.length === 0 ? <EmptyFrame>{t("No rule or dimension is pulling the score down in the latest run.")}</EmptyFrame> : (
              <Table title={t("What is pulling the score down")} head={[t("Driver"), t("Kind"), t("Change in latest run"), t("Effect on the composite"), t("Confidence")]}>
                {det.risks.map((r) => (
                  <tr key={`${r.kind}-${r.driver}`}>
                    <th scope="row" className="m2-card-lead"><Coded code={r.driver} text={r.name} /></th>
                    <td data-label={t("Kind")}>{r.kind === "rule" ? t("Rule") : t("Dimension")}</td>
                    <td data-label={t("Change in latest run")} className="m2-num">{f1(r.change)}</td>
                    <td data-label={t("Effect on the composite")} className="m2-num"><DeltaBar d={r.effect} /> {f1(r.effect)}</td>
                    <td data-label={t("Confidence")} className="m2-num">{t("{n} out of 100", { n: int(r.confidence) })}</td>
                  </tr>
                ))}
              </Table>
            )}
            <EvidencePanel ev={det.risk_evidence} testId="rs-risk-evidence" />
          </>
        );
      }}
    </Section>
  );
}

function EnginePanel({ q }: { q: ReturnType<typeof useReason> }) {
  return (
    <Section q={q} title={t("What the engine reasons")} meta={t("Aletheia reasoning over run-level scores and counts only")} testId="rs-engine">
      {(d) => {
        const e = d.engine;
        const why = e.reason === "too_few_runs" ? t("Four scored runs are needed before the engine can reason about the runs.") : (ENGINE_OFF[e.reason ?? "engine_error"] ?? ENGINE_OFF.engine_error)();
        return (
          <>
            <Mark />
            {e.available && e.anomalies.length + e.risks.length > 0
              ? <p className="m2-meta" data-testid="rs-engine-count">{t("{a} anomalies and {r} causal risks from the engine", { a: int(e.anomalies.length), r: int(e.risks.length) })}</p>
              : <EmptyFrame>{e.available ? t("The engine found nothing beyond the results above.") : why}</EmptyFrame>}
            <EvidencePanel ev={e.evidence} testId="rs-engine-evidence" />
          </>
        );
      }}
    </Section>
  );
}

export function AletheiaReason() {
  const q = useReason();
  const title = t("Reason");
  const d = q.data;
  const worst = d?.deterministic.risks[0];
  const noRuns = d != null && d.runs.length === 0;
  return (
    <CcPage>
      <PageTitle>{title}</PageTitle>
      <Lede>{t("Which runs fell out of line and which rules and dimensions moved the composite score, each with its evidence. The results are deterministic; the Aletheia engine adds its own reasoning from run-level scores and counts only.")}</Lede>
      {noRuns ? <EmptyFrame>{t("No runs yet. Run an analysis, then come back to see what moved the score.")}</EmptyFrame> : null}
      {d && !noRuns ? (
        <CcBanner
          eyebrow={title}
          headline={!d.deterministic.available ? t("Not enough runs to reason about the score") : d.deterministic.anomalies.length === 0 ? t("Every run is in line with its history") : t("Some runs fell out of line with their history")}
          verdict={!d.deterministic.available ? undefined : d.deterministic.anomalies.some((a) => a.severity === "high") ? "at-risk" : "go"}
          why={worst ? t("Biggest driver: {driver}.", { driver: worst.name }) : t("No rule or dimension is pulling the score down.")}
          figs={[
            { label: t("Runs out of line"), value: d.deterministic.available ? int(d.deterministic.anomalies.length) : f1(null) },
            { label: t("Drivers found"), value: d.deterministic.available ? int(d.deterministic.risks.length) : f1(null) },
            { label: t("Biggest effect"), value: worst ? f1(worst.effect) : f1(null), note: worst ? t("{n} out of 100", { n: int(worst.confidence) }) : undefined },
            { label: t("Runs read"), value: int(d.runs.length) },
          ]}
          testId="rs-banner"
          label={title}
        />
      ) : null}
      {noRuns ? null : <><AnomalyPanel q={q} /><RiskPanel q={q} /><EnginePanel q={q} /></>}
    </CcPage>
  );
}
