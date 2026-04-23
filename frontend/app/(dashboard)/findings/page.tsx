"use client";

import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Play, Check, Copy, Network } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DetailPanel } from "@/components/ui/detail-panel";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import dynamic from "next/dynamic";
import { getVersions } from "@/lib/api/versions";
import { getFindings } from "@/lib/api/findings";
import { getLineage } from "@/lib/api/contracts";
import { severityColor, formatModuleName } from "@/lib/format";
import { KpiRail, type KpiItem } from "@/components/ui/kpi-rail";
import { HeroKpi } from "@/components/ui/hero-kpi";
import { NarrativeStrip } from "@/components/ui/narrative-strip";
import { SectionHeader } from "@/components/ui/section-header";
import { SavedView } from "@/components/ui/saved-view";
import { FilterChipBar } from "@/components/ui/filter-chip-bar";
import { useUrlState, useUrlMultiState } from "@/hooks/use-url-state";
import {
  DenseDataTable,
  type DenseColumnDef,
} from "@/components/ui/dense-data-table";
import {
  SmallMultiplesChart,
  type SmallMultipleSeries,
} from "@/components/charts/small-multiples";
import type {
  Finding,
  Severity,
  Dimension,
  LineageGraph,
} from "@/types/api";

const LineageGraphComponent = dynamic(
  () => import("@/components/charts/lineage-graph"),
  { ssr: false, loading: () => <Skeleton className="h-96 w-full" /> },
);

const SEVERITIES: Severity[] = ["critical", "high", "medium", "low", "warning"];
const DIMENSIONS: Dimension[] = [
  "completeness",
  "accuracy",
  "consistency",
  "timeliness",
  "uniqueness",
  "validity",
];

/* ── Helpers ────────────────────────────────────────────── */

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            className="inline-flex h-5 items-center rounded px-1.5 text-muted-foreground hover:bg-black/[0.04] hover:text-foreground"
            onClick={() => {
              navigator.clipboard.writeText(text);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
          />
        }
      >
        {copied ? <Check className="h-3 w-3 text-[#256F3A]" /> : <Copy className="h-3 w-3" />}
      </TooltipTrigger>
      <TooltipContent>{copied ? "Copied" : "Copy"}</TooltipContent>
    </Tooltip>
  );
}

function passRateTone(rate: number | null): "pos" | "warn" | "neg" | "neutral" {
  if (rate === null) return "neutral";
  if (rate >= 95) return "pos";
  if (rate >= 80) return "warn";
  return "neg";
}

function toneClass(tone: "pos" | "warn" | "neg" | "neutral"): string {
  switch (tone) {
    case "pos":
      return "text-[#256F3A]";
    case "warn":
      return "text-[#E76500]";
    case "neg":
      return "text-[#BB0000]";
    default:
      return "text-muted-foreground";
  }
}

/* ── Main page ──────────────────────────────────────────── */

