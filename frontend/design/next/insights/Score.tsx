"use client";

import Link from "next/link";
import { getConfigAwareScore, getHeatmap, getScoreHistory, type ConfigAwareScore, type Heatmap, type HeatTier, type ScoreHistory } from "@/lib/api/v2/score";
import { formatDate, formatModuleName } from "@/lib/format";
import { t } from "@/lib/v2/i18n";
import { f1, int, moduleSlug } from "@/lib/v2/score";
import { Code, DataTable, type Column } from "../kit";
import { ChartCard, cardState } from "../more/ChartCard";
import { QueryView } from "../more/states";
import { AreaTrend, HeatGrid, type HeatCell } from "../viz";
import { Banner, Block, HBars, status, useLift } from "./parts";

/**
 * Score lens: every run scored with the weights stored when it ran and re-weighted under today's configuration
 * (/scores/history), the config-aware score that counts only the rules the loaded configuration says apply
 * (/findings/config-aware-score), and each module on the six DAMA dimensions for the latest run (/insights/heatmap).
 * Every number is the backend's. This screen only reads.
 */

const noHistory: ScoreHistory = { history: [], modules: {} };
type Run = ScoreHistory["history"][number];

const signed = (d: number | null) => (d == null ? f1(null) : (d > 0 ? "+" : "") + f1(d));
const diff = (a: number | null | undefined, b: number | null | undefined) => (a == null || b == null ? null : Math.round((a - b) * 10) / 10);
const tone = (s: number | null | undefined) => (s == null ? undefined : s >= 85 ? "good" as const : s >= 70 ? "warn" as const : "bad" as const);

const DIM: Record<string, () => string> = {
  completeness: () => t("Completeness"),
  accuracy: () => t("Accuracy"),
  consistency: () => t("Consistency"),
  timeliness: () => t("Timeliness"),
  uniqueness: () => t("Uniqueness"),
  validity: () => t("Validity"),
  composite: () => t("Score"),
};
const TIER: Record<string, () => string> = { pass: () => t("on target"), warn: () => t("below target"), fail: () => t("below the warning line") };
const GROUP: Record<string, () => string> = { ecc: () => t("SAP ECC"), successfactors: () => t("SuccessFactors"), warehouse: () => t("Warehouse") };
const dimText = (d: string) => DIM[d]?.() ?? d;

function ModuleName({ m }: { m: string }) {
  return <><Link className="nx-link" href={`/objects?module=${moduleSlug(m)}`} data-testid="sl-module-link">{formatModuleName(m)}</Link> <Code code={m} /></>;
}

function runCols(): Column<Run>[] {
  return [
    { id: "run", label: t("Run"), cell: (r) => formatDate(r.run_at, "date") },
    { id: "then", label: t("As scored then"), align: "end", cell: (r) => f1(r.at_the_time.composite) },
    { id: "now", label: t("Today's weights"), align: "end", cell: (r) => f1(r.under_current.composite), compare: (a, b) => (a.under_current.composite ?? 0) - (b.under_current.composite ?? 0) },
    { id: "shift", label: t("Change from the weights"), align: "end", cell: (r) => signed(diff(r.under_current.composite, r.at_the_time.composite)) },
    { id: "weights", label: t("Weights used then"), cell: (r) => (r.scoring_recorded ? t("Recorded with the run") : t("Not recorded, default weights assumed")) },
  ];
}

type ModRow = { m: string; series: ScoreHistory["modules"][string] };

