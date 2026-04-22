"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { getVersions } from "@/lib/api/versions";
import { getMdmDashboard } from "@/lib/api/mdm-metrics";
import { getLlmSavingsSummary } from "@/lib/api/llm-savings";
import { AxiosError } from "axios";
import { scoreColor, formatModuleName } from "@/lib/format";
import { DqsBarChart } from "@/components/charts/dqs-bar-chart";
import { DimensionDonut } from "@/components/charts/dimension-donut";
import { SeverityBarChart } from "@/components/charts/severity-bar-chart";
import { KpiRail, type KpiItem } from "@/components/ui/kpi-rail";
import { HeroKpi } from "@/components/ui/hero-kpi";
import { EmptyState } from "@/components/ui/empty-state";
import { NarrativeStrip } from "@/components/ui/narrative-strip";
import { SectionHeader } from "@/components/ui/section-header";
import { SavedView } from "@/components/ui/saved-view";
import { SmallMultiplesChart, type SmallMultipleSeries } from "@/components/charts/small-multiples";
import {
  DenseDataTable,
  type DenseColumnDef,
} from "@/components/ui/dense-data-table";
import { DriftSparkline } from "@/components/charts/drift-sparkline";
import type { DQSSummary, DimensionScores, Version } from "@/types/api";

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

const DIMENSION_KEYS: Array<keyof DimensionScores> = [
  "completeness",
  "accuracy",
  "consistency",
  "timeliness",
  "uniqueness",
  "validity",
];