function FindingsContent() {
  const [versionId, setVersionId] = useUrlState("version_id");
  const [severities, setSeverities] = useUrlMultiState("severity");
  const [dimensions, setDimensions] = useUrlMultiState("dimension");
  const [modules, setModules] = useUrlMultiState("module");
  const [selectedFinding, setSelectedFinding] = useState<Finding | null>(null);
  const [lineageFinding, setLineageFinding] = useState<Finding | null>(null);
  const [lineageData, setLineageData] = useState<LineageGraph | null>(null);
  const [lineageLoading, setLineageLoading] = useState(false);

  const { data: versionData } = useQuery({
    queryKey: ["versions-list"],
    queryFn: () => getVersions({ limit: 50 }),
  });
  const completedVersions = (versionData?.versions ?? []).filter(
    (v) => v.status === "agents_complete" || v.status === "complete",
  );
  const activeVersion = versionId || completedVersions[0]?.id || "";

  // Pull a large, single-page slab so we can filter & summarise client-side.
  const {
    data: findingsData,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ["findings", activeVersion],
    queryFn: () =>
      getFindings({
        version_id: activeVersion || undefined,
        limit: 200,
        offset: 0,
      }),
    enabled: Boolean(activeVersion) || completedVersions.length === 0,
  });

  const allFindings = findingsData?.findings ?? [];
  const availableModules = useMemo(() => {
    const set = new Set<string>();
    for (const f of allFindings) set.add(f.module);
    return Array.from(set).sort();
  }, [allFindings]);

  // Apply client-side filters
  const filtered = useMemo(() => {
    const sevSet = new Set(severities);
    const dimSet = new Set(dimensions);
    const modSet = new Set(modules);
    return allFindings.filter((f) => {
      if (sevSet.size > 0 && !sevSet.has(f.severity)) return false;
      if (dimSet.size > 0 && !dimSet.has(f.dimension)) return false;
      if (modSet.size > 0 && !modSet.has(f.module)) return false;
      return true;
    });
  }, [allFindings, severities, dimensions, modules]);

  // Aggregates for KPI rail + narrative
  const kpis = useMemo((): KpiItem[] => {
    let critical = 0,
      high = 0,
      medium = 0,
      low = 0,
      passSum = 0,
      passCount = 0,
      autoFixable = 0;
    for (const f of filtered) {
      if (f.severity === "critical") critical++;
      else if (f.severity === "high") high++;
      else if (f.severity === "medium") medium++;
      else if (f.severity === "low") low++;
      if (f.pass_rate != null) {
        passSum += f.pass_rate;
        passCount++;
      }
      if (f.value_fix_map && Object.keys(f.value_fix_map).length > 0) autoFixable++;
    }
    const avgPass = passCount > 0 ? passSum / passCount : 0;
    return [
      { label: "Total", value: filtered.length.toLocaleString() },
      { label: "Critical", value: critical, tone: critical > 0 ? "neg" : "pos" },
      { label: "High", value: high, tone: high > 10 ? "warn" : "neutral" },
      { label: "Medium", value: medium },
      { label: "Low", value: low },
      {
        label: "Auto-fix",
        value: autoFixable,
        hint: "Findings with populated value_fix_map",
        tone: autoFixable > 0 ? "pos" : "neutral",
      },
      {
        label: "Avg pass",
        value: passCount > 0 ? `${avgPass.toFixed(1)}%` : "—",
        tone: passRateTone(avgPass),
      },
    ];
  }, [filtered]);

  // Dimension small-multiples — pass-rate buckets per dimension
  const dimensionSeries: SmallMultipleSeries[] = useMemo(() => {
    return DIMENSIONS.map((dim, i) => {
      const bucketData = filtered.filter((f) => f.dimension === dim);
      const count = bucketData.length;
      const avgPass =
        count > 0
          ? bucketData.reduce((s, f) => s + (f.pass_rate ?? 0), 0) / count
          : 0;
      // Fake time-series from bucketing pass rates into 6 chunks by position
      const data = Array.from({ length: 6 }, (_, j) => {
        const slice = bucketData.slice(
          Math.floor((j * count) / 6),
          Math.floor(((j + 1) * count) / 6),
        );
        if (slice.length === 0) return { x: j, y: null };
        const avg = slice.reduce((s, f) => s + (f.pass_rate ?? 0), 0) / slice.length;
        return { x: j, y: Math.round(avg * 10) / 10 };
      });
      return {
        key: dim,
        label: dim,
        data,
        value: count > 0 ? `${avgPass.toFixed(0)}%` : "—",
        color: i % 2 === 0 ? "#0070F2" : "#0695A8",
      };
    });
  }, [filtered]);

  // Narrative composition
  const narrative = useMemo(() => {
    const critCount = filtered.filter((f) => f.severity === "critical").length;
    const highCount = filtered.filter((f) => f.severity === "high").length;
    const topModule =
      filtered
        .filter((f) => f.severity === "critical")
        .reduce((acc, f) => {
          acc[f.module] = (acc[f.module] ?? 0) + 1;
          return acc;
        }, {} as Record<string, number>);
    const hottest = Object.entries(topModule).sort((a, b) => b[1] - a[1])[0];
    if (critCount > 0 && hottest) {
      return {
        headline: `${critCount} critical finding${critCount === 1 ? "" : "s"} — ${hottest[1]} on ${formatModuleName(hottest[0])}.`,
        detail: `${highCount} high, ${filtered.length.toLocaleString()} total after current filters.`,
        tone: "neg" as const,
      };
    }
    if (highCount > 0) {
      return {
        headline: `${highCount} high-severity finding${highCount === 1 ? "" : "s"} across ${availableModules.length} module${availableModules.length === 1 ? "" : "s"}.`,
        detail: `No criticals outstanding. ${filtered.length.toLocaleString()} total after filters.`,
        tone: "warn" as const,
      };
    }
    return {
      headline: `${filtered.length.toLocaleString()} finding${filtered.length === 1 ? "" : "s"} across ${availableModules.length} module${availableModules.length === 1 ? "" : "s"}.`,
      detail: "No criticals, no highs — estate looks clean.",
      tone: "pos" as const,
    };
  }, [filtered, availableModules]);

  const openLineage = async (f: Finding) => {
    setLineageFinding(f);
    setLineageLoading(true);
    try {
      const samples = f.details?.sample_failing_records ?? [];
      const idField = f.details?.id_field_used as string | undefined;
      const recordKey =
        idField && samples[0] ? String(samples[0][idField] ?? "") : f.check_id;
      const data = await getLineage(f.module, recordKey || f.check_id);
      setLineageData(data);
    } catch {
      setLineageData({ nodes: [], edges: [] });
    } finally {
      setLineageLoading(false);
    }
  };

  const columns: DenseColumnDef<Finding>[] = useMemo(
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
        accessorKey: "module",
        header: "Module",
        cell: ({ getValue }) => (
          <span className="text-foreground">{formatModuleName(getValue() as string)}</span>
        ),
      },
      {
        accessorKey: "check_id",
        header: "Check",
        cell: ({ getValue }) => (
          <span className="font-mono text-[11px] text-foreground">{getValue() as string}</span>
        ),
      },
      {
        accessorKey: "dimension",
        header: "Dim",
        cell: ({ getValue }) => (
          <span className="text-muted-foreground">{getValue() as string}</span>
        ),
      },
      {
        accessorKey: "pass_rate",
        header: "Pass",
        size: 80,
        cell: ({ getValue }) => {
          const v = getValue() as number | null;
          if (v === null) return <span className="text-muted-foreground">—</span>;
          return (
            <span className={`tabular-nums font-semibold ${toneClass(passRateTone(v))}`}>
              {v.toFixed(1)}%
            </span>
          );
        },
      },
      {
        accessorKey: "affected_count",
        header: "Affected",
        size: 96,
        cell: ({ row }) => {
          const f = row.original;
          return (
            <span className="tabular-nums text-foreground">
              {f.affected_count.toLocaleString()}
              <span className="text-muted-foreground"> / {f.total_count.toLocaleString()}</span>
            </span>
          );
        },
      },
      {
        accessorKey: "details",
        header: "Message",
        enableSorting: false,
        cell: ({ row }) => {
          const msg = row.original.details?.message ?? row.original.remediation_text ?? "";
          return (
            <span className="block max-w-[420px] truncate text-muted-foreground">
              {typeof msg === "string" ? msg : ""}
            </span>
          );
        },
      },
    ],
    [],
  );

  return (
    <TooltipProvider delay={0}>
      <div className="space-y-4">
        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="font-display text-xl font-semibold text-foreground">Findings</h1>
            <p className="text-sm text-muted-foreground">
              {activeVersion
                ? `Version ${activeVersion.slice(0, 8)} · ${allFindings.length.toLocaleString()} total`
                : "Select an analysis version to begin"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <SavedView routeKey="findings" />
            <Link href="/run-sync">
              <Button size="sm" className="gap-1.5 bg-primary hover:bg-primary/90 text-primary-foreground">
                <Play className="h-3.5 w-3.5" />
                Run sync
              </Button>
            </Link>
          </div>
        </div>

        {/* Version selector + filter chips */}
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={activeVersion}
            onChange={(e) => setVersionId(e.target.value)}
            className="rounded-full border border-black/[0.08] bg-white/[0.60] px-2.5 py-1 text-xs"
          >
            {completedVersions.map((v) => (
              <option key={v.id} value={v.id}>
                {new Date(v.run_at).toLocaleDateString()}
                {v.label ? ` · ${v.label}` : ""}
              </option>
            ))}
          </select>
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
                key: "dimension",
                label: "Dimension",
                selected: dimensions,
                onChange: setDimensions,
                options: DIMENSIONS.map((d) => ({ value: d, label: d })),
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
        </div>

        {/* Hero + KPI rail */}
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
          <div className="lg:col-span-4">
            <HeroKpi
              label="Critical findings"
              value={kpis[1]?.value ?? 0}
              caption={
                (kpis[1]?.value ?? 0) === 0
                  ? "No criticals outstanding"
                  : `${kpis[2]?.value ?? 0} high \u00b7 ${filtered.length.toLocaleString()} total after filters`
              }
              tone={(kpis[1]?.value ?? 0) === 0 ? "pos" : "neg"}
              href="/findings?severity=critical"
            />
          </div>
          <div className="lg:col-span-8">
            <KpiRail items={kpis.filter((_, i) => i !== 1)} columns={6} />
          </div>
        </div>

        {/* Narrative */}
        <NarrativeStrip
          headline={narrative.headline}
          detail={narrative.detail}
          tone={narrative.tone}
          cta={
            severities.includes("critical")
              ? null
              : { label: "Show criticals", href: "/findings?severity=critical" }
          }
        />

        {/* Main content */}
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-9 w-full rounded-lg" />
            ))}
          </div>
        ) : error ? (
          <Alert variant="destructive">
            <AlertDescription>
              Failed to load findings.{" "}
              <Button variant="link" className="px-0" onClick={() => refetch()}>
                Retry
              </Button>
            </AlertDescription>
          </Alert>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
              <div className="lg:col-span-12">
                <SectionHeader
                  title="Findings"
                  caption={`${filtered.length.toLocaleString()} of ${allFindings.length.toLocaleString()} after filters${filtered.length > 500 ? " · virtualized" : ""}`}
                />
                <div className="mt-2">
                  <DenseDataTable<Finding>
                    data={filtered}
                    columns={columns}
                    onRowClick={(f) => setSelectedFinding(f)}
                    maxHeight={560}
                    emptyLabel="No findings match the current filters"
                  />
                </div>
              </div>
            </div>

            {/* Small multiples — pass-rate per dimension */}
            <div>
              <SectionHeader
                title="Pass rate by dimension"
                caption="Sliced within the filtered set"
              />
              <div className="mt-2">
                <SmallMultiplesChart series={dimensionSeries} columns={6} />
              </div>
            </div>
          </>
        )}

        {/* Finding detail slide-over */}
        <DetailPanel
          open={!!selectedFinding}
          onOpenChange={(o) => !o && setSelectedFinding(null)}
          width={560}
          title={
            selectedFinding ? (
              <span className="flex items-center gap-2">
                <Badge className={`text-[10px] ${severityColor(selectedFinding.severity)}`}>
                  {selectedFinding.severity}
                </Badge>
                <span className="font-mono text-sm">{selectedFinding.check_id}</span>
              </span>
            ) : null
          }
          subtitle={
            selectedFinding
              ? `${formatModuleName(selectedFinding.module)} · ${selectedFinding.dimension}`
              : undefined
          }
          onPrev={
            selectedFinding
              ? () => {
                  const i = filtered.findIndex((f) => f.check_id === selectedFinding.check_id);
                  if (i > 0) setSelectedFinding(filtered[i - 1]);
                }
              : undefined
          }
          onNext={
            selectedFinding
              ? () => {
                  const i = filtered.findIndex((f) => f.check_id === selectedFinding.check_id);
                  if (i >= 0 && i < filtered.length - 1) setSelectedFinding(filtered[i + 1]);
                }
              : undefined
          }
        >
          {selectedFinding ? (
            <FindingDetail
              finding={selectedFinding}
              onLineage={() => openLineage(selectedFinding)}
            />
          ) : null}
        </DetailPanel>

        {/* Lineage dialog */}
        <Dialog
          open={!!lineageFinding}
          onOpenChange={(o) => {
            if (!o) {
              setLineageFinding(null);
              setLineageData(null);
            }
          }}
        >
          <DialogContent className="max-w-4xl">
            <DialogHeader>
              <DialogTitle>Lineage</DialogTitle>
            </DialogHeader>
            {lineageLoading ? (
              <Skeleton className="h-96 w-full" />
            ) : lineageData && lineageData.nodes.length > 0 ? (
              <LineageGraphComponent graph={lineageData} />
            ) : (
              <p className="text-sm text-muted-foreground">
                No lineage data available for this record.
              </p>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  );
}

