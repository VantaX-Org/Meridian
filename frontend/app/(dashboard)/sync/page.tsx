"use client";

import { useState } from "react";
import {
  RefreshCw,
  CheckCircle,
  XCircle,
  Loader2,
  Clock,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Activity,
  Filter,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useQuery } from "@tanstack/react-query";
import { getSystems, getSyncRuns } from "@/lib/api/systems";
import { relativeTime } from "@/lib/format";
import type { SAPSystem, SyncRun } from "@/types/api";

function QualityBadge({ score }: { score: number | null }) {
  if (score === null) return null;
  const color =
    score >= 0.8
      ? "bg-[#16A34A]/10 text-[#16A34A] border-[#16A34A]/20"
      : score >= 0.6
        ? "bg-[#EA580C]/10 text-[#EA580C] border-[#EA580C]/20"
        : "bg-destructive/10 text-destructive border-destructive/20";

  return (
    <Badge variant="outline" className={color}>
      AI Quality: {(score * 100).toFixed(0)}%
    </Badge>
  );
}

const STATUS_CONFIG: Record<string, { icon: React.ReactNode; label: string; color: string }> = {
  completed: {
    icon: <CheckCircle className="h-4 w-4" />,
    label: "Completed",
    color: "text-[#16A34A]",
  },
  failed: {
    icon: <XCircle className="h-4 w-4" />,
    label: "Failed",
    color: "text-destructive",
  },
  running: {
    icon: <Loader2 className="h-4 w-4 animate-spin" />,
    label: "Running",
    color: "text-primary",
  },
};

