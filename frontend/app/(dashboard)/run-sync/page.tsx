"use client";

import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Play,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Loader2,
  AlertCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { getModuleStatuses, triggerModules } from "@/lib/api/sync-trigger";
import type { ModuleStatus } from "@/lib/api/sync-trigger";
import { useLicence } from "@/hooks/use-licence";
import { toast } from "sonner";

const CATEGORY_ORDER = ["ECC", "SuccessFactors", "Warehouse"];

function statusBadge(status: ModuleStatus["status"]) {
  switch (status) {
    case "running":
      return (
        <Badge className="gap-1 bg-primary/10 text-primary border-primary/20">
          <Loader2 className="h-3 w-3 animate-spin" />
          Running
        </Badge>
      );
    case "completed":
      return (
        <Badge className="gap-1 bg-[#E8F5EE] text-[#0D5639] border-[#8ECDB0]">
          <CheckCircle2 className="h-3 w-3" />
          Completed
        </Badge>
      );
    case "failed":
      return (
        <Badge variant="destructive" className="gap-1">
          <XCircle className="h-3 w-3" />
          Failed
        </Badge>
      );
    default:
      return (
        <Badge variant="outline" className="gap-1 text-muted-foreground">
          <AlertCircle className="h-3 w-3" />
          Idle
        </Badge>
      );
  }
}

export default function RunSyncPage() {
  const { isFeatureEnabled } = useLicence();
  const runSyncEnabled = isFeatureEnabled("run_sync");
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);

  const { data: modules, isLoading } = useQuery({
    queryKey: ["sync-trigger-modules"],
    queryFn: getModuleStatuses,
    refetchInterval: 8_000,
  });

  const trigger = useMutation({
    mutationFn: (ids: string[]) => triggerModules(ids),
    onSuccess: (data) => {
      if (data.queued.length > 0) {
        toast.success(`Queued ${data.queued.length} module${data.queued.length > 1 ? "s" : ""} for re-analysis`);
      }
      if (data.skipped.length > 0) {
        toast.warning(`${data.skipped.length} module${data.skipped.length > 1 ? "s" : ""} skipped — no prior data found`);
      }
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: ["sync-trigger-modules"] });
    },
    onError: () => toast.error("Failed to queue modules — please try again"),
  });

  const grouped = (modules ?? []).reduce<Record<string, ModuleStatus[]>>(
    (acc, m) => {
      (acc[m.category] ??= []).push(m);
      return acc;
    },
    {}
  );

  const allIds = modules?.map((m) => m.module_id) ?? [];
  const allSelected = allIds.length > 0 && allIds.every((id) => selected.has(id));

  const toggleAll = useCallback(() => {
    setSelected(allSelected ? new Set() : new Set(allIds));
  }, [allSelected, allIds]);

  const toggleModule = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleRunSelected = () => {
    if (selected.size === 0) return;
    setConfirmOpen(true);
  };

  const confirmRun = () => {
    setConfirmOpen(false);
    trigger.mutate([...selected]);
  };

  return (
    <div className="space-y-6 animate-[vx-fade-in_0.35s_ease-out_both]">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Run Sync</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Select modules to re-run analysis against the most recent uploaded data.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {!runSyncEnabled && (
            <span className="text-xs text-muted-foreground rounded-lg border border-black/[0.08] px-3 py-1.5">
              Not included in your current licence
            </span>
          )}
          {runSyncEnabled && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={toggleAll}
                disabled={isLoading}
              >
                {allSelected ? "Deselect All" : "Select All"}
              </Button>
              <Button
                size="sm"
                onClick={handleRunSelected}
                disabled={selected.size === 0 || trigger.isPending}
                className="gap-1.5 bg-primary hover:bg-primary/90 text-primary-foreground"
              >
                {trigger.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Play className="h-4 w-4" />
                )}
                Run Selected ({selected.size})
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Module groups */}
      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 9 }).map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-2xl" />
          ))}
        </div>
      ) : (
        CATEGORY_ORDER.map((category) => {
          const items = grouped[category] ?? [];
          if (items.length === 0) return null;
          return (
            <div key={category}>
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                {category}
              </h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {items.map((mod) => {
                  const isSelected = selected.has(mod.module_id);
                  return (
                    <button
                      key={mod.module_id}
                      type="button"
                      onClick={() => runSyncEnabled && toggleModule(mod.module_id)}
                      disabled={!runSyncEnabled}
                      className={`vx-card vx-glass-shimmer text-left transition-all ${
                        isSelected
                          ? "border-primary/40 bg-primary/[0.06] shadow-[0_0_12px_rgba(13,86,57,0.12)]"
                          : "hover:border-black/[0.12]"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <div
                            className={`mt-0.5 h-4 w-4 shrink-0 rounded border transition-colors ${
                              isSelected
                                ? "bg-primary border-primary"
                                : "border-black/20 bg-white"
                            }`}
                          >
                            {isSelected && (
                              <svg viewBox="0 0 16 16" fill="none" className="text-white">
                                <path
                                  d="M3 8l3.5 3.5L13 5"
                                  stroke="currentColor"
                                  strokeWidth="2"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                />
                              </svg>
                            )}
                          </div>
                          <span className="truncate text-sm font-medium text-foreground">
                            {mod.label}
                          </span>
                        </div>
                        {statusBadge(mod.status)}
                      </div>
                      {mod.last_run_at && (
                        <p className="mt-2 text-xs text-muted-foreground">
                          Last run:{" "}
                          {new Date(mod.last_run_at).toLocaleString(undefined, {
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </p>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })
      )}

      {/* Confirmation dialog */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="vx-glass-elevated rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <RefreshCw className="h-5 w-5 text-primary" />
              Confirm Re-Analysis
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This will re-run analysis for{" "}
            <span className="font-semibold text-foreground">{selected.size} selected module{selected.size > 1 ? "s" : ""}</span>.
            Existing findings will be refreshed with updated results.
          </p>
          <div className="flex justify-end gap-2 mt-2">
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={confirmRun}
              className="bg-primary hover:bg-primary/90 text-primary-foreground"
            >
              Run Analysis
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
