"use client";

/**
 * Object 360: everything Meridian knows about one SAP object on one page.
 *
 *  - Score: latest composite DQS as a ring, the cap that applies, and the severity Tally.
 *  - Shape: the six DAMA dimensions as a radar (each links to its findings), and the score per run.
 *  - What breaks in SAP: config-impact features this object's findings block.
 *  - Worst checks: findings ranked by records affected, each opening Finding detail.
 *  - Who fixes it: the planner's recommended steward and effort for this object.
 */

import { useMemo } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { LineChart, RadarChart } from "@/components/aurora";
import {
  DataTable, EmptyState, KeyValue, Mono, PageHeader, ScoreRing, SectionCard, StatusBadge, Tally, TableSkeleton,
  type AuroraColumnMeta, type Status,
} from "@/components/ui-core";
import { PageCrumb } from "@/components/shell/page-crumb";
import { getPrescriptiveAnalytics } from "@/lib/api/analytics";
import { getConfigImpact } from "@/lib/api/connectivity";
import { getFindings } from "@/lib/api/findings";
import { getTriageMetrics } from "@/lib/api/triage";
import { getVersions } from "@/lib/api/versions";
import { formatModuleName, relativeTime, formatDate } from "@/lib/format";
import type { DimensionScores, Finding } from "@/types/api";

const meta = (m: AuroraColumnMeta) => m;
const DIMENSIONS: ReadonlyArray<keyof DimensionScores> = [
  "completeness", "accuracy", "consistency", "timeliness", "uniqueness", "validity",
];
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const SEVERITIES = new Set(["critical", "high", "medium", "low"]);
const plural = (n: number, w: string) => `${n.toLocaleString()} ${w}${n === 1 ? "" : "s"}`;

