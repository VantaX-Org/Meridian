"use client";

import { useState } from "react";
import {
  AlertOctagon,
  AlertTriangle,
  CheckCircle,
  Loader2,
  ArrowUpDown,
  AlertCircle,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useQuery } from "@tanstack/react-query";
import { getVersions } from "@/lib/api/versions";
import { getConfigImpact } from "@/lib/api/connectivity";
import { ConfigImpactChart } from "@/components/charts/config-impact-chart";
import type { ConfigImpactResult, Version } from "@/types/api";

const STATUS_CONFIG: Record<string, { icon: React.ReactNode; badge: string; label: string }> = {
  blocked: {
    icon: <AlertOctagon className="h-3.5 w-3.5" />,
    badge: "bg-destructive/10 text-destructive border-destructive/20",
    label: "Blocked",
  },
  degraded: {
    icon: <AlertTriangle className="h-3.5 w-3.5" />,
    badge: "bg-[#D97706]/10 text-[#D97706] border-[#D97706]/20",
    label: "Degraded",
  },
  ok: {
    icon: <CheckCircle className="h-3.5 w-3.5" />,
    badge: "bg-[#16A34A]/10 text-[#16A34A] border-[#16A34A]/20",
    label: "OK",
  },
};

type SortKey = "feature" | "status" | "total_affected_records";

function SkeletonTable() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 8 }).map((_, i) => (
        <Skeleton key={i} className="h-12 w-full rounded-lg" />
      ))}
    </div>
  );
}

