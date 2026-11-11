"use client";

import { useQuery } from "@tanstack/react-query";
import { getForesight, type Evidence, type Foresight, type GoLiveStatus } from "@/lib/api/v2/aletheia-engine";
import { useFixture } from "@/lib/api/v2/fixture";
import { formatDate } from "@/lib/format";
import { t } from "@/lib/v2/i18n";
import { labelText } from "@/lib/v2/labels";
import { f1, int } from "@/lib/v2/score";
import { ChartFrame, niceTicks, TrendChart } from "../charts";
import { Coded, EmptyFrame, PageTitle } from "../parts";
import { Lede } from "../RunParts";
import { CcBanner, CcPage } from "./cc-parts";
import { Disclose } from "./Guide";
import { ENGINE_OFF } from "./Insights";
import { retry, Section, Table } from "./WorkAnalytics";

/**
 * Aletheia foresight (api/routes/aletheia_engine.py, GET /aletheia/foresight): where the composite score is heading,
 * the date it reaches the go-live target with a 95% band, and the runs the Aletheia engine's world model did not
 * expect. The projection is deterministic and answers without the engine; the engine layer says why when it is off.
 */

const STATUS: Record<GoLiveStatus, () => string> = {
  reached: () => t("The composite score has reached the go-live target"),
  projected: () => t("The composite score is on course for the go-live target"),
  not_converging: () => t("The composite score is not moving toward the go-live target"),
  beyond_horizon: () => t("The go-live target is more than a year away at the current pace"),
};

const NO_PROJECTION: Record<string, () => string> = {
  too_few_runs: () => t("Three scored runs are needed before the score can be projected."),
  undated: () => t("The runs need dates on at least two different days before the score can be projected."),
};

/** The evidence behind one result: what went in, the method, and how sure it is. */
export function EvidencePanel({ ev, testId }: { ev: Evidence; testId: string }) {
  return (
    <Disclose title={t("Evidence")} hint={t("inputs, method and confidence")}>
      <dl className="m2-facts" data-testid={testId}>
        <div className="m2-fact"><dt>{t("Inputs")}</dt><dd>{ev.inputs.join("; ")}</dd></div>
        <div className="m2-fact"><dt>{t("Method")}</dt><dd>{ev.method}</dd></div>
        <div className="m2-fact">
          <dt>{t("Confidence")}</dt>
          <dd>{ev.confidence == null ? t("Shown per result, as its deviation score") : t("{n} out of 100", { n: int(ev.confidence) })}</dd>
        </div>
        {ev.first_run ? <div className="m2-fact"><dt>{t("Runs used")}</dt><dd>{t("{n} runs, {from} to {to}", { n: int(ev.runs ?? 0), from: formatDate(ev.first_run), to: formatDate(ev.last_run) })}</dd></div> : null}
      </dl>
    </Disclose>
  );
}

function Mark() {
  return (
    <span className="m2-meta">
      {/* eslint-disable-next-line @next/next/no-img-element -- the Aletheia mark is served unaltered, docs/diligence/licences.md section 6 */}
      <img src="/brand/aletheia-mark.svg" alt="" width={16} height={16} /> {t("Aletheia")}
    </span>
  );
}

const metricName = (d: Foresight, m: string) => <Coded code={m} text={m.startsWith("dimension:") ? t("{dimension} dimension", { dimension: labelText(m.slice(10)) }) : d.labels[m]} />;

function ProjectionPanel({ q }: { q: ReturnType<typeof useForesight> }) {
  return (
    <Section q={q} title={t("Composite toward the go-live target")} meta={t("95% prediction band, deterministic")} testId="fs-projection">
      {(d) => {
        const p = d.projection;
        if (!p.available) return <><EmptyFrame>{(NO_PROJECTION[p.reason ?? ""] ?? NO_PROJECTION.too_few_runs)()}</EmptyFrame><EvidencePanel ev={p.evidence} testId="fs-projection-evidence" /></>;
        const pts = d.runs.filter((r) => r.composite != null).map((r, i) => ({ id: r.version_id ?? String(i), label: formatDate(r.run_at), title: r.label ?? formatDate(r.run_at), value: r.composite as number }));
        const vals = [...pts.map((x) => x.value), d.target, ...(p.band ?? []).flatMap((b) => [b.low, b.high])];
        const ticks = niceTicks(Math.max(0, Math.min(...vals) - 2), Math.min(100, Math.max(...vals) + 2));
        const title = t("Composite score per run");
        return (
          <>
            <ChartFrame title={title} height={180}>
              <TrendChart points={pts} domain={[ticks[0], ticks[ticks.length - 1]] as const} ticks={ticks} height={180} label={title} yLabel={t("score")} format={f1}
                refs={[{ value: d.target, label: t("Go-live target {n}", { n: f1(d.target) }), testId: "fs-target" }]} />
            </ChartFrame>
            <Table title={t("Projected score with its band")} head={[t("Date"), t("Projected"), t("Lowest likely"), t("Highest likely")]}>
              {(p.band ?? []).map((b) => (
                <tr key={b.date ?? b.point}>
                  <th scope="row" className="m2-card-lead">{formatDate(b.date)}</th>
                  <td data-label={t("Projected")} className="m2-num">{f1(b.point)}</td>
                  <td data-label={t("Lowest likely")} className="m2-num">{f1(b.low)}</td>
                  <td data-label={t("Highest likely")} className="m2-num">{f1(b.high)}</td>
                </tr>
              ))}
            </Table>
            <EvidencePanel ev={p.evidence} testId="fs-projection-evidence" />
          </>
        );
      }}
    </Section>
  );
}

