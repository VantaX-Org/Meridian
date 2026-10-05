"use client";

/**
 * Command Centre overview: the verdict a consultant reads out and the sheet a
 * steward starts from. Every figure links to the findings behind it.
 *
 *  - Journey: systems, analysed objects, open findings, steward inbox, resolved,
 *    each a step a user can click into, and the one thing to do next.
 *  - Verdict and ledger: findings/aggregate, config impact (features blocked).
 *  - Charts: DQS per run, findings per object by severity, severity share.
 *  - Score: composite DQS and dimension bars.
 *  - Matrix: SAP object × DAMA dimension from each object's latest run, with
 *    the predictive 30-day forecast beside it.
 *  - Top by impact: the prescriptive planner (severity weight × records).
 *  - Where the data lives: connected systems and their last extraction.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { BarChart, DonutChart, LineChart, resolveChartTokens } from "@/components/aurora";
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
import { getMetrics } from "@/lib/api/stewardship";
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
  topAction: { title: string; href: string } | null; backlog: number;
}): NextStep | null {
  const { systems, extracted, runs, critical, topAction, backlog } = input;
  if (systems === 0) return { text: "No SAP system is connected yet.", action: "Connect a system", href: "/data?tab=systems" };
  if (runs === 0 && !extracted) return { text: "A system is connected but nothing has been extracted.", action: "Run an extraction", href: "/data?tab=runs" };
  if (runs === 0) return { text: "Data is loaded but has not been analysed.", action: "Run an analysis", href: "/analyse?tab=analyses" };
  if (critical > 0 && topAction) return { text: `Start with the biggest problem: ${topAction.title}.`, action: "Open it", href: topAction.href };
  if (backlog > 0) return { text: `${backlog.toLocaleString()} record${backlog === 1 ? " is" : "s are"} waiting for a steward.`, action: "Open the inbox", href: "/workbench" };
  return { text: "Nothing critical is open. Re-run the analysis after the next extraction.", action: "Analysis runs", href: "/analyse?tab=analyses" };
}

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
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
  const resolved = inbox.data?.items_by_status.resolved ?? 0;
  const next = a && !versions.isLoading && !systems.isLoading ? nextStep({
    systems: systems.data ? systems.data.length : null,
    extracted: !!lastSync,
    runs: versions.data?.versions.length ?? 0,
    critical: a.severity.critical,
    topAction: actions[0] ? { title: actions[0].title, href: actionHref(actions[0]) } : null,
    backlog,
  }) : null;
  const journey = [
    { label: "Systems connected", value: systems.data?.length ?? null, href: "/data?tab=systems",
      sub: lastSync ? `Last extraction ${relativeTime(lastSync)}` : "Nothing extracted yet" },
    { label: "Objects analysed", value: objects.length, href: "/analyse?tab=analyses",
      sub: latestVersion ? `Latest run ${relativeTime(latestVersion.run_at)}` : "No run yet" },
    { label: "Open findings", value: a?.total ?? null, href: "/analyse", tone: a?.severity.critical ? "danger" : undefined,
      sub: a ? `${a.affected_records.toLocaleString()} records affected` : "" },
    { label: "With stewards", value: inbox.data ? backlog : null, href: "/workbench",
      sub: inbox.data ? `${Math.round(inbox.data.sla_compliance_rate)}% inside SLA` : "" },
    { label: "Resolved", value: inbox.data ? resolved : null, href: "/workbench?tab=my-queue", tone: resolved ? "success" : undefined,
      sub: "Records fixed by stewards" },
  ];

  return (
    <div className="ui-page">
      <PageHeader
        title="Overview"
        summary={latestVersion ? `Latest run ${relativeTime(latestVersion.run_at)}, ${objects.length} SAP object${objects.length === 1 ? "" : "s"} assessed.` : undefined}
        actions={
          <>
            <Button variant="primary" onClick={() => router.push("/analyse")}>Open findings</Button>
            <Button variant="secondary" onClick={() => router.push("/?tab=report")}>Executive report</Button>
          </>
        }
      />

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

      <ol className="mn-journey-strip" aria-label="Progress from SAP to fixed records">
        {journey.map((j) => (
          <li key={j.label} data-tone={j.tone}>
            <Link href={j.href} className="aurora-focus-ring">
              <span className="mn-journey-strip__label">{j.label}</span>
              <span className="mn-journey-strip__value aurora-number">{j.value === null ? "—" : j.value.toLocaleString()}</span>
              <span className="mn-journey-strip__sub">{j.sub}</span>
            </Link>
          </li>
        ))}
      </ol>

      {next ? (
        <div className="mn-next" role="status">
          <span className="mn-next__label">Next</span>
          <span className="mn-next__text">{next.text}</span>
          <Button variant="primary" size="sm" onClick={() => router.push(next.href)}>{next.action}</Button>
        </div>
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

      <div className="mn-charts">
        <SectionCard title="Score per run" meta={trend.length ? "Select a run to see its findings" : undefined}>
          {trend.length < 2 ? <EmptyState>The trend appears after the second run.</EmptyState> : (
            <LineChart data={trend} xKey="run" series={[{ key: "dqs", label: "DQS", color: colours.accent }]}
              height={220} yFormatter={(v) => v.toFixed(0)} ariaLabel={`DQS over ${trend.length} runs`}
              onPointClick={(i) => router.push(findingsHref({ version_id: trend[i]?.id }))} />
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

          <SectionCard title="Top 5 by impact" meta="Severity weight × records" flush>
            {planner.isLoading ? <TableSkeleton rows={5} label="Loading priorities" /> : actions.length === 0 ? (
              <EmptyState>Nothing to prioritise. The planner ranks open findings once a run has scored.</EmptyState>
            ) : (
              <ol className="ui-ranked">
                {actions.map((x) => (
                  <li key={`${x.type}-${x.id}`}>
                    <Link href={actionHref(x)}>
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
            <p className="ui-micro" style={{ marginTop: "var(--aurora-space-4)" }}>
              The score weighs completeness and accuracy at 25% each, consistency at 20%, and the other three at 10%.
              One critical finding caps it at 85, two or more at 70.
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
