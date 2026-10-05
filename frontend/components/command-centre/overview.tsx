"use client";

/**
 * Home overview: where things stand. The Tally leads with five figures, each a
 * link to the rows behind it, and everything below answers one of them.
 *
 *  - Tally: DQS, failing checks, failing records, SAP features at risk, cost at risk.
 *  - Next step: the planner's top action, or the next step on the journey.
 *  - Charts: DQS per run, findings per object by severity, severity share.
 *  - Where this is heading: the 30-day forecast and early warnings.
 *  - Matrix: SAP object x DAMA dimension from each object's latest run.
 *  - How the score is made, and the top findings by impact.
 *  - Where the data lives: connected systems and their last extraction.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { BarChart, DonutChart, LineChart, resolveChartTokens, Sparkline } from "@/components/aurora";
import { GettingStarted } from "@/components/getting-started";
import {
  Button,
  EmptyState,
  SectionCard,
  StatusBadge,
  Tally,
  TableSkeleton,
  Verdict,
} from "@/components/ui-core";
import { useJobs } from "@/hooks/use-jobs";
import { useNowSec } from "@/hooks/use-now";
import { getPredictiveAnalytics, getPrescriptiveAnalytics } from "@/lib/api/analytics";
import { getConfigImpact, getSystems } from "@/lib/api/connectivity";
import { compositeDqs, getFindings, getFindingsAggregate } from "@/lib/api/findings";
import { getSettings } from "@/lib/api/settings";
import { getMetrics } from "@/lib/api/stewardship";
import { getVersions } from "@/lib/api/versions";
import { formatModuleName, relativeTime } from "@/lib/format";
import type { DimensionScores, DQSSummary, SystemType } from "@/types/api";

const DISMISSED_KEY = "mn_arrival_dismissed";

const DIMENSIONS: ReadonlyArray<keyof DimensionScores> = [
  "completeness", "accuracy", "consistency", "timeliness", "uniqueness", "validity",
];

/** The documented defaults (CLAUDE.md scoring), used when a tenant has set no weights. */
const DEFAULT_WEIGHTS: DimensionScores = {
  completeness: 0.25, accuracy: 0.25, consistency: 0.2, timeliness: 0.1, uniqueness: 0.1, validity: 0.1,
};

const cap = (d: string) => d.charAt(0).toUpperCase() + d.slice(1);
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/** One critical finding caps DQS at 85, two cap it at 70 (CLAUDE.md scoring). */
function band(score: number): "fail" | "warn" | undefined {
  if (score < 70) return "fail";
  if (score < 85) return "warn";
  return undefined;
}

const SYSTEM_LABEL: Record<SystemType, string> = {
  ecc: "SAP ECC",
  s4hana_onprem: "S/4HANA",
  s4hana_cloud: "S/4HANA Cloud",
  successfactors: "SuccessFactors",
  concur: "Concur",
  ariba: "Ariba",
  btp: "SAP BTP",
  ewm: "EWM",
};

function findingsHref(params: Record<string, string | undefined>): string {
  const q = new URLSearchParams({ tab: "findings" });
  for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
  return `/analyse?${q.toString()}`;
}

function verdictSentence(input: {
  dqs: number;
  previous: number | null;
  critical: number;
  high: number;
  topModule: string | null;
}): string {
  const { dqs, previous, critical, high, topModule } = input;
  const delta = previous === null ? 0 : Math.round((dqs - previous) * 10) / 10;
  const movement = previous === null || delta === 0
    ? `DQS is ${dqs.toFixed(1)}.`
    : `DQS is ${dqs.toFixed(1)}, ${delta > 0 ? "up" : "down"} ${Math.abs(delta)} points since the last run.`;
  if (critical > 0) {
    const where = topModule ? `, most of them in ${topModule}` : "";
    return `${movement} ${critical.toLocaleString()} critical finding${critical === 1 ? " blocks" : "s block"} readiness${where}.`;
  }
  if (high > 0) return `${movement} No critical findings; ${high.toLocaleString()} high-severity finding${high === 1 ? " needs" : "s need"} review.`;
  return `${movement} No critical or high-severity findings are open.`;
}

