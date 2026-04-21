"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  Upload as UploadIcon,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  Server,
  ClipboardList,
  Sparkles,
  AlertCircle,
  ArrowRight,
  Activity,
  Database,
  Shield,
  BarChart3,
  CheckCircle2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { getVersions } from "@/lib/api/versions";
import { getMdmDashboard } from "@/lib/api/mdm-metrics";
import { AxiosError } from "axios";
import { scoreColor, formatModuleName, relativeTime } from "@/lib/format";
import { useCountUp } from "@/hooks/use-count-up";
import { DqsSparkline } from "@/components/charts/dqs-sparkline";
import { DqsBarChart } from "@/components/charts/dqs-bar-chart";
import { DimensionDonut } from "@/components/charts/dimension-donut";
import { SeverityBarChart } from "@/components/charts/severity-bar-chart";
import type { DQSSummary, DimensionScores } from "@/types/api";

/* ─── Helpers ─── */

function averageDqs(summary: Record<string, DQSSummary>): number {
  const scores = Object.values(summary).map((m) => m.composite_score);
  if (scores.length === 0) return 0;
  return Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10;
}

function averageDimensions(summary: Record<string, DQSSummary>): DimensionScores {
  const modules = Object.values(summary);
  if (modules.length === 0) {
    return { completeness: 0, accuracy: 0, consistency: 0, timeliness: 0, uniqueness: 0, validity: 0 };
  }
  const dims: DimensionScores = { completeness: 0, accuracy: 0, consistency: 0, timeliness: 0, uniqueness: 0, validity: 0 };
  for (const m of modules) {
    for (const key of Object.keys(dims) as (keyof DimensionScores)[]) {
      dims[key] += m.dimension_scores[key] ?? 0;
    }
  }
  for (const key of Object.keys(dims) as (keyof DimensionScores)[]) {
    dims[key] = Math.round((dims[key] / modules.length) * 10) / 10;
  }
  return dims;
}

function aggregateSeverityCounts(summary: Record<string, DQSSummary>) {
  let critical = 0, high = 0, medium = 0, low = 0;
  for (const m of Object.values(summary)) {
    critical += m.critical_count ?? 0;
    high += m.high_count ?? 0;
    medium += m.medium_count ?? 0;
    low += m.low_count ?? 0;
  }
  return { critical, high, medium, low };
}

function totalChecks(summary: Record<string, DQSSummary>) {
  let total = 0, passing = 0;
  for (const m of Object.values(summary)) {
    total += m.total_checks ?? 0;
    passing += m.passing_checks ?? 0;
  }
  return { total, passing };
}

function getUserRole(): string {
  if (typeof window === "undefined") return "analyst";
  return new URLSearchParams(window.location.search).get("role") ?? "analyst";
}

/* ─── KPI Stat Card (screenshot-inspired flat card with trend) ─── */

function KpiCard({
  label,
  value,
  trend,
  trendLabel,
  delay = 0,
}: {
  label: string;
  value: string | number;
  trend?: number | null;
  trendLabel?: string;
  delay?: number;
}) {
  return (
    <div
      className="vx-card flex flex-col gap-1"
      style={{ animationDelay: `${delay}ms` }}
    >
      <p className="text-sm text-muted-foreground">{label}</p>
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-display text-3xl font-bold text-foreground">
          {value}
        </span>
        {trend != null && (
          <span
            className={`flex items-center gap-1 text-sm font-semibold ${
              trend >= 0 ? "text-[#16A34A]" : "text-[#DC2626]"
            }`}
          >
            {trend >= 0 ? (
              <TrendingUp className="h-3.5 w-3.5" />
            ) : (
              <TrendingDown className="h-3.5 w-3.5" />
            )}
            {trend >= 0 ? "+" : ""}{trend.toFixed(1)}{trendLabel ?? "%"}
          </span>
        )}
      </div>
    </div>
  );
}

/* ─── Side Stats Row ─── */

function SideStatRow({
  label,
  value,
  bold = false,
}: {
  label: string;
  value: string | number;
  bold?: boolean;
}) {
  return (
    <div className="flex items-center justify-between py-2.5">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className={`font-display text-sm ${bold ? "font-bold text-foreground" : "font-semibold text-foreground"}`}>
        {value}
      </span>
    </div>
  );
}