export default function ConfigImpactPage() {
  const [versionId, setVersionId] = useState<string>("");
  const [sortKey, setSortKey] = useState<SortKey>("status");
  const [sortAsc, setSortAsc] = useState(true);

  // Load versions
  const { data: versionData, isLoading: versionsLoading } = useQuery({
    queryKey: ["versions"],
    queryFn: () => getVersions({ limit: 20 }),
  });

  const completedVersions = (versionData?.versions ?? []).filter(
    (v: Version) => v.status === "agents_complete" || v.status === "complete"
  );

  // Auto-select first version
  const activeVersionId = versionId || completedVersions[0]?.id || "";

  // Load config impact
  const { data: impactData, isLoading: impactLoading, isError, error } = useQuery({
    queryKey: ["config-impact", activeVersionId],
    queryFn: () => getConfigImpact(activeVersionId),
    enabled: Boolean(activeVersionId),
  });

  const results = impactData?.results ?? [];
  const summary = impactData?.summary;

  // Sort
  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortAsc(!sortAsc);
    } else {
      setSortKey(key);
      setSortAsc(true);
    }
  };

  const statusOrder = { blocked: 0, degraded: 1, ok: 2 };
  const sorted = [...results].sort((a, b) => {
    let cmp = 0;
    if (sortKey === "feature") {
      cmp = a.feature.localeCompare(b.feature);
    } else if (sortKey === "status") {
      cmp = (statusOrder[a.status] ?? 3) - (statusOrder[b.status] ?? 3);
    } else if (sortKey === "total_affected_records") {
      cmp = a.total_affected_records - b.total_affected_records;
    }
    return sortAsc ? cmp : -cmp;
  });

  function SortButton({ label, field }: { label: string; field: SortKey }) {
    return (
      <button
        type="button"
        onClick={() => handleSort(field)}
        className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
      >
        {label}
        <ArrowUpDown className="h-3 w-3" />
      </button>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-xl font-bold text-foreground">Config Impact</h1>
          <p className="text-sm text-muted-foreground">
            Analyse how configuration findings affect business features and transactions
          </p>
        </div>
        <select
          value={activeVersionId}
          onChange={(e) => setVersionId(e.target.value)}
          disabled={versionsLoading}
          className="rounded-md border border-black/[0.08] bg-white/[0.70] px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        >
          {versionsLoading && <option>Loading...</option>}
          {completedVersions.map((v: Version) => (
            <option key={v.id} value={v.id}>
              {v.label || new Date(v.run_at).toLocaleDateString()}
            </option>
          ))}
          {completedVersions.length === 0 && !versionsLoading && (
            <option value="">No completed analyses</option>
          )}
        </select>
      </div>

      {/* Summary cards */}
      {summary && (
        <div className="grid gap-4 sm:grid-cols-3">
          <Card className="border-destructive/10 bg-destructive/[0.04]">
            <CardContent className="flex items-center gap-3 p-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-destructive/10">
                <AlertOctagon className="h-5 w-5 text-destructive" />
              </div>
              <div>
                <p className="text-2xl font-bold text-destructive">{summary.features_blocked}</p>
                <p className="text-xs text-muted-foreground">Blocked Features</p>
              </div>
            </CardContent>
          </Card>
          <Card className="border-[#D97706]/10 bg-[#D97706]/[0.04]">
            <CardContent className="flex items-center gap-3 p-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#D97706]/10">
                <AlertTriangle className="h-5 w-5 text-[#D97706]" />
              </div>
              <div>
                <p className="text-2xl font-bold text-[#D97706]">{summary.features_degraded}</p>
                <p className="text-xs text-muted-foreground">Degraded Features</p>
              </div>
            </CardContent>
          </Card>
          <Card className="border-[#16A34A]/10 bg-[#16A34A]/[0.04]">
            <CardContent className="flex items-center gap-3 p-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#16A34A]/10">
                <CheckCircle className="h-5 w-5 text-[#16A34A]" />
              </div>
              <div>
                <p className="text-2xl font-bold text-[#16A34A]">{summary.features_ok}</p>
                <p className="text-xs text-muted-foreground">OK Features</p>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Chart */}
      {summary && (
        <Card className="border-black/[0.08] bg-white/[0.70]">
          <CardContent className="p-5">
            <h3 className="text-sm font-semibold text-foreground mb-3">Feature Impact Distribution</h3>
            <ConfigImpactChart summary={summary} />
          </CardContent>
        </Card>
      )}

      {/* Error state */}
      {isError && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Failed to load config impact: {(error as Error).message}
          </AlertDescription>
        </Alert>
      )}

      {/* Table */}
      {impactLoading ? (
        <SkeletonTable />
      ) : sorted.length > 0 ? (
        <Card className="border-black/[0.08] bg-white/[0.70] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-black/[0.08] bg-white/[0.40]">
                  <th className="px-4 py-3 text-left">
                    <SortButton label="Feature" field="feature" />
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">System</th>
                  <th className="px-4 py-3 text-left">
                    <SortButton label="Status" field="status" />
                  </th>
                  <th className="px-4 py-3 text-left">
                    <SortButton label="Affected Records" field="total_affected_records" />
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground">Blocked Transactions</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((r: ConfigImpactResult, i: number) => {
                  const cfg = STATUS_CONFIG[r.status] ?? STATUS_CONFIG.ok;
                  return (
                    <tr
                      key={`${r.feature}-${r.system}-${i}`}
                      className="border-b border-black/[0.04] last:border-0 hover:bg-white/[0.50] transition-colors"
                    >
                      <td className="px-4 py-3 font-medium text-foreground">{r.feature}</td>
                      <td className="px-4 py-3">
                        <Badge variant="outline" className="text-[10px] border-black/[0.08]">
                          {r.system}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant="outline" className={`gap-1 ${cfg.badge}`}>
                          {cfg.icon}
                          {cfg.label}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {r.total_affected_records.toLocaleString()}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {r.blocked_transactions.length > 0 ? (
                            r.blocked_transactions.slice(0, 3).map((t) => (
                              <span
                                key={t}
                                className="rounded-full bg-destructive/[0.06] px-2 py-0.5 text-[10px] font-mono text-destructive"
                              >
                                {t}
                              </span>
                            ))
                          ) : (
                            <span className="text-xs text-muted-foreground">--</span>
                          )}
                          {r.blocked_transactions.length > 3 && (
                            <span className="text-[10px] text-muted-foreground">
                              +{r.blocked_transactions.length - 3} more
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      ) : activeVersionId ? (
        <Card className="border-black/[0.08] bg-white/[0.70]">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <CheckCircle className="h-12 w-12 text-muted-foreground/20" />
            <h3 className="mt-4 font-semibold text-foreground">No impact data</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              No config impact results found for this analysis version
            </p>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