interface NextStep { text: string; action: string; href: string }

/** The single most useful thing to do now, walking the journey in order. */
function nextStep(input: {
  systems: number | null; extracted: boolean; runs: number; critical: number;
  topAction: { text: string; href: string } | null; backlog: number;
}): NextStep | null {
  const { systems, extracted, runs, critical, topAction, backlog } = input;
  if (systems === 0) return { text: "No SAP system is connected yet.", action: "Connect a system", href: "/data?tab=systems" };
  if (runs === 0 && !extracted) return { text: "A system is connected but nothing has been extracted.", action: "Run an extraction", href: "/data?tab=runs" };
  if (runs === 0) return { text: "Data is loaded but has not been analysed.", action: "Run an analysis", href: "/analyse?tab=analyses" };
  if (critical > 0 && topAction) return { text: topAction.text, action: "Open finding", href: topAction.href };
  if (critical > 0) return { text: `${plural(critical, "critical finding")} ${critical === 1 ? "is" : "are"} open.`, action: "Open critical findings", href: "/analyse?tab=findings&severity=critical" };
  if (backlog > 0) return { text: `${plural(backlog, "record")} ${backlog === 1 ? "is" : "are"} waiting for a steward.`, action: "Open the inbox", href: "/workbench" };
  return { text: "Nothing critical is open. Re-run the analysis after the next extraction.", action: "Analysis runs", href: "/analyse?tab=analyses" };
}

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

const compact = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });

