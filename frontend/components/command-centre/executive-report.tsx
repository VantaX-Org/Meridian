"use client";

/**
 * Executive report: the estate's data quality on one page, for the people who
 * sign off a go-live. Every figure is deterministic — aggregate findings, the
 * composite DQS, the 52 config-impact rules, the next-best-action planner and
 * the DQS history forecast. Prints to PDF from the browser.
 */

import Link from "next/link";
import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Button, Chip, EmptyState, ReportSurface, Stack, Text, type ChipTone, type ReportSurfaceSection } from "@/components/aurora";
import { getPredictiveAnalytics, getPrescriptiveAnalytics } from "@/lib/api/analytics";
import { getConfigImpact } from "@/lib/api/connectivity";
import { compositeDqs, getFindingsAggregate } from "@/lib/api/findings";
import { getVersions } from "@/lib/api/versions";
import { formatModuleName } from "@/lib/format";

const DIMENSIONS = ["completeness", "accuracy", "consistency", "timeliness", "uniqueness", "validity"] as const;
const WEIGHTS: Record<string, number> = { completeness: 0.25, accuracy: 0.25, consistency: 0.2, timeliness: 0.1, uniqueness: 0.1, validity: 0.1 };
const SEV_TONE: Record<string, ChipTone> = { critical: "danger", high: "warning", medium: "info", low: "neutral" };
const IMPACT_TONE: Record<string, ChipTone> = { blocked: "danger", degraded: "warning", ok: "success" };
const SIGNAL_TONE: Record<string, ChipTone> = { red: "danger", amber: "warning", green: "success" };

const pct = (n: number | null | undefined) => (n == null ? "—" : `${n.toFixed(1)}%`);

function Bar({ value, tone = "accent" }: { value: number; tone?: "accent" | "danger" | "warning" | "success" }) {
  return (
    <span className="aurora-exec__bar" data-tone={tone} role="img" aria-label={`${value.toFixed(0)} percent`}>
      <span style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </span>
  );
}

function scoreTone(v: number): "success" | "warning" | "danger" {
  return v >= 90 ? "success" : v >= 70 ? "warning" : "danger";
}

