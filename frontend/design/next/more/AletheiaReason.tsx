"use client";

import { useQuery } from "@tanstack/react-query";
import { getReason, type CausalRisk } from "@/lib/api/v2/aletheia-engine";
import { useFixture } from "@/lib/api/v2/fixture";
import { formatDate } from "@/lib/format";
import { t } from "@/lib/v2/i18n";
import { f1, int } from "@/lib/v2/score";
import { DeltaBar } from "@/design/v2/charts";
import { Code, DataTable, EmptyState, ErrorState, Skeleton, type Column } from "../kit";
import { AreaTrend } from "../viz";
import { Banner } from "./cfg-parts";
import { DeviationTable, ENGINE_OFF, EvidencePanel, Mark, QueryPanel } from "./aletheia-parts";

/**
 * Aletheia reason (GET /aletheia/reason): the runs that fell out of line and the rules and dimensions whose change
 * moved the composite score, each with its evidence. Both lists are deterministic; the engine layer says why when it
 * is off. Only scores and per-rule counts are ever sent.
 */

function useReason() {
  const fixture = useFixture();
  return useQuery({ queryKey: ["aletheia", "reason", fixture], queryFn: () => getReason(), staleTime: 60_000 });
}

type Q = ReturnType<typeof useReason>;

function AnomalyPanel({ q }: { q: Q }) {
  return (
    <QueryPanel q={q} title={t("Runs that fell out of line")} meta={t("Each run against the runs before it, deterministic")} testId="rs-anomalies">
      {(d) => {
        const det = d.deterministic;
        if (!det.available) return <><EmptyState heading={t("Four scored runs are needed before runs can be compared with their history.")} /><EvidencePanel ev={det.anomaly_evidence} testId="rs-anomaly-evidence" /></>;
        const pts = d.runs.filter((r) => r.composite != null).map((r) => ({ label: r.label ?? formatDate(r.run_at), value: r.composite as number }));
        return (
          <>
            <AreaTrend points={pts} label={t("Composite score per run")} height={160} empty={t("No runs yet")} />
            {det.anomalies.length === 0 ? <EmptyState heading={t("Every run is in line with the runs before it.")} /> : (
              <DeviationTable rows={det.anomalies} labels={d.labels} caption={t("Runs that fell out of line")} testId="rs-anomaly-table" />
            )}
            <EvidencePanel ev={det.anomaly_evidence} testId="rs-anomaly-evidence" />
          </>
        );
      }}
    </QueryPanel>
  );
}

function RiskPanel({ q }: { q: Q }) {
  const columns: Column<CausalRisk>[] = [
    { id: "driver", label: t("Driver"), cell: (r) => <Code code={r.driver} text={r.name} /> },
    { id: "kind", label: t("Kind"), cell: (r) => (r.kind === "rule" ? t("Rule") : t("Dimension")) },
    { id: "change", label: t("Change in latest run"), align: "end", cell: (r) => f1(r.change) },
    { id: "effect", label: t("Effect on the composite"), align: "end", cell: (r) => <><DeltaBar d={r.effect} /> {f1(r.effect)}</>, compare: (a, b) => (a.effect ?? 0) - (b.effect ?? 0) },
    { id: "confidence", label: t("Confidence"), align: "end", cell: (r) => t("{n} out of 100", { n: int(r.confidence) }), compare: (a, b) => a.confidence - b.confidence },
  ];
  return (
    <QueryPanel q={q} title={t("What is pulling the score down")} meta={t("Rules and dimensions ranked by their effect on the composite")} testId="rs-risks">
      {(d) => {
        const det = d.deterministic;
        if (!det.available) return <><EmptyState heading={t("Four scored runs are needed before drivers can be ranked.")} /><EvidencePanel ev={det.risk_evidence} testId="rs-risk-evidence" /></>;
        return (
          <>
            {det.risks.length === 0 ? <EmptyState heading={t("No rule or dimension is pulling the score down in the latest run.")} /> : (
              <DataTable rows={det.risks} columns={columns} rowKey={(r) => `${r.kind}-${r.driver}`} rowLabel={(r) => r.name} caption={t("What is pulling the score down")} />
            )}
            <EvidencePanel ev={det.risk_evidence} testId="rs-risk-evidence" />
          </>
        );
      }}
    </QueryPanel>
  );
}

function EnginePanel({ q }: { q: Q }) {
  return (
    <QueryPanel q={q} title={t("What the engine reasons")} meta={t("Aletheia reasoning over run-level scores and counts only")} testId="rs-engine">
      {(d) => {
        const e = d.engine;
        const why = e.reason === "too_few_runs" ? t("Four scored runs are needed before the engine can reason about the runs.") : (ENGINE_OFF[e.reason ?? "engine_error"] ?? ENGINE_OFF.engine_error)();
        return (
          <>
            <Mark />
            {e.available && e.anomalies.length + e.risks.length > 0
              ? <p className="nx-sub" data-testid="rs-engine-count">{t("{a} anomalies and {r} causal risks from the engine", { a: int(e.anomalies.length), r: int(e.risks.length) })}</p>
              : <EmptyState heading={e.available ? t("The engine found nothing beyond the results above.") : why} />}
            <EvidencePanel ev={e.evidence} testId="rs-engine-evidence" />
          </>
        );
      }}
    </QueryPanel>
  );
}

export function AletheiaReason() {
  const q = useReason();
  const title = t("Reason");
  if (q.isPending) return <Skeleton lines={6} label={title} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const d = q.data;
  const lede = t("Which runs fell out of line and which rules and dimensions moved the composite score, each with its evidence. The results are deterministic; the Aletheia engine adds its own reasoning from run-level scores and counts only.");
  if (d.runs.length === 0) return <EmptyState heading={t("No runs yet. Run an analysis, then come back to see what moved the score.")}>{lede}</EmptyState>;
  const det = d.deterministic;
  const worst = det.risks[0];
  return (
    <div className="nx-body" data-testid="aletheia-reason">
      <Banner
        title={title}
        why={!det.available ? t("Not enough runs to reason about the score") : det.anomalies.length === 0 ? t("Every run is in line with its history") : t("Some runs fell out of line with their history")}
        meta={`${worst ? t("Biggest driver: {driver}.", { driver: worst.name }) : t("No rule or dimension is pulling the score down.")} ${lede}`}
        label={title}
        testId="rs-banner"
        figs={[
          { label: t("Runs out of line"), value: det.available ? int(det.anomalies.length) : f1(null) },
          { label: t("Drivers found"), value: det.available ? int(det.risks.length) : f1(null) },
          { label: t("Biggest effect"), value: worst ? f1(worst.effect) : f1(null), note: worst ? t("{n} out of 100", { n: int(worst.confidence) }) : undefined },
          { label: t("Runs read"), value: int(d.runs.length) },
        ]}
      />
      <AnomalyPanel q={q} />
      <RiskPanel q={q} />
      <EnginePanel q={q} />
    </div>
  );
}
