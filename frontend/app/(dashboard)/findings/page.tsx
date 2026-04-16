"use client";

import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Suspense, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { X, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, Network, Play } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { getVersions } from "@/lib/api/versions";
import { getFindings, getFindingReportContext } from "@/lib/api/findings";
import { getLineage } from "@/lib/api/contracts";
import dynamic from "next/dynamic";
import type { LineageGraph } from "@/types/api";

const LineageGraphComponent = dynamic(
  () => import("@/components/charts/lineage-graph"),
  { ssr: false, loading: () => <Skeleton className="h-96 w-full" /> },
);
import {
  severityColor,
  formatModuleName,
  passRateColor,
} from "@/lib/format";
import { Copy, Check } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AlertTitle } from "@/components/ui/alert";
import type { Finding, Severity, Dimension, ValueFixEntry } from "@/types/api";

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

function getFixForValue(
  value: string | null | undefined,
  valueFixMap: Record<string, ValueFixEntry> | null | undefined,
): ValueFixEntry | null {
  if (!valueFixMap || Object.keys(valueFixMap).length === 0) return null;

  const normalised =
    value === null ||
    value === undefined ||
    value === "None" ||
    value === "nan" ||
    String(value).trim() === ""
      ? ""
      : String(value).trim();

  const stripped = normalised.replace(/\.0+$/, "");

  return (
    valueFixMap[normalised] ??
    valueFixMap[stripped] ??
    valueFixMap[""] ??
    valueFixMap["__other__"] ??
    Object.values(valueFixMap)[0] ??
    null
  );
}

const displayValue = (val: string) =>
  val ? val.replace(/\.0+$/, "") : "blank";

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-1.5"
            onClick={() => {
              navigator.clipboard.writeText(text);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
          />
        }
      >
        {copied ? (
          <Check className="h-3 w-3 text-green-600" />
        ) : (
          <Copy className="h-3 w-3" />
        )}
      </TooltipTrigger>
      <TooltipContent>{copied ? "Copied!" : "Copy to clipboard"}</TooltipContent>
    </Tooltip>
  );
}

function authorityClasses(authority: string): string {
  switch (authority) {
    case "sap_hard_constraint":
      return "bg-[#DC2626]/10 text-[#DC2626] border border-[#DC2626]/20";
    case "s4hana_migration":
      return "bg-primary/10 text-primary border border-primary/20";
    case "best_practice":
      return "bg-[#2563EB]/10 text-[#2563EB] border border-[#2563EB]/20";
    case "customer_configured":
      return "bg-[#EA580C]/10 text-[#EA580C] border border-[#EA580C]/20";
    default:
      return "bg-white/[0.60] text-muted-foreground border border-black/[0.08]";
  }
}

function authorityLabel(authority: string): string {
  switch (authority) {
    case "sap_hard_constraint":
      return "SAP Hard Constraint";
    case "s4hana_migration":
      return "S/4HANA Migration Requirement";
    case "best_practice":
      return "Best Practice";
    case "customer_configured":
      return "Customer Configured";
    default:
      return authority;
  }
}

/* ── Module summary helpers ─────────────────────────────── */

interface ModuleSummary {
  module: string;
  findings: Finding[];
  total: number;
  severityCounts: Record<Severity, number>;
  avgPassRate: number;
}

function buildModuleSummaries(findings: Finding[]): ModuleSummary[] {
  const grouped = new Map<string, Finding[]>();
  for (const f of findings) {
    const existing = grouped.get(f.module) ?? [];
    existing.push(f);
    grouped.set(f.module, existing);
  }

  const summaries: ModuleSummary[] = [];
  for (const [module, items] of grouped) {
    const severityCounts: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0, warning: 0 };
    let passRateSum = 0;
    let passRateCount = 0;
    for (const f of items) {
      if (f.severity in severityCounts) {
        severityCounts[f.severity as Severity]++;
      }
      if (f.pass_rate != null) {
        passRateSum += f.pass_rate;
        passRateCount++;
      }
    }
    summaries.push({
      module,
      findings: items,
      total: items.length,
      severityCounts,
      avgPassRate: passRateCount > 0 ? passRateSum / passRateCount : 0,
    });
  }

  // Sort: modules with critical findings first, then by total count
  summaries.sort((a, b) => {
    if (a.severityCounts.critical !== b.severityCounts.critical)
      return b.severityCounts.critical - a.severityCounts.critical;
    return b.total - a.total;
  });

  return summaries;
}

