"use client";

/**
 * Executive report: the estate's data quality on one page, for the people who
 * sign off a go-live. Every figure is deterministic: aggregate findings, the
 * composite DQS, the 52 config-impact rules, the next-best-action planner and
 * the DQS history forecast. Prints to PDF from the browser.
 */

import Link from "next/link";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, EmptyState, Mono, PageHeader, SectionCard, StatusBadge, Tally, Verdict, type Status } from "@/components/ui-core";
import { getPredictiveAnalytics, getPrescriptiveAnalytics } from "@/lib/api/analytics";
import { getConfigImpact } from "@/lib/api/connectivity";
import { compositeDqs, getFindingsAggregate } from "@/lib/api/findings";
import { getVersions } from "@/lib/api/versions";
import { DIMENSIONS, formatModuleName, formatDate, humanizeIds } from "@/lib/format";

const WEIGHTS: Record<string, number> = { completeness: 0.25, accuracy: 0.25, consistency: 0.2, timeliness: 0.1, uniqueness: 0.1, validity: 0.1 };
/** The score weighs six dimensions; lifecycle and freshness are reported in the rule matrix only. */
const SCORED = DIMENSIONS.map((d) => d.id).filter((d) => d in WEIGHTS);
const IMPACT: Record<string, Status> = { blocked: "critical", degraded: "medium", ok: "ok" };
const SIGNAL: Record<string, Status> = { red: "critical", amber: "medium", green: "ok" };
const TREND: Record<string, Status> = { improving: "ok", stable: "idle", declining: "medium", critical: "critical" };
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const day = (iso: string) => formatDate(iso);
const pct = (n: number | null | undefined) => (n == null ? "—" : `${n.toFixed(1)}%`);
const band = (v: number) => (v >= 90 ? undefined : v >= 70 ? "warn" : "fail");

function Bar({ value }: { value: number }) {
  return (
    <span className="ui-dims__track" role="img" aria-label={`${value.toFixed(0)} percent`} style={{ minWidth: 80 }}>
      <span className="ui-dims__fill" data-band={band(value)} style={{ transform: `scaleX(${Math.max(0, Math.min(100, value)) / 100})` }} />
    </span>
  );
}

