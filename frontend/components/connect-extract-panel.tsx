"use client";

import { useState } from "react";
import { Play, Loader2, CheckCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getSystems, getSystemModules, extractModules } from "@/lib/api/connectivity";
import { formatModuleName } from "@/lib/format";
import type { SAPSystemExtended, SystemModule } from "@/types/api";

export function ConnectExtractPanel() {
  const [selectedSystem, setSelectedSystem] = useState<string>("");
  const [selectedModules, setSelectedModules] = useState<Set<string>>(new Set());
  const [includeConfig, setIncludeConfig] = useState(true);
  const [syncType, setSyncType] = useState<"full" | "delta">("full");
  const qc = useQueryClient();

  const { data: systems, isLoading: systemsLoading } = useQuery({
    queryKey: ["systems"],
    queryFn: getSystems,
  });

  const { data: modules, isLoading: modulesLoading } = useQuery({
    queryKey: ["system-modules", selectedSystem],
    queryFn: () => getSystemModules(selectedSystem),
    enabled: Boolean(selectedSystem),
  });

  const extractMutation = useMutation({
    mutationFn: () =>
      extractModules(selectedSystem, Array.from(selectedModules), includeConfig, syncType),
    onSuccess: () => {
      setSelectedModules(new Set());
      qc.invalidateQueries({ queryKey: ["system-modules", selectedSystem] });
    },
  });

  const toggleModule = (mod: string) => {
    setSelectedModules((prev) => {
      const next = new Set(prev);
      if (next.has(mod)) next.delete(mod);
      else next.add(mod);
      return next;
    });
  };

  return (
    <Card className="border-black/[0.08] bg-white/[0.70]">
      <CardContent className="p-5 space-y-4">
        <h3 className="font-display text-sm font-semibold text-foreground">Quick Extract</h3>

        {/* System selector */}
        <label className="block">
          <span className="text-xs font-medium text-muted-foreground">System</span>
          <select
            value={selectedSystem}
            onChange={(e) => {
              setSelectedSystem(e.target.value);
              setSelectedModules(new Set());
            }}
            disabled={systemsLoading}
            className="mt-1 block w-full rounded-md border border-black/[0.08] bg-white/[0.70] px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          >
            <option value="">Select a system...</option>
            {systems?.map((sys: SAPSystemExtended) => (
              <option key={sys.id} value={sys.id}>
                {sys.name} ({sys.environment})
              </option>
            ))}
          </select>
        </label>

        {/* Module checkboxes */}
        {selectedSystem && (
          <div>
            <span className="text-xs font-medium text-muted-foreground">Modules</span>
            {modulesLoading ? (
              <div className="mt-2 space-y-2">
                <Skeleton className="h-6 w-full" />
                <Skeleton className="h-6 w-full" />
                <Skeleton className="h-6 w-3/4" />
              </div>
            ) : modules && modules.length > 0 ? (
              <div className="mt-2 grid grid-cols-2 gap-1.5">
                {modules.map((mod: SystemModule) => (
                  <label
                    key={mod.module}
                    className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-white/[0.50] cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={selectedModules.has(mod.module)}
                      onChange={() => toggleModule(mod.module)}
                      className="rounded border-black/[0.15] text-primary focus:ring-primary"
                    />
                    <span className="text-foreground">{formatModuleName(mod.module)}</span>
                  </label>
                ))}
              </div>
            ) : (
              <p className="mt-2 text-xs text-muted-foreground">No modules available</p>
            )}
          </div>
        )}

        {/* Options */}
        {selectedSystem && (
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={includeConfig}
                onChange={(e) => setIncludeConfig(e.target.checked)}
                className="rounded border-black/[0.15] text-primary focus:ring-primary"
              />
              <span className="text-foreground">Include config</span>
            </label>
            <select
              value={syncType}
              onChange={(e) => setSyncType(e.target.value as "full" | "delta")}
              className="rounded-md border border-black/[0.08] bg-white/[0.70] px-2 py-1 text-xs text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="full">Full sync</option>
              <option value="delta">Delta only</option>
            </select>
          </div>
        )}

        {/* Extract button */}
        <Button
          disabled={selectedModules.size === 0 || extractMutation.isPending}
          onClick={() => extractMutation.mutate()}
          className="w-full gap-2 bg-primary hover:bg-primary/80 text-white"
        >
          {extractMutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Play className="h-4 w-4" />
          )}
          Extract & Analyse
        </Button>

        {extractMutation.isSuccess && (
          <Alert>
            <CheckCircle className="h-4 w-4 text-[#256F3A]" />
            <AlertDescription className="text-xs">
              Extraction job started. Check Sync Monitor for progress.
            </AlertDescription>
          </Alert>
        )}

        {extractMutation.isError && (
          <Alert variant="destructive">
            <AlertDescription className="text-xs">
              {(extractMutation.error as Error).message}
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