export function CommandCentreOverview() {
  const router = useRouter();
  const agg = useQuery({ queryKey: ["findings.aggregate"], queryFn: () => getFindingsAggregate() });
  const versions = useQuery({ queryKey: ["versions.list", { limit: 40 }], queryFn: () => getVersions({ limit: 40 }) });
  const latestVersion = versions.data?.versions.find((v) => v.dqs_summary && Object.keys(v.dqs_summary).length);
  const impact = useQuery({ queryKey: ["config-impact", latestVersion?.id], enabled: !!latestVersion,
    queryFn: () => getConfigImpact(latestVersion!.id), retry: false, meta: { ignoreError: true } });
  const forecast = useQuery({ queryKey: ["analytics.predictive"], queryFn: () => getPredictiveAnalytics(),
    retry: false, meta: { ignoreError: true } });
  const planner = useQuery({ queryKey: ["analytics.prescriptive", { limit: 5 }],
    queryFn: () => getPrescriptiveAnalytics({ limit: 5 }), retry: false, meta: { ignoreError: true } });
  const top = useQuery({ queryKey: ["findings.top-impact"], queryFn: () => getFindings({ sort: "impact", limit: 5 }),
    retry: false, meta: { ignoreError: true } });
  const settings = useQuery({ queryKey: ["settings"], queryFn: getSettings, retry: false, meta: { ignoreError: true } });
  const systems = useQuery({ queryKey: ["systems.list"], queryFn: getSystems, retry: false, meta: { ignoreError: true } });
  const inbox = useQuery({ queryKey: ["stewardship.metrics"], queryFn: getMetrics, retry: false, meta: { ignoreError: true } });
  const { jobs } = useJobs();
  const nowSec = useNowSec(true, 30_000);
  const [dismissed, setDismissed] = useState<string | null>(() => {
    try { return sessionStorage.getItem(DISMISSED_KEY); } catch { return null; }
  });

  const a = agg.data;
  const dqs = a?.dqs.composite ?? null;
  const previous = a?.previous_dqs ?? null;
  const delta = dqs !== null && previous !== null ? Math.round((dqs - previous) * 10) / 10 : null;
  const topModule = a?.by_module[0]?.module ?? null;

  /** Each object's latest run: versions arrive newest first. */
  const objects = useMemo(() => {
    const seen = new Map<string, { summary: DQSSummary; versionId: string }>();
    for (const v of versions.data?.versions ?? []) {
      for (const [module, summary] of Object.entries(v.dqs_summary ?? {})) {
        if (!seen.has(module)) seen.set(module, { summary, versionId: v.id });
      }
    }
    return [...seen.entries()]
      .map(([module, s]) => ({ module, ...s }))
      .sort((x, y) => x.summary.composite_score - y.summary.composite_score);
  }, [versions.data]);
  const totalChecks = objects.reduce((n, o) => n + (o.summary.total_checks ?? 0), 0);

  const forecastByModule = useMemo(
    () => new Map((forecast.data?.forecasts ?? []).map((f) => [f.module_id, f])),
    [forecast.data],
  );
  /** The three objects furthest below where they should be in 30 days. */
  const heading = useMemo(
    () => [...(forecast.data?.forecasts ?? [])].sort((x, y) => x.forecast_30d - y.forecast_30d).slice(0, 3),
    [forecast.data],
  );

  /** DQS per run, oldest first, for the trend chart. */
  const trend = useMemo(() => (versions.data?.versions ?? [])
    .flatMap((v) => {
      const dqs = compositeDqs(v.dqs_summary);
      return dqs === null ? [] : [{ run: shortDate(v.run_at), dqs: Math.round(dqs * 10) / 10, id: v.id }];
    })
    .reverse(), [versions.data]);

  const colours = useMemo(() => resolveChartTokens(null), []);
  const sev = [
    { key: "critical", label: "Critical", color: colours.status.danger },
    { key: "high", label: "High", color: colours.status.warning },
    { key: "medium", label: "Medium", color: colours.status.info },
    { key: "low", label: "Low", color: colours.axisInk },
  ] as const;
  const byObject = (a?.by_module ?? []).slice(0, 8).map((m) => ({
    module: m.module, object: formatModuleName(m.module), critical: m.critical, high: m.high, medium: m.medium, low: m.low,
  }));

  const arrivedJob = jobs.find((j) => j.kind !== "config_sync" && j.status === "completed"
    && nowSec - (j.finished_at ?? 0) < 900 && j.id !== dismissed);
  const dismiss = () => {
    if (!arrivedJob) return;
    try { sessionStorage.setItem(DISMISSED_KEY, arrivedJob.id); } catch { /* storage blocked */ }
    setDismissed(arrivedJob.id);
  };

  const empty = a && a.version_ids.length === 0 && !versions.isLoading && (versions.data?.versions.length ?? 0) === 0;
  const actions = planner.data?.actions.slice(0, 5) ?? [];
  const actionHref = (x: (typeof actions)[number]) =>
    x.check_id ? findingsHref({ check_id: x.check_id, module: x.module }) : "/workbench";

  const lastSync = (systems.data ?? []).map((s) => s.last_sync_at).filter((t): t is string => !!t).sort().pop() ?? null;
  const backlog = inbox.data?.backlog_total ?? 0;
  const best = actions[0];
  const next = a && !versions.isLoading && !systems.isLoading ? nextStep({
    systems: systems.data ? systems.data.length : null,
    extracted: !!lastSync,
    runs: versions.data?.versions.length ?? 0,
    critical: a.severity.critical,
    topAction: best ? {
      text: `Clear ${best.title}: ${plural(best.affected_count, "record")}, about ${Math.max(1, Math.round(best.effort_hours))} hours, `
        + `worth ${best.impact_points.toFixed(1)} points of DQS.`,
      href: actionHref(best),
    } : null,
    backlog,
  }) : null;

  const impactSummary = impact.data?.summary;
  const atRisk = impactSummary ? impactSummary.features_blocked + impactSummary.features_degraded : null;
  const cost = a?.cost_at_risk ?? null;
  const costObjects = a?.by_module.filter((m) => (m.cost_at_risk ?? 0) > 0).length ?? 0;
  const retryAgg = () => { void agg.refetch(); };

  const weights = settings.data?.dqs_weights ?? DEFAULT_WEIGHTS;
  const weightTotal = DIMENSIONS.reduce((n, d) => n + weights[d], 0) || 1;

  return (
    <div className="ui-page">
      {arrivedJob ? (
        <div className="ui-notice" role="status">
          <span>{arrivedJob.label} finished. {arrivedJob.message}</span>
          <Button variant="secondary" size="sm" onClick={() => { dismiss(); router.push("/analyse"); }}>Open findings</Button>
          <button type="button" className="ui-link-button" onClick={dismiss}>Dismiss</button>
        </div>
      ) : null}

      {empty ? (
        <div className="mn-legacy-host"><GettingStarted hasAnalysis={false} /></div>
      ) : null}

      {a && dqs !== null ? (
        <Verdict>
          {verdictSentence({ dqs, previous, critical: a.severity.critical, high: a.severity.high,
            topModule: topModule ? formatModuleName(topModule) : null })}
        </Verdict>
      ) : null}

      <Tally
        level={1}
        label="Where things stand"
        as_of={latestVersion ? `Latest run ${relativeTime(latestVersion.run_at)}, ${plural(objects.length, "SAP object")} assessed.` : undefined}
        figures={[
          {
            label: "DQS",
            value: dqs === null ? null : dqs.toFixed(1),
            href: "/analyse?tab=analyses",
            loading: agg.isLoading,
            error: agg.isError ? { retry: retryAgg } : undefined,
            tone: a ? (a.dqs.tier === "fail" ? "danger" : a.dqs.tier === "warn" ? "warning" : undefined) : undefined,
            verdict: dqs === null ? "No scored run yet. Run an analysis."
              : a?.dqs.capped ? "of 100, capped by critical findings" : "of 100",
            delta: delta === null ? undefined : { value: delta, unit: " points", good: "up" },
          },
          {
            label: "Failing checks",
            value: a ? a.total : null,
            href: findingsHref({}),
            loading: agg.isLoading,
            error: agg.isError ? { retry: retryAgg } : undefined,
            tone: a?.severity.critical ? "danger" : undefined,
            verdict: a ? `${totalChecks ? `of ${totalChecks.toLocaleString()}. ` : ""}${a.severity.critical.toLocaleString()} critical` : "",
          },
          {
            label: "Failing records",
            value: a ? a.affected_records : null,
            href: "/analyse?tab=triage",
            loading: agg.isLoading,
            error: agg.isError ? { retry: retryAgg } : undefined,
            verdict: a ? `across ${plural(a.by_module.length, "object")}` : "",
          },
          {
            label: "SAP features at risk",
            value: atRisk,
            href: "/process?tab=readiness",
            loading: !!latestVersion && impact.isLoading,
            error: impact.isError ? { retry: () => { void impact.refetch(); } } : undefined,
            tone: impactSummary?.features_blocked ? "danger" : undefined,
            verdict: impactSummary
              ? `${impactSummary.features_blocked} blocked, ${impactSummary.features_degraded} degraded`
              : "No SAP feature assessed yet.",
          },
          {
            label: "Cost at risk",
            value: cost ? compact.format(cost) : null,
            href: findingsHref({ sort: "impact" }),
            loading: agg.isLoading,
            error: agg.isError ? { retry: retryAgg } : undefined,
            verdict: cost ? `this run, across ${plural(costObjects, "object")}` : "No cost formula configured.",
          },
        ]}
      />

      {next ? (
        <SectionCard title="Next step">
          <p className="ui-note">{next.text}</p>
          <Button variant="primary" size="sm" onClick={() => router.push(next.href)}>{next.action}</Button>
        </SectionCard>
      ) : null}

      <div className="mn-charts">
        <SectionCard title="Score per run" meta={trend.length ? "Select a run to see its findings" : undefined}>
          {trend.length < 2 ? <EmptyState>The trend appears after the second run.</EmptyState> : (
            <LineChart data={trend} xKey="run" series={[{ key: "dqs", label: "DQS", color: colours.accent }]}
              height={220} yFormatter={(v) => v.toFixed(0)} ariaLabel={`DQS over ${trend.length} runs`}
              onPointClick={(i) => router.push(`/analyse?tab=analyses&version_id=${trend[i]?.id}`)} />
          )}
        </SectionCard>
        <SectionCard title="Findings per object" meta={byObject.length ? "Select an object to open it" : undefined}>
          {byObject.length === 0 ? <EmptyState>No findings yet.</EmptyState> : (
            <BarChart data={byObject} xKey="object" stacked height={220}
              series={sev.map((x) => ({ key: x.key, label: x.label, color: x.color }))}
              ariaLabel="Open findings per SAP object, split by severity"
              onBarClick={(i) => router.push(`/analyse/object/${encodeURIComponent(byObject[i].module)}`)} />
          )}
        </SectionCard>
        <SectionCard title="By severity">
          {!a || a.total === 0 ? <EmptyState>No open findings.</EmptyState> : (
            <>
              <DonutChart height={160} ariaLabel="Share of open findings by severity"
                data={sev.map((x) => ({ name: x.label, value: a.severity[x.key], color: x.color }))} />
              <ul className="mn-legend">
                {sev.map((x) => (
                  <li key={x.key}>
                    <Link href={findingsHref({ severity: x.key })}>
                      <span className="mn-legend__swatch" style={{ background: x.color }} aria-hidden />
                      {x.label}<span className="aurora-number">{a.severity[x.key].toLocaleString()}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
        </SectionCard>
      </div>

      <div className="ui-columns">
        <div className="ui-stack">
          <SectionCard title="Objects by dimension" meta={objects.length ? `${plural(objects.length, "object")}, weakest first` : undefined} flush>
            {versions.isLoading ? <TableSkeleton rows={5} label="Loading scores" /> : objects.length === 0 ? (
              <EmptyState>No scored runs yet.</EmptyState>
            ) : (
              <div className="ui-matrix-scroll">
                <table className="ui-matrix">
                  <caption className="ui-visually-hidden">
                    Score per SAP object and data quality dimension. Cells below 85 are tinted; select a cell to open its findings.
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Object</th>
                      <th scope="col">DQS</th>
                      {DIMENSIONS.map((d) => <th key={d} scope="col">{cap(d)}</th>)}
                      <th scope="col" title="Projected DQS in 30 days from the run history. Confidence grows with the number of runs.">In 30 days</th>
                    </tr>
                  </thead>
                  <tbody>
                    {objects.map(({ module, summary, versionId }) => {
                      const f = forecastByModule.get(module);
                      return (
                        <tr key={module}>
                          <th scope="row"><Link className="ui-link" href={`/analyse/object/${encodeURIComponent(module)}`}>{formatModuleName(module)}</Link></th>
                          <td data-col="dqs" data-band={band(summary.composite_score)}>
                            <Link href={findingsHref({ module, version_id: versionId })}
                              title={summary.capped && summary.cap_reason ? summary.cap_reason : undefined}>
                              {summary.composite_score.toFixed(1)}
                            </Link>
                          </td>
                          {DIMENSIONS.map((d) => {
                            const s = summary.dimension_scores[d];
                            return (
                              <td key={d} data-band={band(s)}>
                                <Link href={findingsHref({ module, dimension: d, version_id: versionId })}
                                  aria-label={`${formatModuleName(module)} ${d} ${s.toFixed(0)}`}>
                                  {s.toFixed(0)}
                                </Link>
                              </td>
                            );
                          })}
                          <td>
                            {f ? (
                              <span title={`${f.confidence}% confidence from ${f.points} runs over ${f.span_days} days`}>
                                {f.forecast_30d.toFixed(1)} <span className="ui-matrix__trend" data-trend={f.trend}>{f.trend}</span>
                              </span>
                            ) : <span>—</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>

          <SectionCard title="Top findings by impact" meta="Severity weight × records" flush>
            {top.isLoading ? <TableSkeleton rows={5} label="Loading findings" /> : !top.data || top.data.findings.length === 0 ? (
              <EmptyState>No findings.</EmptyState>
            ) : (
              <ol className="ui-ranked">
                {top.data.findings.map((f) => (
                  <li key={f.id}>
                    <Link href={`/analyse/finding/${f.id}?v=${f.version_id}`}>
                      <StatusBadge status={f.severity === "warning" ? "medium" : f.severity} />
                      <span className="ui-ranked__title">{f.details.message ?? f.check_id}</span>
                      <span className="ui-ranked__num aurora-number">{plural(f.affected_count, "record")}</span>
                      <span className="ui-ranked__meta">
                        {[formatModuleName(f.module), f.cost_at_risk ? `${compact.format(f.cost_at_risk)} at risk` : null].filter(Boolean).join(", ")}
                      </span>
                    </Link>
                  </li>
                ))}
              </ol>
            )}
          </SectionCard>
        </div>

        <div className="ui-stack">
          <SectionCard title="Where this is heading"
            action={<Link className="ui-link" href="/analyse?tab=analyses">Analysis runs</Link>}>
            {heading.length === 0 ? <EmptyState>Forecast needs three runs.</EmptyState> : (
              <ul className="ui-ranked">
                {heading.map((f) => (
                  <li key={f.module_id}>
                    <Link href={`/analyse/object/${encodeURIComponent(f.module_id)}`}>
                      <span className="ui-ranked__title">{formatModuleName(f.module_id)}</span>
                      <span className="ui-ranked__num aurora-number">{f.forecast_30d.toFixed(1)}</span>
                      <span className="ui-ranked__meta">{`In 30 days, ${f.confidence}% confidence`}</span>
                      <Sparkline height={24}
                        data={[{ d: "Now", v: f.current_score }, { d: "7 days", v: f.forecast_7d },
                          { d: "30 days", v: f.forecast_30d }, { d: "90 days", v: f.forecast_90d }]}
                        xKey="d" yKey="v" ariaLabel={`${formatModuleName(f.module_id)} score now and in 7, 30 and 90 days`} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            {(forecast.data?.early_warnings ?? []).slice(0, 2).map((w) => (
              <p key={`${w.module_id}-${w.message}`} className="ui-micro">{formatModuleName(w.module_id)}: {w.message}</p>
            ))}
          </SectionCard>

          <SectionCard title="How the score is made" meta={settings.data?.dqs_weights ? undefined : "Defaults in use"}
            action={<Link className="ui-link" href="/data?tab=scoring">Scoring and alerts</Link>}>
            <dl className="ui-dims">
              {DIMENSIONS.map((d) => (
                <div key={d} className="ui-dims__row">
                  <dt><Link className="ui-link" href={findingsHref({ dimension: d })}>{cap(d)}</Link></dt>
                  <dd><span className="aurora-number">{Math.round((weights[d] / weightTotal) * 100)}%</span></dd>
                </div>
              ))}
            </dl>
            <p className="ui-micro" style={{ marginTop: "var(--aurora-space-4)" }}>
              One critical finding caps the score at 85, two or more at 70.
            </p>
          </SectionCard>

          <SectionCard title="Where the data lives"
            action={<Link className="ui-link" href="/data?tab=systems">Systems</Link>}>
            <p className="ui-note">
              <strong>SAP rows stay in this deployment.</strong> Checks run here, and the language model
              receives finding summaries only, never raw records. Nothing is written back to SAP.
            </p>
            {systems.data && systems.data.length ? (
              <ul className="ui-ranked" style={{ marginTop: "var(--aurora-space-3)" }}>
                {systems.data.map((s) => (
                  <li key={s.id}>
                    <div className="ui-ranked__row" style={{ paddingInline: 0 }}>
                      <span className="ui-micro">{s.environment}</span>
                      <span className="ui-ranked__title">{s.name}</span>
                      <span className="ui-ranked__num">{SYSTEM_LABEL[s.system_type] ?? s.system_type}</span>
                      <span className="ui-ranked__meta">
                        {s.last_sync_at ? `Last extraction ${relativeTime(s.last_sync_at)}` : "Not extracted yet"}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            ) : null}
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
