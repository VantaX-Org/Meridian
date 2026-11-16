"use client";

import type { ReactNode } from "react";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { useFixture } from "@/lib/api/v2/fixture";
import { getConfigAwareScore, getHeatmap, getScoreHistory, type ConfigAwareScore, type Heatmap, type HeatRow, type HeatTier, type ModuleScoreHistoryEntry, type ScoreHistory, type ScoreHistoryEntry } from "@/lib/api/v2/score";
import { formatDate, formatModuleName } from "@/lib/format";
import { t } from "@/lib/v2/i18n";
import { f1, int, moduleSlug } from "@/lib/v2/score";
import { Chip, Code, DataTable, EmptyState, ErrorState, Skeleton, Sparkline, type ChipTone, type Column } from "../kit";
import { About, Banner, Fold, HBars, Panel } from "./cfg-parts";
import { KeepLink } from "./states";

/**
 * Score lens: every run scored two ways, with the weights stored when it ran and re-weighted under today's
 * configuration (/scores/history), beside the config-aware score that counts only the rules the loaded SAP
 * configuration says apply (/findings/config-aware-score), and each module on the six DAMA dimensions for the
 * latest run (/insights/heatmap). Every number is the backend's.
 */

const status = (e: unknown) => (e as { response?: { status?: number }; status?: number } | null)?.response?.status ?? (e as { status?: number } | null)?.status;
const retry = (n: number, e: unknown) => { const s = status(e); return s !== 403 && s !== 404 && n < 2; };

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

const signed = (d: number | null) => (d == null ? f1(null) : (d > 0 ? "+" : "") + f1(d));
const diff = (a: number | null | undefined, b: number | null | undefined) => (a == null || b == null ? null : Math.round((a - b) * 10) / 10);

function Part<T>({ q, label, children }: { q: UseQueryResult<T, unknown>; label: string; children: (d: T) => ReactNode }) {
  if (q.isPending) return <Skeleton lines={4} label={label} />;
  if (q.isError) {
    return status(q.error) === 403
      ? <EmptyState heading={t("Your role cannot read the score history.")} />
      : <ErrorState sentence={t("This list could not be read.")} onRetry={() => void q.refetch()} />;
  }
  return <>{children(q.data)}</>;
}

export function ScoreLens() {
  const fixture = useFixture();
  const hist = useQuery({ queryKey: ["score-history", fixture], queryFn: lift(getScoreHistory, noHistory), staleTime: 60_000, retry });
  const heat = useQuery({ queryKey: ["score-heatmap", fixture], queryFn: lift<Heatmap | null>(getHeatmap, null), staleTime: 60_000, retry });
  const aware = useQuery({ queryKey: ["config-aware-score", fixture], queryFn: lift<ConfigAwareScore | null>(getConfigAwareScore, null), staleTime: 60_000, retry });
  const title = t("Score lens");

  if (hist.isPending) return <Skeleton lines={8} label={title} />;
  if (hist.isError) {
    return status(hist.error) === 403
      ? <EmptyState heading={t("Your role cannot read the score history.")} />
      : <ErrorState sentence={t("The score history could not be read.")} onRetry={() => void hist.refetch()} />;
  }
  const runs = hist.data.history;
  const last = runs[0];
  const ca = aware.data ?? null;
  const shift = diff(last?.under_current.composite, last?.at_the_time.composite);
  return (
    <div className="nx-body">
      <Banner
        testId="sl-banner"
        label={title}
        meta={title}
        title={!last ? t("No run has been scored yet") : t("{score} under today's weights", { score: f1(last.under_current.composite) })}
        why={t("The same runs scored two ways: with the weights in force when each ran, and again under today's weights, so a change of weights never reads as a change in the data.")}
        figs={[
          { label: t("Latest run, today's weights"), value: f1(last?.under_current.composite ?? null) },
          { label: t("Latest run, as scored then"), value: f1(last?.at_the_time.composite ?? null), note: shift == null ? undefined : t("{n} points from the weight change", { n: f1(shift) }) },
          { label: t("Config-aware score"), value: f1(ca?.config_aware.score ?? null), note: ca ? t("{n} rules do not apply", { n: int(ca.config_aware.not_applicable) }) : undefined },
        ]}
      />
      <Trend runs={runs} />
      <Fold title={t("Run by run")} hint={t("Each run scored then and now.")}><Runs runs={runs} /></Fold>
      <Fold title={t("Where the score moved")} hint={t("Heat map by rule and the score by area.")}>
        <Heat q={heat} />
        <Modules modules={hist.data.modules} />
      </Fold>
      <Fold title={t("Config-aware view")} hint={t("The score counting only the rules your configuration applies.")}><Aware q={aware} /></Fold>
      <About
        shows={t("Compares each run scored with the weights in force then and with today's weights, so a weight change is not mistaken for a data change.")}
        next={{ href: "/runs", label: t("Open the runs") }}
        why={t("This screen only reads. No run is rescored and no weight is changed.")}
        means={[
          [t("Latest run, today's weights"), t("The newest run scored with the weights you use now.")],
          [t("Latest run, as scored then"), t("The same run with the weights it was scored with when it ran.")],
          [t("Config-aware score"), t("The score counting only the rules your configuration says apply.")],
        ]}
      />
    </div>
  );
}

