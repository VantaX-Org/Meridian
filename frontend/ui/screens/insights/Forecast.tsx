"use client";

import { useCrumbs } from "@/ui/screens/flow";
import { getForesight, getReason, type Anomaly, type Evidence, type Foresight, type GoLiveStatus, type Reason } from "@/lib/api/v2/aletheia-engine";
import { getForecast, getPredictive } from "@/lib/api/v2/analytics";
import { getHeatmap } from "@/lib/api/v2/score";
import { t, useInterfaceLang } from "@/lib/v2/i18n";
import { AletheiaMark, BandChart, BarList, Button, Card, EmptyState, EvidenceNote, FieldChip, PageHeader, Select, SeverityPill, StatTile, TrendArea, buildBody, useAletheia, useAletheiaScope, type AletheiaAnswer, type AskContext } from "@/ui/kit";
import { streamAnswer } from "@/ui/kit/aletheia/stream";
import { useState } from "react";
import { labelText } from "@/lib/v2/labels";
import { PlanCard } from "./PlanCards";
import { Gate, InsightsNav, Mod, Tbl, day, n0, n1, sevLabel, sevOf, useQ } from "./shared";

const trendText = (s: string) => (s === "improving" ? t("Improving") : s === "declining" ? t("Declining") : s === "critical" ? t("Critical") : t("Stable"));

function ModuleForecast({ module }: { module: string }) {
  const q = useQ("forecast", () => getForecast(module), [module]);
  const f = q.data?.forecast ?? null;
  return (
    <Gate q={q} empty={!f} emptyHeading={t("Not enough runs to forecast")} emptyBody={q.data?.message ?? t("A forecast needs several scored runs.")}>
      {f ? (
        <div className="b8-stack">
          <dl className="mx-tiles">
            <StatTile label={t("Score now")} value={n1(f.current_score)} note={trendText(f.trend)} />
            <StatTile label={t("In 7 days")} value={n1(f.forecast_7d)} note={t("{a} to {b}", { a: n1(f.forecast_7d_low), b: n1(f.forecast_7d_high) })} />
            <StatTile label={t("In 30 days")} value={n1(f.forecast_30d)} note={t("{a} to {b}", { a: n1(f.forecast_30d_low), b: n1(f.forecast_30d_high) })} />
            <StatTile label={t("In 90 days")} value={n1(f.forecast_90d)} note={t("{a} to {b}", { a: n1(f.forecast_90d_low), b: n1(f.forecast_90d_high) })} />
          </dl>
          <TrendArea label={t("Fitted score history")} emptyLabel={t("No history")} points={f.history.map((p) => ({ axis: t("Day {d}", { d: String(p.day) }), title: t("Day {d}", { d: String(p.day) }), value: p.score }))} />
          <p className="mx-muted">{t("Based on {n} runs over {d} days. Confidence {c}, which is the width of the 7 day band, not a probability.", { n: n0(f.points), d: n0(f.span_days), c: n0(f.confidence) })}</p>
          {f.contributing_factors.length ? <ul className="b8-list">{f.contributing_factors.map((c) => <li key={c}>{c}</li>)}</ul> : null}
        </div>
      ) : null}
    </Gate>
  );
}

const GO_LIVE: Record<GoLiveStatus, () => string> = {
  reached: () => t("The go-live target is reached"),
  projected: () => t("The go-live target is projected"),
  not_converging: () => t("The score is not moving toward the go-live target"),
  beyond_horizon: () => t("The go-live target is beyond the projection"),
};

const offText = (r: string | null | undefined): string => (
  r === "too_few_runs" ? t("Aletheia needs at least three scored runs.")
    : r === "undated" ? t("The runs have no dates to project from.")
      : r === "not_configured" ? t("The Aletheia engine is not set up for this tenant.")
        : r === "licence_invalid" ? t("The Aletheia engine licence is not valid.")
          : t("The Aletheia engine could not be reached.")
);

const evidenceLines = (ev: Evidence): string[] => [
  t("Inputs: {v}", { v: ev.inputs.join("; ") }),
  t("Method: {v}", { v: ev.method }),
  ev.confidence == null ? t("Confidence is shown per result, as its deviation score.") : t("Confidence {n} out of 100", { n: n0(ev.confidence) }),
];

const goLiveLine = (f: Foresight): string => {
  const gl = f.projection.go_live;
  if (!gl) return t("Go-live target {n}", { n: n1(f.target) });
  return gl.projected ? `${GO_LIVE[gl.status]()} ${t("by {when}", { when: day(gl.projected) })}` : GO_LIVE[gl.status]();
};

/** Ranked by size of effect on the composite score, whatever its sign. */
const byEffect = (r: Reason) => [...r.deterministic.risks].sort((a, b) => Math.abs(b.effect ?? 0) - Math.abs(a.effect ?? 0));

