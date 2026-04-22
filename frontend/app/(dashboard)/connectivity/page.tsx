"use client";

import { useState } from "react";
import {
  Plug,
  Loader2,
  Server,
  AlertCircle,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getSystems,
  testConnection,
} from "@/lib/api/connectivity";
import { SystemCard } from "@/components/system-card";
import { AddSystemDialog } from "@/components/add-system-dialog";
import { relativeTime } from "@/lib/format";
import type { SAPSystemExtended } from "@/types/api";

function SkeletonCards() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <Card key={i} className="border-black/[0.08] bg-white/[0.70]">
          <CardContent className="p-5 space-y-3">
            <div className="flex items-center gap-3">
              <Skeleton className="h-10 w-10 rounded-lg" />
              <div className="space-y-1.5 flex-1">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-48" />
              </div>
            </div>
            <Skeleton className="h-3 w-24" />
            <div className="flex gap-2">
              <Skeleton className="h-8 w-16 rounded-md" />
              <Skeleton className="h-8 w-20 rounded-md" />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export default function ConnectivityPage() {
  const qc = useQueryClient();
  const [testingId, setTestingId] = useState<string | null>(null);

  const { data: systems, isLoading, isError, error } = useQuery({
    queryKey: ["systems"],
    queryFn: getSystems,
  });

  const testMutation = useMutation({
    mutationFn: (systemId: string) => testConnection(systemId),
    onSettled: () => setTestingId(null),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["systems"] }),
  });

  const handleTest = (systemId: string) => {
    setTestingId(systemId);
    testMutation.mutate(systemId);
  };

  // Aggregate stats
  const healthyCount = systems?.filter((s) => s.health_status === "healthy").length ?? 0;
  const degradedCount = systems?.filter((s) => s.health_status === "degraded").length ?? 0;
  const unreachableCount = systems?.filter(
    (s) => s.health_status === "unreachable" || s.health_status === "auth_failed"
  ).length ?? 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-xl font-bold text-foreground">Connectivity</h1>
          <p className="text-sm text-muted-foreground">
            Manage SAP system connections, modules, and data extraction
          </p>
        </div>
        <AddSystemDialog />
      </div>

      {/* Summary cards */}
      {systems && systems.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-3">
          <Card className="border-black/[0.08] bg-white/[0.70]">
            <CardContent className="flex items-center gap-3 p-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#256F3A]/10">
                <div className="h-3 w-3 rounded-full bg-[#256F3A]" />
              </div>
              <div>
                <p className="text-2xl font-bold text-foreground">{healthyCount}</p>
                <p className="text-xs text-muted-foreground">Healthy</p>
              </div>
            </CardContent>
          </Card>
          <Card className="border-black/[0.08] bg-white/[0.70]">
            <CardContent className="flex items-center gap-3 p-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#E76500]/10">
                <div className="h-3 w-3 rounded-full bg-[#E76500]" />
              </div>
              <div>
                <p className="text-2xl font-bold text-foreground">{degradedCount}</p>
                <p className="text-xs text-muted-foreground">Degraded</p>
              </div>
            </CardContent>
          </Card>
          <Card className="border-black/[0.08] bg-white/[0.70]">
            <CardContent className="flex items-center gap-3 p-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-destructive/10">
                <div className="h-3 w-3 rounded-full bg-destructive" />
              </div>
              <div>
                <p className="text-2xl font-bold text-foreground">{unreachableCount}</p>
                <p className="text-xs text-muted-foreground">Unreachable</p>
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
            Failed to load systems: {(error as Error).message}
          </AlertDescription>
        </Alert>
      )}

      {/* Loading state */}
      {isLoading ? (
        <SkeletonCards />
      ) : !systems || systems.length === 0 ? (
        /* Empty state */
        <Card className="border-black/[0.08] bg-white/[0.70]">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <Plug className="h-12 w-12 text-muted-foreground/20" />
            <h3 className="mt-4 font-semibold text-foreground">No systems connected</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Add your first SAP system to begin extracting and analysing data
            </p>
          </CardContent>
        </Card>
      ) : (
        /* System cards grid */
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {systems.map((sys: SAPSystemExtended) => (
            <SystemCard
              key={sys.id}
              system={sys}
              onTest={() => handleTest(sys.id)}
              isTesting={testingId === sys.id}
            />
          ))}
        </div>
      )}
    </div>
  );
}
