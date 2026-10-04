"use client";

/**
 * Command Centre overview: the verdict a consultant reads out and the sheet a
 * steward starts from. Every figure links to the findings behind it.
 *
 *  - Verdict and ledger: findings/aggregate, config impact (features blocked).
 *  - Score: composite DQS, dimension bars, DQS per run.
 *  - Matrix: SAP object × DAMA dimension from each object's latest run, with
 *    the predictive 30-day forecast beside it.
 *  - Top by impact: the prescriptive planner (severity weight × records).
 *  - Where the data lives: connected systems and their last extraction.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { GettingStarted } from "@/components/getting-started";
import {
  Button,
  EmptyState,
  Metric,
  MetricStrip,
  PageHeader,
  SectionCard,
  StatusBadge,
  TableSkeleton,
} from "@/components/ui-core";
import { useJobs } from "@/hooks/use-jobs";
import { useNowSec } from "@/hooks/use-now";
import { getPredictiveAnalytics, getPrescriptiveAnalytics } from "@/lib/api/analytics";
import { getConfigImpact, getSystems } from "@/lib/api/connectivity";
import { compositeDqs, getFindingsAggregate } from "@/lib/api/findings";
import { getVersions } from "@/lib/api/versions";
import { formatModuleName, relativeTime } from "@/lib/format";
import type { DimensionScores, DQSSummary, SystemType } from "@/types/api";

const DISMISSED_KEY = "mn_arrival_dismissed";

const DIMENSIONS: ReadonlyArray<keyof DimensionScores> = [
  "completeness", "accuracy", "consistency", "timeliness", "uniqueness", "validity",
];

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
  ewm: "EWM",
};

function findingsHref(params: Record<string, string | undefined>): string {
  const q = new URLSearchParams({ tab: "findings" });
  for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
  return `/?${q.toString()}`;
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

/** DQS per run as one line, with the 85 threshold dashed behind it. */
function Sparkline({ points }: { points: number[] }) {
  if (points.length < 2) return <p className="ui-micro">The trend appears after the second run.</p>;
  const min = Math.min(60, ...points);
  const max = 100;
  const w = 100;
  const h = 48;
  const x = (i: number) => (i / (points.length - 1)) * w;
  const y = (v: number) => h - ((v - min) / (max - min)) * h;
  const d = points.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(2)},${y(v).toFixed(2)}`).join(" ");
  const last = points[points.length - 1];
  return (
    <svg className="ui-spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img"
      aria-label={`DQS over ${points.length} runs, from ${points[0].toFixed(1)} to ${last.toFixed(1)}`}>
      <line className="ui-spark__ref" x1={0} x2={w} y1={y(85)} y2={y(85)} />
      <path className="ui-spark__line" d={d} />
      <circle className="ui-spark__dot" cx={x(points.length - 1)} cy={y(last)} r={1.6} />
    </svg>
  );
}

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
  const systems = useQuery({ queryKey: ["systems.list"], queryFn: getSystems, retry: false, meta: { ignoreError: true } });
  const { jobs } = useJobs();
  const nowSec = useNowSec(true, 30_000);
  const [dismissed, setDismissed] = useState<string | null>(() => {
    try { return sessionStorage.getItem(DISMISSED_KEY); } catch { return null; }
  });

  const a = agg.data;
  const dqs = a?.dqs.composite ?? null;
  const previous = a?.previous_dqs ?? null;
  const delta = dqs !== null && previous !== null ? Math.round((dqs - previous) * 10) / 10 : null;
  const blocked = impact.data?.summary.features_blocked ?? null;
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

  const forecastByModule = useMemo(
    () => new Map((forecast.data?.forecasts ?? []).map((f) => [f.module_id, f])),
    [forecast.data],
  );

  const trend = useMemo(() => (versions.data?.versions ?? [])
    .map((v) => compositeDqs(v.dqs_summary))
    .filter((p): p is number => p !== null)
    .reverse(), [versions.data]);

  const arrivedJob = jobs.find((j) => j.kind !== "config_sync" && j.status === "completed"
    && nowSec - (j.finished_at ?? 0) < 900 && j.id !== dismissed);
  const dismiss = () => {
    if (!arrivedJob) return;
    try { sessionStorage.setItem(DISMISSED_KEY, arrivedJob.id); } catch { /* storage blocked */ }
    setDismissed(arrivedJob.id);
  };

  const empty = a && a.version_ids.length === 0 && !versions.isLoading && (versions.data?.versions.length ?? 0) === 0;
  const actions = planner.data?.actions.slice(0, 5) ?? [];

  return (
    <div className="ui-page">
      <PageHeader
        title="Overview"
        summary={latestVersion ? `Latest run ${relativeTime(latestVersion.run_at)}, ${objects.length} SAP object${objects.length === 1 ? "" : "s"} assessed.` : undefined}
        actions={
          <>
            <Button variant="primary" onClick={() => router.push("/?tab=findings")}>Open findings</Button>
            <Button variant="secondary" onClick={() => router.push("/?tab=report")}>Executive report</Button>
          </>
        }
      />

      {arrivedJob ? (
        <div className="ui-notice" role="status">
          <span>{arrivedJob.label} finished. {arrivedJob.message}</span>
          <Button variant="secondary" size="sm" onClick={() => { dismiss(); router.push("/?tab=findings"); }}>Open findings</Button>
          <button type="button" className="ui-link-button" onClick={dismiss}>Dismiss</button>
        </div>
      ) : null}

      {empty ? (
        <div className="mn-legacy-host"><GettingStarted hasAnalysis={false} /></div>
      ) : null}

      {a && dqs !== null ? (
        <p className="ui-verdict">
          {verdictSentence({ dqs, previous, critical: a.severity.critical, high: a.severity.high,
            topModule: topModule ? formatModuleName(topModule) : null })}
        </p>
      ) : null}

      <MetricStrip label="Open findings by severity">
        <Metric label="Critical" value={a ? a.severity.critical.toLocaleString() : null}
          tone={a?.severity.critical ? "danger" : "default"} href={findingsHref({ severity: "critical" })} />
        <Metric label="High" value={a ? a.severity.high.toLocaleString() : null}
          tone={a?.severity.high ? "warning" : "default"} href={findingsHref({ severity: "high" })} />
        <Metric label="Medium" value={a ? a.severity.medium.toLocaleString() : null} href={findingsHref({ severity: "medium" })} />
        <Metric label="Records affected" value={a ? a.affected_records.toLocaleString() : null} href={findingsHref({})} />
        <Metric label="SAP features blocked" value={blocked === null ? null : blocked.toLocaleString()}
          tone={blocked ? "danger" : "default"} href="/process?tab=config-impact" />
      </MetricStrip>

      <div className="ui-columns">
        <div className="ui-stack">
          <SectionCard title="Objects by dimension" meta={objects.length ? `${objects.length} object${objects.length === 1 ? "" : "s"}, weakest first` : undefined} flush>
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
                      {DIMENSIONS.map((d) => <th key={d} scope="col">{d.charAt(0).toUpperCase() + d.slice(1)}</th>)}
                      <th scope="col" title="Projected DQS in 30 days from the run history. Confidence grows with the number of runs.">In 30 days</th>
                    </tr>
                  </thead>
                  <tbody>
                    {objects.map(({ module, summary, versionId }) => {
                      const f = forecastByModule.get(module);
                      return (
                        <tr key={module}>
                          <th scope="row">{formatModuleName(module)}</th>
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

          <SectionCard title="Top 5 by impact" meta="Severity weight × records" flush>
            {planner.isLoading ? <TableSkeleton rows={5} label="Loading priorities" /> : actions.length === 0 ? (
              <EmptyState>Nothing to prioritise. The planner ranks open findings once a run has scored.</EmptyState>
            ) : (
              <ol className="ui-ranked">
                {actions.map((x) => (
                  <li key={`${x.type}-${x.id}`}>
                    <Link href={x.check_id ? findingsHref({ check_id: x.check_id, module: x.module }) : "/workbench"}>
                      <StatusBadge status={x.severity} />
                      <span className="ui-ranked__title">{x.title}</span>
                      <span className="ui-ranked__num aurora-number">{x.affected_count.toLocaleString()} record{x.affected_count === 1 ? "" : "s"}</span>
                      <span className="ui-ranked__meta">
                        {[x.module ? formatModuleName(x.module) : null,
                          x.recommended_steward ? `Owner ${x.recommended_steward}` : "No owner assigned",
                          `about ${Math.max(1, Math.round(x.effort_hours))} h`].filter(Boolean).join(", ")}
                      </span>
                    </Link>
                  </li>
                ))}
              </ol>
            )}
          </SectionCard>
        </div>

        <div className="ui-stack">
          <SectionCard title="Data quality score" meta={a?.dqs.capped ? "Capped by critical findings" : undefined}>
            <MetricStrip label="Composite score">
              <Metric label="Composite, out of 100" value={dqs === null ? null : dqs.toFixed(1)}
                delta={delta === null ? null : { value: delta, unit: " pts", good: "up" }} />
            </MetricStrip>
            <dl className="ui-dims" style={{ marginTop: "var(--aurora-space-4)" }}>
              {DIMENSIONS.map((d) => {
                const s = a?.dqs.dimension_scores[d];
                return (
                  <div key={d} className="ui-dims__row">
                    <dt><Link className="ui-link" href={findingsHref({ dimension: d })}>{d.charAt(0).toUpperCase() + d.slice(1)}</Link></dt>
                    <dd>
                      <span className="ui-dims__track" aria-hidden>
                        {s != null ? <span className="ui-dims__fill" data-band={band(s)} style={{ width: `${Math.max(0, Math.min(100, s))}%` }} /> : null}
                      </span>
                      <span className="aurora-number">{s == null ? "—" : s.toFixed(1)}</span>
                    </dd>
                  </div>
                );
              })}
            </dl>
            <div style={{ marginTop: "var(--aurora-space-5)" }}>
              <p className="ui-micro" style={{ marginBottom: "var(--aurora-space-2)" }}>
                DQS per run, last {trend.length}. Dashed line at 85.
              </p>
              <Sparkline points={trend} />
            </div>
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
