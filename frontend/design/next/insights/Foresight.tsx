"use client";

import { getForesight, type BandPoint, type Foresight as FS, type GoLiveStatus } from "@/lib/api/v2/aletheia-engine";
import { formatDate } from "@/lib/format";
import { t } from "@/lib/v2/i18n";
import { f1 } from "@/lib/v2/score";
import { DataTable, type Column } from "../kit";
import { ChartCard, cardState } from "../more/ChartCard";
import { QueryView } from "../more/states";
import { AreaTrend, StackedBar } from "../viz";
import { Banner, Block, DeviationTable, ENGINE_OFF, EvidencePanel, Mark, runTrend, status, useLift } from "./parts";

/**
 * Aletheia foresight (GET /aletheia/foresight): where the composite score is heading, the date it reaches the go-live
 * target with a 95% band, and the runs the engine did not expect. The projection is deterministic; the engine layer
 * says why when it is off. Run-level scores and counts only.
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

const bandCols = (): Column<BandPoint>[] => [
  { id: "date", label: t("Date"), cell: (b) => formatDate(b.date) },
  { id: "point", label: t("Projected"), align: "end", cell: (b) => f1(b.point) },
  { id: "low", label: t("Lowest likely"), align: "end", cell: (b) => f1(b.low) },
  { id: "high", label: t("Highest likely"), align: "end", cell: (b) => f1(b.high) },
];

function Projection({ d }: { d: FS }) {
  const p = d.projection;
  if (!p.available) {
    return <Block title={t("Composite toward the go-live target")} meta={t("95% prediction band, deterministic")} testId="fs-projection">
      <p className="nx-sub">{(NO_PROJECTION[p.reason ?? ""] ?? NO_PROJECTION.too_few_runs)()}</p>
      <EvidencePanel ev={p.evidence} testId="fs-projection-evidence" />
    </Block>;
  }
  const band = p.band ?? [];
  const pts = [...runTrend(d.runs), ...band.map((b) => ({ label: formatDate(b.date, "date"), value: b.point }))];
  return (
    <Block title={t("Composite toward the go-live target")} meta={t("95% prediction band, deterministic")} testId="fs-projection">
      <p className="nx-sub" data-testid="fs-target">{t("Go-live target {n}", { n: f1(d.target) })}</p>
      <AreaTrend points={pts} label={t("Composite score per run")} height={160} empty={t("Three scored runs are needed before the score can be projected.")} />
      <DataTable rows={band} columns={bandCols()} rowKey={(b) => b.date ?? String(b.point)} rowLabel={(b) => formatDate(b.date)} caption={t("Projected score with its band")} />
      <EvidencePanel ev={p.evidence} testId="fs-projection-evidence" />
    </Block>
  );
}

function Engine({ d }: { d: FS }) {
  const e = d.engine;
  const title = t("What the engine did not expect");
  const meta = t("Learned by the Aletheia engine from run-level scores and counts");
  if (!e.available) {
    const why = e.reason === "too_few_runs" ? t("Six scored runs are needed before the engine can learn how the runs move.") : (ENGINE_OFF[e.reason ?? "engine_error"] ?? ENGINE_OFF.engine_error)();
    return <Block title={title} meta={meta} testId="fs-engine"><Mark /><p className="nx-sub">{why}</p></Block>;
  }
  const high = e.surprises.filter((s) => s.severity === "high").length;
  return (
    <Block title={title} meta={meta} testId="fs-engine">
      <Mark />
      {e.normal ? (
        <dl className="nx-ins-dl" data-testid="fs-normal">
          <dt>{t("Learned normal range of the composite")}</dt><dd>{t("{low} to {high}", { low: f1(e.normal.low), high: f1(e.normal.high) })}</dd>
          <dt>{t("Latest run")}</dt><dd>{f1(e.normal.latest)} {e.normal.outside ? t("Outside the normal range") : t("Within the normal range")}</dd>
        </dl>
      ) : null}
      {e.surprises.length === 0 ? <p className="nx-sub">{t("Every run moved the way the engine expected.")}</p> : (
        <>
          <StackedBar label={t("Severity")} segs={[
            { id: "high", label: t("High"), value: high, tone: "bad" },
            { id: "medium", label: t("Medium"), value: e.surprises.length - high, tone: "warn" },
          ]} />
          <DeviationTable rows={e.surprises} labels={d.labels} caption={t("Runs the engine did not expect")} />
        </>
      )}
      <EvidencePanel ev={{ ...e.evidence, inputs: [...e.evidence.inputs, ...e.methodology] }} testId="fs-engine-evidence" />
    </Block>
  );
}

export function Foresight() {
  const q = useLift(["aletheia", "foresight"], getForesight, null as FS | null);
  const d = q.data;
  const p = d?.projection;
  const gl = p?.available ? p.go_live : null;
  const trend = d ? runTrend(d.runs) : [];
  return (
    <div className="nx-body" data-testid="ins-foresight">
      <p className="nx-sub">{t("Where the composite score is heading, when it reaches the go-live target, and which runs the Aletheia engine did not expect. The projection is deterministic; the engine adds what it learned from run-level scores and counts only.")}</p>
      {q.isError && status(q.error) === 403 ? <p className="nx-sub" role="alert">{t("Your role cannot read the Aletheia foresight.")}</p> : (
      <QueryView loading={q.isLoading} error={q.isError ? t("The Aletheia foresight could not be read.") : null} onRetry={() => void q.refetch()} empty={!d} emptyHeading={t("Not enough runs to project the score")} label={t("Foresight")}>
        {d ? (
          <>
            <Banner
              eyebrow={t("Foresight")}
              headline={gl ? STATUS[gl.status]() : t("Not enough runs to project the score")}
              verdict={gl ? (gl.status === "reached" || gl.status === "projected" ? "go" : "at-risk") : undefined}
              why={t("Target {n}, set by {source}.", { n: f1(d.target), source: d.target_source === "tenant" ? t("the scoring settings") : t("this view") })}
              figs={[
                { label: t("Go-live date"), value: gl?.projected ? Date.parse(gl.projected) : null, format: (n) => formatDate(new Date(n).toISOString(), "date"), note: gl?.earliest && gl.latest ? t("{from} to {to}", { from: formatDate(gl.earliest, "date"), to: formatDate(gl.latest, "date") }) : undefined },
                { label: t("Next run"), value: p?.next ? p.next.point : null, format: f1, note: p?.next ? t("{low} to {high}", { low: f1(p.next.low), high: f1(p.next.high) }) : undefined },
                { label: t("Change per 30 days"), value: p?.slope_per_30d ?? null, format: f1 },
                { label: t("Unexpected runs"), value: d.engine.available ? d.engine.surprises.length : null },
              ]}
              testId="fs-banner"
            />
            <div className="nx-chartcards">
              <ChartCard title={t("Composite score per run")} state={cardState(q, trend.length === 0)} figure={trend.length ? f1(trend[trend.length - 1].value) : undefined}
                emptyLine={t("Three scored runs are needed before the score can be projected.")}
                chart={<AreaTrend points={trend} label={t("Composite score per run")} empty={t("Three scored runs are needed before the score can be projected.")} />} />
            </div>
            <Projection d={d} />
            <Engine d={d} />
          </>
        ) : null}
      </QueryView>
      )}
    </div>
  );
}
