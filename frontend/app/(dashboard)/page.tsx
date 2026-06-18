"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { getVersions } from "@/lib/api/versions";
import { getMdmDashboard } from "@/lib/api/mdm-metrics";
import { AxiosError } from "axios";
import { formatModuleName } from "@/lib/format";
import { EmptyState } from "@/components/ui/empty-state";
import type { DQSSummary, DimensionScores, Version } from "@/types/api";

import {
  DQSBars,
  DimensionRings,
  SeverityBars,
  SmallMultiples,
  DriftSpark,
  RadialGauge,
  Sparkline,
} from "@/components/meridian/charts";
import {
  PageHead,
  SectionHeader,
  KPI,
  DeltaPill,
  ScoreCell,
  SevPill,
  HeroValue,
  ActivityTicker,
  type ActivityItem,
} from "@/components/meridian/atoms";
import {
  MeridianMark,
  SparklesIcon,
  ArrowRight,
  BookmarkIcon,
  MoreH,
} from "@/components/meridian/icons";
import { copyToClipboard, saveView } from "@/components/meridian/actions";
import { SearchField, matchesSearch } from "@/components/meridian/controls";

/* ─── Aggregation helpers (unchanged) ─── */

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

const DIMENSION_KEYS: Array<keyof DimensionScores> = [
  "completeness",
  "accuracy",
  "consistency",
  "timeliness",
  "uniqueness",
  "validity",
];

interface ModuleRow {
  key: string;        // 2-letter module code (FI, MM, …)
  name: string;       // raw module id (used for URL)
  label: string;      // pretty name
  score: number;
  critical: number;
  high: number;
  medium: number;
  records: number;
  trend: number[];
  versionId: string;
}

function moduleCode(name: string): string {
  // Take the first segment before `_`/`-`/`.`/space, uppercase, truncate to 2.
  const head = name.split(/[\s_\-.]/)[0] ?? name;
  return head.slice(0, 2).toUpperCase();
}

/* ─── Page ─── */

const RANGE_OPTIONS = ["7d", "30d", "90d", "YTD"] as const;