function modCols(): Column<ModRow>[] {
  return [
    { id: "module", label: t("Module"), cell: (r) => <ModuleName m={r.m} /> },
    {
      id: "trend", label: t("Trend"), cell: (r) => r.series.length > 1
        ? <AreaTrend points={[...r.series].reverse().flatMap((s, i) => (s.composite == null ? [] : [{ label: String(i + 1), value: s.composite }]))} label={t("{name} over {n} runs", { name: formatModuleName(r.m), n: int(r.series.length) })} height={24} empty={f1(null)} />
        : f1(null),
    },
    { id: "latest", label: t("Latest"), align: "end", cell: (r) => f1(r.series[0]?.composite ?? null), compare: (a, b) => (a.series[0]?.composite ?? 0) - (b.series[0]?.composite ?? 0) },
    { id: "then", label: t("As scored then"), align: "end", cell: (r) => f1(r.series[0]?.at_the_time ?? null) },
    {
      id: "since", label: t("Since the first run"), align: "end",
      cell: (r) => signed(r.series.length > 1 ? diff(r.series[0]?.composite, r.series[r.series.length - 1]?.composite) : null),
    },
  ];
}

function Heat({ h }: { h: Heatmap | null }) {
  const title = t("Each module on the six dimensions");
  if (!h || h.rows.length === 0) {
    return <Block title={title} meta={t("Latest run, coloured by your score targets")} testId="sl-heat"><p className="nx-sub">{t("No finished run has dimension scores yet.")}</p></Block>;
  }
  const dims = h.dimensions;
  const cells: Record<string, HeatCell> = {};
  for (const r of h.rows) {
    const name = formatModuleName(r.module);
    for (const d of dims) {
      const v = r.scores[d] ?? null;
      const tier: HeatTier | undefined = r.tier[d];
      cells[`${r.module}|${d}`] = {
        key: `${r.module}|${d}`,
        value: v,
        title: v == null ? t("{name}: {dim} not measured", { name, dim: dimText(d) }) : t("{name}: {dim} {score}, {tier}", { name, dim: dimText(d), score: f1(v), tier: tier ? TIER[tier]() : f1(null) }),
      };
    }
  }
  type Row = Heatmap["rows"][number];
  const cols: Column<Row>[] = [
    { id: "module", label: t("Module"), cell: (r) => <span className="nx-cell-stack"><span><ModuleName m={r.module} /></span><span className="nx-sub">{GROUP[r.group]?.() ?? r.group}</span></span> },
    ...dims.map((d): Column<Row> => ({
      id: d, label: dimText(d), align: "end",
      compare: (a, b) => (a.scores[d] ?? -1) - (b.scores[d] ?? -1),
      cell: (r) => {
        const v = r.scores[d];
        const tier = r.tier[d];
        const target = r.target?.[d];
        return (
          <span className="nx-cell-stack">
            <span>{f1(v ?? null)}</span>
            {v != null && tier ? <span className="nx-sub" data-testid={`sl-heat-status-${d}`}>{TIER[tier]()}{target != null ? `, ${t("Target")} ${f1(target)}` : ""}</span> : null}
          </span>
        );
      },
    })),
    { id: "critical", label: t("Critical rules failing"), align: "end", cell: (r) => int(r.critical), compare: (a, b) => a.critical - b.critical },
  ];
  return (
    <Block title={title} meta={t("Latest run, coloured by your score targets")} testId="sl-heat">
      <HeatGrid rows={h.rows.map((r) => r.module)} cols={dims} cells={cells} label={title} />
      <DataTable rows={h.rows} columns={cols} rowKey={(r) => r.module} rowLabel={(r) => formatModuleName(r.module)} caption={title} />
      {h.rows.some((r) => r.cap_reason) ? (
        <ul className="nx-ins-list nx-sub">
          {h.rows.filter((r) => r.cap_reason).map((r) => <li key={r.module}>{formatModuleName(r.module)}: {r.cap_reason}</li>)}
        </ul>
      ) : null}
    </Block>
  );
}

