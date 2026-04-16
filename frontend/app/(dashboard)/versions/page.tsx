"use client";

import { useState, useRef } from "react";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowUp,
  ArrowDown,
  Minus,
  Download,
  FileJson,
  FileSpreadsheet,
  Eye,
  GitCompareArrows,
  X,
  Pencil,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  getVersions,
  compareVersions,
  patchVersionLabel,
} from "@/lib/api/versions";
import { getReportDownloadUrl, getReportJsonExportUrl } from "@/lib/api/reports";
import { getConfigMatchesExportUrl } from "@/lib/api/config-matches";
import { formatModuleName, scoreColor } from "@/lib/format";
import type { Version, VersionComparison } from "@/types/api";

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  pending: { label: "Queued", className: "bg-gray-500" },
  running: {
    label: "Running",
    className: "bg-blue-500",
  },
  complete: { label: "Complete", className: "bg-green-600" },
  agents_enqueued: { label: "Complete", className: "bg-green-600" },
  agents_running: { label: "Complete — AI enriching", className: "bg-green-600" },
  agents_complete: { label: "Complete", className: "bg-green-600" },
  failed: { label: "Failed", className: "bg-red-600" },
  agents_failed: { label: "Complete", className: "bg-green-600" },
  ai_enriching: { label: "Complete", className: "bg-green-600" },
  ai_enriched: { label: "Complete", className: "bg-green-600" },
};

function overallDqs(v: Version): number | null {
  if (!v.dqs_summary) return null;
  const scores = Object.values(v.dqs_summary).map((s) => s.composite_score);
  if (scores.length === 0) return null;
  return Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10;
}

function totalCritical(v: Version): number {
  if (!v.dqs_summary) return 0;
  return Object.values(v.dqs_summary).reduce(
    (sum, s) => sum + s.critical_count,
    0
  );
}