function Trend({ runs }: { runs: ScoreHistoryEntry[] }) {
  const title = t("Score under today's weights, run by run");
  const asc = [...runs].reverse();
  const pts = asc.flatMap((r) => (r.under_current.composite == null ? [] : [r.under_current.composite]));
  const cols: Column<ScoreHistoryEntry>[] = [
    { id: "run", label: t("Run"), cell: (r) => formatDate(r.run_at, "date") },
    { id: "now", label: t("Today's weights"), align: "end", cell: (r) => f1(r.under_current.composite) },
    { id: "then", label: t("As scored then"), align: "end", cell: (r) => f1(r.at_the_time.composite) },
  ];
  return (
    <Panel title={title} meta={t("Oldest run on the left")} testId="sl-trend">
      {pts.length < 2 ? <EmptyState heading={t("Two scored runs are needed to draw a trend.")} /> : (
        <>
          <Sparkline points={pts} label={title} />
          <DataTable caption={title} rows={asc} rowKey={(r) => r.version_id} rowLabel={(r) => formatDate(r.run_at, "date")} columns={cols} />
        </>
      )}
    </Panel>
  );
}

function Runs({ runs }: { runs: ScoreHistoryEntry[] }) {
  const title = t("Each run, then and now");
  const cols: Column<ScoreHistoryEntry>[] = [
    { id: "run", label: t("Run"), cell: (r) => formatDate(r.run_at, "date"), compare: (a, b) => a.run_at.localeCompare(b.run_at) },
    { id: "then", label: t("As scored then"), align: "end", cell: (r) => f1(r.at_the_time.composite) },
    { id: "now", label: t("Today's weights"), align: "end", cell: (r) => f1(r.under_current.composite) },
    { id: "change", label: t("Change from the weights"), align: "end", cell: (r) => signed(diff(r.under_current.composite, r.at_the_time.composite)) },
    { id: "weights", label: t("Weights used then"), cell: (r) => <span className="nx-sub">{r.scoring_recorded ? t("Recorded with the run") : t("Not recorded, default weights assumed")}</span> },
  ];
  return (
    <Panel title={title} meta={t("Newest first")} testId="sl-runs">
      {runs.length === 0 ? <EmptyState heading={t("No run has been scored yet.")} /> : (
        <DataTable caption={title} rows={runs} rowKey={(r) => r.version_id} rowLabel={(r) => formatDate(r.run_at, "date")} columns={cols} />
      )}
    </Panel>
  );
}

type ModRow = [string, ModuleScoreHistoryEntry[]];

