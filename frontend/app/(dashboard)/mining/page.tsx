"use client";

import { useMemo, useState } from "react";
import { Sparkles, RefreshCw } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  getMiningPatterns,
  getMiningRuns,
  getMiningSummary,
  type MiningPattern,
} from "@/lib/api/mining";
import { KpiRail, type KpiItem } from "@/components/ui/kpi-rail";
import { NarrativeStrip } from "@/components/ui/narrative-strip";
import { SectionHeader } from "@/components/ui/section-header";
import { SavedView } from "@/components/ui/saved-view";
import { FilterChipBar } from "@/components/ui/filter-chip-bar";
import { useUrlMultiState } from "@/hooks/use-url-state";
import {
  DenseDataTable,
  type DenseColumnDef,
} from "@/components/ui/dense-data-table";
import {
  SmallMultiplesChart,
  type SmallMultipleSeries,
} from "@/components/charts/small-multiples";
import { PatternTreemap } from "@/components/charts/pattern-treemap";
import { DriftSparkline } from "@/components/charts/drift-sparkline";
import { relativeTime, severityColor, formatModuleName } from "@/lib/format";

const SEVERITIES: MiningPattern["severity"][] = ["critical", "high", "medium", "low"];

export default function MiningPage() {
  const [severities, setSeverities] = useUrlMultiState("severity");
  const [modules, setModules] = useUrlMultiState("module");
  const [selected, setSelected] = useState<MiningPattern | null>(null);

  const { data: summary, isLoading: summaryLoading } = useQuery({
    queryKey: ["mining-summary", 30],
    queryFn: () => getMiningSummary(30),
    retry: false,
  });
  const { data: patternsData, isLoading: patternsLoading } = useQuery({
    queryKey: ["mining-patterns"],
    queryFn: () => getMiningPatterns({ limit: 2000 }),
    retry: false,
  });
  const { data: runsData } = useQuery({
    queryKey: ["mining-runs", 20],
    queryFn: () => getMiningRuns(20),
    retry: false,
  });

  const patterns = patternsData?.patterns ?? [];
  const runs = runsData?.runs ?? [];

  const availableModules = useMemo(() => {
    const set = new Set<string>();
    for (const p of patterns) set.add(p.module);
    return Array.from(set).sort();
  }, [patterns]);

  const filtered = useMemo(() => {
    const sevSet = new Set(severities);
    const modSet = new Set(modules);
    return patterns.filter((p) => {
      if (sevSet.size > 0 && !sevSet.has(p.severity)) return false;
      if (modSet.size > 0 && !modSet.has(p.module)) return false;
      return true;
    });
  }, [patterns, severities, modules]);

  const kpis: KpiItem[] = useMemo(() => {
    if (!summary) return [];
    const promoted = filtered.filter((p) => p.promoted_to_rule).length;
    return [
      { label: "Patterns", value: summary.total_patterns.toLocaleString() },
      {
        label: "Anomalies",
        value: summary.new_anomalies,
        tone: summary.new_anomalies > 0 ? "warn" : "neutral",
      },
      { label: "Stable", value: summary.stable_patterns },
      {
        label: "Coverage",
        value: `${summary.coverage_pct.toFixed(0)}%`,
        tone: summary.coverage_pct >= 80 ? "pos" : summary.coverage_pct >= 50 ? "warn" : "neg",
        hint: "Share of SAP tables with at least one mined pattern",
      },
      { label: "Runs", value: summary.runs_total },
      {
        label: "Cost",
        value: `$${summary.cost_usd.toFixed(2)}`,
        hint: "LLM cost over the last 30 days",
      },
      {
        label: "Promoted",
        value: promoted,
        tone: promoted > 0 ? "pos" : "neutral",
        hint: "Patterns already promoted to rules",
      },
    ];
  }, [summary, filtered]);

  const topPatternSeries: SmallMultipleSeries[] = useMemo(() => {
    const top = [...filtered]
      .sort((a, b) => b.occurrences - a.occurrences)
      .slice(0, 6);
    return top.map((p, i) => ({
      key: p.id,
      label: p.name,
      data: (p.trend ?? []).map((y, x) => ({ x, y: y ?? null })),
      value: p.occurrences.toLocaleString(),
      color: i % 2 === 0 ? "#0070F2" : "#7C3AED",
    }));
  }, [filtered]);

  const narrative = useMemo(() => {
    if (!summary) return null;
    if (summary.runs_total === 0) {
      return {
        headline: "Mining service not yet active.",
        detail:
          "Pattern mining will start automatically once the LLM-reduction worker is deployed. Check back after the next maintenance window.",
        tone: "info" as const,
      };
    }
    if (summary.new_anomalies > 0) {
      return {
        headline: `${summary.new_anomalies.toLocaleString()} new anomal${summary.new_anomalies === 1 ? "y" : "ies"} detected in the last 30 days.`,
        detail: `${summary.stable_patterns.toLocaleString()} stable patterns — candidates for promotion to deterministic rules.`,
        tone: "warn" as const,
      };
    }
    return {
      headline: `${summary.total_patterns.toLocaleString()} pattern${summary.total_patterns === 1 ? "" : "s"} under watch — no new anomalies.`,
      detail: `${summary.runs_total} mining runs executed · $${summary.cost_usd.toFixed(2)} spent.`,
      tone: "pos" as const,
    };
  }, [summary]);

  const columns: DenseColumnDef<MiningPattern>[] = useMemo(
    () => [
      {
        accessorKey: "severity",
        header: "Sev",
        size: 88,
        cell: ({ getValue }) => (
          <Badge className={`text-[10px] ${severityColor(getValue() as string)}`}>
            {getValue() as string}
          </Badge>
        ),
      },
      {
        accessorKey: "name",
        header: "Pattern",
        cell: ({ getValue }) => (
          <span className="text-foreground">{getValue() as string}</span>
        ),
      },
      {
        accessorKey: "module",
        header: "Module",
        cell: ({ getValue }) => (
          <span className="text-muted-foreground">
            {formatModuleName(getValue() as string)}
          </span>
        ),
      },
      {
        accessorKey: "pattern_type",
        header: "Type",
        cell: ({ getValue }) => (
          <span className="text-muted-foreground">{getValue() as string}</span>
        ),
      },
      {
        accessorKey: "occurrences",
        header: "Count",
        size: 96,
        cell: ({ getValue }) => (
          <span className="tabular-nums text-foreground">
            {(getValue() as number).toLocaleString()}
          </span>
        ),
      },
      {
        accessorKey: "confidence",
        header: "Conf",
        size: 80,
        cell: ({ getValue }) => {
          const v = getValue() as number;
          return (
            <span className="tabular-nums text-foreground">{(v * 100).toFixed(0)}%</span>
          );
        },
      },
      {
        accessorKey: "last_seen",
        header: "Last",
        size: 100,
        cell: ({ getValue }) => (
          <span className="text-muted-foreground">
            {relativeTime(getValue() as string)}
          </span>
        ),
      },
      {
        accessorKey: "trend",
        header: "Drift",
        size: 120,
        enableSorting: false,
        cell: ({ getValue }) => (
          <DriftSparkline data={getValue() as ReadonlyArray<number | null>} />
        ),
      },
      {
        accessorKey: "promoted_to_rule",
        header: "Rule",
        size: 84,
        cell: ({ getValue }) =>
          (getValue() as boolean) ? (
            <Badge className="bg-primary/10 text-[10px] text-primary">Promoted</Badge>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
    ],
    [],
  );

  const isLoading = summaryLoading || patternsLoading;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 font-display text-xl font-semibold text-foreground">
            <Sparkles className="h-5 w-5 text-primary" />
            Mining
          </h1>
          <p className="text-sm text-muted-foreground">
            Deterministic pattern discovery across SAP — mines drift, anomalies, and
            promote-to-rule candidates.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <SavedView routeKey="mining" />
          <Badge variant="outline" className="text-xs text-muted-foreground">
            <RefreshCw className="mr-1 h-3 w-3" />
            {runs.length > 0
              ? `Last run ${relativeTime(runs[0].started_at)}`
              : "No runs yet"}
          </Badge>
        </div>
      </div>

      {kpis.length > 0 ? <KpiRail items={kpis} columns={7} /> : null}

      {narrative ? (
        <NarrativeStrip
          headline={narrative.headline}
          detail={narrative.detail}
          tone={narrative.tone}
          cta={null}
        />
      ) : null}

      <FilterChipBar
        groups={[
          {
            key: "severity",
            label: "Severity",
            selected: severities,
            onChange: setSeverities,
            options: SEVERITIES.map((s) => ({ value: s, label: s })),
          },
          {
            key: "module",
            label: "Module",
            selected: modules,
            onChange: setModules,
            options: availableModules.map((m) => ({
              value: m,
              label: formatModuleName(m),
            })),
          },
        ]}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="lg:col-span-7">
          <SectionHeader
            title="Pattern frequency"
            caption="Area ∝ occurrences · colour = severity"
          />
          <div className="mt-2">
            {isLoading ? (
              <Skeleton className="h-80 w-full rounded-xl" />
            ) : (
              <PatternTreemap patterns={filtered} height={360} />
            )}
          </div>
        </div>

        <div className="lg:col-span-5">
          <SectionHeader
            title="Top 6 patterns — drift"
            caption="30-day occurrence trend"
          />
          <div className="mt-2">
            {isLoading ? (
              <Skeleton className="h-80 w-full rounded-xl" />
            ) : (
              <SmallMultiplesChart series={topPatternSeries} columns={2} height={140} />
            )}
          </div>
        </div>
      </div>

      <div>
        <SectionHeader
          title="Patterns"
          caption={`${filtered.length.toLocaleString()} after filters${filtered.length > 500 ? " · virtualized" : ""}`}
        />
        <div className="mt-2">
          {isLoading ? (
            <Skeleton className="h-80 w-full rounded-xl" />
          ) : (
            <DenseDataTable<MiningPattern>
              data={filtered}
              columns={columns}
              onRowClick={(p) => setSelected(p)}
              emptyLabel={
                patterns.length === 0
                  ? "Mining has not produced any patterns yet"
                  : "No patterns match these filters"
              }
            />
          )}
        </div>
      </div>

      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="max-w-xl">
          {selected ? (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Badge className={`text-[10px] ${severityColor(selected.severity)}`}>
                    {selected.severity}
                  </Badge>
                  <span>{selected.name}</span>
                  <span className="text-muted-foreground">· {formatModuleName(selected.module)}</span>
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-3 text-sm">
                <div className="grid grid-cols-2 gap-3">
                  <Stat label="Type" value={selected.pattern_type} />
                  <Stat
                    label="Occurrences"
                    value={selected.occurrences.toLocaleString()}
                  />
                  <Stat
                    label="Confidence"
                    value={`${(selected.confidence * 100).toFixed(0)}%`}
                  />
                  <Stat
                    label="First seen"
                    value={relativeTime(selected.first_seen)}
                  />
                  <Stat
                    label="Last seen"
                    value={relativeTime(selected.last_seen)}
                  />
                  <Stat
                    label="Promoted"
                    value={selected.promoted_to_rule ? "Yes" : "No"}
                  />
                </div>
                <div>
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    30-day drift
                  </p>
                  <DriftSparkline data={selected.trend} height={48} fullWidth />
                </div>
                {!selected.promoted_to_rule ? (
                  <p className="text-xs text-muted-foreground">
                    Promotion to a deterministic rule is managed in
                    <span className="mx-1 rounded bg-black/[0.04] px-1 py-0.5 font-mono">
                      /api/v1/mining/promote
                    </span>
                    (phase 2 UI).
                  </p>
                ) : null}
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-medium text-foreground">{value}</p>
    </div>
  );
}