/* ─── Main Dashboard ─── */

export default function DashboardPage() {
  const userRole = getUserRole();

  const {
    data: versionData,
    isLoading: versionsLoading,
    error: versionsError,
    refetch: refetchVersions,
  } = useQuery({
    queryKey: ["versions", { limit: 20 }],
    queryFn: () => getVersions({ limit: 20 }),
  });

  const {
    data: mdmData,
    isLoading: mdmLoading,
    error: mdmError,
  } = useQuery({
    queryKey: ["mdm-dashboard"],
    queryFn: getMdmDashboard,
    retry: false,
    // Gracefully handle 402 (feature not available in licence)
    throwOnError: (error) => {
      const axiosError = error as AxiosError;
      return axiosError?.response?.status !== 402;
    },
  });

  const versions = versionData?.versions ?? [];
  const COMPLETED_STATUSES = ["complete", "agents_complete", "agents_failed", "agents_running", "ai_enriching", "ai_enriched"];
  const completed = versions.filter((v) => COMPLETED_STATUSES.includes(v.status) && v.dqs_summary);
  const latestComplete = completed[0];

  // Build merged DQS: latest run per module across ALL completed versions
  const mergedDqs: Record<string, DQSSummary> = {};
  const moduleVersionMap: Record<string, string> = {};
  for (const v of completed) {
    if (!v.dqs_summary) continue;
    for (const [mod, summary] of Object.entries(v.dqs_summary)) {
      if (!mergedDqs[mod]) {
        mergedDqs[mod] = summary;
        moduleVersionMap[mod] = v.id;
      }
    }
  }

  if (versionsLoading || mdmLoading) {
    return (
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-2xl" />
          ))}
        </div>
        <Skeleton className="h-80 rounded-2xl" />
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          <Skeleton className="h-72 rounded-2xl" />
          <Skeleton className="h-72 rounded-2xl" />
          <Skeleton className="h-72 rounded-2xl" />
        </div>
      </div>
    );
  }

  if (versionsError) {
    return (
      <Alert variant="destructive" className="rounded-2xl">
        <AlertTriangle className="h-4 w-4" />
        <AlertDescription>
          Failed to load dashboard data.{" "}
          <Button variant="link" className="px-0" onClick={() => refetchVersions()}>
            Retry
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  if (!latestComplete || Object.keys(mergedDqs).length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-6 py-24">
        <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-primary/10">
          <UploadIcon className="h-10 w-10 text-primary" />
        </div>
        <div className="text-center">
          <h2 className="font-display text-xl font-semibold text-foreground">No analysis data yet</h2>
          <p className="mt-2 text-muted-foreground">Upload SAP data to get your first Data Quality Score.</p>
        </div>
        <Link href="/upload">
          <Button className="bg-primary text-white hover:bg-primary/80 rounded-xl px-6">
            Upload Data
          </Button>
        </Link>
      </div>
    );
  }

  const dqs = mergedDqs;
  const overallScore = averageDqs(dqs);
  const dimensions = averageDimensions(dqs);
  const severityCounts = aggregateSeverityCounts(dqs);
  const checks = totalChecks(dqs);

  // DQS Trend data
  const sparklineData = completed
    .slice(0, 10)
    .reverse()
    .map((v) => ({ score: averageDqs(v.dqs_summary!) }));

  const prevComplete = completed[1];
  const prevScore = prevComplete?.dqs_summary ? averageDqs(prevComplete.dqs_summary) : null;
  const dqsDelta = prevScore !== null ? Math.round((overallScore - prevScore) * 10) / 10 : null;

  // MDM data
  const mdmLatest = mdmData?.latest ?? null;
  const mdmTrend = mdmData?.trend ?? [];
  const activeSystems = mdmData?.active_systems_count ?? 0;
  const mdmSparkline = mdmTrend.map((m) => ({ score: m.mdm_health_score }));
  const prevMdm = mdmTrend.length >= 2 ? mdmTrend[1] : null;
  const mdmDelta = mdmLatest && prevMdm
    ? Math.round((mdmLatest.mdm_health_score - prevMdm.mdm_health_score) * 10) / 10
    : null;

  // Bar chart data
  const barData = completed
    .slice(0, 10)
    .reverse()
    .map((v) => ({
      date: new Date(v.run_at).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
      label: v.label ?? "",
      score: averageDqs(v.dqs_summary!),
    }));

  // Top modules sorted by score descending
  const moduleEntries = Object.entries(dqs)
    .map(([name, summary]) => ({ name, score: summary.composite_score }))
    .sort((a, b) => b.score - a.score);

  // Active runs
  const activeRuns = versions.filter(
    (v) => v.status === "running" || v.status === "agents_running" || v.status === "pending" || v.status === "agents_enqueued"
  ).length;

  // Role visibility
  const isViewer = userRole === "viewer";
  const canSeeMdm = !isViewer;
  const canSeeAiPanel = ["admin", "steward", "ai_reviewer"].includes(userRole);

  return (
    <div className="space-y-5">
      {/* ═══════════════════════════════════════════════════════════════
          ROW 1: KPI Stat Cards (like the reference screenshot)
          ═══════════════════════════════════════════════════════════════ */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard
          label="Data Quality Score"
          value={overallScore.toFixed(1)}
          trend={dqsDelta}
          trendLabel=" pts"
          delay={0}
        />
        <KpiCard
          label="Checks Passing"
          value={checks.passing.toLocaleString()}
          trend={checks.total > 0 ? Math.round((checks.passing / checks.total) * 1000) / 10 : null}
          trendLabel="%"
          delay={60}
        />
        {canSeeMdm && mdmLatest ? (
          <KpiCard
            label="MDM Health"
            value={mdmLatest.mdm_health_score.toFixed(1)}
            trend={mdmDelta}
            trendLabel=" pts"
            delay={120}
          />
        ) : (
          <KpiCard
            label="Modules Analysed"
            value={Object.keys(dqs).length}
            delay={120}
          />
        )}
        <KpiCard
          label="Active Systems"
          value={activeSystems}
          trend={activeRuns > 0 ? activeRuns : null}
          trendLabel={activeRuns === 1 ? " run" : " runs"}
          delay={180}
        />
      </div>

      {/* ═══════════════════════════════════════════════════════════════
          ROW 2: DQS Over Time (chart + side stats panel)
          Like the "Number of Posts vs Engagement" in the reference
          ═══════════════════════════════════════════════════════════════ */}
      <div
        className="vx-card flex flex-col lg:flex-row gap-0"
        style={{ animationDelay: "220ms", padding: 0, overflow: "hidden" }}
      >
        {/* Chart area — ~70% */}
        <div className="flex-1 p-6 min-w-0">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-base font-semibold text-foreground">
              DQS Over Time
            </h3>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-primary" />
                <span className="text-xs text-muted-foreground">DQS Score</span>
              </div>
              {canSeeMdm && mdmSparkline.length >= 2 && (
                <div className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-[#16A34A]" />
                  <span className="text-xs text-muted-foreground">MDM Health</span>
                </div>
              )}
            </div>
          </div>
          <div style={{ height: 280 }}>
            {barData.length >= 2 ? (
              <DqsBarChart data={barData} />
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                Upload data at least twice to see trends
              </div>
            )}
          </div>
        </div>

        {/* Side stats panel — ~30% */}
        <div className="w-full border-t border-black/[0.06] p-6 lg:w-[280px] lg:border-t-0 lg:border-l">
          {/* Checks Summary */}
          <h4 className="text-sm font-semibold text-foreground mb-1">Quality Checks</h4>
          <div className="divide-y divide-black/[0.06]">
            <SideStatRow label="Total checks" value={checks.total} bold />
            <SideStatRow label="Passing" value={checks.passing} />
            <SideStatRow label="Failing" value={checks.total - checks.passing} />
          </div>

          <div className="my-4 border-t border-black/[0.08]" />

          {/* Severity Summary */}
          <h4 className="text-sm font-semibold text-foreground mb-1">Findings</h4>
          <div className="divide-y divide-black/[0.06]">
            <SideStatRow label="Critical" value={severityCounts.critical} />
            <SideStatRow label="High" value={severityCounts.high} />
            <SideStatRow label="Medium" value={severityCounts.medium} />
            <SideStatRow label="Low" value={severityCounts.low} />
          </div>

          <Link
            href="/findings"
            className="mt-4 flex items-center gap-1 text-sm font-medium text-primary hover:text-primary/80 transition-colors"
          >
            See full report <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════
          ROW 3: Health Donut + Module Leaderboard + MDM / Severity
          ═══════════════════════════════════════════════════════════════ */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-12">
        {/* Health by Dimension (Donut) */}
        <div
          className="vx-card flex flex-col items-center lg:col-span-4"
          style={{ animationDelay: "300ms" }}
        >
          <div className="mb-4 flex w-full items-center justify-between">
            <h3 className="text-base font-semibold text-foreground">
              Health by Dimension
            </h3>
          </div>
          <DimensionDonut dimensions={dimensions} overallScore={overallScore} />
        </div>

        {/* Module Leaderboard */}
        <div
          className="vx-card flex flex-col lg:col-span-4"
          style={{ animationDelay: "360ms" }}
        >
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-base font-semibold text-foreground">
              Top Modules
            </h3>
            <Link
              href="/findings"
              className="text-xs font-medium text-primary hover:text-primary/80 transition-colors"
            >
              View all
            </Link>
          </div>
          <div className="flex-1 space-y-0.5">
            {moduleEntries.slice(0, 6).map((m, i) => (
              <Link
                key={m.name}
                href={`/findings?module=${m.name}&version_id=${moduleVersionMap[m.name] ?? latestComplete.id}`}
                className="flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-black/[0.03] group"
              >
                <span
                  className="flex h-7 w-7 items-center justify-center rounded-lg font-display text-xs font-bold text-white"
                  style={{ background: scoreColor(m.score) }}
                >
                  {i + 1}
                </span>
                <span className="flex-1 text-sm text-foreground group-hover:text-primary transition-colors">
                  {formatModuleName(m.name)}
                </span>
                <span className="font-display text-sm font-bold" style={{ color: scoreColor(m.score) }}>
                  {m.score.toFixed(1)}
                </span>
              </Link>
            ))}
          </div>
        </div>

        {/* Findings by Severity */}
        <div
          className="vx-card lg:col-span-4"
          style={{ animationDelay: "420ms" }}
        >
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-base font-semibold text-foreground">
              Findings by Severity
            </h3>
            <Link
              href="/findings"
              className="text-xs font-medium text-primary hover:text-primary/80 transition-colors"
            >
              Details
            </Link>
          </div>
          <div style={{ height: 200 }}>
            <SeverityBarChart counts={severityCounts} />
          </div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════
          ROW 4: MDM Metrics + Module Health Grid + Sparklines
          ═══════════════════════════════════════════════════════════════ */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-12">
        {/* MDM Metrics Panel */}
        {canSeeMdm && mdmLatest && (
          <div
            className="vx-card lg:col-span-4"
            style={{ animationDelay: "460ms" }}
          >
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-base font-semibold text-foreground">
                MDM Metrics
              </h3>
              {mdmSparkline.length >= 2 && (
                <Badge variant="outline" className="text-xs font-medium text-muted-foreground border-black/[0.08]">
                  {mdmTrend.length} snapshots
                </Badge>
              )}
            </div>
            <div className="divide-y divide-black/[0.06]">
              <SideStatRow
                label="Golden Coverage"
                value={`${(mdmLatest.golden_record_coverage_pct * 100).toFixed(0)}%`}
              />
              <SideStatRow
                label="Match Confidence"
                value={`${(mdmLatest.avg_match_confidence * 100).toFixed(0)}%`}
              />
              <SideStatRow
                label="SLA Compliance"
                value={`${(mdmLatest.steward_sla_compliance_pct * 100).toFixed(0)}%`}
              />
              <SideStatRow
                label="Source Consistency"
                value={`${(mdmLatest.source_consistency_pct * 100).toFixed(0)}%`}
              />
              <SideStatRow
                label="Sync Coverage"
                value={`${(mdmLatest.sync_coverage_pct * 100).toFixed(0)}%`}
              />
            </div>
            {mdmSparkline.length >= 2 && (
              <div className="mt-4">
                <p className="mb-1 text-[13px] font-medium text-muted-foreground">Health Trend</p>
                <DqsSparkline data={mdmSparkline} color="#0695A8" height={36} />
              </div>
            )}
          </div>
        )}

        {/* Module Health Grid */}
        <div
          className={`vx-card ${canSeeMdm && mdmLatest ? "lg:col-span-8" : "lg:col-span-12"}`}
          style={{ animationDelay: "500ms" }}
        >
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-base font-semibold text-foreground">
              Module Health
            </h3>
            <span className="text-xs text-muted-foreground">
              Last analysed: {relativeTime(latestComplete.run_at)}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {moduleEntries.map((m) => (
              <Link
                key={m.name}
                href={`/findings?module=${m.name}&version_id=${moduleVersionMap[m.name] ?? latestComplete.id}`}
                className="group rounded-xl border border-black/[0.06] bg-white/[0.60] p-3.5 transition-all hover:border-primary/20 hover:bg-primary/10 hover:shadow-sm"
              >
                <p className="text-xs text-muted-foreground truncate">{formatModuleName(m.name)}</p>
                <div className="mt-1.5 flex items-baseline gap-2">
                  <span className="font-display text-xl font-bold" style={{ color: scoreColor(m.score) }}>
                    {m.score.toFixed(1)}
                  </span>
                  <div className="h-1.5 flex-1 rounded-full bg-black/[0.05] overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-700"
                      style={{
                        width: `${Math.min(m.score, 100)}%`,
                        background: scoreColor(m.score),
                      }}
                    />
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════
          ROW 5: AI Insights Panel
          ═══════════════════════════════════════════════════════════════ */}
      {canSeeAiPanel && mdmLatest?.ai_narrative && (
        <div
          className="vx-card overflow-hidden border-l-[3px] border-l-[#7C3AED]"
          style={{ animationDelay: "540ms" }}
        >
          <div className="mb-4 flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#7C3AED]/10">
              <Sparkles className="h-3.5 w-3.5 text-[#7C3AED]" />
            </div>
            <h3 className="text-base font-semibold text-[#7C3AED]">
              AI Health Insights
            </h3>
            <Badge className="ml-auto bg-[#7C3AED]/10 text-[#7C3AED] text-xs border-0 font-medium">
              Weekly Analysis
            </Badge>
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            {/* Narrative text */}
            <div className="lg:col-span-8">
              <p className="text-sm leading-relaxed text-muted-foreground whitespace-pre-line">
                {mdmLatest.ai_narrative}
              </p>
            </div>

            {/* Projected Score + Risk Flags */}
            <div className="lg:col-span-4 flex flex-col gap-4">
              {mdmLatest.ai_projected_score != null && (
                <div className="rounded-xl bg-white/[0.60] p-4">
                  <h4 className="mb-2 text-[13px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                    Projected Score (4 weeks)
                  </h4>
                  <div className="flex items-baseline gap-2">
                    <span
                      className="font-display text-3xl font-bold"
                      style={{ color: scoreColor(mdmLatest.ai_projected_score) }}
                    >
                      {mdmLatest.ai_projected_score.toFixed(1)}
                    </span>
                    <span className="text-sm text-muted-foreground">/100</span>
                    {(() => {
                      const projDelta = mdmLatest.ai_projected_score - mdmLatest.mdm_health_score;
                      if (Math.abs(projDelta) < 0.1) return null;
                      return (
                        <span className={`ml-auto flex items-center gap-1 text-xs font-semibold ${projDelta >= 0 ? "text-[#16A34A]" : "text-[#DC2626]"}`}>
                          {projDelta >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                          {projDelta >= 0 ? "+" : ""}{projDelta.toFixed(1)}
                        </span>
                      );
                    })()}
                  </div>
                  {mdmSparkline.length >= 2 && (
                    <div className="mt-3">
                      <DqsSparkline
                        data={[...mdmSparkline, { score: mdmLatest.ai_projected_score }]}
                        color="#7C3AED"
                        height={32}
                      />
                    </div>
                  )}
                </div>
              )}

              {mdmLatest.ai_risk_flags && mdmLatest.ai_risk_flags.length > 0 && (
                <div className="rounded-xl border border-[#DC2626]/20 bg-[#DC2626]/10 p-4">
                  <h4 className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold uppercase tracking-[0.12em] text-[#DC2626]">
                    <AlertCircle className="h-3.5 w-3.5" />
                    Risk Flags
                  </h4>
                  <ul className="space-y-1.5">
                    {mdmLatest.ai_risk_flags.map((flag, i) => (
                      <li key={i} className="flex items-start gap-2 text-xs text-[#DC2626]">
                        <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-[#DC2626]" />
                        {flag}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