const metricText = (labels: Record<string, string>, m: string) => labels[m] ?? (m.startsWith("dimension:") ? m.slice(10) : m);

function AnomalyTable({ rows, labels, label }: { rows: Anomaly[]; labels: Record<string, string>; label: string }) {
  return (
    <Tbl label={label} rows={rows} rowKey={(r) => `${r.metric}/${r.version_id}`} cols={[
      { key: "m", label: t("Measure"), render: (r) => (r.metric.startsWith("dimension:") || labels[r.metric] ? labelText(metricText(labels, r.metric)) : <FieldChip code={r.metric} description={metricText(labels, r.metric)} />) },
      { key: "r", label: t("Run"), render: (r) => `${r.label ?? r.version_id ?? t("n/a")} (${day(r.run_at)})` },
      { key: "e", label: t("Expected"), end: true, render: (r) => n1(r.expected) },
      { key: "o", label: t("Observed"), end: true, render: (r) => n1(r.observed) },
      { key: "z", label: t("Deviation"), end: true, render: (r) => n1(r.z) },
      { key: "s", label: t("Severity"), render: (r) => <SeverityPill sev={sevOf(r.severity)} label={sevLabel(r.severity)} /> },
    ]} />
  );
}

function ForesightCard({ q }: { q: ReturnType<typeof useQ<Foresight>> }) {
  const f = q.data;
  const p = f?.projection;
  const data = f ? [
    ...f.runs.filter((r) => r.composite != null).map((r) => ({ axis: day(r.run_at), value: r.composite })),
    ...(p?.band ?? []).map((b) => ({ axis: day(b.date), point: b.point, low: b.low, high: b.high })),
  ] : [];
  return (
    <Card title={t("Foresight")} sub={t("Where the composite score is heading, with a 95% band and the go-live date")} action={<AletheiaMark />}>
      <Gate q={q} empty={!p?.available} emptyHeading={t("No projection yet")} emptyBody={offText(p?.reason)}>
        {f && p ? (
          <div className="b8-stack" data-testid="foresight">
            <dl className="mx-tiles">
              <StatTile label={t("Score now")} value={n1(p.latest)} note={t("{n} points per 30 days", { n: n1(p.slope_per_30d) })} />
              <StatTile label={t("Next run")} value={n1(p.next?.point)} note={p.next ? t("{a} to {b}", { a: n1(p.next.low), b: n1(p.next.high) }) : undefined} />
              <StatTile label={t("Go-live target")} value={n1(f.target)} note={p.go_live?.earliest ? t("{a} to {b}", { a: day(p.go_live.earliest), b: day(p.go_live.latest) }) : undefined} />
            </dl>
            <p>{goLiveLine(f)}</p>
            <BandChart label={t("Composite score per run, then the projection with its 95% band")} data={data} target={f.target} />
            <EvidenceNote ev={p.evidence} testId="foresight-evidence" />
            <h3 className="mx-card-t">{t("Runs the engine did not expect")}</h3>
            {f.engine.available
              ? (f.engine.surprises.length ? <AnomalyTable label={t("Runs the engine did not expect")} rows={f.engine.surprises} labels={f.labels} /> : <p className="mx-muted">{t("Every run was in line with the ones before it.")}</p>)
              : <p className="mx-muted">{offText(f.engine.reason)}</p>}
            {f.engine.available ? <EvidenceNote ev={f.engine.evidence} testId="foresight-engine-evidence" /> : null}
          </div>
        ) : null}
      </Gate>
    </Card>
  );
}

function ReasonCard({ q }: { q: ReturnType<typeof useQ<Reason>> }) {
  const r = q.data;
  const d = r?.deterministic;
  const risks = r ? byEffect(r) : [];
  return (
    <Card title={t("Reason")} sub={t("Unusual runs, and the rules and dimensions moving the score, by effect")} action={<AletheiaMark />}>
      <Gate q={q} empty={!d?.available || (risks.length === 0 && d.anomalies.length === 0)} emptyHeading={t("No risk or unusual run found")} emptyBody={d?.available ? t("Every run is in line and no rule is moving the score.") : offText(d?.reason)}>
        {r && d ? (
          <div className="b8-stack" data-testid="reason">
            <BarList label={t("Risks by effect on the score")} items={risks.map((x) => ({ id: `${x.kind}/${x.driver}`, label: x.kind === "rule" ? `${x.driver} ${x.name}` : metricText(r.labels, `dimension:${x.driver}`), value: Math.abs(x.effect ?? 0), display: t("{n} points", { n: n1(x.effect) }) }))} />
            <EvidenceNote ev={d.risk_evidence} testId="reason-risk-evidence" />
            <h3 className="mx-card-t">{t("{count, plural, one {# unusual run} other {# unusual runs}}", { count: d.anomalies.length })}</h3>
            {d.anomalies.length ? <AnomalyTable label={t("Unusual runs")} rows={d.anomalies} labels={r.labels} /> : null}
            <EvidenceNote ev={d.anomaly_evidence} testId="reason-anomaly-evidence" />
          </div>
        ) : null}
      </Gate>
    </Card>
  );
}