function Aware({ ca }: { ca: ConfigAwareScore | null }) {
  const title = t("Config-aware score");
  if (!ca) return <Block title={title} meta={t("Only the rules your configuration says apply")} testId="sl-aware"><p className="nx-sub">{t("No finished run to score against the configuration yet.")}</p></Block>;
  const tally = ca.config_aware;
  type M = ConfigAwareScore["modules"][number];
  type R = ConfigAwareScore["config_aware"]["not_applicable_reasons"][number];
  const mcols: Column<M>[] = [
    { id: "module", label: t("Module"), cell: (m) => <>{formatModuleName(m.module)} <Code code={m.module} /></> },
    { id: "applicable", label: t("Rules that apply"), align: "end", cell: (m) => int(m.applicable) },
    { id: "na", label: t("Do not apply"), align: "end", cell: (m) => int(m.not_applicable) },
    { id: "pass", label: t("Pass"), align: "end", cell: (m) => int(m.passes) },
    { id: "score", label: t("Score"), align: "end", cell: (m) => f1(m.score), compare: (a, b) => (a.score ?? 0) - (b.score ?? 0) },
  ];
  const rcols: Column<R>[] = [
    { id: "reason", label: t("Reason"), cell: (r) => r.reason ?? t("No reason recorded") },
    { id: "count", label: t("Rules"), align: "end", cell: (r) => int(r.count) },
  ];
  return (
    <Block title={title} meta={t("Only the rules your configuration says apply")} testId="sl-aware">
      <p className="nx-sub">
        {ca.config_load
          ? t("Judged from the configuration loaded on {date}.", { date: formatDate(ca.config_load.loaded_at, "date") })
          : t("No configuration is loaded, so every rule counts by default.")}{" "}
        {t("{a} rules apply, {p} pass, {n} do not apply, {d} kept by default.", { a: int(tally.applicable), p: int(tally.passes), n: int(tally.not_applicable), d: int(tally.by_default) })}
      </p>
      {ca.processes.length ? (
        <HBars
          label={t("Config-aware score per process")}
          testId="sl-processes"
          bars={ca.processes.map((p) => ({ key: p.l1, label: <>{p.name} <Code code={p.l1} /></>, value: p.score ?? 0, text: f1(p.score), tone: tone(p.score) }))}
        />
      ) : null}
      <DataTable rows={ca.modules} columns={mcols} rowKey={(m) => m.module} rowLabel={(m) => formatModuleName(m.module)} caption={t("Config-aware score per module")} />
      {tally.not_applicable_reasons.length ? (
        <DataTable rows={tally.not_applicable_reasons} columns={rcols} rowKey={(r) => r.reason ?? "none"} rowLabel={(r) => r.reason ?? t("No reason recorded")} caption={t("Why rules do not apply")} />
      ) : null}
    </Block>
  );
}