export default function OverviewPage() {
  const userRole = getUserRole();
  const [range, setRange] = useState<(typeof RANGE_OPTIONS)[number]>("30d");
  const [moduleSearch, setModuleSearch] = useState("");

  const {
    data: versionData,
    isLoading: versionsLoading,
    error: versionsError,
    refetch: refetchVersions,
  } = useQuery({
    queryKey: ["versions", { limit: 20 }],
    queryFn: () => getVersions({ limit: 20 }),
  });

  const { data: mdmData, isLoading: mdmLoading } = useQuery({
    queryKey: ["mdm-dashboard"],
    queryFn: getMdmDashboard,
    retry: false,
    throwOnError: (error) => {
      const axiosError = error as AxiosError;
      return axiosError?.response?.status !== 402;
    },
  });

  const versions = versionData?.versions ?? [];
  const COMPLETED_STATUSES = [
    "complete",
    "agents_complete",
    "agents_failed",
    "agents_running",
    "ai_enriching",
    "ai_enriched",
  ];
  const completed = useMemo(
    () => versions.filter((v) => COMPLETED_STATUSES.includes(v.status) && v.dqs_summary),
    [versions],
  );
  const latestComplete = completed[0];

  const { mergedDqs, moduleVersionMap } = useMemo(() => {
    const merged: Record<string, DQSSummary> = {};
    const map: Record<string, string> = {};
    for (const v of completed) {
      if (!v.dqs_summary) continue;
      for (const [mod, summary] of Object.entries(v.dqs_summary)) {
        if (!merged[mod]) {
          merged[mod] = summary;
          map[mod] = v.id;
        }
      }
    }
    return { mergedDqs: merged, moduleVersionMap: map };
  }, [completed]);

  if (versionsLoading || mdmLoading) {
    return (
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-[10px]" />
          ))}
        </div>
        <Skeleton className="h-10 rounded-[10px]" />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          <Skeleton className="h-80 rounded-[10px] lg:col-span-8" />
          <Skeleton className="h-80 rounded-[10px] lg:col-span-4" />
        </div>
        <Skeleton className="h-[420px] rounded-[10px]" />
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
      <div className="py-20">
        <EmptyState
          illustration="data"
          title="No analysis data yet"
          description="Upload SAP data to get your first Data Quality Score across your modules."
          action={{ label: "Upload data", href: "/upload" }}
        />
      </div>
    );
  }

  const dqs = mergedDqs;
  const overallScore = averageDqs(dqs);
  const dimensions = averageDimensions(dqs);
  const severityCounts = aggregateSeverityCounts(dqs);
  const checks = totalChecks(dqs);

  // DQS trend — runs inside the selected range window, oldest → newest.
  const rangeCutoff = (() => {
    const now = Date.now();
    if (range === "7d") return now - 7 * 86_400_000;
    if (range === "30d") return now - 30 * 86_400_000;
    if (range === "90d") return now - 90 * 86_400_000;
    return new Date(new Date().getFullYear(), 0, 1).getTime(); // YTD
  })();
  const rangeVersions = completed.filter(
    (v) => new Date(v.run_at).getTime() >= rangeCutoff,
  );
  const trendVersions = rangeVersions.slice(0, 10).slice().reverse();
  const dqsTrend: number[] = trendVersions.map((v) => averageDqs(v.dqs_summary!));
  const trendLabels: string[] = trendVersions.map((v: Version, i) => {
    if (i === trendVersions.length - 1) return "Today";
    return new Date(v.run_at).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  });

  const prevComplete = completed[1];
  const prevScore = prevComplete?.dqs_summary ? averageDqs(prevComplete.dqs_summary) : null;
  const dqsDelta = prevScore !== null ? Math.round((overallScore - prevScore) * 10) / 10 : undefined;

  // 90D high/low + Y/A from the trend window
  const high90 = dqsTrend.length ? Math.max(...dqsTrend) : overallScore;
  const low90 = dqsTrend.length ? Math.min(...dqsTrend) : overallScore;
  const yearAgo = dqsTrend[0] ?? overallScore;
  const atHigh = Math.abs(overallScore - high90) < 0.05;

  // Per-dimension series (small multiples)
  const dimensionSeries: Record<string, number[]> = {};
  for (const key of DIMENSION_KEYS) {
    dimensionSeries[key] = trendVersions.map((v) => {
      const summary = v.dqs_summary;
      if (!summary) return 0;
      const scores = Object.values(summary).map((m) => m.dimension_scores[key] ?? 0);
      return scores.length ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10 : 0;
    });
  }

  // MDM
  const mdmLatest = mdmData?.latest ?? null;
  const mdmTrend = mdmData?.trend ?? [];
  const activeSystems = mdmData?.active_systems_count ?? 0;
  const prevMdm = mdmTrend.length >= 2 ? mdmTrend[1] : null;
  const mdmDelta = mdmLatest && prevMdm
    ? Math.round((mdmLatest.mdm_health_score - prevMdm.mdm_health_score) * 10) / 10
    : undefined;
  const mdmTrendSpark = mdmTrend.slice().reverse().map((m) => m.mdm_health_score);

  // Active runs
  const activeRuns = versions.filter(
    (v) => v.status === "running" || v.status === "agents_running" || v.status === "pending" || v.status === "agents_enqueued",
  ).length;

  // Role visibility
  const isViewer = userRole === "viewer";
  const canSeeMdm = !isViewer;

  // Module rows — sorted by criticals desc, then score asc
  const moduleRows: ModuleRow[] = Object.entries(dqs)
    .map(([name, summary]) => {
      const trend = completed
        .slice(0, 10)
        .slice()
        .reverse()
        .map((v) => v.dqs_summary?.[name]?.composite_score ?? NaN)
        .filter((n) => Number.isFinite(n));
      return {
        key: moduleCode(name),
        name,
        label: formatModuleName(name),
        score: summary.composite_score,
        critical: summary.critical_count ?? 0,
        high: summary.high_count ?? 0,
        medium: summary.medium_count ?? 0,
        records: summary.total_checks ?? 0,
        trend,
        versionId: moduleVersionMap[name] ?? latestComplete.id,
      };
    })
    .sort((a, b) => b.critical - a.critical || a.score - b.score);

  // Passing %
  const passingPct = checks.total > 0 ? Math.round((checks.passing / checks.total) * 100) : 0;
  const passingSpark = dqsTrend.length >= 2 ? dqsTrend.map((s) => Math.min(99, Math.round(s + (passingPct - overallScore)))) : undefined;

  // Activity ticker — derived from recent versions + module deltas. Falls
  // back to a single-item feed when there's only one run so the marquee
  // still anchors the layout.
  const activity: ActivityItem[] = buildActivityFeed(completed, moduleRows);

  // Narrative
  const topHot = moduleRows[0];
  const movingUp = moduleRows.filter((m) => m.trend.length >= 2 && m.trend[m.trend.length - 1] >= m.trend[0]).length;
  const movingDown = moduleRows.length - movingUp;
  const lastRun = latestComplete.run_at
    ? new Date(latestComplete.run_at).toLocaleString(undefined, { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" })
    : "—";

  return (
    <div style={{ minHeight: "100%" }}>
      <PageHead
        title="Overview"
        route="Analyse · /"
        sub={
          <>
            {dqsDelta !== undefined && dqsDelta > 0 ? (
              <>
                Quality across the estate is{" "}
                <strong style={{ color: "var(--mn-pos)" }}>up {Math.abs(dqsDelta).toFixed(1)} pts</strong>{" "}
                this week — the strongest run in 90 days.
              </>
            ) : dqsDelta !== undefined && dqsDelta < 0 ? (
              <>
                Quality dipped{" "}
                <strong style={{ color: "var(--mn-neg)" }}>{Math.abs(dqsDelta).toFixed(1)} pts</strong> on the latest run.
              </>
            ) : (
              <>Estate snapshot across {Object.keys(dqs).length} modules.</>
            )}{" "}
            Sourced from <strong style={{ color: "var(--mn-ink-700)" }}>{activeSystems || "—"} SAP systems</strong> ·{" "}
            {completed.length} run{completed.length === 1 ? "" : "s"} · last refresh{" "}
            <span style={{ font: "500 11.5px/1 'JetBrains Mono', monospace", color: "var(--mn-ink-500)" }}>{lastRun}</span>
          </>
        }
        actions={
          <>
            <span className="mn-pill">
              <span className="pdot" />
              Auto-refresh on
            </span>
            <div className="mn-segment">
              {RANGE_OPTIONS.map((r) => (
                <button
                  key={r}
                  type="button"
                  className={range === r ? "on" : ""}
                  onClick={() => setRange(r)}
                >
                  {r}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="mn-btn mn-btn-ghost"
              onClick={() => saveView("overview", { range })}
            >
              <BookmarkIcon /> Save view
            </button>
          </>
        }
      />

      {/* Hero + KPI rail */}
      <div className="mn-row mn-row-12 mn-stagger" style={{ marginBottom: 14 }}>
        <div className="mn-col-4">
          <div className="mn-hero" style={{ height: "100%" }}>
            <MeridianMark size={220} className="mn-hero-watermark" style={{ color: "var(--mn-primary)" }} />
            <div className="mn-hero-grid">
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                  <span className="mn-eyebrow">DQS · Composite</span>
                  {atHigh && (
                    <span className="mn-chip-hi">
                      <svg className="star" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
                        <path d="m6 0 1.6 3.6 3.9.4-2.9 2.7.8 3.9L6 8.8 2.6 10.6l.8-3.9L.5 4l3.9-.4z" />
                      </svg>
                      90D HIGH
                    </span>
                  )}
                </div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                  <HeroValue value={overallScore} />
                  <span className="mn-hero-suffix">/ 100</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 14 }}>
                  <DeltaPill delta={dqsDelta} unit=" pts" />
                  <span style={{ fontSize: 12.5, color: "var(--mn-ink-500)" }}>vs previous run</span>
                </div>
              </div>
              <div className="mn-hero-gauge">
                <RadialGauge value={overallScore} size={104} stroke={10} />
              </div>
            </div>
            <div style={{ marginTop: 18, marginLeft: -6, marginRight: -6, position: "relative", zIndex: 1 }}>
              <Sparkline data={dqsTrend} width={400} height={72} stroke="var(--mn-primary)" pulse />
            </div>
            <div className="mn-hero-foot">
              <span title="Score one year ago">Y/A · {yearAgo.toFixed(1)}</span>
              <span title="90-day low">90D LOW · {low90.toFixed(1)}</span>
              <span title="90-day high">90D HIGH · {high90.toFixed(1)}</span>
            </div>
          </div>
        </div>
        <div className="mn-col-8">
          <div
            className="mn-row"
            style={{ gridTemplateColumns: `repeat(${canSeeMdm && mdmLatest ? 5 : 4}, minmax(0, 1fr))`, height: "100%" }}
          >
            <KPI
              label="Critical"
              value={severityCounts.critical}
              delta={dqsDelta !== undefined ? -Math.round(dqsDelta * 2) : undefined}
              deltaUnit=""
              invertColors
              spark={passingSpark ? passingSpark.map((p) => 100 - p) : undefined}
              tone="neg"
              href="/findings?severity=critical"
            />
            <KPI
              label="High"
              value={severityCounts.high}
              deltaUnit=""
              tone="warn"
              href="/findings?severity=high"
            />
            <KPI
              label="Checks passing"
              value={passingPct ? `${passingPct}%` : "—"}
              delta={dqsDelta}
              deltaUnit="%"
              spark={passingSpark}
              href="/findings"
            />
            <KPI
              label="Active systems"
              value={activeSystems || "—"}
              hint={activeRuns ? `${activeRuns} run${activeRuns === 1 ? "" : "s"} in flight` : "All idle"}
              href="/systems"
            />
            {canSeeMdm && mdmLatest && (
              <KPI
                label="MDM health"
                value={mdmLatest.mdm_health_score.toFixed(1)}
                delta={mdmDelta}
                deltaUnit=" pts"
                spark={mdmTrendSpark.length >= 2 ? mdmTrendSpark : undefined}
                tone={mdmDelta !== undefined && mdmDelta >= 0 ? "pos" : undefined}
                href="/stewardship"
              />
            )}
          </div>
        </div>
      </div>

      {/* Narrative */}
      {topHot && (
        <div className="mn-narrative" style={{ marginBottom: 14 }}>
          <div className="ico">
            <SparklesIcon size={15} />
          </div>
          <div style={{ flex: 1 }}>
            <div className="mn-narrative-headline">
              {movingUp > movingDown
                ? `${movingUp} module${movingUp === 1 ? "" : "s"} moving in the right direction.${movingDown ? ` ${movingDown} ${movingDown === 1 ? "is" : "are"} not.` : ""}`
                : `${movingDown} module${movingDown === 1 ? "" : "s"} regressing — focus the next sweep there.`}
            </div>
            <div className="mn-narrative-detail">
              <strong style={{ color: "var(--mn-ink-700)" }}>
                {topHot.key} · {topHot.label}
              </strong>{" "}
              still holds{" "}
              <strong style={{ color: "var(--mn-neg)" }}>
                {topHot.critical} critical{topHot.critical === 1 ? "" : "s"}
              </strong>
              . Aggregate severity across the estate: {severityCounts.high} high, {severityCounts.medium} medium,{" "}
              {severityCounts.low} low.
            </div>
          </div>
          <Link href="/findings?severity=critical" className="mn-btn mn-btn-ghost" style={{ background: "white" }}>
            Triage criticals <ArrowRight size={13} />
          </Link>
        </div>
      )}

      {/* Activity ticker */}
      <div style={{ marginBottom: 18 }}>
        <ActivityTicker items={activity} />
      </div>

      {/* Trend + Dimensions */}
      <div className="mn-row mn-row-12" style={{ marginBottom: 18 }}>
        <div className="mn-col-8">
          <div className="mn-card mn-card-pad">
            <SectionHeader
              title="Quality trend"
              caption={
                dqsTrend.length
                  ? `Last ${dqsTrend.length} runs · mean ${(dqsTrend.reduce((a, b) => a + b, 0) / dqsTrend.length).toFixed(1)} · range ${Math.min(...dqsTrend).toFixed(0)}–${Math.max(...dqsTrend).toFixed(0)}`
                  : undefined
              }
              right={
                <Link href="/versions" className="mn-link">
                  Versions <ArrowRight size={12} />
                </Link>
              }
            />
            <div style={{ marginTop: 4 }}>
              {dqsTrend.length >= 2 ? (
                <DQSBars data={dqsTrend} labels={trendLabels} height={220} />
              ) : (
                <div
                  style={{
                    height: 220,
                    display: "grid",
                    placeItems: "center",
                    color: "var(--mn-ink-400)",
                    fontSize: 13,
                  }}
                >
                  {completed.length >= 2
                    ? `No more than one run in the last ${range}. Widen the range to see the trend.`
                    : "Run analysis at least twice to see the trend."}
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="mn-col-4">
          <div className="mn-card mn-card-pad" style={{ height: "100%" }}>
            <SectionHeader title="Six DAMA lenses" caption="Weighted composite" />
            <div style={{ marginTop: 8 }}>
              <DimensionRings dimensions={dimensions as unknown as Record<string, number>} overall={overallScore} />
            </div>
          </div>
        </div>
      </div>

      {/* Dimension trend + Severity */}
      <div className="mn-row mn-row-12" style={{ marginBottom: 18 }}>
        <div className="mn-col-8">
          <div className="mn-card mn-card-pad" style={{ height: "100%" }}>
            <SectionHeader title="Dimension trend" caption="Six lenses · last 10 runs" />
            <div style={{ marginTop: 10 }}>
              <SmallMultiples series={dimensionSeries} />
            </div>
          </div>
        </div>
        <div className="mn-col-4">
          <div className="mn-card mn-card-pad" style={{ height: "100%" }}>
            <SectionHeader
              title="Open findings"
              caption={`${severityCounts.critical + severityCounts.high + severityCounts.medium + severityCounts.low} total · by gravity`}
              right={
                <Link href="/findings" className="mn-link">
                  Details <ArrowRight size={12} />
                </Link>
              }
            />
            <div style={{ marginTop: 16 }}>
              <SeverityBars counts={severityCounts} />
            </div>
          </div>
        </div>
      </div>

      {/* Module table */}
      <SectionHeader
        title="Where to look first"
        caption="Sorted by criticals · click a row to drill into findings"
        right={
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <SearchField
              value={moduleSearch}
              onChange={setModuleSearch}
              placeholder="Filter modules…"
            />
            <Link href="/findings" className="mn-link">
              View findings <ArrowRight size={12} />
            </Link>
          </div>
        }
      />
      <div className="mn-card" style={{ padding: 0, overflow: "hidden" }}>
        <div className="mn-table-wrap">
          <table className="mn-table">
            <thead>
              <tr>
                <th style={{ paddingLeft: 20 }}>Module</th>
                <th>DQS</th>
                <th>Critical</th>
                <th>High</th>
                <th>Medium</th>
                <th className="right">Checks</th>
                <th>10-run drift</th>
                <th style={{ width: 36 }}></th>
              </tr>
            </thead>
            <tbody>
              {moduleRows.filter((m) => matchesSearch(m, moduleSearch)).map((m) => (
                <tr key={m.name}>
                  <td style={{ paddingLeft: 20 }}>
                    <Link
                      href={`/findings?module=${m.name}&version_id=${m.versionId}`}
                      className="ico-cell"
                      style={{ color: "inherit" }}
                    >
                      <span className="swatch">{m.key}</span>
                      <span className="module">{m.label}</span>
                    </Link>
                  </td>
                  <td>
                    <ScoreCell value={m.score} />
                  </td>
                  <td>
                    <SevPill value={m.critical} severity="crit" />
                  </td>
                  <td>
                    <SevPill value={m.high} severity="high" />
                  </td>
                  <td className="mn-tabular" style={{ color: "var(--mn-ink-500)" }}>
                    {m.medium}
                  </td>
                  <td className="right mn-tabular" style={{ color: "var(--mn-ink-500)" }}>
                    {m.records.toLocaleString()}
                  </td>
                  <td>
                    <DriftSpark data={m.trend} />
                  </td>
                  <td>
                    <button
                      type="button"
                      className="mn-icon-btn"
                      style={{ width: 26, height: 26 }}
                      aria-label="Copy module name"
                      onClick={() => copyToClipboard(m.name, "Module name copied")}
                    >
                      <MoreH size={14} />
                    </button>
                  </td>
                </tr>
              ))}
              {moduleRows.filter((m) => matchesSearch(m, moduleSearch)).length === 0 && (
                <tr>
                  <td colSpan={8} style={{ padding: 32, textAlign: "center", color: "var(--mn-ink-400)" }}>
                    No modules match this filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginTop: 14,
          fontSize: 12,
          color: "var(--mn-ink-400)",
        }}
      >
        <span>Showing {moduleRows.length} modules</span>
        <span>
          Updated {lastRun}
          {latestComplete.label ? ` · ${latestComplete.label}` : ""}
        </span>
      </div>
    </div>
  );
}

/* ─── Activity feed composer ─────────────────────────────────────────
 * Derives a marquee of recent estate-level events from the version
 * history and module deltas. Falls back to a single anchor row when
 * data is sparse so the ticker layout doesn't collapse.
 * ───────────────────────────────────────────────────────────────── */
function buildActivityFeed(versions: Version[], modules: ModuleRow[]): ActivityItem[] {
  const items: ActivityItem[] = [];
  const fmt = (iso: string) =>
    new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });

  for (const v of versions.slice(0, 4)) {
    if (!v.run_at) continue;
    items.push({
      t: fmt(v.run_at),
      tag: "RUN",
      module: v.label ?? `v${v.id.slice(0, 6)}`,
      msg: v.dqs_summary
        ? `Quality check complete · DQS ${averageDqs(v.dqs_summary).toFixed(1)}`
        : `Status ${v.status}`,
    });
  }

  // Module drift signals
  for (const m of modules.slice(0, 3)) {
    if (m.trend.length < 2) continue;
    const last = m.trend[m.trend.length - 1];
    const prev = m.trend[m.trend.length - 2];
    const delta = last - prev;
    if (Math.abs(delta) < 0.3) continue;
    items.push({
      t: "—",
      tag: delta < 0 ? "DRIFT" : "RESOLVED",
      module: `${m.key} · ${m.label}`,
      msg:
        delta < 0
          ? `Score slipped ${Math.abs(delta).toFixed(1)} pts on the latest run`
          : `Score recovered ${Math.abs(delta).toFixed(1)} pts`,
    });
  }

  if (items.length === 0) {
    items.push({
      t: "—",
      tag: "RUN",
      module: "Estate",
      msg: "Awaiting first multi-run history — activity feed will populate on next scheduled run.",
    });
  }
  return items;
}