export function ExecutiveReport() {
  const agg = useQuery({ queryKey: ["findings.aggregate"], queryFn: () => getFindingsAggregate() });
  const versions = useQuery({ queryKey: ["versions.list", { limit: 40 }], queryFn: () => getVersions({ limit: 40 }) });
  const latest = versions.data?.versions.find((v) => v.dqs_summary && Object.keys(v.dqs_summary).length);
  const impact = useQuery({ queryKey: ["config-impact", latest?.id], enabled: !!latest, retry: false,
    queryFn: () => getConfigImpact(latest!.id), meta: { ignoreError: true } });
  const sprints = useQuery({ queryKey: ["analytics.prescriptive", 20], retry: false, meta: { ignoreError: true },
    queryFn: () => getPrescriptiveAnalytics({ limit: 20 }) });
  const predictive = useQuery({ queryKey: ["analytics.predictive"], retry: false, meta: { ignoreError: true },
    queryFn: () => getPredictiveAnalytics() });

  const a = agg.data;
  const dqs = a?.dqs.composite ?? null;
  const history = useMemo(() => (versions.data?.versions ?? [])
    .map((v) => ({ v, dqs: compositeDqs(v.dqs_summary) }))
    .filter((p): p is { v: typeof p.v; dqs: number } => p.dqs !== null)
    .slice(0, 12), [versions.data]);

  const sentence = dqs === null
    ? "No analysis has run yet."
    : a!.severity.critical > 0
      ? `The estate scores ${dqs.toFixed(1)} and ${a!.severity.critical} critical finding${a!.severity.critical === 1 ? "" : "s"} block${a!.severity.critical === 1 ? "s" : ""} go-live.`
      : dqs >= 90
        ? `The estate scores ${dqs.toFixed(1)} with no critical findings. It is ready, with ${a!.severity.high} high findings to clear.`
        : `The estate scores ${dqs.toFixed(1)} with no critical findings; ${a!.severity.high} high findings hold it below 90.`;

  const blocked = (impact.data?.results ?? []).filter((r) => r.status !== "ok")
    .sort((x, y) => (x.status === y.status ? y.total_affected_records - x.total_affected_records : x.status === "blocked" ? -1 : 1));
  const sprint = sprints.data?.sprints[0];

  const empty = (t: string) => <EmptyState>{t}</EmptyState>;

  return (
    <div className="ui-page">
      <PageHeader title="Executive report" summary="A one page read of data quality across the estate." />
      <div className="ui-report__bar">
        <Verdict>{sentence}</Verdict>
        <div className="ui-report__actions" data-print="hide">
          <Button variant="secondary" onClick={() => window.print()}>Print or save as PDF</Button>
          <Link className="ui-link" href="/analyse?tab=findings">All findings</Link>
        </div>
      </div>

      {a && dqs !== null ? (
        <>
          <Tally level={2} label="Estate" as_of={day(new Date().toISOString())} figures={[
            { label: "Composite DQS", value: Number(dqs.toFixed(1)), href: "/analyse?tab=findings", tone: dqs < 70 ? "danger" : dqs < 90 ? "warning" : undefined,
              delta: a.previous_dqs != null ? { value: Number((dqs - a.previous_dqs).toFixed(1)), unit: " points", good: "up" } : undefined,
              verdict: dqs >= 90 ? "At or above the go-live line of 90." : "Below the go-live line of 90." },
            { label: "Failing records", value: a.affected_records, href: "/analyse?tab=findings", verdict: `${a.total.toLocaleString()} findings across ${Object.keys(a.dqs.modules).length} object${Object.keys(a.dqs.modules).length === 1 ? "" : "s"}.` },
            { label: "Critical findings", value: a.severity.critical, href: "/analyse?tab=findings&severity=critical", tone: a.severity.critical ? "danger" : undefined,
              verdict: a.severity.critical ? "Each one blocks go-live." : "None block go-live." },
            { label: "Features at risk", value: impact.data ? impact.data.summary.features_blocked + impact.data.summary.features_degraded : null, href: "/analyse?tab=findings",
              tone: impact.data?.summary.features_blocked ? "high" : undefined,
              verdict: impact.data ? `${impact.data.summary.features_blocked} blocked, ${impact.data.summary.features_degraded} degraded.` : "Config impact is not available." },
          ]} />
          <p className="ui-note">
            {a.version_ids.length} system{a.version_ids.length === 1 ? "" : "s"} in the latest run set, {Object.keys(a.dqs.modules).length} object{Object.keys(a.dqs.modules).length === 1 ? "" : "s"}, {a.total.toLocaleString()} findings.
            Scores use the DAMA dimensions at the weights shown. One critical finding caps the score at 85, two or more at 70.{a.dqs.capped ? " This score is capped." : ""}
          </p>
        </>
      ) : null}

      <SectionCard title="Quality score">
        {dqs === null ? empty("No score yet. Run an analysis to fill this report.") : (
          <table className="ui-mini-table">
            <thead><tr><th>Dimension</th><th className="ui-num">Weight</th><th className="ui-num">Score</th><th><span className="ui-visually-hidden">Bar</span></th></tr></thead>
            <tbody>
              {SCORED.map((d) => {
                const v = a!.dqs.dimension_scores[d];
                return (
                  <tr key={d}>
                    <td>{cap(d)}</td>
                    <td className="ui-num">{Math.round(WEIGHTS[d] * 100)}%</td>
                    <td className="ui-num">{v == null ? "—" : v.toFixed(1)}</td>
                    <td style={{ width: "40%" }}>{v == null ? null : <Bar value={v} />}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </SectionCard>

      <SectionCard title="By object" meta={a?.by_module.length || undefined} flush>
        {!a?.by_module.length ? empty("No findings by object.") : (
          <div style={{ overflowX: "auto" }}>
            <table className="ui-mini-table">
              <thead><tr><th>Object</th><th className="ui-num">DQS</th><th className="ui-num">Critical</th><th className="ui-num">High</th><th className="ui-num">Medium</th><th className="ui-num">Low</th><th className="ui-num">Records</th><th className="ui-num">Pass rate</th></tr></thead>
              <tbody>
                {a.by_module.map((m) => {
                  const score = a.dqs.modules[m.module];
                  return (
                    <tr key={m.module}>
                      <td>{formatModuleName(m.module)}</td>
                      <td className="ui-num">{score == null ? "—" : score.toFixed(1)}</td>
                      <td className="ui-num">{m.critical || "—"}</td>
                      <td className="ui-num">{m.high || "—"}</td>
                      <td className="ui-num">{m.medium || "—"}</td>
                      <td className="ui-num">{m.low || "—"}</td>
                      <td className="ui-num">{m.affected.toLocaleString()}</td>
                      <td className="ui-num">{pct(m.avg_pass_rate)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      <SectionCard title="SAP features at risk" meta={blocked.length || undefined}>
        {!latest ? empty("No analysed version.")
          : impact.isError || !impact.data ? empty("Config impact is not available for this version. It is computed from the 52 feature rules when an analysis completes.")
          : impact.data.summary.total_features_assessed === 0 ? empty("Config impact has not been computed for this version. Re-run the analysis to fill it.")
          : blocked.length === 0 ? empty(`All ${impact.data.summary.total_features_assessed} assessed features are clear.`)
          : (
            <div className="ui-stack">
              <p className="ui-note">
                {impact.data.summary.features_blocked} blocked, {impact.data.summary.features_degraded} degraded and {impact.data.summary.features_ok} clear, of {impact.data.summary.total_features_assessed} assessed.
              </p>
              <div style={{ overflowX: "auto" }}>
                <table className="ui-mini-table">
                  <thead><tr><th>Feature</th><th>Status</th><th className="ui-num">Records</th><th>Blocked transactions</th><th>Why</th></tr></thead>
                  <tbody>
                    {blocked.map((r) => (
                      <tr key={`${r.system}-${r.feature}`}>
                        <td>{r.feature}<div className="ui-micro">{r.system}</div></td>
                        <td><StatusBadge status={IMPACT[r.status] ?? "idle"}>{cap(r.status)}</StatusBadge></td>
                        <td className="ui-num">{r.total_affected_records.toLocaleString()}</td>
                        <td className="ui-mono">{r.blocked_transactions.join(", ") || "—"}</td>
                        <td>
                          {r.blocking_findings.slice(0, 3).map((f) => (
                            <div key={f.check_id}>
                              <Link className="ui-link" href={`/workbench?tab=triage&check_id=${encodeURIComponent(f.check_id)}`}><Mono>{f.check_id}</Mono></Link>, {f.affected_count.toLocaleString()} records
                            </div>
                          ))}
                          {r.opportunity_cost_summary ? <div className="ui-micro">{r.opportunity_cost_summary}</div> : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
      </SectionCard>

      <SectionCard title="Next sprint" meta={sprint?.actions.length || undefined}>
        {!sprint ? empty("No actions planned. The planner ranks open findings by impact per hour once an analysis is complete.") : (
          <div className="ui-stack">
            <p className="ui-note">
              {sprint.name}: {sprint.actions.length} actions, {sprint.total_effort_hours.toFixed(0)} h estimated effort, {sprint.records_fixed.toLocaleString()} records corrected.
              {sprint.dqs_now !== null && sprint.dqs_projected !== null ? ` DQS moves from ${sprint.dqs_now.toFixed(1)} to ${sprint.dqs_projected.toFixed(1)} once these findings pass.` : ""}
              {sprint.estimated_cost !== null ? ` Estimated cost ${sprint.currency} ${Math.round(sprint.estimated_cost).toLocaleString()} at your cost per record.` : ""}
              {" "}Ranked by severity-weighted records per hour{sprints.data ? `, at ${sprints.data.assumptions.minutes_per_record} min per record plus ${sprints.data.assumptions.investigation_hours} h per finding` : ""}.
            </p>
            <div style={{ overflowX: "auto" }}>
              <table className="ui-mini-table">
                <thead><tr><th className="ui-num">Rank</th><th>Action</th><th className="ui-num">Records</th><th className="ui-num">Effort</th><th>Owner</th></tr></thead>
                <tbody>
                  {sprint.actions.map((x, i) => (
                    <tr key={x.id}>
                      <td className="ui-num">{i + 1}</td>
                      <td>{humanizeIds(x.title)}<div className="ui-micro">{x.type}</div></td>
                      <td className="ui-num">{x.affected_count.toLocaleString()} of {x.total_count.toLocaleString()}</td>
                      <td className="ui-num">{x.effort_hours.toFixed(1)} h</td>
                      <td>{x.recommended_steward ?? "Unassigned"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </SectionCard>

      <SectionCard title="Outlook" meta={predictive.data?.early_warnings.length || undefined}>
        {!predictive.data || (!predictive.data.forecasts.length && !predictive.data.early_warnings.length)
          ? empty("Not enough history to forecast. Forecasts start after three recorded runs per object, one per day at most.")
          : (
            <div className="ui-stack">
              {predictive.data.early_warnings.length ? (
                <ul className="ui-plain-list">
                  {predictive.data.early_warnings.map((w) => (
                    <li key={w.module_id}>
                      <StatusBadge status={SIGNAL[w.signal] ?? "idle"}>{cap(w.signal)}</StatusBadge>{" "}
                      <strong>{formatModuleName(w.module_id)}</strong>: {w.message} {w.recommended_action}
                    </li>
                  ))}
                </ul>
              ) : null}
              {predictive.data.forecasts.length ? (
                <div style={{ overflowX: "auto" }}>
                  <table className="ui-mini-table">
                    <thead><tr><th>Object</th><th className="ui-num">Now</th><th className="ui-num">7 days</th><th className="ui-num">30 days</th><th className="ui-num">90 days</th><th>Trend</th><th className="ui-num">Confidence</th></tr></thead>
                    <tbody>
                      {predictive.data.forecasts.map((f) => (
                        <tr key={f.module_id}>
                          <td>{formatModuleName(f.module_id)}</td>
                          <td className="ui-num">{f.current_score.toFixed(1)}</td>
                          <td className="ui-num">{f.forecast_7d.toFixed(1)}</td>
                          <td className="ui-num">{f.forecast_30d.toFixed(1)}</td>
                          <td className="ui-num">{f.forecast_90d.toFixed(1)}</td>
                          <td><StatusBadge status={TREND[f.trend] ?? "idle"}>{cap(f.trend)}</StatusBadge></td>
                          <td className="ui-num">{f.confidence}% ({f.points} runs)</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </div>
          )}
      </SectionCard>

      <SectionCard title="Run history" meta={history.length || undefined}>
        {!history.length ? empty("No analysed runs.") : (
          <div style={{ overflowX: "auto" }}>
            <table className="ui-mini-table">
              <thead><tr><th>Run</th><th>Date</th><th>Objects</th><th className="ui-num">Records</th><th className="ui-num">DQS</th><th><span className="ui-visually-hidden">Bar</span></th></tr></thead>
              <tbody>
                {history.map(({ v, dqs: d }) => (
                  <tr key={v.id}>
                    <td>{v.label ?? v.metadata?.file_name ?? v.id.slice(0, 8)}{v.metadata?.baseline ? <div className="ui-micro">Baseline</div> : null}</td>
                    <td>{day(v.run_at)}</td>
                    <td>{(v.metadata?.modules ?? []).map(formatModuleName).join(", ")}</td>
                    <td className="ui-num">{(v.metadata?.row_count ?? 0).toLocaleString()}</td>
                    <td className="ui-num">{d.toFixed(1)}</td>
                    <td style={{ width: "25%" }}><Bar value={d} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </div>
  );
}