function EnginePanel({ q }: { q: ReturnType<typeof useForesight> }) {
  return (
    <Section q={q} title={t("What the engine did not expect")} meta={t("Learned by the Aletheia engine from run-level scores and counts")} testId="fs-engine">
      {(d) => {
        const e = d.engine;
        if (!e.available) {
          const why = e.reason === "too_few_runs" ? t("Six scored runs are needed before the engine can learn how the runs move.") : (ENGINE_OFF[e.reason ?? "engine_error"] ?? ENGINE_OFF.engine_error)();
          return <><Mark /><EmptyFrame>{why}</EmptyFrame></>;
        }
        return (
          <>
            <Mark />
            {e.normal ? (
              <dl className="m2-facts" data-testid="fs-normal">
                <div className="m2-fact"><dt>{t("Learned normal range of the composite")}</dt><dd className="m2-num">{t("{low} to {high}", { low: f1(e.normal.low), high: f1(e.normal.high) })}</dd></div>
                <div className="m2-fact"><dt>{t("Latest run")}</dt><dd className="m2-num">{f1(e.normal.latest)} {e.normal.outside ? t("Outside the normal range") : t("Within the normal range")}</dd></div>
              </dl>
            ) : null}
            {e.surprises.length === 0 ? <EmptyFrame>{t("Every run moved the way the engine expected.")}</EmptyFrame> : (
              <Table title={t("Runs the engine did not expect")} head={[t("Run"), t("Measure"), t("Expected"), t("Observed"), t("Deviation"), t("Severity")]}>
                {e.surprises.map((s) => (
                  <tr key={`${s.version_id}-${s.metric}`}>
                    <th scope="row" className="m2-card-lead">{s.label ?? formatDate(s.run_at)}</th>
                    <td data-label={t("Measure")}>{metricName(d, s.metric)}</td>
                    <td data-label={t("Expected")} className="m2-num">{f1(s.expected)}</td>
                    <td data-label={t("Observed")} className="m2-num">{f1(s.observed)}</td>
                    <td data-label={t("Deviation")} className="m2-num">{s.z == null ? f1(null) : s.z.toFixed(1)}</td>
                    <td data-label={t("Severity")}>{s.severity === "high" ? t("High") : t("Medium")}</td>
                  </tr>
                ))}
              </Table>
            )}
            <EvidencePanel ev={{ ...e.evidence, inputs: [...e.evidence.inputs, ...e.methodology] }} testId="fs-engine-evidence" />
          </>
        );
      }}
    </Section>
  );
}

function useForesight() {
  const fixture = useFixture();
  return useQuery({ queryKey: ["aletheia", "foresight", fixture], queryFn: getForesight, staleTime: 60_000, retry });
}

export function AletheiaForesight() {
  const q = useForesight();
  const title = t("Foresight");
  const p = q.data?.projection;
  const gl = p?.available ? p.go_live : null;
  return (
    <CcPage>
      <PageTitle>{title}</PageTitle>
      <Lede>{t("Where the composite score is heading, when it reaches the go-live target, and which runs the Aletheia engine did not expect. The projection is deterministic; the engine adds what it learned from run-level scores and counts only.")}</Lede>
      {q.data ? (
        <CcBanner
          eyebrow={t("Foresight")}
          headline={gl ? STATUS[gl.status]() : t("Not enough runs to project the score")}
          verdict={gl ? (gl.status === "reached" || gl.status === "projected" ? "go" : "at-risk") : undefined}
          why={t("Target {n}, set by {source}.", { n: f1(q.data.target), source: q.data.target_source === "tenant" ? t("the scoring settings") : t("this view") })}
          figs={[
            { label: t("Go-live date"), value: gl?.projected ? formatDate(gl.projected) : f1(null), note: gl?.earliest && gl.latest ? t("{from} to {to}", { from: formatDate(gl.earliest), to: formatDate(gl.latest) }) : undefined },
            { label: t("Next run"), value: p?.next ? f1(p.next.point) : f1(null), note: p?.next ? t("{low} to {high}", { low: f1(p.next.low), high: f1(p.next.high) }) : undefined },
            { label: t("Change per 30 days"), value: p?.slope_per_30d == null ? f1(null) : f1(p.slope_per_30d) },
            { label: t("Unexpected runs"), value: q.data.engine.available ? int(q.data.engine.surprises.length) : f1(null) },
          ]}
          testId="fs-banner"
          label={title}
        />
      ) : null}
      <ProjectionPanel q={q} />
      <EnginePanel q={q} />
    </CcPage>
  );
}
