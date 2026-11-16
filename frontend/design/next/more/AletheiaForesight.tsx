"use client";

import { useQuery } from "@tanstack/react-query";
import { getForesight, type BandPoint, type GoLiveStatus } from "@/lib/api/v2/aletheia-engine";
import { useFixture } from "@/lib/api/v2/fixture";
import { formatDate } from "@/lib/format";
import { t } from "@/lib/v2/i18n";
import { f1, int } from "@/lib/v2/score";
import { DataTable, EmptyState, ErrorState, Skeleton, type Column } from "../kit";
import { AreaTrend } from "../viz";
import { Banner, Figs } from "./cfg-parts";
import { DeviationTable, ENGINE_OFF, EvidencePanel, Mark, QueryPanel } from "./aletheia-parts";

/**
 * Aletheia foresight (GET /aletheia/foresight): where the composite score is heading, the date it reaches the go-live
 * target with a 95% band, and the runs the engine did not expect. The projection is deterministic; the engine layer
 * says why when it is off. Every result carries its evidence.
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

export function useForesight() {
  const fixture = useFixture();
  return useQuery({ queryKey: ["aletheia", "foresight", fixture], queryFn: getForesight, staleTime: 60_000 });
}

type Q = ReturnType<typeof useForesight>;

function ProjectionPanel({ q }: { q: Q }) {
  return (
    <QueryPanel q={q} title={t("Composite toward the go-live target")} meta={t("95% prediction band, deterministic")} testId="fs-projection">
      {(d) => {
        const p = d.projection;
        if (!p.available) return <><EmptyState heading={(NO_PROJECTION[p.reason ?? ""] ?? NO_PROJECTION.too_few_runs)()} /><EvidencePanel ev={p.evidence} testId="fs-projection-evidence" /></>;
        const pts = d.runs.filter((r) => r.composite != null).map((r) => ({ label: r.label ?? formatDate(r.run_at), value: r.composite as number }));
        const columns: Column<BandPoint>[] = [
          { id: "date", label: t("Date"), cell: (b) => formatDate(b.date) },
          { id: "point", label: t("Projected"), align: "end", cell: (b) => f1(b.point) },
          { id: "low", label: t("Lowest likely"), align: "end", cell: (b) => f1(b.low) },
          { id: "high", label: t("Highest likely"), align: "end", cell: (b) => f1(b.high) },
        ];
        return (
          <>
            <AreaTrend points={pts} label={t("Composite score per run")} height={160} empty={t("No runs yet")} />
            <p className="nx-sub" data-testid="fs-target">{t("Go-live target {n}", { n: f1(d.target) })}</p>
            <DataTable rows={p.band ?? []} columns={columns} rowKey={(b) => b.date ?? String(b.point)} rowLabel={(b) => formatDate(b.date)} caption={t("Projected score with its band")} />
            <EvidencePanel ev={p.evidence} testId="fs-projection-evidence" />
          </>
        );
      }}
    </QueryPanel>
  );
}

function EnginePanel({ q }: { q: Q }) {
  return (
    <QueryPanel q={q} title={t("What the engine did not expect")} meta={t("Learned by the Aletheia engine from run-level scores and counts")} testId="fs-engine">
      {(d) => {
        const e = d.engine;
        if (!e.available) {
          const why = e.reason === "too_few_runs" ? t("Six scored runs are needed before the engine can learn how the runs move.") : (ENGINE_OFF[e.reason ?? "engine_error"] ?? ENGINE_OFF.engine_error)();
          return <><Mark /><EmptyState heading={why} /><EvidencePanel ev={e.evidence} testId="fs-engine-evidence" /></>;
        }
        return (
          <>
            <Mark />
            {e.normal ? (
              <div data-testid="fs-normal">
                <Figs label={t("Learned normal range of the composite")} figs={[
                  { label: t("Learned normal range of the composite"), value: t("{low} to {high}", { low: f1(e.normal.low), high: f1(e.normal.high) }) },
                  { label: t("Latest run"), value: f1(e.normal.latest), note: e.normal.outside ? t("Outside the normal range") : t("Within the normal range") },
                ]} />
              </div>
            ) : null}
            {e.surprises.length === 0 ? <EmptyState heading={t("Every run moved the way the engine expected.")} /> : (
              <DeviationTable rows={e.surprises} labels={d.labels} caption={t("Runs the engine did not expect")} testId="fs-surprises" />
            )}
            <EvidencePanel ev={{ ...e.evidence, inputs: [...e.evidence.inputs, ...e.methodology] }} testId="fs-engine-evidence" />
          </>
        );
      }}
    </QueryPanel>
  );
}

export function AletheiaForesight() {
  const q = useForesight();
  const title = t("Foresight");
  const lede = t("Where the composite score is heading, when it reaches the go-live target, and which runs the Aletheia engine did not expect. The projection is deterministic; the engine adds what it learned from run-level scores and counts only.");
  if (q.isPending) return <Skeleton lines={6} label={title} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const d = q.data;
  const p = d.projection;
  const gl = p.available ? p.go_live : null;
  return (
    <div className="nx-body" data-testid="aletheia-foresight">
      <Banner
        title={title}
        why={gl ? STATUS[gl.status]() : t("Not enough runs to project the score")}
        meta={`${t("Target {n}, set by {source}.", { n: f1(d.target), source: d.target_source === "tenant" ? t("the scoring settings") : t("this view") })} ${lede}`}
        label={title}
        testId="fs-banner"
        figs={[
          { label: t("Go-live date"), value: gl?.projected ? formatDate(gl.projected) : f1(null), note: gl?.earliest && gl.latest ? t("{from} to {to}", { from: formatDate(gl.earliest), to: formatDate(gl.latest) }) : undefined },
          { label: t("Next run"), value: p.next ? f1(p.next.point) : f1(null), note: p.next ? t("{low} to {high}", { low: f1(p.next.low), high: f1(p.next.high) }) : undefined },
          { label: t("Change per 30 days"), value: p.slope_per_30d == null ? f1(null) : f1(p.slope_per_30d) },
          { label: t("Unexpected runs"), value: d.engine.available ? int(d.engine.surprises.length) : f1(null) },
        ]}
      />
      <ProjectionPanel q={q} />
      <EnginePanel q={q} />
    </div>
  );
}
