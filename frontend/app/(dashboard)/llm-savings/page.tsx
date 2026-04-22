"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Sparkles } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  getLlmSavingsByService,
  getLlmSavingsSummary,
  type LlmSavingsByServiceRow,
} from "@/lib/api/llm-savings";
import { KpiRail, type KpiItem } from "@/components/ui/kpi-rail";
import { NarrativeStrip } from "@/components/ui/narrative-strip";
import { SectionHeader } from "@/components/ui/section-header";
import { SavedView } from "@/components/ui/saved-view";
import { useUrlState } from "@/hooks/use-url-state";
import {
  DenseDataTable,
  type DenseColumnDef,
} from "@/components/ui/dense-data-table";
import {
  SmallMultiplesChart,
  type SmallMultipleSeries,
} from "@/components/charts/small-multiples";
import { DriftSparkline } from "@/components/charts/drift-sparkline";

const WINDOWS = [7, 14, 30, 90] as const;

type Window = (typeof WINDOWS)[number];

export default function LlmSavingsPage() {
  const [windowRaw, setWindowRaw] = useUrlState("window", "30");
  const windowDays: Window = (WINDOWS.find((w) => w === Number(windowRaw)) ?? 30) as Window;

  const { data: summary, isLoading: summaryLoading } = useQuery({
    queryKey: ["llm-savings-summary", windowDays],
    queryFn: () => getLlmSavingsSummary(windowDays),
    retry: false,
  });
  const { data: byService, isLoading: serviceLoading } = useQuery({
    queryKey: ["llm-savings-by-service", windowDays],
    queryFn: () => getLlmSavingsByService(windowDays),
    retry: false,
  });

  const rows = byService?.rows ?? [];

  const kpis: KpiItem[] = useMemo(() => {
    if (!summary) return [];
    const prev = summary.previous_period;
    const deltaReduction = prev
      ? Math.round((summary.reduction_pct - prev.reduction_pct) * 10) / 10
      : undefined;
    const deltaCost = prev
      ? Math.round((summary.cost_saved_usd - prev.cost_saved_usd) * 100) / 100
      : undefined;
    return [
      {
        label: "Reduction",
        value: `${summary.reduction_pct.toFixed(1)}%`,
        delta: deltaReduction,
        deltaLabel: " pts",
        tone: deltaReduction !== undefined && deltaReduction >= 0 ? "pos" : "neg",
        spark: summary.series.map((p) =>
          p.calls_total > 0 ? (p.calls_saved / p.calls_total) * 100 : null,
        ),
      },
      {
        label: "Cost saved",
        value: `$${summary.cost_saved_usd.toFixed(2)}`,
        delta: deltaCost,
        deltaLabel: " $",
        tone: "pos",
        spark: summary.series.map((p) => p.cost_saved_usd),
      },
      {
        label: "Calls total",
        value: summary.calls_total.toLocaleString(),
      },
      {
        label: "Calls saved",
        value: summary.calls_saved.toLocaleString(),
        tone: "pos",
      },
      {
        label: "Tokens saved",
        value: summary.tokens_saved.toLocaleString(),
      },
      {
        label: "Deterministic",
        value: `${(summary.deterministic_ratio * 100).toFixed(0)}%`,
        hint: "Share of calls handled by deterministic pre-filter",
        tone: summary.deterministic_ratio >= 0.5 ? "pos" : "warn",
      },
      {
        label: "Avg latency",
        value:
          summary.avg_latency_ms !== null
            ? `${Math.round(summary.avg_latency_ms)}ms`
            : "—",
      },
    ];
  }, [summary]);

  const narrative = useMemo(() => {
    if (!summary) return null;
    if (summary.calls_total === 0) {
      return {
        headline: "LLM savings not yet reporting.",
        detail:
          "The deterministic pre-filter metrics endpoint is available after the first LLM call is made in the current window.",
        tone: "info" as const,
      };
    }
    const deltaReduction = summary.previous_period
      ? summary.reduction_pct - summary.previous_period.reduction_pct
      : 0;
    if (summary.reduction_pct >= 30 && deltaReduction >= 0) {
      return {
        headline: `Saved ${summary.reduction_pct.toFixed(1)}% of LLM calls — $${summary.cost_saved_usd.toFixed(2)} avoided over ${windowDays}d.`,
        detail: `Deterministic pre-filter absorbed ${summary.calls_saved.toLocaleString()} of ${summary.calls_total.toLocaleString()} calls.`,
        tone: "pos" as const,
      };
    }
    if (deltaReduction < 0) {
      return {
        headline: `LLM reduction down ${Math.abs(deltaReduction).toFixed(1)} pts vs prior period.`,
        detail:
          "Either a new service bypassed the pre-filter, or deterministic coverage dropped. Investigate the per-service breakdown below.",
        tone: "warn" as const,
      };
    }
    return {
      headline: `Reduction at ${summary.reduction_pct.toFixed(1)}% — $${summary.cost_saved_usd.toFixed(2)} saved.`,
      detail:
        "Room to grow: add or tune deterministic rules where the share of calls is still high.",
      tone: "info" as const,
    };
  }, [summary, windowDays]);

  const chartData = summary?.series ?? [];
  const areaDomain = chartData.length > 0 ? undefined : [0, 1];

  const byServiceSeries: SmallMultipleSeries[] = useMemo(() => {
    return rows.slice(0, 6).map((r, i) => ({
      key: r.service,
      label: r.service,
      data: r.trend.map((y, x) => ({ x, y: y ?? null })),
      value: `${r.reduction_pct.toFixed(0)}%`,
      delta: i % 2 === 0 ? 1.0 : -0.5,
      color: i % 2 === 0 ? "#0070F2" : "#7C3AED",
    }));
  }, [rows]);

  const columns: DenseColumnDef<LlmSavingsByServiceRow>[] = useMemo(
    () => [
      {
        accessorKey: "service",
        header: "Service",
        cell: ({ getValue }) => (
          <span className="font-mono text-xs text-foreground">{getValue() as string}</span>
        ),
      },
      {
        accessorKey: "calls_total",
        header: "Calls",
        size: 96,
        cell: ({ getValue }) => (
          <span className="tabular-nums text-foreground">
            {(getValue() as number).toLocaleString()}
          </span>
        ),
      },
      {
        accessorKey: "calls_saved",
        header: "Saved",
        size: 96,
        cell: ({ getValue }) => (
          <span className="tabular-nums text-[#256F3A]">
            {(getValue() as number).toLocaleString()}
          </span>
        ),
      },
      {
        accessorKey: "reduction_pct",
        header: "Ratio",
        size: 80,
        cell: ({ getValue }) => {
          const v = getValue() as number;
          const tone = v >= 50 ? "text-[#256F3A]" : v >= 20 ? "text-[#E76500]" : "text-[#BB0000]";
          return (
            <span className={`tabular-nums font-semibold ${tone}`}>{v.toFixed(1)}%</span>
          );
        },
      },
      {
        accessorKey: "cost_saved_usd",
        header: "$",
        size: 96,
        cell: ({ getValue }) => (
          <span className="tabular-nums text-foreground">
            ${(getValue() as number).toFixed(2)}
          </span>
        ),
      },
      {
        accessorKey: "p95_latency_ms",
        header: "p95 ms",
        size: 96,
        cell: ({ getValue }) => {
          const v = getValue() as number | null;
          return v === null ? (
            <span className="text-muted-foreground">—</span>
          ) : (
            <span className="tabular-nums text-muted-foreground">{Math.round(v)}</span>
          );
        },
      },
      {
        accessorKey: "trend",
        header: "Trend",
        size: 120,
        enableSorting: false,
        cell: ({ getValue }) => (
          <DriftSparkline data={getValue() as ReadonlyArray<number | null>} />
        ),
      },
    ],
    [],
  );

  const isLoading = summaryLoading || serviceLoading;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 font-display text-xl font-semibold text-foreground">
            <Sparkles className="h-5 w-5 text-primary" />
            LLM savings
          </h1>
          <p className="text-sm text-muted-foreground">
            Deterministic pre-filter is shrinking the LLM bill. Lower is better for calls,
            higher for ratio.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={String(windowDays)}
            onChange={(e) => setWindowRaw(e.target.value)}
            className="rounded-full border border-black/[0.08] bg-white/[0.60] px-2.5 py-1 text-xs"
          >
            {WINDOWS.map((w) => (
              <option key={w} value={w}>
                Last {w}d
              </option>
            ))}
          </select>
          <SavedView routeKey="llm-savings" />
        </div>
      </div>

      {isLoading ? (
        <Skeleton className="h-24 w-full rounded-xl" />
      ) : kpis.length > 0 ? (
        <KpiRail items={kpis} columns={7} />
      ) : null}

      {narrative ? (
        <NarrativeStrip
          headline={narrative.headline}
          detail={narrative.detail}
          tone={narrative.tone}
          cta={null}
        />
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="lg:col-span-8">
          <SectionHeader
            title="Calls vs saved"
            caption={`${windowDays}-day stacked area · green = saved, grey = executed`}
          />
          <div className="vx-card mt-2 p-3">
            <div style={{ height: 260 }}>
              {chartData.length < 2 ? (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                  Not enough points to plot — {chartData.length} data point
                  {chartData.length === 1 ? "" : "s"} available
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={[...chartData]} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="savedGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#0070F2" stopOpacity={0.45} />
                        <stop offset="100%" stopColor="#0070F2" stopOpacity={0.05} />
                      </linearGradient>
                      <linearGradient id="executedGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#6B7280" stopOpacity={0.3} />
                        <stop offset="100%" stopColor="#6B7280" stopOpacity={0.05} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.05)" />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 10, fill: "#6B7280" }}
                      tickFormatter={(v) => new Date(v).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                    />
                    <YAxis
                      tick={{ fontSize: 10, fill: "#6B7280" }}
                      domain={areaDomain as [number, number] | undefined}
                    />
                    <Tooltip
                      contentStyle={{ fontSize: 11 }}
                      labelFormatter={(v) => new Date(v as string).toLocaleDateString()}
                    />
                    <Area
                      type="monotone"
                      dataKey="calls_saved"
                      stackId="1"
                      stroke="#0070F2"
                      fill="url(#savedGrad)"
                    />
                    <Area
                      type="monotone"
                      dataKey="calls_total"
                      stackId="1"
                      stroke="#6B7280"
                      fill="url(#executedGrad)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        </div>

        <div className="lg:col-span-4">
          <SectionHeader
            title="Top 6 services"
            caption="Reduction % per service"
          />
          <div className="mt-2">
            {isLoading ? (
              <Skeleton className="h-52 w-full rounded-xl" />
            ) : (
              <SmallMultiplesChart series={byServiceSeries} columns={2} height={110} />
            )}
          </div>
        </div>
      </div>

      <div>
        <SectionHeader
          title="By service"
          caption={`${rows.length.toLocaleString()} services reporting`}
          right={
            rows.length === 0 ? (
              <Badge variant="outline" className="text-[10px] text-muted-foreground">
                No data
              </Badge>
            ) : null
          }
        />
        <div className="mt-2">
          {isLoading ? (
            <Skeleton className="h-60 w-full rounded-xl" />
          ) : (
            <DenseDataTable<LlmSavingsByServiceRow>
              data={rows}
              columns={columns}
              emptyLabel="Deterministic pre-filter metrics not reporting yet"
            />
          )}
        </div>
      </div>
    </div>
  );
}