export default function Object360Page() {
  const obj = decodeURIComponent(useParams<{ module: string }>().module);
  const name = formatModuleName(obj);
  const router = useRouter();
  const crumb = (
    <PageCrumb segments={[
      { level: "portfolio", label: "Portfolio", href: "/" },
      { level: "hub", label: "Analyse", href: "/analyse" },
      { level: "page", label: `Object: ${name}` },
    ]} />
  );

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
  const triage = useQuery({ queryKey: ["triage.metrics", 8], queryFn: () => getTriageMetrics(8), retry: false, meta: { ignoreError: true } });

  const features = (impact.data?.results ?? [])
    .map((r) => ({ ...r, mine: r.blocking_findings.filter((b) => b.module === obj) }))
    .filter((r) => r.status !== "ok" && r.mine.length > 0)
    .sort((x, y) => (x.status === y.status ? y.total_affected_records - x.total_affected_records : x.status === "blocked" ? -1 : 1));
  const actions = (planner.data?.actions ?? []).filter((x) => x.module === obj);
  const steward = actions.find((x) => x.recommended_steward)?.recommended_steward ?? null;
  const effort = actions.reduce((n, x) => n + x.effort_hours, 0);
  const owners = (triage.data?.backlog_by_owner ?? []).filter((o) => o.open > 0).sort((a, b) => b.open - a.open).slice(0, 5);

  const list: Finding[] = findings.data?.findings ?? [];
  const trend = [...runs].reverse().map((r) => ({
    run: formatDate(r.at),
    dqs: Math.round(r.s.composite_score * 10) / 10,
  }));

  const columns = useMemo<ColumnDef<Finding, unknown>[]>(() => [
    { id: "sev", header: "Severity", meta: meta({ width: 104 }),
      cell: ({ row }) => <StatusBadge status={(SEVERITIES.has(row.original.severity) ? row.original.severity : "low") as Status}>{cap(row.original.severity)}</StatusBadge> },
    { id: "check", header: "Check", meta: meta({ minWidth: 300 }), cell: ({ row }) => (
      <Link className="ui-cell-stack ui-link" href={`/analyse/finding/${row.original.id}?v=${row.original.version_id}`} onClick={(e) => e.stopPropagation()}>
        <span className="ui-cell-stack__main">{row.original.details?.message ?? row.original.check_id}</span>
        <span className="ui-cell-stack__sub"><Mono>{row.original.check_id}</Mono><span>{cap(row.original.dimension)}</span></span>
      </Link>) },
    { id: "n", header: "Records affected", meta: meta({ width: 170, align: "end", numeric: true }),
      cell: ({ row }) => `${row.original.affected_count.toLocaleString()} of ${row.original.total_count.toLocaleString()}` },
    { id: "pass", header: "Pass rate", meta: meta({ width: 100, align: "end", numeric: true }),
      cell: ({ row }) => (row.original.pass_rate === null ? "—" : `${row.original.pass_rate.toFixed(1)}%`) },
  ], []);

  if (versions.isLoading) return <div className="ui-page">{crumb}<TableSkeleton rows={6} label={`Loading ${name}`} /></div>;
  if (!latest) {
    return (
      <div className="ui-page">
        {crumb}
        <EmptyState action={<Link className="ui-link" href="/analyse?tab=analyses">Open analysis runs</Link>}>{name} has no scored run yet.</EmptyState>
      </div>
    );
  }

  const s = latest.s;
  const delta = prior ? Math.round((s.composite_score - prior.s.composite_score) * 10) / 10 : null;
  const findingsHref = (extra: Record<string, string> = {}) =>
    `/analyse?${new URLSearchParams({ tab: "findings", module: obj, version_id: latest.id, ...extra })}`;
  const failing = s.total_checks - s.passing_checks;
  const weakest = [...DIMENSIONS].sort((a, b) => s.dimension_scores[a] - s.dimension_scores[b])[0];
  const sevFig = (k: "critical" | "high" | "medium" | "low", tone?: "danger" | "high") => ({
    label: cap(k), value: s[`${k}_count`], href: findingsHref({ severity: k }), tone,
    verdict: `${plural(s[`${k}_count`], "check")} at this severity.`,
  });

  return (
    <div className="ui-page ui-o360">
      {crumb}
      <PageHeader title={name}
        summary={`${failing === 0 ? `All ${s.total_checks} checks pass.` : `${failing} of ${s.total_checks} checks fail.`} Weakest on ${weakest}, at ${s.dimension_scores[weakest].toFixed(0)}. ${
          delta === null ? "First scored run." : delta === 0 ? "Unchanged since the previous run." : `${delta > 0 ? "Up" : "Down"} ${Math.abs(delta)} since the previous run.`} Scored ${relativeTime(latest.at)}.`} />

      <div className="ui-o360__head">
        <div className="ui-stack" style={{ gap: "var(--aurora-space-3)" }}>
          <Tally level={3} label={`${name} findings by severity`} figures={[sevFig("critical", "danger"), sevFig("high", "high"), sevFig("medium"), sevFig("low")]} />
          {s.capped && s.cap_reason ? <p className="ui-o360__cap">Score capped: {s.cap_reason}</p> : null}
        </div>
        <ScoreRing score={s.composite_score} size={120} capReason={s.capped ? s.cap_reason : null} />
      </div>

      <div className="mn-charts">
        <SectionCard title="Score by dimension" meta={`Weakest: ${weakest}`}>
          <RadarChart data={DIMENSIONS.map((d) => ({ axis: cap(d), value: s.dimension_scores[d] }))} ariaLabel={`${name} score per dimension`} />
          <p className="ui-o360__dims">
            {DIMENSIONS.map((d) => (
              <Link key={d} className="ui-link" href={findingsHref({ dimension: d })}>{cap(d)} <span className="aurora-number">{s.dimension_scores[d].toFixed(0)}</span></Link>
            ))}
          </p>
        </SectionCard>
        <SectionCard title="Score per run" meta={runs.length > 1 ? "Select a run to open its findings" : undefined}>
          {trend.length < 2 ? <EmptyState>One run so far. The trend appears after the next analysis.</EmptyState> : (
            <LineChart data={trend} xKey="run" series={[{ key: "dqs", label: "DQS" }]} height={260} ariaLabel={`${name} score per run`}
              onPointClick={(i) => router.push(`/analyse?${new URLSearchParams({ tab: "findings", module: obj, version_id: runs[runs.length - 1 - i].id })}`)} />
          )}
        </SectionCard>
      </div>

      <SectionCard title="What breaks in SAP" meta={features.length ? "Features these findings block or degrade" : undefined}>
        {impact.isLoading ? <TableSkeleton rows={3} label="Loading SAP impact" /> : features.length === 0 ? (
          <EmptyState>No assessed SAP feature depends on a failing {name} check.</EmptyState>
        ) : (
          <ul className="ui-o360__features">
            {features.map((f) => (
              <li key={f.feature} data-status={f.status}>
                <div className="ui-o360__feature-head">
                  <StatusBadge status={f.status === "blocked" ? "critical" : "medium"}>{cap(f.status)}</StatusBadge>
                  <strong>{f.feature}</strong>
                  <Link className="ui-link" href={findingsHref({ check_id: f.mine[0].check_id })}>{plural(f.total_affected_records, "record")}</Link>
                </div>
                {f.opportunity_cost_summary ? <p>{f.opportunity_cost_summary}</p> : null}
                {f.blocked_transactions.length ? <p className="ui-o360__tcodes">{f.blocked_transactions.map((t) => <Mono key={t}>{t}</Mono>)}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <SectionCard title="Worst checks" meta={findings.data ? `${findings.data.total} failing, most records first` : undefined} flush>
        {findings.isLoading ? <TableSkeleton rows={6} label="Loading checks" /> : list.length === 0 ? (
          <EmptyState>No failing checks in the latest run.</EmptyState>
        ) : (
          <DataTable columns={columns} data={list} getRowId={(f) => f.id} ariaLabel="Worst checks"
            onRowActivate={(f) => router.push(`/analyse/finding/${f.id}?v=${f.version_id}`)} />
        )}
      </SectionCard>

      <SectionCard title="Who fixes it">
        <div className="ui-stack" style={{ gap: "var(--aurora-space-3)" }}>
          {steward || effort > 0 ? (
            <KeyValue rows={[
              { k: "Steward", v: steward ?? "Not assigned yet" },
              { k: "Effort", v: `About ${Math.round(effort).toLocaleString()} hours to fix` },
            ]} />
          ) : <EmptyState>No steward or effort is planned for {name} yet.</EmptyState>}
          {owners.length ? (
            <div className="ui-matrix-scroll">
              <table className="ui-mini-table">
                <caption className="ui-micro">Open record backlog by owner, across all objects</caption>
                <thead><tr><th scope="col">Owner</th><th scope="col">Open</th><th scope="col">Past deadline</th></tr></thead>
                <tbody>
                  {owners.map((o) => (
                    <tr key={o.user_id}>
                      <td><Link className="ui-link" href={`/issues?${new URLSearchParams({ assigned_to: o.user_id, status: "open" })}`}>{o.email}</Link></td>
                      <td className="aurora-number">{o.open.toLocaleString()}</td>
                      <td className="aurora-number">{o.breached.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      </SectionCard>
    </div>
  );
}
