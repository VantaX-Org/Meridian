"use client";

import { useQuery } from "@tanstack/react-query";
import { DeltaBar } from "../kit";
import { EvidencePanel } from "@/design/v2/screens/AletheiaForesight";
import { ENGINE_OFF } from "@/design/v2/screens/Insights";
import { getReason, type Anomaly, type CausalRisk, type Reason } from "@/lib/api/v2/aletheia-engine";
import { useFixture } from "@/lib/api/v2/fixture";
import { t } from "@/lib/v2/i18n";
import { labelText } from "@/lib/v2/labels";
import { f1, int } from "@/lib/v2/score";
import { Chip, Code, EmptyState, ErrorState, Skeleton } from "../kit";
import "./runs.css";

const num = (n: number | null) => (n == null ? t("not measured") : f1(n));

const metricText = (d: Reason, m: string) => (m.startsWith("dimension:") ? t("{dimension} dimension", { dimension: labelText(m.slice(10)) }) : d.labels[m] ?? m);

function RiskRow({ r }: { r: CausalRisk }) {
  return (
    <li className="nx-cell-stack" data-testid="reason-risk">
      <span><Code code={r.driver} text={r.kind === "dimension" ? t("{dimension} dimension", { dimension: labelText(r.name) }) : r.name} /></span>
      <span className="nx-sub">
        {t("Moved {change} points, worth {effect} composite points, confidence {c} percent", { change: num(r.change), effect: num(r.effect), c: int(Math.round(r.confidence * 100)) })}
      </span>
      {r.effect != null ? <DeltaBar d={r.effect} width={120} scale={4} /> : null}
    </li>
  );
}

function AnomalyRow({ a, d, mine }: { a: Anomaly; d: Reason; mine: boolean }) {
  return (
    <li className="nx-cell-stack" data-testid="reason-anomaly">
      <span>
        <Code code={a.metric} text={metricText(d, a.metric)} /> <Chip tone={a.severity === "high" ? "bad" : "warn"}>{a.severity === "high" ? t("High") : t("Medium")}</Chip>
        {mine ? <> <Chip tone="accent">{t("This run")}</Chip></> : null}
      </span>
      <span className="nx-sub">
        {t("{run}: expected {expected}, observed {observed}, {z} standard deviations away", { run: a.label ?? t("A run"), expected: num(a.expected), observed: num(a.observed), z: a.z == null ? "?" : f1(Math.abs(a.z)) })}
      </span>
    </li>
  );
}

/**
 * Aletheia's reasoning over the run history: which rules or dimensions drove the score and which runs broke from the
 * trend, each with the evidence it rests on. Only scores and per-rule counts feed it, never record values.
 */
export function ReasonPanel({ versionId, systemId }: { versionId?: string; systemId?: string | null }) {
  const fx = useFixture();
  const q = useQuery({
    queryKey: ["aletheia", "reason", fx, versionId ?? "", systemId ?? ""],
    queryFn: () => getReason({ ...(versionId ? { version_id: versionId } : {}), ...(systemId ? { system_id: systemId } : {}) }),
    staleTime: 60_000, retry: false,
  });
  const d = q.data;
  const det = d?.deterministic;
  const risks = [...(det?.risks ?? []), ...(d?.engine.risks ?? [])];
  const anomalies = [...(det?.anomalies ?? []), ...(d?.engine.anomalies ?? [])];
  return (
    <section aria-labelledby="nx-reason-h" data-testid="reason-panel">
      <h3 id="nx-reason-h" className="nx-rn-h3">{t("Why, according to Aletheia")} <Chip tone="aletheia">{t("Aletheia")}</Chip></h3>
      {q.isLoading ? <Skeleton lines={3} label={t("Loading the reasoning")} /> : null}
      {q.isError ? <ErrorState error={q.error} fallback={t("The reasoning could not be loaded.")} onRetry={() => void q.refetch()} /> : null}
      {d && det && !det.available ? <EmptyState heading={t("Not enough runs yet")}>{ENGINE_OFF.too_few_runs()}</EmptyState> : null}
      {d && det?.available ? (
        <>
          <h4 className="nx-sub">{t("What drove the score")}</h4>
          {risks.length ? <ul className="nx-rn-list">{risks.map((r) => <RiskRow key={`${r.kind}:${r.driver}`} r={r} />)}</ul> : <p className="nx-rn-note">{t("No rule or dimension stands out as a driver.")}</p>}
          <EvidencePanel ev={det.risk_evidence} testId="reason-risk-evidence" />
          <h4 className="nx-sub">{t("Runs that broke from the trend")}</h4>
          {anomalies.length ? (
            <ul className="nx-rn-list">{anomalies.map((a, i) => <AnomalyRow key={`${a.metric}:${a.version_id}:${i}`} a={a} d={d} mine={Boolean(versionId) && a.version_id === versionId} />)}</ul>
          ) : <p className="nx-rn-note">{t("Every run sits inside its normal range.")}</p>}
          <EvidencePanel ev={det.anomaly_evidence} testId="reason-anomaly-evidence" />
          {!d.engine.available && d.engine.reason ? <p className="nx-rn-note">{ENGINE_OFF[d.engine.reason]?.() ?? ENGINE_OFF.engine_error()}</p> : null}
        </>
      ) : null}
    </section>
  );
}