export function Score() {
  const hist = useLift(["score-history"], getScoreHistory, noHistory);
  const heat = useLift<Heatmap | null>(["score-heatmap"], getHeatmap, null);
  const aware = useLift<ConfigAwareScore | null>(["config-aware-score"], getConfigAwareScore, null);
  const denied = hist.isError && status(hist.error) === 403;
  const runs = hist.data?.history ?? [];
  const last = runs[0];
  const ca = aware.data ?? null;
  const shift = diff(last?.under_current.composite, last?.at_the_time.composite);
  const asc = [...runs].reverse();
  const trend = asc.flatMap((r) => (r.under_current.composite == null ? [] : [{ label: formatDate(r.run_at, "date"), value: r.under_current.composite }]));
  const modules: ModRow[] = Object.entries(hist.data?.modules ?? {}).sort(([a], [b]) => a.localeCompare(b)).map(([m, series]) => ({ m, series }));
  const latestMods = modules.filter((r) => r.series[0]?.composite != null).sort((a, b) => (a.series[0].composite ?? 0) - (b.series[0].composite ?? 0));
  return (
    <div className="nx-body" data-testid="ins-score">
      <p className="nx-sub">{t("Compares each run scored with the weights in force then and with today's weights, so a weight change is not mistaken for a data change.")} {t("This screen only reads. No run is rescored and no weight is changed.")}</p>
      {denied ? <p className="nx-sub" role="alert">{t("Your role cannot read the score history.")}</p> : (
        <QueryView loading={hist.isPending} error={hist.isError ? t("The score history could not be read.") : null} onRetry={() => void hist.refetch()} empty={false} emptyHeading="" label={t("Score lens")}>
          <Banner
            testId="sl-banner"
            eyebrow={t("Score lens")}
            headline={!last ? t("No run has been scored yet") : t("{score} under today's weights", { score: f1(last.under_current.composite) })}
            why={t("The same runs scored two ways: with the weights in force when each ran, and again under today's weights, so a change of weights never reads as a change in the data.")}
            figs={[
              { label: t("Latest run, today's weights"), value: last?.under_current.composite ?? null, format: f1 },
              { label: t("Latest run, as scored then"), value: last?.at_the_time.composite ?? null, format: f1, note: shift == null ? undefined : t("{n} points from the weight change", { n: f1(shift) }) },
              { label: t("Config-aware score"), value: ca?.config_aware.score ?? null, format: f1, note: ca ? t("{n} rules do not apply", { n: int(ca.config_aware.not_applicable) }) : undefined },
            ]}
          />
          <div className="nx-chartcards">
            <ChartCard
              title={t("Score under today's weights, run by run")}
              line={t("Oldest run on the left")}
              state={trend.length < 2 ? "empty" : "ready"}
              emptyLine={t("Two scored runs are needed to draw a trend.")}
              figure={f1(last?.under_current.composite ?? null)}
              testId="sl-trend"
              href="/runs"
              chart={<AreaTrend points={trend} label={t("Score under today's weights, run by run")} height={120} empty={t("Two scored runs are needed to draw a trend.")} />}
            />
            <ChartCard
              title={t("Each module across the runs")}
              line={t("Under today's weights")}
              state={latestMods.length === 0 ? "empty" : "ready"}
              emptyLine={t("No module has a score yet.")}
              chart={<HBars label={t("Each module across the runs")} bars={latestMods.slice(0, 8).map((r) => ({ key: r.m, label: formatModuleName(r.m), value: r.series[0].composite ?? 0, text: f1(r.series[0].composite), tone: tone(r.series[0].composite) }))} />}
            />
            <ChartCard
              title={t("Config-aware score per process")}
              line={t("Only the rules your configuration says apply")}
              state={cardState(aware, !ca || ca.processes.length === 0)}
              emptyLine={t("No finished run to score against the configuration yet.")}
              figure={f1(ca?.config_aware.score ?? null)}
              onRetry={() => void aware.refetch()}
              chart={<HBars label={t("Config-aware score per process")} bars={(ca?.processes ?? []).map((p) => ({ key: p.l1, label: p.name, value: p.score ?? 0, text: f1(p.score), tone: tone(p.score) }))} />}
            />
          </div>
          <Block title={t("Each run, then and now")} meta={t("Newest first")} testId="sl-runs">
            <DataTable rows={runs} columns={runCols()} rowKey={(r) => r.version_id} rowLabel={(r) => formatDate(r.run_at, "date")} caption={t("Each run, then and now")} empty={{ heading: t("No run has been scored yet.") }} />
            <p><Link className="nx-btn nx-btn-secondary nx-btn-sm" href="/runs">{t("Open the runs")}</Link></p>
          </Block>
          <QueryView loading={heat.isPending} error={heat.error} onRetry={() => void heat.refetch()} empty={false} emptyHeading="" label={t("Each module on the six dimensions")}>
            <Heat h={heat.data ?? null} />
          </QueryView>
          <Block title={t("Each module across the runs")} meta={t("Under today's weights")} testId="sl-modules">
            <DataTable rows={modules} columns={modCols()} rowKey={(r) => r.m} rowLabel={(r) => formatModuleName(r.m)} caption={t("Each module across the runs")} empty={{ heading: t("No module has a score yet.") }} />
            <p><Link className="nx-btn nx-btn-secondary nx-btn-sm" href="/objects">{t("Open the objects")}</Link></p>
          </Block>
          <QueryView loading={aware.isPending} error={aware.error} onRetry={() => void aware.refetch()} empty={false} emptyHeading="" label={t("Config-aware score")}>
            <Aware ca={ca} />
          </QueryView>
        </QueryView>
      )}
    </div>
  );
}