/* ── Main page ──────────────────────────────────────────── */

function FindingsContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const paramVersionId = searchParams.get("version_id") ?? "";
  const paramModule = searchParams.get("module") ?? "";
  const paramSeverity = searchParams.get("severity") ?? "";
  const paramDimension = searchParams.get("dimension") ?? "";

  const [versionId, setVersionId] = useState(paramVersionId);
  const [moduleFilter, setModuleFilter] = useState(paramModule);
  const [severityFilter, setSeverityFilter] = useState(paramSeverity);
  const [dimensionFilter, setDimensionFilter] = useState(paramDimension);
  const [expandedModules, setExpandedModules] = useState<Set<string>>(new Set());
  const [selectedFinding, setSelectedFinding] = useState<Finding | null>(null);
  const [lineageFinding, setLineageFinding] = useState<Finding | null>(null);
  const [lineageData, setLineageData] = useState<LineageGraph | null>(null);
  const [lineageLoading, setLineageLoading] = useState(false);

  const openLineage = async (f: Finding) => {
    setLineageFinding(f);
    setLineageLoading(true);
    try {
      const samples = f.details?.sample_failing_records ?? [];
      const idField = f.details?.id_field_used as string | undefined;
      const recordKey =
        idField && samples[0]
          ? String(samples[0][idField] ?? "")
          : f.check_id;
      const data = await getLineage(f.module, recordKey || f.check_id);
      setLineageData(data);
    } catch {
      setLineageData({ nodes: [], edges: [] });
    } finally {
      setLineageLoading(false);
    }
  };

  const { data: versionData } = useQuery({
    queryKey: ["versions-list"],
    queryFn: () => getVersions({ limit: 50 }),
  });
  const completedVersions = (versionData?.versions ?? []).filter(
    (v) => v.status === "agents_complete" || v.status === "complete"
  );

  const activeVersionId = versionId || "";

  // Fetch ALL findings (large limit) so we can group by module client-side
  const {
    data: findingsData,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: [
      "findings",
      activeVersionId,
      moduleFilter,
      severityFilter,
      dimensionFilter,
    ],
    queryFn: () =>
      getFindings({
        version_id: activeVersionId || undefined,
        module: moduleFilter || undefined,
        severity: severityFilter || undefined,
        dimension: dimensionFilter || undefined,
        limit: 200,
        offset: 0,
      }),
  });

  // Build module summaries from findings
  const moduleSummaries = useMemo(
    () => buildModuleSummaries(findingsData?.findings ?? []),
    [findingsData],
  );

  // Derive unique modules for the filter dropdown
  const availableModules = useMemo(() => {
    const modules = new Set<string>();
    for (const f of findingsData?.findings ?? []) {
      modules.add(f.module);
    }
    return Array.from(modules).sort();
  }, [findingsData]);

  const toggleModule = (module: string) => {
    setExpandedModules((prev) => {
      const next = new Set(prev);
      if (next.has(module)) next.delete(module);
      else next.add(module);
      return next;
    });
  };

  const expandAll = () => {
    setExpandedModules(new Set(moduleSummaries.map((s) => s.module)));
  };

  const collapseAll = () => {
    setExpandedModules(new Set());
  };

  const updateUrl = (params: Record<string, string>) => {
    const sp = new URLSearchParams(searchParams.toString());
    Object.entries(params).forEach(([k, v]) => {
      if (v) sp.set(k, v);
      else sp.delete(k);
    });
    router.push(`/findings?${sp.toString()}`);
  };

  const clearFilters = () => {
    setModuleFilter("");
    setSeverityFilter("");
    setDimensionFilter("");
    router.push(`/findings${activeVersionId ? `?version_id=${activeVersionId}` : ""}`);
  };

  return (
    <TooltipProvider delay={0}>
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Findings</h1>
        <div className="flex items-center gap-2">
          {moduleSummaries.length > 0 && (
            <>
              <Button variant="ghost" size="sm" onClick={expandAll}>
                Expand all
              </Button>
              <Button variant="ghost" size="sm" onClick={collapseAll}>
                Collapse all
              </Button>
            </>
          )}
          <Link href="/run-sync">
            <Button size="sm" className="gap-1.5 bg-primary hover:bg-primary/90 text-primary-foreground">
              <Play className="h-3.5 w-3.5" />
              Run Sync
            </Button>
          </Link>
        </div>
      </div>

      {/* Filter bar */}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 py-3">
          {/* Version selector */}
          <select
            value={activeVersionId}
            onChange={(e) => {
              setVersionId(e.target.value);
              setExpandedModules(new Set());
              updateUrl({ version_id: e.target.value });
            }}
            className="rounded-md border border-border bg-accent px-3 py-1.5 text-sm"
          >
            <option value="">All versions</option>
            {completedVersions.map((v) => {
              const modules = v.metadata?.modules?.map((m: string) =>
                m.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase())
              ).join(", ") ?? "";
              return (
                <option key={v.id} value={v.id}>
                  {new Date(v.run_at).toLocaleDateString()}
                  {modules ? ` — ${modules}` : ""}
                  {v.label ? ` (${v.label})` : ""}
                </option>
              );
            })}
          </select>

          {/* Module filter — dynamic */}
          <select
            value={moduleFilter}
            onChange={(e) => {
              setModuleFilter(e.target.value);
              setExpandedModules(new Set());
            }}
            className="rounded-md border border-border bg-accent px-3 py-1.5 text-sm"
          >
            <option value="">All modules</option>
            {availableModules.map((m) => (
              <option key={m} value={m}>
                {formatModuleName(m)}
              </option>
            ))}
          </select>

          {/* Severity pills */}
          <div className="flex gap-1">
            {SEVERITIES.map((s) => (
              <button
                key={s}
                onClick={() => {
                  setSeverityFilter(severityFilter === s ? "" : s);
                  setExpandedModules(new Set());
                }}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  severityFilter === s
                    ? severityColor(s)
                    : "bg-accent text-muted-foreground hover:text-foreground"
                }`}
              >
                {s}
              </button>
            ))}
          </div>

          {/* Dimension pills */}
          <div className="flex gap-1">
            {DIMENSIONS.map((d) => (
              <button
                key={d}
                onClick={() => {
                  setDimensionFilter(dimensionFilter === d ? "" : d);
                  setExpandedModules(new Set());
                }}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  dimensionFilter === d
                    ? "bg-primary text-white"
                    : "bg-accent text-muted-foreground hover:text-foreground"
                }`}
              >
                {d}
              </button>
            ))}
          </div>

          {(moduleFilter || severityFilter || dimensionFilter) && (
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              <X className="mr-1 h-3 w-3" /> Clear
            </Button>
          )}

          <span className="ml-auto text-xs text-muted-foreground">
            {findingsData
              ? `${findingsData.total} findings across ${moduleSummaries.length} modules`
              : ""}
          </span>
        </CardContent>
      </Card>

      {/* Module cards */}
      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full rounded-lg" />
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
      ) : moduleSummaries.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground font-medium">No findings found</p>
            <p className="text-muted-foreground/70 text-xs mt-1">
              Upload a file and run an analysis to see findings.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {moduleSummaries.map((summary) => {
            const isExpanded = expandedModules.has(summary.module);
            return (
              <Card key={summary.module} className="border-black/[0.08]">
                {/* Module header — clickable to expand/collapse */}
                <button
                  type="button"
                  className="w-full text-left"
                  onClick={() => toggleModule(summary.module)}
                >
                  <CardContent className="flex items-center gap-4 py-4">
                    {/* Expand icon */}
                    <div className="shrink-0">
                      {isExpanded ? (
                        <ChevronUp className="h-5 w-5 text-muted-foreground" />
                      ) : (
                        <ChevronDown className="h-5 w-5 text-muted-foreground" />
                      )}
                    </div>

                    {/* Module name + total */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-foreground">
                          {formatModuleName(summary.module)}
                        </span>
                        <Badge variant="outline" className="text-xs">
                          {summary.total} finding{summary.total !== 1 ? "s" : ""}
                        </Badge>
                      </div>
                    </div>

                    {/* Severity breakdown pills */}
                    <div className="flex gap-1.5 shrink-0">
                      {SEVERITIES.map((s) => {
                        const count = summary.severityCounts[s];
                        if (count === 0) return null;
                        return (
                          <Badge key={s} className={`text-xs ${severityColor(s)}`}>
                            {count} {s}
                          </Badge>
                        );
                      })}
                    </div>

                    {/* Avg pass rate */}
                    <div className="flex items-center gap-2 shrink-0 w-32">
                      <Progress
                        value={summary.avgPassRate}
                        className={`h-2 ${passRateColor(summary.avgPassRate)}`}
                      />
                      <span className="text-xs text-muted-foreground w-12 text-right">
                        {summary.avgPassRate.toFixed(1)}%
                      </span>
                    </div>
                  </CardContent>
                </button>

                {/* Expanded: findings table for this module */}
                {isExpanded && (
                  <div className="border-t border-black/[0.06]">
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-border text-left text-muted-foreground">
                            <th className="px-4 py-3">Severity</th>
                            <th className="px-4 py-3">Check</th>
                            <th className="px-4 py-3">Message</th>
                            <th className="px-4 py-3 text-right">Affected / Total</th>
                            <th className="w-32 px-4 py-3">Pass Rate</th>
                            <th className="px-4 py-3">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {summary.findings.map((f) => (
                            <tr
                              key={f.id}
                              className="border-b border-black/[0.06] hover:bg-black/[0.03]"
                            >
                              <td className="px-4 py-3">
                                <Badge className={severityColor(f.severity)}>
                                  {f.severity}
                                </Badge>
                              </td>
                              <td className="px-4 py-3">
                                <div className="font-mono text-xs">{f.check_id}</div>
                                {f.business_name && (
                                  <Tooltip>
                                    <TooltipTrigger
                                      render={
                                        <div className="text-xs text-primary truncate max-w-[180px] cursor-default" />
                                      }
                                    >
                                      {f.business_name}
                                    </TooltipTrigger>
                                    <TooltipContent className="max-w-xs">
                                      {f.business_definition || f.business_name}
                                    </TooltipContent>
                                  </Tooltip>
                                )}
                                {f.glossary_term_id && (
                                  <a
                                    href={`/glossary/${f.glossary_term_id}`}
                                    onClick={(e) => e.stopPropagation()}
                                    className="text-xs text-[#2563EB] hover:underline"
                                  >
                                    View in Glossary
                                  </a>
                                )}
                              </td>
                              <td className="max-w-xs truncate px-4 py-3">
                                {f.details?.message ?? "—"}
                              </td>
                              <td className="px-4 py-3 text-right">
                                {f.affected_count.toLocaleString()} / {f.total_count.toLocaleString()}
                              </td>
                              <td className="px-4 py-3">
                                {f.pass_rate != null ? (
                                  <div className="flex items-center gap-2">
                                    <Progress
                                      value={f.pass_rate}
                                      className={`h-2 ${passRateColor(f.pass_rate)}`}
                                    />
                                    <span className="text-xs">
                                      {f.pass_rate.toFixed(1)}%
                                    </span>
                                  </div>
                                ) : (
                                  "—"
                                )}
                              </td>
                              <td className="px-4 py-3">
                                <div className="flex gap-1">
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setSelectedFinding(f)}
                                  >
                                    View detail
                                  </Button>
                                  <Tooltip>
                                    <TooltipTrigger
                                      render={
                                        <Button
                                          variant="ghost"
                                          size="sm"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            openLineage(f);
                                          }}
                                        />
                                      }
                                    >
                                      <Network className="h-4 w-4" />
                                    </TooltipTrigger>
                                    <TooltipContent>View lineage</TooltipContent>
                                  </Tooltip>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {/* ── Lineage modal ── */}
      <Dialog
        open={lineageFinding !== null}
        onOpenChange={(open) => {
          if (!open) {
            setLineageFinding(null);
            setLineageData(null);
          }
        }}
      >
        <DialogContent className="fixed left-[50%] top-[50%] translate-x-[-50%] translate-y-[-50%] w-[90vw] max-w-[800px] h-[70vh] overflow-y-auto p-6 rounded-xl shadow-2xl border border-black/[0.08] bg-white/[0.70] backdrop-blur-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Network className="h-5 w-5 text-primary" />
              Data Lineage — {lineageFinding?.check_id}
            </DialogTitle>
          </DialogHeader>
          <div className="mt-4">
            {lineageLoading ? (
              <div className="flex items-center justify-center py-16">
                <Skeleton className="h-96 w-full" />
              </div>
            ) : lineageData ? (
              <LineageGraphComponent graph={lineageData} width={720} height={450} />
            ) : null}
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Detail modal — centred, wide, scrollable ── */}
      <Dialog
        open={selectedFinding !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedFinding(null);
        }}
      >
        <DialogContent
          className="fixed left-[50%] top-[50%] translate-x-[-50%] translate-y-[-50%] w-[95vw] max-w-[1400px] h-[90vh] overflow-y-auto p-0 rounded-xl shadow-2xl border border-black/[0.08] bg-white/[0.70] backdrop-blur-xl"
        >
          {selectedFinding && (
            <>
              <DialogHeader className="px-8 pt-6 pb-4 border-b border-black/[0.08] sticky top-0 bg-white/[0.70] backdrop-blur-xl z-10">
                <div className="flex items-center gap-3">
                  <Badge className={severityColor(selectedFinding.severity)}>
                    {selectedFinding.severity}
                  </Badge>
                  <DialogTitle className="font-mono text-sm text-muted-foreground">
                    {selectedFinding.check_id}
                  </DialogTitle>
                  <Badge variant="outline" className="text-xs">
                    {formatModuleName(selectedFinding.module)}
                  </Badge>
                </div>
                <p className="text-foreground font-medium mt-1">
                  {selectedFinding.details?.message ?? "—"}
                </p>
              </DialogHeader>

              <div className="px-8 py-6">
                <FindingDetail
                  finding={selectedFinding}
                  onRefresh={() => {
                    refetch().then((result) => {
                      const updated = result.data?.findings.find(
                        (f) => f.id === selectedFinding.id,
                      );
                      if (updated) setSelectedFinding(updated);
                    });
                  }}
                  onNavigateUpload={() => router.push("/upload")}
                />
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
    </TooltipProvider>
  );
}

/* ── Finding detail panels ──────────────────────────────── */

function FindingDetail({
  finding,
  onRefresh,
  onNavigateUpload,
}: {
  finding: Finding;
  onRefresh: () => void;
  onNavigateUpload: () => void;
}) {
  const samples = finding.details?.sample_failing_records ?? [];
  const distinctInvalid = finding.details?.distinct_invalid_values;
  const ruleCtx = finding.rule_context;
  const valueFixes = finding.value_fix_map;
  const recordFixes = finding.record_fixes;
  const checkField = finding.details?.field_checked as string | undefined;

  const { data: reportCtxData, isLoading: isReportCtxLoading } = useQuery({
    queryKey: ["finding-report-context", finding.id],
    queryFn: () => getFindingReportContext(finding.id),
    enabled: !!finding.id,
  });
  const reportCtx = reportCtxData?.report_context;

  return (
    <div className="space-y-6">
      {/* Summary badges */}
      <div className="flex flex-wrap gap-2">
        <Badge variant="outline">{finding.dimension}</Badge>
        {checkField && (
          <Badge variant="secondary" className="font-mono text-xs">
            {checkField}
          </Badge>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4 text-sm">
        <div>
          <span className="text-muted-foreground">Affected Records</span>
          <p className="text-lg font-bold">
            {finding.affected_count.toLocaleString()} of{" "}
            {finding.total_count.toLocaleString()}
          </p>
        </div>
        <div>
          <span className="text-muted-foreground">Pass Rate</span>
          <div className="mt-1 flex items-center gap-2">
            <Progress
              value={finding.pass_rate ?? 0}
              className={`h-2.5 ${passRateColor(finding.pass_rate ?? 0)}`}
            />
            <span className="text-lg font-bold">
              {finding.pass_rate != null
                ? `${finding.pass_rate.toFixed(1)}%`
                : "—"}
            </span>
          </div>
        </div>
      </div>

      {/* ─── PANEL 1: Why this rule exists ─── */}
      {ruleCtx && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Why this rule exists</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Badge className={authorityClasses(ruleCtx.rule_authority)}>
              {authorityLabel(ruleCtx.rule_authority)}
            </Badge>

            <p className="text-sm leading-relaxed">{ruleCtx.why_it_matters}</p>

            {finding.severity === "critical" && ruleCtx.sap_impact ? (
              <Alert variant="destructive">
                <AlertTitle>SAP impact</AlertTitle>
                <AlertDescription>{ruleCtx.sap_impact}</AlertDescription>
              </Alert>
            ) : ruleCtx.sap_impact ? (
              <p className="text-sm text-muted-foreground">
                <span className="font-medium">SAP impact:</span>{" "}
                {ruleCtx.sap_impact}
              </p>
            ) : null}

            {ruleCtx.valid_values_with_labels &&
              Object.keys(ruleCtx.valid_values_with_labels).length > 0 && (
                <div>
                  <h4 className="mb-1 text-xs font-semibold">Valid values</h4>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-20">Code</TableHead>
                        <TableHead>Meaning</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {Object.entries(ruleCtx.valid_values_with_labels).map(
                        ([code, label]) => (
                          <TableRow key={code}>
                            <TableCell>
                              <code className="text-xs">{code}</code>
                            </TableCell>
                            <TableCell className="text-xs">{label}</TableCell>
                          </TableRow>
                        ),
                      )}
                    </TableBody>
                  </Table>
                </div>
              )}
          </CardContent>
        </Card>
      )}

      {/* ─── PANEL 2: Failing records with recommended fix ─── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">
            Failing records
            <span className="ml-1 font-normal text-muted-foreground">
              (showing {Math.min(samples.length, 10)} of{" "}
              {finding.affected_count.toLocaleString()})
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {samples.length > 0 ? (
            <div className="overflow-x-auto">
              <table
                style={{
                  tableLayout: "fixed",
                  width: "100%",
                  borderCollapse: "collapse",
                }}
              >
                <colgroup>
                  <col style={{ width: "18%" }} />
                  <col style={{ width: "18%" }} />
                  <col style={{ width: "14%" }} />
                  <col style={{ width: "50%" }} />
                </colgroup>
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground">
                    <th
                      style={{
                        wordBreak: "break-word",
                        verticalAlign: "top",
                        padding: "10px 12px",
                      }}
                      className="text-xs font-medium"
                    >
                      Record ID
                    </th>
                    <th
                      style={{
                        wordBreak: "break-word",
                        verticalAlign: "top",
                        padding: "10px 12px",
                      }}
                      className="text-xs font-medium"
                    >
                      Field
                    </th>
                    <th
                      style={{
                        wordBreak: "break-word",
                        verticalAlign: "top",
                        padding: "10px 12px",
                      }}
                      className="text-xs font-medium"
                    >
                      Invalid value
                    </th>
                    <th
                      style={{
                        wordBreak: "break-word",
                        verticalAlign: "top",
                        padding: "10px 12px",
                      }}
                      className="text-xs font-medium"
                    >
                      Recommended fix
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {samples.slice(0, 10).map((record, idx) => {
                    const fix = recordFixes?.[idx];
                    const idField =
                      finding.details?.id_field_used as string | undefined;
                    const rawVal = checkField
                      ? String(record[checkField] ?? "")
                      : "";
                    const valueFix = getFixForValue(rawVal, valueFixes);

                    const instruction =
                      fix?.fix_instruction ??
                      valueFix?.fix_instruction ??
                      null;
                    const sqlStatement =
                      fix?.sql_statement ??
                      valueFix?.sql_statement ??
                      null;

                    const cellStyle = {
                      wordBreak: "break-word" as const,
                      verticalAlign: "top" as const,
                      padding: "10px 12px",
                    };

                    return (
                      <tr
                        key={idx}
                        className="border-b border-border/50"
                      >
                        <td
                          style={cellStyle}
                          className="font-mono text-xs text-muted-foreground"
                        >
                          {fix?.record_id ??
                            (idField
                              ? String(record[idField] ?? "")
                              : "—")}
                        </td>
                        <td
                          style={cellStyle}
                          className="font-mono text-xs text-muted-foreground"
                        >
                          {checkField ?? "—"}
                        </td>
                        <td style={cellStyle}>
                          <Badge
                            variant="outline"
                            className="font-mono text-xs"
                          >
                            {displayValue(rawVal)}
                          </Badge>
                        </td>
                        <td
                          style={{
                            ...cellStyle,
                            fontSize: "13px",
                            lineHeight: "1.5",
                          }}
                          className="text-foreground"
                        >
                          <div className="space-y-1">
                            {instruction ? (
                              <p>{instruction}</p>
                            ) : (
                              <span className="text-xs italic text-muted-foreground">
                                Check fix_map configuration for this
                                rule
                              </span>
                            )}
                            {sqlStatement && (
                              <div className="flex items-center gap-1 rounded bg-accent p-1.5">
                                <code className="text-[13px] break-all">
                                  {sqlStatement}
                                </code>
                                <CopyButton text={sqlStatement} />
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm italic text-muted-foreground">
              Record detail not available for this check.
            </p>
          )}

          {/* Distinct invalid values summary */}
          {distinctInvalid &&
            Object.keys(distinctInvalid).length > 1 && (
              <div>
                <h5 className="mb-2 text-xs font-semibold">
                  All invalid values found in this dataset
                </h5>
                <div className="space-y-1">
                  {Object.entries(distinctInvalid)
                    .sort((a, b) => b[1] - a[1])
                    .map(([val, count]) => {
                      const stripped = val.replace(/\.0+$/, "");
                      const fix =
                        valueFixes?.[val] ?? valueFixes?.[stripped];
                      return (
                        <div
                          key={val}
                          className="flex items-center gap-2 text-xs"
                        >
                          <Badge variant="outline" className="font-mono">
                            {displayValue(val)}
                          </Badge>
                          <span className="text-muted-foreground">
                            {count.toLocaleString()} records
                          </span>
                          {fix?.fix_instruction && (
                            <span className="truncate text-muted-foreground">
                              {String(fix.fix_instruction).slice(0, 80)}
                              {String(fix.fix_instruction).length > 80
                                ? "..."
                                : ""}
                            </span>
                          )}
                        </div>
                      );
                    })}
                </div>
              </div>
            )}
        </CardContent>
      </Card>

      {/* ─── PANEL 3: Remediation guidance ─── */}
      <Card className="border-primary/30 bg-primary/5">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Remediation guidance</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {reportCtx &&
          (reportCtx.effort_estimate ||
            reportCtx.cross_finding_patterns?.length > 0) ? (
            <div className="space-y-4">
              {reportCtx.effort_estimate && (
                <div className="bg-white/[0.60] rounded-lg p-4 border border-black/[0.08]">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Estimated effort
                    </span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium">
                      {reportCtx.effort_estimate.fix_complexity} complexity
                    </span>
                  </div>
                  <p className="text-2xl font-bold text-primary">
                    {reportCtx.effort_estimate.estimated_person_hours}h
                  </p>
                  <p className="text-xs text-secondary-foreground mt-1">
                    {reportCtx.effort_estimate.estimation_basis}
                  </p>
                </div>
              )}

              {reportCtx.fix_sequence && (
                <div className="border-l-[3px] border-[#2563EB] pl-4 py-2">
                  <p className="text-xs font-semibold text-muted-foreground mb-1">
                    Fix priority #{reportCtx.fix_sequence.sequence}
                  </p>
                  <p className="text-sm text-secondary-foreground">
                    {reportCtx.fix_sequence.reason}
                  </p>
                </div>
              )}

              {reportCtx.cross_finding_patterns.length > 0 && (
                <div>
                  <h5 className="mb-1 text-xs font-semibold">
                    Connected to other findings
                  </h5>
                  {reportCtx.cross_finding_patterns.map((p, i) => (
                    <div
                      key={i}
                      className="mb-2 rounded-md border border-border bg-background p-3"
                    >
                      <p className="text-sm">{p.pattern_description}</p>
                      <p className="text-xs text-muted-foreground">
                        Affects {p.shared_record_count.toLocaleString()}{" "}
                        records across{" "}
                        {p.affected_check_ids.join(", ")}
                      </p>
                      <p className="text-xs">{p.recommended_approach}</p>
                    </div>
                  ))}
                </div>
              )}

              {reportCtx.flags.length > 0 && (
                <Alert>
                  <AlertTitle>Note from AI analysis</AlertTitle>
                  {reportCtx.flags.map((f, i) => (
                    <AlertDescription key={i}>{f.flag}</AlertDescription>
                  ))}
                </Alert>
              )}
            </div>
          ) : isReportCtxLoading ? (
            <div className="space-y-3 py-2">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-10 w-3/4" />
              <Skeleton className="h-10 w-1/2" />
            </div>
          ) : finding.remediation_text ? (
            <div className="bg-white/[0.60] rounded-lg p-4 border border-black/[0.08]">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                Remediation guidance
              </p>
              <p className="text-sm text-secondary-foreground leading-relaxed whitespace-pre-line">
                {finding.remediation_text}
              </p>
            </div>
          ) : (
            <div className="text-center py-8 space-y-3">
              <p className="text-sm text-secondary-foreground">
                Remediation guidance is generated during analysis. This
                finding is from a previous run that pre-dates the AI
                remediation feature.
              </p>
              <p className="text-xs text-muted-foreground">
                Run a new analysis to generate effort estimates, fix
                sequencing, and cross-finding pattern analysis.
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={onNavigateUpload}
              >
                Run new analysis
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function FindingsPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <FindingsContent />
    </Suspense>
  );
}
