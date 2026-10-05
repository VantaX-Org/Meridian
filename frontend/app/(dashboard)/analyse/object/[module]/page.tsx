"use client";

/**
 * Object 360: everything Meridian knows about one SAP object on one page.
 *
 *  - Score: latest composite DQS as a ring, the cap that applies, and how it moved.
 *  - Shape: the six DAMA dimensions as a radar, and the score per run.
 *  - What breaks in SAP: config-impact features this object's findings block.
 *  - Worst checks: findings ranked by records affected, each with its failing sample.
 *  - Who fixes it: the planner's recommended steward and effort for this object.
 */

import { useMemo } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { LineChart, RadarChart } from "@/components/aurora";
import { EmptyState, SectionCard, StatusBadge, TableSkeleton } from "@/components/ui-core";
import { getPrescriptiveAnalytics } from "@/lib/api/analytics";
import { getConfigImpact } from "@/lib/api/connectivity";
import { getFindings } from "@/lib/api/findings";
import { getVersions } from "@/lib/api/versions";
import { formatModuleName, relativeTime } from "@/lib/format";
import type { Status } from "@/components/ui-core";
import type { DimensionScores, Finding } from "@/types/api";

const DIMENSIONS: ReadonlyArray<keyof DimensionScores> = [
  "completeness", "accuracy", "consistency", "timeliness", "uniqueness", "validity",
];
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const band = (n: number) => (n < 70 ? "fail" : n < 85 ? "warn" : "pass");
const SEVERITIES = new Set(["critical", "high", "medium", "low"]);

function ScoreRing({ score }: { score: number }) {
  const r = 84;
  const c = 2 * Math.PI * r;
  return (
    <svg className="mn-o360__ring" data-band={band(score)} viewBox="0 0 200 200" role="img"
         aria-label={`Data quality score ${score.toFixed(1)} out of 100`}>
      <circle cx="100" cy="100" r={r} className="mn-o360__ring-track" />
      <circle cx="100" cy="100" r={r} className="mn-o360__ring-fill"
              strokeDasharray={c} strokeDashoffset={c * (1 - score / 100)} transform="rotate(-90 100 100)" />
      <text x="100" y="104" className="mn-o360__ring-num">{score.toFixed(1)}</text>
      <text x="100" y="134" className="mn-o360__ring-unit">of 100</text>
    </svg>
  );
}