interface ModuleRow {
  name: string;
  score: number;
  critical: number;
  high: number;
  records: number;
  trend: number[];
  versionId: string;
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
  } = useQuery({
    queryKey: ["mdm-dashboard"],
    queryFn: getMdmDashboard,
    retry: false,
    throwOnError: (error) => {
      const axiosError = error as AxiosError;
      return axiosError?.response?.status !== 402;
    },
  });

  const { data: llmSavings } = useQuery({
    queryKey: ["llm-savings-summary", 30],
    queryFn: () => getLlmSavingsSummary(30),
    retry: false,
  });

  const versions = versionData?.versions ?? [];
  const COMPLETED_STATUSES = ["complete", "agents_complete", "agents_failed", "agents_running", "ai_enriching", "ai_enriched"];
  const completed = useMemo(
    () => versions.filter((v) => COMPLETED_STATUSES.includes(v.status) && v.dqs_summary),
    [versions],
  );
  const latestComplete = completed[0];

  // Build merged DQS: latest run per module across ALL completed versions
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
            <Skeleton key={i} className="h-20 rounded-2xl" />
          ))}
        </div>
        <Skeleton className="h-10 rounded-xl" />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          <Skeleton className="h-80 rounded-2xl lg:col-span-8" />
          <Skeleton className="h-80 rounded-2xl lg:col-span-4" />
        </div>
        <Skeleton className="h-[420px] rounded-2xl" />
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

  // DQS trend sparkline data
  const dqsTrend: number[] = completed
    .slice(0, 10)
    .reverse()
    .map((v) => averageDqs(v.dqs_summary!));

  const prevComplete = completed[1];
  const prevScore = prevComplete?.dqs_summary ? averageDqs(prevComplete.dqs_summary) : null;
  const dqsDelta = prevScore !== null ? Math.round((overallScore - prevScore) * 10) / 10 : undefined;

  // Per-dimension historical series (small multiples)
  const dimensionSeries: SmallMultipleSeries[] = DIMENSION_KEYS.map((key) => {
    const data = completed
      .slice(0, 10)
      .reverse()
      .map((v, i) => {
        const summary = v.dqs_summary;
        if (!summary) return { x: i, y: null as number | null };
        const scores = Object.values(summary).map((m) => m.dimension_scores[key] ?? 0);
        const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
        return { x: i, y: Math.round(avg * 10) / 10 };
      });
    const first = data[0]?.y;
    const last = data[data.length - 1]?.y;
    return {
      key,
      label: key,
      data,
      value: last !== null && last !== undefined ? last.toFixed(1) : "—",
      delta:
        first != null && last != null ? Math.round((last - first) * 10) / 10 : undefined,
    };
  });

  // MDM data
  const mdmLatest = mdmData?.latest ?? null;
  const mdmTrend = mdmData?.trend ?? [];
  const activeSystems = mdmData?.active_systems_count ?? 0;
  const prevMdm = mdmTrend.length >= 2 ? mdmTrend[1] : null;
  const mdmDelta = mdmLatest && prevMdm
    ? Math.round((mdmLatest.mdm_health_score - prevMdm.mdm_health_score) * 10) / 10
    : undefined;
  const mdmTrendSpark = mdmTrend.slice().reverse().map((m) => m.mdm_health_score);

  // Bar chart data
  const barData = completed
    .slice(0, 10)
    .reverse()
    .map((v: Version) => ({
      date: new Date(v.run_at).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
      label: v.label ?? "",
      score: averageDqs(v.dqs_summary!),
    }));

  // Active runs
  const activeRuns = versions.filter(
    (v) => v.status === "running" || v.status === "agents_running" || v.status === "pending" || v.status === "agents_enqueued"
  ).length;

  // Role visibility
  const isViewer = userRole === "viewer";
  const canSeeMdm = !isViewer;

  // Dense module table rows
  const moduleRows: ModuleRow[] = Object.entries(dqs)
    .map(([name, summary]) => {
      const trend = completed
        .slice(0, 10)
        .reverse()
        .map((v) => v.dqs_summary?.[name]?.composite_score ?? NaN)
        .filter((n) => Number.isFinite(n));
      return {
        name,
        score: summary.composite_score,
        critical: summary.critical_count ?? 0,
        high: summary.high_count ?? 0,
        records: summary.total_checks ?? 0,
        trend,
        versionId: moduleVersionMap[name] ?? latestComplete.id,
      };
    })
    .sort((a, b) => b.critical - a.critical || a.score - b.score);

  const moduleColumns: DenseColumnDef<ModuleRow>[] = [
    {
      accessorKey: "name",
      header: "Module",
      cell: ({ row }) => (
        <Link
          href={`/findings?module=${row.original.name}&version_id=${row.original.versionId}`}
          className="font-medium text-foreground hover:text-primary"
        >
          {formatModuleName(row.original.name)}
        </Link>
      ),
    },
    {
      accessorKey: "score",
      header: "DQS",
      cell: ({ getValue }) => {
        const v = getValue() as number;
        return (
          <span className="tabular-nums font-semibold" style={{ color: scoreColor(v) }}>
            {v.toFixed(1)}
          </span>
        );
      },
    },
    {
      accessorKey: "critical",
      header: "Crit",
      cell: ({ getValue }) => {
        const v = getValue() as number;
        return (
          <span className={v > 0 ? "text-[#BB0000] tabular-nums font-medium" : "text-muted-foreground tabular-nums"}>
            {v}
          </span>
        );
      },
    },
    {
      accessorKey: "high",
      header: "High",
      cell: ({ getValue }) => {
        const v = getValue() as number;
        return (
          <span className={v > 0 ? "text-[#E76500] tabular-nums font-medium" : "text-muted-foreground tabular-nums"}>
            {v}
          </span>
        );
      },
    },
    {
      accessorKey: "records",
      header: "Checks",
      cell: ({ getValue }) => (getValue() as number).toLocaleString(),
    },
    {
      accessorKey: "trend",
      header: "Drift",
      enableSorting: false,
      cell: ({ getValue }) => {
        const data = getValue() as number[];
        return data.length >= 2 ? <DriftSparkline data={data} /> : <span className="text-muted-foreground">—</span>;
      },
    },
  ];

  // KPI rail
  const kpis: KpiItem[] = [
    {
      label: "DQS",
      value: overallScore.toFixed(1),
      delta: dqsDelta,
      deltaLabel: " pts",
      spark: dqsTrend,
      tone: dqsDelta === undefined ? "neutral" : dqsDelta >= 0 ? "pos" : "neg",
    },
    {
      label: "Critical",
      value: severityCounts.critical.toLocaleString(),
      tone: severityCounts.critical > 0 ? "neg" : "pos",
      href: "/findings?severity=critical",
    },
    {
      label: "High",
      value: severityCounts.high.toLocaleString(),
      tone: severityCounts.high > 10 ? "warn" : "neutral",
      href: "/findings?severity=high",
    },
    {
      label: "Checks",
      value:
        checks.total > 0
          ? `${Math.round((checks.passing / checks.total) * 100)}%`
          : "—",
      hint: `${checks.passing.toLocaleString()} / ${checks.total.toLocaleString()} passing`,
    },
    {
      label: "Systems",
      value: `${activeSystems}`,
      hint: activeRuns ? `${activeRuns} run${activeRuns === 1 ? "" : "s"} in flight` : "All idle",
      href: "/systems",
    },
    ...(canSeeMdm && mdmLatest
      ? [
          {
            label: "MDM",
            value: mdmLatest.mdm_health_score.toFixed(1),
            delta: mdmDelta,
            deltaLabel: " pts",
            spark: mdmTrendSpark,
            tone: (mdmDelta === undefined ? "neutral" : mdmDelta >= 0 ? "pos" : "neg") as KpiItem["tone"],
            href: "/stewardship",
          } satisfies KpiItem,
        ]
      : []),
    ...(llmSavings && llmSavings.calls_total > 0
      ? [
          {
            label: "LLM saved",
            value: `${Math.round(llmSavings.reduction_pct)}%`,
            delta: llmSavings.previous_period
              ? Math.round((llmSavings.reduction_pct - llmSavings.previous_period.reduction_pct) * 10) / 10
              : undefined,
            tone: "pos" as const,
            href: "/llm-savings",
            hint: "Deterministic pre-filter saved LLM calls",
          } satisfies KpiItem,
        ]
      : []),
  ];

  // Narrative
  const narrative = buildOverviewNarrative({
    overallScore,
    dqsDelta: dqsDelta ?? null,
    severityCounts,
    openStewardship: mdmLatest?.backlog_count ?? 0,
    topHot: moduleRows[0]?.name,
  });

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-semibold text-foreground">Overview</h1>
          <p className="text-sm text-muted-foreground">
            Data quality snapshot across {Object.keys(dqs).length} modules · {completed.length} run
            {completed.length === 1 ? "" : "s"} analysed
          </p>
        </div>
        <SavedView routeKey="overview" />
      </div>

      {/* Hero + KPI rail */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
        <div className="lg:col-span-4">
          <HeroKpi
            label="Data Quality Score"
            value={overallScore.toFixed(1)}
            suffix="/ 100"
            delta={dqsDelta}
            deltaLabel=" pts"
            caption={
              dqsDelta === undefined
                ? `${completed.length} run${completed.length === 1 ? "" : "s"} analysed`
                : `${dqsDelta >= 0 ? "Up" : "Down"} ${Math.abs(dqsDelta).toFixed(1)} pts vs previous run`
            }
            spark={dqsTrend}
            href={dqsTrend.length >= 2 ? "/versions" : undefined}
          />
        </div>
        <div className="lg:col-span-8">
          <KpiRail
            items={kpis.slice(1)}
            columns={Math.max(4, Math.min(kpis.length - 1, 6)) as 4 | 5 | 6}
          />
        </div>
      </div>

      {/* Narrative */}
      <NarrativeStrip
        headline={narrative.headline}
        detail={narrative.detail}
        tone={narrative.tone}
        cta={narrative.cta}
      />

      {/* DQS trend + dimension donut + severity */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="vx-card flex flex-col gap-2 p-4 lg:col-span-8">
          <SectionHeader
            title="DQS over time"
            caption={`Last ${barData.length} runs · mean ${overallScore.toFixed(1)}`}
            right={
              <Link
                href="/versions"
                className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:text-primary/80"
              >
                Versions <ArrowRight className="h-3 w-3" />
              </Link>
            }
          />
          <div style={{ height: 240 }}>
            {barData.length >= 2 ? (
              <DqsBarChart data={barData} />
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                Upload data at least twice to see trends
              </div>
            )}
          </div>
        </div>

        <div className="vx-card flex flex-col gap-2 p-4 lg:col-span-4">
          <SectionHeader title="Dimensions" caption="DAMA DMBOK weighted" />
          <DimensionDonut dimensions={dimensions} overallScore={overallScore} />
        </div>
      </div>

      {/* Small multiples + severity */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="flex flex-col gap-2 lg:col-span-8">
          <SectionHeader
            title="Dimension trend"
            caption="6 DAMA dimensions across the last 10 runs"
          />
          <SmallMultiplesChart series={dimensionSeries} columns={6} normaliseY />
        </div>
        <div className="vx-card flex flex-col gap-2 p-4 lg:col-span-4">
          <SectionHeader
            title="Severity"
            caption={`${severityCounts.critical + severityCounts.high + severityCounts.medium + severityCounts.low} findings total`}
            right={
              <Link
                href="/findings"
                className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:text-primary/80"
              >
                Details <ArrowRight className="h-3 w-3" />
              </Link>
            }
          />
          <div style={{ height: 200 }}>
            <SeverityBarChart counts={severityCounts} />
          </div>
        </div>
      </div>

      {/* Module leaderboard table */}
      <div className="flex flex-col gap-2">
        <SectionHeader
          title="Module health"
          caption="Sorted by criticals · click a module to drill into findings"
          right={
            <Link
              href="/findings"
              className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:text-primary/80"
            >
              View findings <ArrowRight className="h-3 w-3" />
            </Link>
          }
        />
        <DenseDataTable<ModuleRow>
          data={moduleRows}
          columns={moduleColumns}
          rowHeight={40}
          emptyLabel="No module data available"
        />
      </div>
    </div>
  );
}

/* ─── Narrative composer ─── */

interface Narrative {
  headline: string;
  detail?: string;
  tone: "pos" | "neg" | "warn" | "info";
  cta: { label: string; href: string } | null;
}

function buildOverviewNarrative(args: {
  overallScore: number;
  dqsDelta: number | null;
  severityCounts: { critical: number; high: number; medium: number; low: number };
  openStewardship: number;
  topHot?: string;
}): Narrative {
  const { overallScore, dqsDelta, severityCounts, openStewardship, topHot } = args;

  if (severityCounts.critical > 0 && topHot) {
    return {
      headline: `${severityCounts.critical} critical finding${severityCounts.critical === 1 ? "" : "s"} — hottest module: ${formatModuleName(topHot)}.`,
      detail:
        dqsDelta !== null
          ? `DQS ${dqsDelta >= 0 ? "up" : "down"} ${Math.abs(dqsDelta).toFixed(1)} pts vs prior run. ${openStewardship} open stewardship item${openStewardship === 1 ? "" : "s"}.`
          : `${openStewardship} open stewardship item${openStewardship === 1 ? "" : "s"}.`,
      tone: "neg",
      cta: { label: "Triage", href: "/findings?severity=critical" },
    };
  }

  if (severityCounts.high > 10) {
    return {
      headline: `DQS ${overallScore.toFixed(1)} — ${severityCounts.high} high-severity findings across the estate.`,
      detail: "No criticals outstanding. Raise or assign remaining high-severity items.",
      tone: "warn",
      cta: { label: "Review high", href: "/findings?severity=high" },
    };
  }

  return {
    headline: `DQS ${overallScore.toFixed(1)} — estate is healthy.${dqsDelta !== null ? ` ${dqsDelta >= 0 ? "+" : ""}${dqsDelta.toFixed(1)} pts vs prior run.` : ""}`,
    detail: `${openStewardship} open stewardship item${openStewardship === 1 ? "" : "s"}. ${severityCounts.medium} medium · ${severityCounts.low} low findings.`,
    tone: "pos",
    cta: null,
  };
}