export default function VersionsPage() {
  const qc = useQueryClient();
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [comparison, setComparison] = useState<VersionComparison | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const editRef = useRef<HTMLInputElement>(null);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["versions-all"],
    queryFn: () => getVersions({ limit: 100 }),
  });

  const labelMutation = useMutation({
    mutationFn: ({ id, label }: { id: string; label: string }) =>
      patchVersionLabel(id, label),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["versions-all"] });
      setEditingId(null);
    },
  });

  const compareMutation = useMutation({
    mutationFn: (ids: string[]) => compareVersions(ids[0], ids[1]),
    onSuccess: (data) => setComparison(data),
  });

  const toggleCompare = (id: string) => {
    setComparison(null);
    setCompareIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      const next = [...prev, id].slice(-2);
      if (next.length === 2) compareMutation.mutate(next);
      return next;
    });
  };

  if (isLoading)
    return (
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-12" />
        ))}
      </div>
    );

  if (error)
    return (
      <Alert variant="destructive">
        <AlertDescription>
          Failed to load versions.{" "}
          <Button variant="link" className="px-0" onClick={() => refetch()}>
            Retry
          </Button>
        </AlertDescription>
      </Alert>
    );

  const versions = data?.versions ?? [];

  return (
    <TooltipProvider delay={0}>
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Versions</h1>
        {compareIds.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setCompareIds([]);
              setComparison(null);
            }}
          >
            <X className="mr-1 h-3 w-3" /> Clear comparison
          </Button>
        )}
      </div>

      {/* Comparison view */}
      {comparison && <ComparisonView comparison={comparison} />}

      {/* Version list */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="px-4 py-3">Run Date</th>
                  <th className="px-4 py-3">Label</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Modules</th>
                  <th className="px-4 py-3 text-right">DQS</th>
                  <th className="px-4 py-3 text-right">Critical</th>
                  <th className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {versions.map((v) => {
                  const dqs = overallDqs(v);
                  const crit = totalCritical(v);
                  const badge = STATUS_BADGE[v.status] ?? {
                    label: v.status,
                    className: "bg-gray-500",
                  };
                  const isRunning =
                    v.status === "running" || v.status === "agents_running";

                  return (
                    <tr
                      key={v.id}
                      className={`border-b border-border/50 hover:bg-accent/30 ${
                        compareIds.includes(v.id) ? "bg-primary/10" : ""
                      }`}
                    >
                      <td className="px-4 py-3">
                        {new Date(v.run_at).toLocaleString()}
                      </td>
                      <td className="px-4 py-3">
                        {editingId === v.id ? (
                          <input
                            ref={editRef}
                            defaultValue={v.label ?? ""}
                            autoFocus
                            className="w-full rounded border border-border bg-accent px-2 py-1 text-sm"
                            onBlur={(e) =>
                              labelMutation.mutate({
                                id: v.id,
                                label: e.target.value,
                              })
                            }
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                labelMutation.mutate({
                                  id: v.id,
                                  label: (e.target as HTMLInputElement).value,
                                });
                              }
                              if (e.key === "Escape") setEditingId(null);
                            }}
                          />
                        ) : (
                          <span
                            className="cursor-pointer hover:underline"
                            onClick={() => setEditingId(v.id)}
                          >
                            {v.label || (
                              <span className="text-muted-foreground">
                                <Pencil className="mr-1 inline h-3 w-3" />
                                Add label
                              </span>
                            )}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <Badge
                          className={`${badge.className} ${
                            isRunning
                              ? "animate-pulse"
                              : ""
                          }`}
                        >
                          {badge.label}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        {v.metadata?.modules
                          ?.map(formatModuleName)
                          .join(", ") ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {dqs != null ? (
                          <span style={{ color: scoreColor(dqs) }}>{dqs}</span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {crit > 0 ? (
                          <Badge variant="destructive">{crit}</Badge>
                        ) : (
                          "0"
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1">
                          <Tooltip>
                            <TooltipTrigger>
                              <Link href={`/findings?version_id=${v.id}`}>
                                <Button variant="ghost" size="sm">
                                  <Eye className="h-4 w-4" />
                                </Button>
                              </Link>
                            </TooltipTrigger>
                            <TooltipContent>View findings</TooltipContent>
                          </Tooltip>
                          {v.status !== "pending" && v.status !== "running" && v.status !== "failed" && (
                            <>
                              <Tooltip>
                                <TooltipTrigger>
                                  <a href={getReportDownloadUrl(v.id)} download>
                                    <Button variant="ghost" size="sm">
                                      <Download className="h-4 w-4" />
                                    </Button>
                                  </a>
                                </TooltipTrigger>
                                <TooltipContent>Download PDF report</TooltipContent>
                              </Tooltip>
                              <Tooltip>
                                <TooltipTrigger>
                                  <a href={getReportJsonExportUrl(v.id)} download>
                                    <Button variant="ghost" size="sm">
                                      <FileJson className="h-4 w-4" />
                                    </Button>
                                  </a>
                                </TooltipTrigger>
                                <TooltipContent>Export report as JSON</TooltipContent>
                              </Tooltip>
                              <Tooltip>
                                <TooltipTrigger>
                                  <a href={getConfigMatchesExportUrl(v.id)} download>
                                    <Button variant="ghost" size="sm">
                                      <FileSpreadsheet className="h-4 w-4" />
                                    </Button>
                                  </a>
                                </TooltipTrigger>
                                <TooltipContent>Export config matches (xlsx)</TooltipContent>
                              </Tooltip>
                            </>
                          )}
                          <Tooltip>
                            <TooltipTrigger>
                              <Button
                                variant={
                                  compareIds.includes(v.id) ? "default" : "ghost"
                                }
                                size="sm"
                                onClick={() => toggleCompare(v.id)}
                              >
                                <GitCompareArrows className="h-4 w-4" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Compare versions</TooltipContent>
                          </Tooltip>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
    </TooltipProvider>
  );
}

function ComparisonView({ comparison }: { comparison: VersionComparison }) {
  const { v1, v2, delta } = comparison;
  const modules = Object.keys(delta);

  return (
    <Card className="border-primary/30">
      <CardHeader>
        <CardTitle className="text-base">Version Comparison</CardTitle>
        <p className="text-xs text-muted-foreground">
          {new Date(v1.run_at).toLocaleDateString()} {v1.label ? `(${v1.label})` : ""} vs{" "}
          {new Date(v2.run_at).toLocaleDateString()} {v2.label ? `(${v2.label})` : ""}
        </p>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground">
                <th className="px-4 py-3">Module</th>
                <th className="px-4 py-3 text-right">V1 Score</th>
                <th className="px-4 py-3 text-center">Change</th>
                <th className="px-4 py-3 text-right">V2 Score</th>
              </tr>
            </thead>
            <tbody>
              {modules.map((module) => {
                const d = delta[module];
                const change = d.dqs_change;
                return (
                  <tr
                    key={module}
                    className="border-b border-border/50"
                  >
                    <td className="px-4 py-3">
                      {formatModuleName(module)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span style={{ color: scoreColor(d.v1_score) }}>
                        {d.v1_score}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span
                        className={`inline-flex items-center gap-1 ${
                          change > 0
                            ? "text-green-400"
                            : change < 0
                              ? "text-red-400"
                              : "text-muted-foreground"
                        }`}
                      >
                        {change > 0 ? (
                          <ArrowUp className="h-3 w-3" />
                        ) : change < 0 ? (
                          <ArrowDown className="h-3 w-3" />
                        ) : (
                          <Minus className="h-3 w-3" />
                        )}
                        {change > 0 ? "+" : ""}
                        {change.toFixed(1)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span style={{ color: scoreColor(d.v2_score) }}>
                        {d.v2_score}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
