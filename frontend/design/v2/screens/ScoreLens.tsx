"use client";

import { useQuery } from "@tanstack/react-query";
import { useFixture } from "@/lib/api/v2/fixture";
import { getConfigAwareScore, getHeatmap, getScoreHistory, type ConfigAwareScore, type Heatmap, type HeatTier, type ScoreHistory } from "@/lib/api/v2/score";
import { formatDate, formatModuleName } from "@/lib/format";
import { t } from "@/lib/v2/i18n";
import { f1, int } from "@/lib/v2/score";
import { ChartFrame, ChartTable, DeltaBar, niceTicks, scoreDomain, Sparkline, TrendChart } from "../charts";
import { EmptyFrame, ErrorFrame, Skeleton } from "../parts";
import { CcBanner, CcHBars, CcPage } from "./cc-parts";
import { retry, Section, status, Table } from "./WorkAnalytics";

/**
 * Score lens: every run scored two ways, with the weights stored when it ran and re-weighted under today's
 * configuration (api/routes/findings.py /scores/history), beside the config-aware score that counts only the rules
 * the loaded SAP configuration says apply (/findings/config-aware-score), and each module scored on the six DAMA
 * dimensions for the latest run (/insights/heatmap). Every number is the backend's.
 */

const noHistory: ScoreHistory = { history: [], modules: {} };

function lift<T>(fn: () => Promise<T>, empty: T) {
  return async () => {
    try {
      return await fn();
    } catch (e) {
      if (status(e) === 404) return empty;
      throw e;
    }
  };
}

const diff = (a: number | null | undefined, b: number | null | undefined) => (a == null || b == null ? null : Math.round((a - b) * 10) / 10);

export function ScoreLens() {
  const fixture = useFixture();
  const hist = useQuery({ queryKey: ["score-history", fixture], queryFn: lift(getScoreHistory, noHistory), staleTime: 60_000, retry });
  const heat = useQuery({ queryKey: ["score-heatmap", fixture], queryFn: lift<Heatmap | null>(getHeatmap, null), staleTime: 60_000, retry });
  const aware = useQuery({ queryKey: ["config-aware-score", fixture], queryFn: lift<ConfigAwareScore | null>(getConfigAwareScore, null), staleTime: 60_000, retry });

  if (hist.isPending) return <CcPage><Skeleton width="100%" height={320} /></CcPage>;
  if (hist.isError) {
    return (
      <CcPage>
        {status(hist.error) === 403 ? (
          <EmptyFrame>{t("Your role cannot read the score history.")}</EmptyFrame>
        ) : (
          <ErrorFrame onRetry={() => void hist.refetch()}>{t("The score history could not be read.")}</ErrorFrame>
        )}
      </CcPage>
    );
  }
  const runs = hist.data.history;
  const last = runs[0];
  const ca = aware.data ?? null;
  const shift = diff(last?.under_current.composite, last?.at_the_time.composite);
  return (
    <CcPage>
      <CcBanner
        eyebrow={t("Score lens")}
        headline={
          !last
            ? t("No run has been scored yet")
            : t("{score} under today's weights", { score: f1(last.under_current.composite) })
        }
        why={t("The same runs scored two ways: with the weights in force when each ran, and again under today's weights, so a change of weights never reads as a change in the data.")}
        figs={[
          { label: t("Latest run, today's weights"), value: f1(last?.under_current.composite ?? null) },
          { label: t("Latest run, as scored then"), value: f1(last?.at_the_time.composite ?? null), note: shift == null ? undefined : t("{n} points from the weight change", { n: f1(shift) }) },
          { label: t("Config-aware score"), value: f1(ca?.config_aware.score ?? null), note: ca ? t("{n} rules do not apply", { n: int(ca.config_aware.not_applicable) }) : undefined },
        ]}
        testId="sl-banner"
        label={t("Score lens")}
      />
      <TrendPanel runs={runs} />
      <RunsPanel runs={runs} />
      <HeatPanel q={heat} />
      <ModulesPanel modules={hist.data.modules} />
      <AwarePanel q={aware} />
    </CcPage>
  );
}

function TrendPanel({ runs }: { runs: ScoreHistory["history"] }) {
  const asc = [...runs].reverse();
  const title = t("Score under today's weights, run by run");
  const pts = asc.map((r) => {
    const label = formatDate(r.run_at, "date");
    return { id: r.version_id, label, title: t("{day}: {now} under today's weights, {then} as scored then", { day: label, now: f1(r.under_current.composite), then: f1(r.at_the_time.composite) }), value: r.under_current.composite };
  });
  const [lo, hi] = scoreDomain(pts.flatMap((p) => (p.value == null ? [] : [p.value])));
  const ticks = niceTicks(lo, hi, 4);
  return (
    <ChartFrame
      title={title}
      sub={t("Oldest run on the left")}
      height={180}
      level={2}
      state={pts.length < 2 ? "empty" : "ready"}
      empty={t("Two scored runs are needed to draw a trend.")}
      testId="sl-trend"
      table={<ChartTable caption={title} head={[t("Run"), t("Today's weights"), t("As scored then")]} rows={asc.map((r) => [formatDate(r.run_at, "date"), f1(r.under_current.composite), f1(r.at_the_time.composite)])} />}
    >
      <TrendChart points={pts} domain={[ticks[0], ticks[ticks.length - 1]] as const} ticks={ticks} height={180} label={title} yLabel={t("score")} format={f1} />
    </ChartFrame>
  );
}