function SyncRunRow({ run }: { run: SyncRun }) {
  const [expanded, setExpanded] = useState(false);
  const config = STATUS_CONFIG[run.status] ?? STATUS_CONFIG.running;

  return (
    <div className="border-b border-black/[0.06] last:border-0">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-black/[0.03] transition-colors"
      >
        {expanded ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
        )}

        <span className={`flex items-center gap-1.5 ${config.color}`}>
          {config.icon}
          <span className="text-sm font-medium">{config.label}</span>
        </span>

        <span className="text-xs text-muted-foreground">
          {relativeTime(run.started_at)}
        </span>

        <span className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
          <span>{run.rows_extracted.toLocaleString()} rows</span>
          <QualityBadge score={run.ai_quality_score} />
        </span>
      </button>

      {expanded && (
        <div className="bg-white/[0.60] px-4 py-3 pl-11 space-y-2">
          <div className="grid grid-cols-3 gap-4 text-xs">
            <div>
              <span className="text-muted-foreground">Rows extracted</span>
              <p className="font-mono font-medium text-foreground">
                {run.rows_extracted.toLocaleString()}
              </p>
            </div>
            <div>
              <span className="text-muted-foreground">Findings delta</span>
              <p className="font-mono font-medium text-foreground">{run.findings_delta}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Duration</span>
              <p className="font-mono font-medium text-foreground">
                {run.completed_at
                  ? `${Math.round(
                      (new Date(run.completed_at).getTime() -
                        new Date(run.started_at).getTime()) /
                        1000
                    )}s`
                  : "—"}
              </p>
            </div>
          </div>

          {run.error_detail && (
            <div className="rounded-md bg-destructive/5 px-3 py-2 text-xs text-destructive">
              {run.error_detail}
            </div>
          )}

          {run.anomaly_flags && run.anomaly_flags.length > 0 && (
            <div className="space-y-1">
              <span className="text-xs font-medium text-muted-foreground">Anomaly Flags</span>
              {run.anomaly_flags.map((flag, i) => (
                <div
                  key={i}
                  className="flex items-start gap-2 rounded-md bg-white/[0.70] px-3 py-1.5 text-xs"
                >
                  <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0 text-[#EA580C]" />
                  <div>
                    <span className="font-medium text-foreground">{flag.type}</span>
                    <span className="text-muted-foreground"> — {flag.detail}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function SyncMonitorPage() {
  const [filterSystem, setFilterSystem] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");

  const { data: systems } = useQuery({
    queryKey: ["systems"],
    queryFn: getSystems,
  });

  // Fetch runs for all systems
  const systemIds = systems?.map((s: SAPSystem) => s.id) ?? [];
  const runsQueries = useQuery({
    queryKey: ["all-sync-runs", systemIds],
    queryFn: async () => {
      if (systemIds.length === 0) return [];
      const allRuns = await Promise.all(
        systemIds.map(async (id: string) => {
          const runs = await getSyncRuns(id, 50);
          const sys = systems?.find((s: SAPSystem) => s.id === id);
          return runs.map((r: SyncRun) => ({ ...r, system_name: sys?.name ?? "Unknown", system_id: id }));
        })
      );
      return allRuns
        .flat()
        .sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime());
    },
    enabled: systemIds.length > 0,
  });

  const allRuns = runsQueries.data ?? [];
  const filteredRuns = allRuns.filter((r: SyncRun & { system_id: string }) => {
    if (filterSystem !== "all" && r.system_id !== filterSystem) return false;
    if (filterStatus !== "all" && r.status !== filterStatus) return false;
    return true;
  });

  const stats = {
    total: allRuns.length,
    completed: allRuns.filter((r: SyncRun) => r.status === "completed").length,
    failed: allRuns.filter((r: SyncRun) => r.status === "failed").length,
    running: allRuns.filter((r: SyncRun) => r.status === "running").length,
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-xl font-bold text-foreground">Sync Monitor</h1>
        <p className="text-sm text-muted-foreground">
          Timeline of all sync runs across all SAP systems
        </p>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: "Total Runs", value: stats.total, icon: Activity, color: "#00D4AA" },
          { label: "Completed", value: stats.completed, icon: CheckCircle, color: "#16A34A" },
          { label: "Failed", value: stats.failed, icon: XCircle, color: "#DC2626" },
          { label: "Running", value: stats.running, icon: Loader2, color: "#EA580C" },
        ].map(({ label, value, icon: Icon, color }) => (
          <Card key={label} className="border-black/[0.08] bg-white/[0.70]">
            <CardContent className="flex items-center gap-3 p-4">
              <Icon className="h-5 w-5" style={{ color }} />
              <div>
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="text-lg font-bold text-foreground">{value}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <div className="flex gap-3">
        <select
          value={filterSystem}
          onChange={(e) => setFilterSystem(e.target.value)}
          className="rounded-md border border-black/[0.08] bg-white/[0.70] px-3 py-1.5 text-sm text-foreground focus:border-primary focus:outline-none"
        >
          <option value="all">All Systems</option>
          {systems?.map((s: SAPSystem) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="rounded-md border border-black/[0.08] bg-white/[0.70] px-3 py-1.5 text-sm text-foreground focus:border-primary focus:outline-none"
        >
          <option value="all">All Status</option>
          <option value="completed">Completed</option>
          <option value="failed">Failed</option>
          <option value="running">Running</option>
        </select>
      </div>

      {/* Timeline */}
      <Card className="border-black/[0.08] bg-white/[0.70]">
        <CardContent className="p-0">
          {runsQueries.isLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : filteredRuns.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16">
              <Clock className="h-12 w-12 text-white/[0.08]" />
              <h3 className="mt-4 font-semibold text-foreground">No sync runs yet</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Sync runs will appear here once your first sync completes
              </p>
            </div>
          ) : (
            filteredRuns.map((run: SyncRun & { system_name: string }) => (
              <div key={run.id}>
                <div className="flex items-center gap-2 border-b border-black/[0.06] bg-white/[0.60] px-4 py-1.5">
                  <span className="text-xs font-medium text-foreground">
                    {run.system_name}
                  </span>
                </div>
                <SyncRunRow run={run} />
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
