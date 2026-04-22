"use client";

import { useState } from "react";
import {
  Workflow,
  Loader2,
  AlertCircle,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useQuery } from "@tanstack/react-query";
import { getVersions } from "@/lib/api/versions";
import { getBusinessProcess } from "@/lib/api/connectivity";
import { ProcessReadinessTree } from "@/components/charts/process-readiness-tree";
import { formatModuleName } from "@/lib/format";
import type { Version } from "@/types/api";

const ALL_MODULES = [
  "business_partner",
  "material_master",
  "fi_gl",
  "accounts_payable",
  "accounts_receivable",
  "asset_accounting",
  "mm_purchasing",
  "plant_maintenance",
  "production_planning",
  "sd_customer_master",
  "sd_sales_orders",
  "employee_central",
];

function SkeletonTree() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="rounded-xl border border-black/[0.08] bg-white/[0.70] p-4 space-y-3">
          <Skeleton className="h-5 w-48" />
          <div className="ml-4 space-y-2">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-4 w-36" />
            <Skeleton className="h-4 w-44" />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function BusinessProcessPage() {
  const [versionId, setVersionId] = useState<string>("");
  const [module, setModule] = useState<string>(ALL_MODULES[0]);

  // Load versions
  const { data: versionData, isLoading: versionsLoading } = useQuery({
    queryKey: ["versions"],
    queryFn: () => getVersions({ limit: 20 }),
  });

  const completedVersions = (versionData?.versions ?? []).filter(
    (v: Version) => v.status === "agents_complete" || v.status === "complete"
  );

  const activeVersionId = versionId || completedVersions[0]?.id || "";

  // Load business process
  const {
    data: processes,
    isLoading: processLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ["business-process", activeVersionId, module],
    queryFn: () => getBusinessProcess(activeVersionId, module),
    enabled: Boolean(activeVersionId) && Boolean(module),
  });

  // Readiness summary counts
  const readinessCounts = { green: 0, amber: 0, red: 0 };
  if (processes) {
    for (const l1 of processes) {
      for (const l2 of l1.l2_groups) {
        for (const l3 of l2.l3_processes) {
          readinessCounts[l3.overall_readiness]++;
        }
      }
    }
  }
  const totalProcesses = readinessCounts.green + readinessCounts.amber + readinessCounts.red;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-xl font-bold text-foreground">Business Processes</h1>
          <p className="text-sm text-muted-foreground">
            View SAP business process hierarchy with data quality readiness at each level
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* Module selector */}
          <select
            value={module}
            onChange={(e) => setModule(e.target.value)}
            className="rounded-md border border-black/[0.08] bg-white/[0.70] px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          >
            {ALL_MODULES.map((m) => (
              <option key={m} value={m}>
                {formatModuleName(m)}
              </option>
            ))}
          </select>

          {/* Version selector */}
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
      </div>

      {/* Readiness summary */}
      {totalProcesses > 0 && (
        <div className="grid gap-4 sm:grid-cols-3">
          <Card className="border-[#256F3A]/10 bg-[#256F3A]/[0.04]">
            <CardContent className="flex items-center gap-3 p-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#256F3A]/10">
                <div className="h-3 w-3 rounded-full bg-[#256F3A]" />
              </div>
              <div>
                <p className="text-2xl font-bold text-[#256F3A]">{readinessCounts.green}</p>
                <p className="text-xs text-muted-foreground">Ready (Green)</p>
              </div>
            </CardContent>
          </Card>
          <Card className="border-[#E76500]/10 bg-[#E76500]/[0.04]">
            <CardContent className="flex items-center gap-3 p-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#E76500]/10">
                <div className="h-3 w-3 rounded-full bg-[#E76500]" />
              </div>
              <div>
                <p className="text-2xl font-bold text-[#E76500]">{readinessCounts.amber}</p>
                <p className="text-xs text-muted-foreground">Conditional (Amber)</p>
              </div>
            </CardContent>
          </Card>
          <Card className="border-destructive/10 bg-destructive/[0.04]">
            <CardContent className="flex items-center gap-3 p-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-destructive/10">
                <div className="h-3 w-3 rounded-full bg-destructive" />
              </div>
              <div>
                <p className="text-2xl font-bold text-destructive">{readinessCounts.red}</p>
                <p className="text-xs text-muted-foreground">Not Ready (Red)</p>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Error state */}
      {isError && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Failed to load business processes: {(error as Error).message}
          </AlertDescription>
        </Alert>
      )}

      {/* Process tree */}
      {processLoading ? (
        <SkeletonTree />
      ) : processes ? (
        <ProcessReadinessTree processes={processes} />
      ) : !activeVersionId ? (
        <Card className="border-black/[0.08] bg-white/[0.70]">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <Workflow className="h-12 w-12 text-muted-foreground/20" />
            <h3 className="mt-4 font-semibold text-foreground">No analysis available</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Run an analysis first to see business process readiness
            </p>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