function FindingDetail({
  finding,
  onLineage,
}: {
  finding: Finding;
  onLineage: () => void;
}) {
  const ctx = finding.rule_context;
  const fixMap = finding.value_fix_map;
  const samples = finding.details?.sample_failing_records ?? [];
  const recordFixes = finding.record_fixes;
  const checkField = finding.details?.field_checked as string | undefined;

  return (
    <div className="space-y-4 text-sm">
        <div>
          <p className="text-muted-foreground">
            {finding.details?.message ?? finding.remediation_text ?? "No description."}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <span>
              Affected:{" "}
              <span className="font-medium text-foreground tabular-nums">
                {finding.affected_count.toLocaleString()} / {finding.total_count.toLocaleString()}
              </span>
            </span>
            {finding.pass_rate != null ? (
              <span>
                Pass rate:{" "}
                <span
                  className={`font-semibold tabular-nums ${toneClass(passRateTone(finding.pass_rate))}`}
                >
                  {finding.pass_rate.toFixed(1)}%
                </span>
              </span>
            ) : null}
            {checkField ? (
              <span>
                Field: <span className="font-mono text-foreground">{checkField}</span>
              </span>
            ) : null}
            <Button size="sm" variant="outline" onClick={onLineage} className="h-6 gap-1 text-xs">
              <Network className="h-3 w-3" />
              Lineage
            </Button>
          </div>
        </div>

        {ctx ? (
          <div className="rounded-lg border border-black/[0.06] bg-white/[0.60] p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Why it matters
            </p>
            <p className="mt-1 text-sm text-foreground">{ctx.why_it_matters}</p>
            <p className="mt-2 text-xs text-muted-foreground">{ctx.sap_impact}</p>
          </div>
        ) : null}

        <FindingSignalsSection finding={finding} />

        {fixMap && Object.keys(fixMap).length > 0 ? (
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Value fix map
            </p>
            <div className="rounded-lg border border-black/[0.06] bg-white/[0.60]">
              <table className="w-full text-xs">
                <thead className="border-b border-black/[0.06] text-left text-muted-foreground">
                  <tr>
                    <th className="px-2.5 py-1.5 font-medium">Invalid</th>
                    <th className="px-2.5 py-1.5 font-medium">Fix</th>
                    <th className="px-2.5 py-1.5 font-medium">SQL</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(fixMap)
                    .slice(0, 10)
                    .map(([k, v]) => (
                      <tr key={k} className="border-b border-black/[0.04] last:border-0">
                        <td className="px-2.5 py-1 font-mono text-foreground">{k || "—"}</td>
                        <td className="px-2.5 py-1 text-foreground">
                          {v.fix_instruction ?? "—"}
                        </td>
                        <td className="px-2.5 py-1 font-mono text-muted-foreground">
                          {v.sql_statement ? (
                            <span className="inline-flex items-center gap-1">
                              <span className="max-w-[240px] truncate">{v.sql_statement}</span>
                              <CopyButton text={v.sql_statement} />
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        {samples.length > 0 ? (
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Sample failing records ({Math.min(samples.length, 5)} of {samples.length})
            </p>
            <div className="rounded-lg border border-black/[0.06] bg-white/[0.60] overflow-hidden">
              <table className="w-full text-xs">
                <thead className="border-b border-black/[0.06] text-left text-muted-foreground">
                  <tr>
                    {Object.keys(samples[0]).slice(0, 5).map((k) => (
                      <th key={k} className="px-2.5 py-1.5 font-medium">{k}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {samples.slice(0, 5).map((r, i) => (
                    <tr key={i} className="border-b border-black/[0.04] last:border-0">
                      {Object.keys(samples[0]).slice(0, 5).map((k) => (
                        <td key={k} className="px-2.5 py-1 font-mono text-foreground">
                          {String(r[k] ?? "—")}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

      {recordFixes && recordFixes.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          {recordFixes.length} record-level fix{recordFixes.length === 1 ? "" : "es"} available in
          the full report.
        </p>
      ) : null}
    </div>
  );
}

/**
 * Extension panel for the backend signals shipped in PRs B–F:
 *   - Root-cause classification (PR F) — bad_data / bad_config / mixed
 *   - Cross-module marker (PR D) — rule joined multiple modules
 *   - Customer namespace flag (PR E) — Z-table / Y-table finding
 *   - Applies-when predicate (PR B) — rule scope
 *
 * Shown below "Why it matters". No-op when the finding has none of
 * these signals — legacy findings render unchanged.
 */
function FindingSignalsSection({ finding }: { finding: Finding }) {
  const d = (finding.details ?? {}) as Record<string, unknown>;
  const rootCause = d.root_cause as
    | {
        root_cause_type?: string;
        reasoning?: string;
        element_type?: string;
        flagged_values_in_config?: string[];
        flagged_values_not_in_config?: string[];
      }
    | undefined;
  const crossModule = d.cross_module === true;
  const sources = Array.isArray(d.sources) ? (d.sources as string[]) : [];
  const isCustomer = d.namespace === "customer";
  const appliesWhen = d.applies_when as Record<string, string[]> | undefined;

  const hasAny =
    (rootCause && rootCause.root_cause_type && rootCause.root_cause_type !== "unknown") ||
    crossModule ||
    isCustomer ||
    (appliesWhen && Object.keys(appliesWhen).length > 0);
  if (!hasAny) return null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {crossModule ? (
          <Badge className="border-blue-300 bg-blue-50 text-[10px] text-blue-700">
            Cross-module · {sources.join(" + ") || "multi-module"}
          </Badge>
        ) : null}
        {isCustomer ? (
          <Badge className="border-blue-300 bg-blue-50 text-[10px] text-blue-700">
            Customer namespace
          </Badge>
        ) : null}
        {rootCause?.root_cause_type === "bad_data" ? (
          <Badge className="border-blue-300 bg-blue-50 text-[10px] text-blue-700">
            Data issue
          </Badge>
        ) : null}
        {rootCause?.root_cause_type === "bad_config" ? (
          <Badge className="border-amber-300 bg-amber-50 text-[10px] text-amber-800">
            Config issue — review SPRO
          </Badge>
        ) : null}
        {rootCause?.root_cause_type === "bad_data_and_config" ? (
          <Badge className="border-amber-300 bg-amber-50 text-[10px] text-amber-800">
            Data + config — split remediation
          </Badge>
        ) : null}
      </div>

      {appliesWhen && Object.keys(appliesWhen).length > 0 ? (
        <p className="text-xs text-muted-foreground">
          Applies when{" "}
          {Object.entries(appliesWhen).map(([field, values], idx) => (
            <span key={field}>
              {idx > 0 ? " and " : ""}
              <span className="font-mono">{field}</span> in{" "}
              {(values ?? []).join(", ")}
            </span>
          ))}
        </p>
      ) : null}

      {rootCause &&
      rootCause.reasoning &&
      rootCause.root_cause_type !== "unknown" ? (
        <div className="rounded-lg border border-black/[0.06] bg-white/[0.60] p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Root cause
          </p>
          <p className="mt-1 text-sm text-foreground">{rootCause.reasoning}</p>
          {rootCause.flagged_values_in_config?.length ? (
            <p className="mt-2 text-xs text-muted-foreground">
              Valid in your SPRO config:{" "}
              <span className="font-mono text-foreground">
                {rootCause.flagged_values_in_config.join(", ")}
              </span>
            </p>
          ) : null}
          {rootCause.flagged_values_not_in_config?.length ? (
            <p className="mt-1 text-xs text-muted-foreground">
              Not in your SPRO config:{" "}
              <span className="font-mono text-foreground">
                {rootCause.flagged_values_not_in_config.join(", ")}
              </span>
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export default function FindingsPage() {
  return (
    <Suspense fallback={<div className="p-6"><Skeleton className="h-64 w-full rounded-xl" /></div>}>
      <FindingsContent />
    </Suspense>
  );
}