function Sample({ rows }: { rows: Record<string, unknown>[] }) {
  const cols = Object.keys(rows[0] ?? {}).slice(0, 6);
  return (
    <div className="ui-matrix-scroll">
      <table className="mn-o360__sample">
        <thead><tr>{cols.map((c) => <th key={c} scope="col">{c}</th>)}</tr></thead>
        <tbody>
          {rows.slice(0, 5).map((r, i) => (
            <tr key={i}>{cols.map((c) => <td key={c}>{r[c] == null || r[c] === "" ? <em>empty</em> : String(r[c])}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function Object360Page() {
  const obj = decodeURIComponent(useParams<{ module: string }>().module);
  const name = formatModuleName(obj);
  const router = useRouter();

  const versions = useQuery({ queryKey: ["versions.list", { limit: 40, module: obj }],
    queryFn: () => getVersions({ limit: 40, module: obj }) });
  const runs = useMemo(() => (versions.data?.versions ?? [])
    .filter((v) => v.dqs_summary?.[obj])
    .map((v) => ({ id: v.id, at: v.run_at, s: v.dqs_summary![obj] })), [versions.data, obj]);
  const latest = runs[0];
  const prior = runs[1];

  const findings = useQuery({ queryKey: ["findings", { module: obj, version_id: latest?.id, sort: "impact" }],
    enabled: !!latest, queryFn: () => getFindings({ module: obj, version_id: latest!.id, sort: "impact", limit: 12 }) });
  const impact = useQuery({ queryKey: ["config-impact", latest?.id], enabled: !!latest,
    queryFn: () => getConfigImpact(latest!.id), retry: false, meta: { ignoreError: true } });
  const planner = useQuery({ queryKey: ["analytics.prescriptive", { limit: 50 }],
    queryFn: () => getPrescriptiveAnalytics({ limit: 50 }), retry: false, meta: { ignoreError: true } });

  const features = (impact.data?.results ?? [])
    .map((r) => ({ ...r, mine: r.blocking_findings.filter((b) => b.module === obj) }))
    .filter((r) => r.status !== "ok" && r.mine.length > 0)
    .sort((x, y) => (x.status === y.status ? y.total_affected_records - x.total_affected_records : x.status === "blocked" ? -1 : 1));
  const actions = (planner.data?.actions ?? []).filter((x) => x.module === obj);
  const steward = actions.find((x) => x.recommended_steward)?.recommended_steward ?? null;
  const effort = actions.reduce((n, x) => n + x.effort_hours, 0);

  const list: Finding[] = findings.data?.findings ?? [];
  const worst = Math.max(1, ...list.map((f) => f.affected_count));
  const trend = [...runs].reverse().map((r) => ({
    run: new Date(r.at).toLocaleDateString(undefined, { day: "numeric", month: "short" }),
    dqs: Math.round(r.s.composite_score * 10) / 10,
  }));

  if (versions.isLoading) return <div className="aurora-page"><TableSkeleton rows={6} label={`Loading ${name}`} /></div>;
  if (!latest) {
    return (
      <div className="aurora-page">
        <Link href="/analyse" className="aurora-link">← Analyse</Link>
        <EmptyState>{name} has no scored run yet. Run an analysis for it from <Link className="ui-link" href="/analyse?tab=analyses">Analysis runs</Link>.</EmptyState>
      </div>
    );
  }

  const s = latest.s;
  const delta = prior ? Math.round((s.composite_score - prior.s.composite_score) * 10) / 10 : null;
  const findingsHref = (extra: Record<string, string> = {}) =>
    `/analyse?${new URLSearchParams({ tab: "findings", module: obj, version_id: latest.id, ...extra })}`;
  const failing = s.total_checks - s.passing_checks;
  const weakest = [...DIMENSIONS].sort((a, b) => s.dimension_scores[a] - s.dimension_scores[b])[0];

  return (
    <div className="aurora-page mn-o360">
      <Link href="/" className="aurora-link">← Home</Link>

      <header className="mn-o360__hero">
        <div className="mn-o360__lede">
          <h1 className="mn-o360__title">{name}</h1>
          <p className="mn-o360__verdict">
            {failing === 0 ? `All ${s.total_checks} checks pass.` : `${failing} of ${s.total_checks} checks fail.`}{" "}
            Weakest on {weakest}, at {s.dimension_scores[weakest].toFixed(0)}.{" "}
            {delta === null ? "First scored run." : delta === 0 ? "Unchanged since the previous run."
              : `${delta > 0 ? "Up" : "Down"} ${Math.abs(delta)} since the previous run.`}
          </p>
          {s.capped && s.cap_reason ? <p className="mn-o360__cap">Score capped: {s.cap_reason}</p> : null}
          <dl className="mn-o360__counts">
            {(["critical", "high", "medium", "low"] as const).map((k) => (
              <div key={k} data-sev={k}>
                <dt>{cap(k)}</dt>
                <dd><Link href={findingsHref({ severity: k })}>{s[`${k}_count`].toLocaleString()}</Link></dd>
              </div>
            ))}
            <div>
              <dt>SAP features at risk</dt>
              <dd>{impact.isLoading ? "…" : features.length}</dd>
            </div>
          </dl>
          <p className="mn-o360__meta">
            Scored {relativeTime(latest.at)}, {runs.length} run{runs.length === 1 ? "" : "s"} on record.{" "}
            {steward ? <>Owner {steward}, about {Math.round(effort)} hours to fix.</> : "No owner assigned yet."}
          </p>
        </div>
        <ScoreRing score={s.composite_score} />
      </header>

      <div className="mn-charts">
        <SectionCard title="Score by dimension" meta={`Weakest: ${weakest}`}>
          <RadarChart data={DIMENSIONS.map((d) => ({ axis: cap(d), value: s.dimension_scores[d] }))}
            ariaLabel={`${name} score per dimension`} />
        </SectionCard>
        <SectionCard title="Score per run" meta={runs.length > 1 ? "Select a run to open its findings" : undefined}>
          {trend.length < 2 ? <EmptyState>One run so far. The trend appears after the next analysis.</EmptyState> : (
            <LineChart data={trend} xKey="run" series={[{ key: "dqs", label: "DQS" }]} height={260}
              ariaLabel={`${name} score per run`}
              onPointClick={(i) => router.push(`/analyse?${new URLSearchParams({ tab: "findings", module: obj, version_id: runs[runs.length - 1 - i].id })}`)} />
          )}
        </SectionCard>
      </div>

      <SectionCard title="What breaks in SAP" meta={features.length ? "Features these findings block or degrade" : undefined}>
        {impact.isLoading ? <TableSkeleton rows={3} label="Loading SAP impact" /> : features.length === 0 ? (
          <EmptyState>No assessed SAP feature depends on a failing {name} check.</EmptyState>
        ) : (
          <ul className="mn-o360__features">
            {features.map((f) => (
              <li key={f.feature} data-status={f.status}>
                <div className="mn-o360__feature-head">
                  <StatusBadge status={f.status === "blocked" ? "critical" : "medium"}>{cap(f.status)}</StatusBadge>
                  <strong>{f.feature}</strong>
                  <span>{f.total_affected_records.toLocaleString()} records</span>
                </div>
                {f.opportunity_cost_summary ? <p>{f.opportunity_cost_summary}</p> : null}
                {f.blocked_transactions.length ? (
                  <p className="mn-o360__tcodes">{f.blocked_transactions.map((t) => <code key={t}>{t}</code>)}</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <SectionCard title="Worst checks" meta={findings.data ? `${findings.data.total} failing, most records first` : undefined}
        flush>
        {findings.isLoading ? <TableSkeleton rows={6} label="Loading checks" /> : list.length === 0 ? (
          <EmptyState>No failing checks in the latest run.</EmptyState>
        ) : (
          <ol className="mn-o360__checks">
            {list.map((f) => {
              const rows = f.details?.sample_failing_records ?? [];
              return (
                <li key={f.id}>
                  <details>
                    <summary>
                      <span className="mn-o360__bar" style={{ "--w": `${(f.affected_count / worst) * 100}%` } as React.CSSProperties}
                            data-sev={f.severity} aria-hidden />
                      <span className="mn-o360__check">
                        <StatusBadge status={(SEVERITIES.has(f.severity) ? f.severity : "low") as Status}>{cap(f.severity)}</StatusBadge>
                        <span className="mn-o360__msg">{f.details?.message ?? f.check_id}</span>
                      </span>
                      <span className="mn-o360__num">
                        <strong>{f.affected_count.toLocaleString()}</strong> of {f.total_count.toLocaleString()}
                      </span>
                    </summary>
                    <div className="mn-o360__detail">
                      <p>
                        {cap(f.dimension)} check <code>{f.check_id}</code>, {(f.pass_rate ?? 0).toFixed(1)}% pass.{" "}
                        <Link className="ui-link" href={findingsHref({ check_id: f.check_id })}>Open finding</Link>
                      </p>
                      {f.remediation_text ? <p>{f.remediation_text}</p> : null}
                      {rows.length ? <Sample rows={rows} /> : <p>No sample records were kept for this check.</p>}
                    </div>
                  </details>
                </li>
              );
            })}
          </ol>
        )}
      </SectionCard>
    </div>
  );
}
