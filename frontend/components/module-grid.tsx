"use client";

import { useState } from "react";
import { CheckCircle, XCircle, Loader2, RefreshCw, Clock } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getSystemModules, extractModules } from "@/lib/api/connectivity";
import { formatModuleName, relativeTime } from "@/lib/format";
import type { SystemModule } from "@/types/api";

const SYNC_STATUS_ICON: Record<string, React.ReactNode> = {
  completed: <CheckCircle className="h-3.5 w-3.5 text-[#16A34A]" />,
  failed: <XCircle className="h-3.5 w-3.5 text-destructive" />,
  running: <Loader2 className="h-3.5 w-3.5 text-primary animate-spin" />,
};

interface ModuleGridProps {
  systemId: string;
}

export function ModuleGrid({ systemId }: ModuleGridProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const qc = useQueryClient();

  const { data: modules, isLoading } = useQuery({
    queryKey: ["system-modules", systemId],
    queryFn: () => getSystemModules(systemId),
    enabled: Boolean(systemId),
  });

  const extractMutation = useMutation({
    mutationFn: () =>
      extractModules(systemId, Array.from(selected), true, "full"),
    onSuccess: () => {
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: ["system-modules", systemId] });
    },
  });

  const toggleModule = (mod: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(mod)) next.delete(mod);
      else next.add(mod);
      return next;
    });
  };

  const toggleAll = () => {
    if (!modules) return;
    if (selected.size === modules.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(modules.map((m) => m.module)));
    }
  };

  if (isLoading) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-xl" />
        ))}
      </div>
    );
  }

  if (!modules || modules.length === 0) {
    return (
      <Card className="border-black/[0.08] bg-white/[0.70]">
        <CardContent className="flex flex-col items-center justify-center py-12">
          <p className="text-sm text-muted-foreground">No modules available for this system</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={toggleAll}
            className="text-xs border-black/[0.08]"
          >
            {selected.size === modules.length ? "Deselect All" : "Select All"}
          </Button>
          <span className="text-xs text-muted-foreground">
            {selected.size} of {modules.length} selected
          </span>
        </div>
        <Button
          size="sm"
          disabled={selected.size === 0 || extractMutation.isPending}
          onClick={() => extractMutation.mutate()}
          className="gap-1.5 bg-primary hover:bg-primary/80 text-white"
        >
          {extractMutation.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          Sync Selected
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {modules.map((mod: SystemModule) => {
          const isSelected = selected.has(mod.module);
          return (
            <button
              key={mod.module}
              type="button"
              onClick={() => toggleModule(mod.module)}
              className={`text-left rounded-xl border p-4 transition-all ${
                isSelected
                  ? "border-primary/40 bg-primary/[0.06] ring-1 ring-primary/20"
                  : "border-black/[0.08] bg-white/[0.70] hover:bg-white/[0.85]"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-foreground">
                  {formatModuleName(mod.module)}
                </span>
                <div
                  className={`h-4 w-4 rounded border transition-colors ${
                    isSelected
                      ? "border-primary bg-primary"
                      : "border-black/[0.15] bg-white"
                  }`}
                >
                  {isSelected && (
                    <svg viewBox="0 0 16 16" fill="none" className="h-4 w-4 text-white">
                      <path d="M4 8l3 3 5-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </div>
              </div>
              <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  {mod.last_sync_status
                    ? SYNC_STATUS_ICON[mod.last_sync_status] ?? null
                    : <Clock className="h-3 w-3" />}
                  {mod.last_synced_at ? relativeTime(mod.last_synced_at) : "Never synced"}
                </span>
                {mod.row_count > 0 && (
                  <span>{mod.row_count.toLocaleString()} rows</span>
                )}
              </div>
              {mod.config_synced && (
                <Badge variant="outline" className="mt-2 text-[10px] border-primary/20 text-primary">
                  Config synced
                </Badge>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