function RunsPanel({ runs }: { runs: ScoreHistory["history"] }) {
  const title = t("Each run, then and now");
  const q = { isPending: false, isError: false, error: null, data: runs, refetch: () => undefined };
  return (
    <Section q={q} title={title} meta={t("Newest first")} testId="sl-runs">
      {(d) => d.length === 0 ? <EmptyFrame>{t("No run has been scored yet.")}</EmptyFrame> : (
        <Table title={title} head={[t("Run"), t("As scored then"), t("Today's weights"), t("Change from the weights"), t("Weights used then")]}>
          {d.map((r) => {
            const c = diff(r.under_current.composite, r.at_the_time.composite);
            return (
              <tr key={r.version_id}>
                <th scope="row" className="m2-card-lead">{formatDate(r.run_at, "date")}</th>
                <td data-label={t("As scored then")} className="m2-num">{f1(r.at_the_time.composite)}</td>
                <td data-label={t("Today's weights")} className="m2-num">{f1(r.under_current.composite)}</td>
                <td data-label={t("Change from the weights")} className="m2-num"><DeltaBar d={c} /></td>
                <td data-label={t("Weights used then")} className="m2-meta">{r.scoring_recorded ? t("Recorded with the run") : t("Not recorded, default weights assumed")}</td>
              </tr>
            );
          })}
        </Table>
      )}
    </Section>
  );
}

function ModulesPanel({ modules }: { modules: ScoreHistory["modules"] }) {
  const title = t("Each module across the runs");
  const rows = Object.entries(modules).sort(([a], [b]) => a.localeCompare(b));
  const q = { isPending: false, isError: false, error: null, data: rows, refetch: () => undefined };
  return (
    <Section q={q} title={title} meta={t("Under today's weights")} testId="sl-modules">
      {(d) => d.length === 0 ? <EmptyFrame>{t("No module has a score yet.")}</EmptyFrame> : (
        <Table title={title} head={[t("Module"), t("Trend"), t("Latest"), t("As scored then"), t("Since the first run")]}>
          {d.map(([m, series]) => {
            const latest = series[0];
            const first = series[series.length - 1];
            const name = formatModuleName(m);
            return (
              <tr key={m}>
                <th scope="row" className="m2-card-lead">{name} <span className="m2-mono m2-meta">{m}</span></th>
                <td data-label={t("Trend")}>{series.length > 1 ? <Sparkline values={[...series].reverse().map((s) => s.composite)} label={t("{name} over {n} runs", { name, n: int(series.length) })} width={120} height={24} /> : f1(null)}</td>
                <td data-label={t("Latest")} className="m2-num">{f1(latest?.composite ?? null)}</td>
                <td data-label={t("As scored then")} className="m2-num">{f1(latest?.at_the_time ?? null)}</td>
                <td data-label={t("Since the first run")} className="m2-num"><DeltaBar d={series.length > 1 ? diff(latest?.composite, first?.composite) : null} /></td>
              </tr>
            );
          })}
        </Table>
      )}
    </Section>
  );
}

const DIM: Record<string, () => string> = {
  completeness: () => t("Completeness"),
  accuracy: () => t("Accuracy"),
  consistency: () => t("Consistency"),
  timeliness: () => t("Timeliness"),
  uniqueness: () => t("Uniqueness"),
  validity: () => t("Validity"),
  composite: () => t("Score"),
};
const BAND: Record<string, string> = { pass: "0", warn: "2", fail: "3" };
const TIER: Record<string, () => string> = { pass: () => t("on target"), warn: () => t("below target"), fail: () => t("below the warning line") };
const GROUP: Record<string, () => string> = { ecc: () => t("SAP ECC"), successfactors: () => t("SuccessFactors"), warehouse: () => t("Warehouse") };

type HeatQ = { isPending: boolean; isError: boolean; error: unknown; data: Heatmap | null | undefined; refetch: () => unknown };