function Modules({ modules }: { modules: ScoreHistory["modules"] }) {
  const title = t("Each module across the runs");
  const rows: ModRow[] = Object.entries(modules).sort(([a], [b]) => a.localeCompare(b));
  const cols: Column<ModRow>[] = [
    { id: "module", label: t("Module"), cell: ([m]) => <KeepLink className="nx-link" href={`/objects?module=${moduleSlug(m)}`}><Code code={m} text={formatModuleName(m)} /></KeepLink> },
    { id: "trend", label: t("Trend"), cell: ([m, s]) => (s.length > 1 ? <Sparkline points={[...s].reverse().map((x) => x.composite)} label={t("{name} over {n} runs", { name: formatModuleName(m), n: int(s.length) })} /> : f1(null)) },
    { id: "latest", label: t("Latest"), align: "end", cell: ([, s]) => f1(s[0]?.composite ?? null) },
    { id: "then", label: t("As scored then"), align: "end", cell: ([, s]) => f1(s[0]?.at_the_time ?? null) },
    { id: "since", label: t("Since the first run"), align: "end", cell: ([, s]) => signed(s.length > 1 ? diff(s[0]?.composite, s[s.length - 1]?.composite) : null) },
  ];
  return (
    <Panel title={title} meta={t("Under today's weights")} testId="sl-modules">
      {rows.length === 0 ? <EmptyState heading={t("No module has a score yet.")} /> : (
        <>
          <DataTable caption={title} rows={rows} rowKey={([m]) => m} rowLabel={([m]) => formatModuleName(m)} columns={cols} />
          <p className="nx-sub"><KeepLink className="nx-link" href="/objects">{t("Open the objects")}</KeepLink></p>
        </>
      )}
    </Panel>
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
const TIER: Record<string, () => string> = { pass: () => t("on target"), warn: () => t("below target"), fail: () => t("below the warning line") };
const TONE: Record<string, ChipTone> = { pass: "good", warn: "warn", fail: "bad" };
const GROUP: Record<string, () => string> = { ecc: () => t("SAP ECC"), successfactors: () => t("SuccessFactors"), warehouse: () => t("Warehouse") };

function HeatCell({ v, tier, target }: { v: number | null | undefined; tier: HeatTier | undefined; target?: number }) {
  if (v == null || !tier) return <>{f1(v ?? null)}</>;
  return <span>{f1(v)} <Chip tone={TONE[tier]}>{TIER[tier]()}</Chip>{target != null ? <span className="nx-sub">{`, ${t("Target")} ${f1(target)}`}</span> : null}</span>;
}

function Heat({ q }: { q: UseQueryResult<Heatmap | null, unknown> }) {
  const title = t("Each module on the six dimensions");
  return (
    <Panel title={title} meta={t("Latest run, coloured by your score targets")} testId="sl-heat">
      <Part q={q} label={title}>
        {(h) => {
          if (!h || h.rows.length === 0) return <EmptyState heading={t("No finished run has dimension scores yet.")} />;
          const cols: Column<HeatRow>[] = [
            { id: "module", label: t("Module"), cell: (r) => <span><KeepLink className="nx-link" href={`/objects?module=${moduleSlug(r.module)}`}><Code code={r.module} text={formatModuleName(r.module)} /></KeepLink> <span className="nx-sub">{GROUP[r.group]?.() ?? r.group}</span></span> },
            ...h.dimensions.map((d): Column<HeatRow> => ({ id: d, label: DIM[d]?.() ?? d, align: "end", cell: (r) => <HeatCell v={r.scores[d]} tier={r.tier[d]} target={r.target?.[d]} />, compare: (a, b) => (a.scores[d] ?? -1) - (b.scores[d] ?? -1) })),
            { id: "critical", label: t("Critical rules failing"), align: "end", cell: (r) => int(r.critical), compare: (a, b) => a.critical - b.critical },
          ];
          const capped = h.rows.filter((r) => r.cap_reason);
          return (
            <>
              <DataTable caption={title} rows={h.rows} rowKey={(r) => r.module} rowLabel={(r) => formatModuleName(r.module)} columns={cols} />
              {capped.length ? <ul className="nx-sub">{capped.map((r) => <li key={r.module}>{formatModuleName(r.module)}: {r.cap_reason}</li>)}</ul> : null}
            </>
          );
        }}
      </Part>
    </Panel>
  );
}

type AwareModule = ConfigAwareScore["modules"][number];
type Reason = ConfigAwareScore["config_aware"]["not_applicable_reasons"][number];

function Aware({ q }: { q: UseQueryResult<ConfigAwareScore | null, unknown> }) {
  const title = t("Config-aware score");
  return (
    <Panel title={title} meta={t("Only the rules your configuration says apply")} testId="sl-aware">
      <Part q={q} label={title}>
        {(ca) => {
          if (!ca) return <EmptyState heading={t("No finished run to score against the configuration yet.")} />;
          const tally = ca.config_aware;
          const mods: Column<AwareModule>[] = [
            { id: "module", label: t("Module"), cell: (m) => <Code code={m.module} text={formatModuleName(m.module)} /> },
            { id: "applicable", label: t("Rules that apply"), align: "end", cell: (m) => int(m.applicable), compare: (a, b) => a.applicable - b.applicable },
            { id: "na", label: t("Do not apply"), align: "end", cell: (m) => int(m.not_applicable), compare: (a, b) => a.not_applicable - b.not_applicable },
            { id: "pass", label: t("Pass"), align: "end", cell: (m) => int(m.passes), compare: (a, b) => a.passes - b.passes },
            { id: "score", label: t("Score"), align: "end", cell: (m) => f1(m.score), compare: (a, b) => (a.score ?? -1) - (b.score ?? -1) },
          ];
          const reasons: Column<Reason>[] = [
            { id: "reason", label: t("Reason"), cell: (r) => r.reason ?? t("No reason recorded") },
            { id: "rules", label: t("Rules"), align: "end", cell: (r) => int(r.count), compare: (a, b) => a.count - b.count },
          ];
          return (
            <>
              <p className="nx-sub">
                {ca.config_load
                  ? t("Judged from the configuration loaded on {date}.", { date: formatDate(ca.config_load.loaded_at, "date") })
                  : t("No configuration is loaded, so every rule counts by default.")}{" "}
                {t("{a} rules apply, {p} pass, {n} do not apply, {d} kept by default.", { a: int(tally.applicable), p: int(tally.passes), n: int(tally.not_applicable), d: int(tally.by_default) })}
              </p>
              {ca.processes.length ? (
                <HBars
                  label={t("Config-aware score per process")}
                  rows={ca.processes.map((p) => ({ key: p.l1, label: <Code code={p.l1} text={p.name} />, value: p.score ?? 0, text: f1(p.score), tone: p.score == null || p.score >= 85 ? "good" : p.score >= 70 ? "warn" : "bad" }))}
                />
              ) : null}
              <DataTable caption={t("Config-aware score per module")} rows={ca.modules} rowKey={(m) => m.module} rowLabel={(m) => formatModuleName(m.module)} columns={mods} />
              {tally.not_applicable_reasons.length ? (
                <DataTable caption={t("Why rules do not apply")} rows={tally.not_applicable_reasons} rowKey={(r) => r.reason ?? "none"} rowLabel={(r) => r.reason ?? t("No reason recorded")} columns={reasons} />
              ) : null}
            </>
          );
        }}
      </Part>
    </Panel>
  );
}