export function ExecutiveReport() {
  const router = useRouter();
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
        ? `The estate scores ${dqs.toFixed(1)} with no critical findings — ready, with ${a!.severity.high} high findings to clear.`
        : `The estate scores ${dqs.toFixed(1)} with no critical findings; ${a!.severity.high} high findings hold it below 90.`;

  const blocked = (impact.data?.results ?? []).filter((r) => r.status !== "ok")
    .sort((x, y) => (x.status === y.status ? y.total_affected_records - x.total_affected_records : x.status === "blocked" ? -1 : 1));
  const sprint = sprints.data?.sprints[0];

  const sections: ReportSurfaceSection[] = [
    {
      id: "quality", label: "Quality score",
      body: dqs === null ? <EmptyState title="No score yet." body="Run an analysis to populate this report." /> : (
        <div className="aurora-exec__grid">
          <div>
            <Text variant="text-micro" tone="muted" className="aurora-exec__eyebrow">Composite DQS</Text>
            <Text variant="display-lg" numeric as="div">{dqs.toFixed(1)}</Text>
            <Text variant="text-small" tone="secondary" as="div">
              {a!.previous_dqs != null ? `${dqs - a!.previous_dqs >= 0 ? "+" : ""}${(dqs - a!.previous_dqs).toFixed(1)} vs the previous run` : "First measured run"}
              {a!.dqs.capped ? " · capped by critical findings" : ""}
            </Text>
            <Text variant="text-small" tone="muted" as="div">
              {a!.total.toLocaleString()} findings · {a!.affected_records.toLocaleString()} records affected ·{" "}
              {Object.keys(a!.dqs.modules).length} object{Object.keys(a!.dqs.modules).length === 1 ? "" : "s"}
            </Text>
          </div>
          <table className="aurora-exec__table">
            <thead><tr><th>Dimension</th><th>Weight</th><th>Score</th><th /></tr></thead>
            <tbody>
              {DIMENSIONS.map((d) => {
                const v = a!.dqs.dimension_scores[d];
                return (
                  <tr key={d}>
                    <td>{d[0].toUpperCase() + d.slice(1)}</td>
                    <td className="aurora-number">{Math.round(WEIGHTS[d] * 100)}%</td>
                    <td className="aurora-number">{v == null ? "—" : v.toFixed(1)}</td>
                    <td>{v == null ? null : <Bar value={v} tone={scoreTone(v)} />}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ),
    },
    {
      id: "modules", label: "By object", count: a?.by_module.length,
      body: !a?.by_module.length ? <EmptyState title="No findings by object." /> : (
        <table className="aurora-exec__table">
          <thead><tr><th>Object</th><th>DQS</th><th>Critical</th><th>High</th><th>Medium</th><th>Low</th><th>Records</th><th>Pass rate</th></tr></thead>
          <tbody>
            {a.by_module.map((m) => {
              const score = a.dqs.modules[m.module];
              return (
                <tr key={m.module}>
                  <td>{formatModuleName(m.module)}</td>
                  <td className="aurora-number">{score == null ? "—" : <Chip tone={scoreTone(score)}>{score.toFixed(1)}</Chip>}</td>
                  <td className="aurora-number">{m.critical || "—"}</td>
                  <td className="aurora-number">{m.high || "—"}</td>
                  <td className="aurora-number">{m.medium || "—"}</td>
                  <td className="aurora-number">{m.low || "—"}</td>
                  <td className="aurora-number">{m.affected.toLocaleString()}</td>
                  <td className="aurora-number">{pct(m.avg_pass_rate)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ),
    },
    {
      id: "features", label: "SAP features at risk", count: blocked.length,
      body: !latest ? <EmptyState title="No analysed version." /> : impact.isError || !impact.data
        ? <EmptyState title="Config impact is not available for this version." body="It is computed from the 52 feature rules when an analysis completes." />
        : impact.data.summary.total_features_assessed === 0
          ? <EmptyState title="Config impact has not been computed for this version." body="It is produced by the analysis pipeline after the checks; re-run the analysis to populate it." />
          : blocked.length === 0
            ? <EmptyState title={`All ${impact.data.summary.total_features_assessed} assessed features are clear.`} />
          : (
            <Stack gap={3}>
              <Text variant="text-small" tone="secondary">
                {impact.data.summary.features_blocked} blocked · {impact.data.summary.features_degraded} degraded ·{" "}
                {impact.data.summary.features_ok} clear, of {impact.data.summary.total_features_assessed} assessed.
              </Text>
              <table className="aurora-exec__table">
                <thead><tr><th>Feature</th><th>Status</th><th>Records</th><th>Blocked transactions</th><th>Why</th></tr></thead>
                <tbody>
                  {blocked.map((r) => (
                    <tr key={`${r.system}-${r.feature}`}>
                      <td>{r.feature}<Text variant="text-micro" tone="muted" as="div">{r.system}</Text></td>
                      <td><Chip tone={IMPACT_TONE[r.status]}>{r.status}</Chip></td>
                      <td className="aurora-number">{r.total_affected_records.toLocaleString()}</td>
                      <td className="aurora-number">{r.blocked_transactions.join(", ") || "—"}</td>
                      <td>
                        {r.blocking_findings.slice(0, 3).map((f) => (
                          <Link key={f.check_id} className="aurora-link aurora-exec__finding" href={`/?tab=issues&check_id=${encodeURIComponent(f.check_id)}`}>
                            {f.check_id} · {f.affected_count.toLocaleString()}
                          </Link>
                        ))}
                        {r.opportunity_cost_summary ? <Text variant="text-small" tone="muted" as="div">{r.opportunity_cost_summary}</Text> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Stack>
          ),
    },
    {
      id: "sprint", label: "Next sprint", count: sprint?.actions.length,
      body: !sprint ? <EmptyState title="No actions planned." body="The planner ranks open findings by impact per hour once an analysis is complete." /> : (
        <Stack gap={3}>
          <Text variant="text-small" tone="secondary">
            {sprint.name}: {sprint.actions.length} actions · {sprint.total_effort_hours.toFixed(0)} h estimated effort, ranked by records affected per hour.
          </Text>
          <table className="aurora-exec__table">
            <thead><tr><th>#</th><th>Action</th><th>Records</th><th>Effort</th><th>Owner</th></tr></thead>
            <tbody>
              {sprint.actions.map((x, i) => (
                <tr key={x.id}>
                  <td className="aurora-number">{i + 1}</td>
                  <td>{x.title}<Text variant="text-micro" tone="muted" as="div">{x.type}</Text></td>
                  <td className="aurora-number">{x.affected_count.toLocaleString()} / {x.total_count.toLocaleString()}</td>
                  <td className="aurora-number">{x.effort_hours.toFixed(1)} h</td>
                  <td>{x.recommended_steward ?? "Unassigned"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Stack>
      ),
    },
    {
      id: "outlook", label: "Outlook", count: predictive.data?.early_warnings.length,
      body: !predictive.data || (!predictive.data.forecasts.length && !predictive.data.early_warnings.length)
        ? <EmptyState title="Not enough history to forecast." body="Forecasts start after three recorded runs per object." />
        : (
          <Stack gap={4}>
            {predictive.data.early_warnings.length ? (
              <ul className="aurora-exec__warnings">
                {predictive.data.early_warnings.map((w) => (
                  <li key={w.module_id}>
                    <Chip tone={SIGNAL_TONE[w.signal]}>{w.signal}</Chip>
                    <span><strong>{formatModuleName(w.module_id)}</strong> — {w.message} <em>{w.recommended_action}</em></span>
                  </li>
                ))}
              </ul>
            ) : null}
            {predictive.data.forecasts.length ? (
              <table className="aurora-exec__table">
                <thead><tr><th>Object</th><th>Now</th><th>7 days</th><th>30 days</th><th>90 days</th><th>Trend</th><th>Confidence</th></tr></thead>
                <tbody>
                  {predictive.data.forecasts.map((f) => (
                    <tr key={f.module_id}>
                      <td>{formatModuleName(f.module_id)}</td>
                      <td className="aurora-number">{f.current_score.toFixed(1)}</td>
                      <td className="aurora-number">{f.forecast_7d.toFixed(1)}</td>
                      <td className="aurora-number">{f.forecast_30d.toFixed(1)}</td>
                      <td className="aurora-number">{f.forecast_90d.toFixed(1)}</td>
                      <td><Chip tone={f.trend === "improving" ? "success" : f.trend === "stable" ? "neutral" : f.trend === "declining" ? "warning" : "danger"}>{f.trend}</Chip></td>
                      <td className="aurora-number">{Math.round(f.confidence * 100)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
          </Stack>
        ),
    },
    {
      id: "runs", label: "Run history", count: history.length,
      body: !history.length ? <EmptyState title="No analysed runs." /> : (
        <table className="aurora-exec__table">
          <thead><tr><th>Run</th><th>Date</th><th>Objects</th><th>Records</th><th>DQS</th><th /></tr></thead>
          <tbody>
            {history.map(({ v, dqs: d }) => (
              <tr key={v.id}>
                <td>{v.label ?? v.metadata?.file_name ?? v.id.slice(0, 8)}{v.metadata?.baseline ? <Chip tone="info">baseline</Chip> : null}</td>
                <td className="aurora-number">{new Date(v.run_at).toLocaleDateString("en-GB")}</td>
                <td>{(v.metadata?.modules ?? []).map(formatModuleName).join(", ")}</td>
                <td className="aurora-number">{(v.metadata?.row_count ?? 0).toLocaleString()}</td>
                <td className="aurora-number">{d.toFixed(1)}</td>
                <td><Bar value={d} tone={scoreTone(d)} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      ),
    },
  ];

  return (
    <div className="aurora-exec">
      <ReportSurface
        eyebrow={`Executive report · ${new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}`}
        title={sentence}
        support={a && dqs !== null ? `${a.version_ids.length} system${a.version_ids.length === 1 ? "" : "s"} in the latest run set. Scores use the DAMA dimensions at the weights shown; one critical finding caps the score at 85, two or more at 70.` : undefined}
        chips={a && dqs !== null ? (
          <>
            <Chip tone={scoreTone(dqs)}>DQS {dqs.toFixed(1)}</Chip>
            {(["critical", "high"] as const).map((s) => a.severity[s] ? <Chip key={s} tone={SEV_TONE[s]}>{a.severity[s]} {s}</Chip> : null)}
          </>
        ) : undefined}
        actions={
          <>
            <Button variant="secondary" onClick={() => window.print()}>Print / PDF</Button>
            <Button variant="ghost" onClick={() => router.push("/?tab=findings")}>All findings</Button>
          </>
        }
        sections={sections}
        navLabel="Report sections"
      />
    </div>
  );
}