/** Any other question goes to the backend chat; the answer arrives whole instead of in chunks. */
const streamed = (prompt: string, ctx?: AskContext) => new Promise<AletheiaAnswer>((resolve) => {
  streamAnswer(buildBody(prompt, ctx), {
    onEvidence: () => undefined,
    onToken: () => undefined,
    onDone: (d) => resolve({ text: d.answer, evidence: d.facts.map((x) => x.statement) }),
  }).catch(() => resolve({ text: t("Aletheia could not answer just now. Try again in a moment.") }));
});

export function Forecast() {
  const crumbs = useCrumbs();
  useInterfaceLang();
  const chat = useAletheia();
  const heat = useQ("score-heat", getHeatmap);
  const pred = useQ("predictive", getPredictive);
  const mods = (heat.data?.rows ?? []).map((r) => r.module);
  const fore = useQ("aletheia-foresight", getForesight);
  const reason = useQ("aletheia-reason", () => getReason());
  const [picked, setPicked] = useState<string | null>(null);
  const mod = picked ?? mods[0] ?? null;
  const askGoLive = t("When do we reach the go-live target?");
  const askMoving = t("What is moving the score?");
  const ctx = mod ? { module: mod } : undefined;
  useAletheiaScope({
    key: "insights/forecast",
    label: t("Asking about the forecast"),
    suggestions: [askGoLive, askMoving, t("Which object will fall below target?"), t("What happens if we do nothing?"), t("How reliable is this forecast?")],
    context: ctx,
    answer: (prompt) => {
      const f = fore.data;
      if (prompt === askGoLive && f?.projection.available) {
        return { text: `${goLiveLine(f)}. ${t("The score is {s} now and moves {n} points per 30 days.", { s: n1(f.projection.latest), n: n1(f.projection.slope_per_30d) })}`, evidence: evidenceLines(f.projection.evidence) };
      }
      const r = reason.data;
      if (prompt === askMoving && r?.deterministic.available) {
        const top = byEffect(r).slice(0, 3);
        const text = top.length
          ? top.map((x) => t("{name} moves the score by {n} points", { name: x.kind === "rule" ? `${x.driver} ${x.name}` : metricText(r.labels, `dimension:${x.driver}`), n: n1(x.effect) })).join(". ")
          : t("No rule or dimension is moving the score.");
        return { text, evidence: evidenceLines(r.deterministic.risk_evidence) };
      }
      return streamed(prompt, ctx);
    },
  });
  const warnings = pred.data?.early_warnings ?? [];
  return (
    <div className="b8-page">
      <PageHeader crumbs={crumbs("insights",t("Forecast"))} title={t("Forecast")} context={t("Where each object's score is heading, with the band it should stay in.")}
        actions={<><InsightsNav here="forecast" /><Button variant="ghost" tone="aletheia" onClick={() => chat.setOpen(true)}>{t("Ask Aletheia")}</Button></>} />
      <Card title={t("Object forecast")} action={mods.length ? <Select aria-label={t("Object")} value={mod ?? ""} onChange={(e) => setPicked(e.target.value)} options={mods.map((m) => ({ value: m, label: m }))} /> : undefined}>
        {mod ? <ModuleForecast module={mod} /> : <EmptyState heading={t("No object to forecast")} body={t("Objects appear after the first scored run.")} />}
      </Card>
      <ForesightCard q={fore} />
      <ReasonCard q={reason} />
      <PlanCard />
      <Card title={t("Early warnings")} sub={t("Signals that an object may soon cross its threshold")}>
        <Gate q={pred} empty={warnings.length === 0} emptyHeading={t("No early warnings")} emptyBody={pred.data?.reason ?? t("No object is heading toward its threshold.")}>
          <Tbl label={t("Early warnings")} rows={warnings} rowKey={(r) => `${r.module_id}/${r.signal}`} cols={[
            { key: "m", label: t("Object"), render: (r) => <Mod code={r.module_id} /> },
            { key: "s", label: t("Signal"), render: (r) => r.signal },
            { key: "r", label: t("Reason"), render: (r) => r.reason },
            { key: "t", label: t("Threshold"), end: true, render: (r) => n1(r.threshold) },
          ]} />
        </Gate>
      </Card>
    </div>
  );
}