function HeatPanel({ q }: { q: HeatQ }) {
  const title = t("Each module on the six dimensions");
  return (
    <Section q={q} title={title} meta={t("Latest run, coloured by your score targets")} testId="sl-heat">
      {(h) => {
        if (!h || h.rows.length === 0) return <EmptyFrame>{t("No finished run has dimension scores yet.")}</EmptyFrame>;
        const dims = h.dimensions;
        const cell = (v: number | null | undefined, tier: HeatTier | undefined, d: string, name: string) => (
          <td
            key={d}
            data-label={DIM[d]?.() ?? d}
            className="m2-num m2-ck-heat"
            data-band={tier ? BAND[tier] : undefined}
            title={v == null ? t("{name}: {dim} not measured", { name, dim: DIM[d]?.() ?? d }) : t("{name}: {dim} {score}, {tier}", { name, dim: DIM[d]?.() ?? d, score: f1(v), tier: tier ? TIER[tier]() : f1(null) })}
          >
            {f1(v ?? null)}
          </td>
        );
        return (
          <>
            <div className="m2-ck-matrix">
              <Table title={title} head={[t("Module"), ...dims.map((d) => DIM[d]?.() ?? d), t("Critical rules failing")]}>
                {h.rows.map((r) => {
                  const name = formatModuleName(r.module);
                  return (
                    <tr key={r.module}>
                      <th scope="row" className="m2-card-lead">
                        {name} <span className="m2-mono m2-meta">{r.module}</span>
                        <span className="m2-meta"> {GROUP[r.group]?.() ?? r.group}</span>
                      </th>
                      {dims.map((d) => cell(r.scores[d], r.tier[d], d, name))}
                      <td data-label={t("Critical rules failing")} className="m2-num">{int(r.critical)}</td>
                    </tr>
                  );
                })}
              </Table>
            </div>
            {h.rows.some((r) => r.cap_reason) ? (
              <ul className="m2-meta">
                {h.rows.filter((r) => r.cap_reason).map((r) => (
                  <li key={r.module}>{formatModuleName(r.module)}: {r.cap_reason}</li>
                ))}
              </ul>
            ) : null}
          </>
        );
      }}
    </Section>
  );
}

type AwareQ = { isPending: boolean; isError: boolean; error: unknown; data: ConfigAwareScore | null | undefined; refetch: () => unknown };

function AwarePanel({ q }: { q: AwareQ }) {
  const title = t("Config-aware score");
  return (
    <Section q={q} title={title} meta={t("Only the rules your configuration says apply")} testId="sl-aware">
      {(ca) => {
        if (!ca) return <EmptyFrame>{t("No finished run to score against the configuration yet.")}</EmptyFrame>;
        const tally = ca.config_aware;
        return (
          <>
            <p className="m2-meta">
              {ca.config_load
                ? t("Judged from the configuration loaded on {date}.", { date: formatDate(ca.config_load.loaded_at, "date") })
                : t("No configuration is loaded, so every rule counts by default.")}{" "}
              {t("{a} rules apply, {p} pass, {n} do not apply, {d} kept by default.", { a: int(tally.applicable), p: int(tally.passes), n: int(tally.not_applicable), d: int(tally.by_default) })}
            </p>
            {ca.processes.length ? (
              <CcHBars
                label={t("Config-aware score per process")}
                testId="sl-processes"
                rows={ca.processes.map((p) => ({ key: p.l1, label: <>{p.name} <span className="m2-mono m2-meta">{p.l1}</span></>, value: p.score ?? 0, text: f1(p.score), tone: p.score == null ? "data" : p.score >= 85 ? "pass" : p.score >= 70 ? "warn" : "crit" }))}
              />
            ) : null}
            <Table title={t("Config-aware score per module")} head={[t("Module"), t("Rules that apply"), t("Do not apply"), t("Pass"), t("Score")]}>
              {ca.modules.map((m) => (
                <tr key={m.module}>
                  <th scope="row" className="m2-card-lead">{formatModuleName(m.module)} <span className="m2-mono m2-meta">{m.module}</span></th>
                  <td data-label={t("Rules that apply")} className="m2-num">{int(m.applicable)}</td>
                  <td data-label={t("Do not apply")} className="m2-num">{int(m.not_applicable)}</td>
                  <td data-label={t("Pass")} className="m2-num">{int(m.passes)}</td>
                  <td data-label={t("Score")} className="m2-num">{f1(m.score)}</td>
                </tr>
              ))}
            </Table>
            {tally.not_applicable_reasons.length ? (
              <Table title={t("Why rules do not apply")} head={[t("Reason"), t("Rules")]}>
                {tally.not_applicable_reasons.map((r, i) => (
                  <tr key={r.reason ?? i}>
                    <th scope="row" className="m2-card-lead">{r.reason ?? t("No reason recorded")}</th>
                    <td data-label={t("Rules")} className="m2-num">{int(r.count)}</td>
                  </tr>
                ))}
              </Table>
            ) : null}
          </>
        );
      }}
    </Section>
  );
}
