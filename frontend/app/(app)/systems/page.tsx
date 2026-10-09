"use client";

import { useRouter } from "next/navigation";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { Button, DataTable, ExplorerPage, Pill, Stat, type PillTone } from "@/design";
import { HEALTH_LABEL, latestDqs } from "./_health";
import { getSystems, testConnection } from "@/lib/api/connectivity";
import { getSystemVersions } from "@/lib/api/system-objects";
import { getConfigLandscape, type SystemConfigState } from "@/lib/api/config-load";
import { formatDate } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";
import type { HealthStatus, SAPSystemExtended } from "@/types/api";

const HEALTH_TONE: Record<HealthStatus, PillTone> = {
  healthy: "go",
  degraded: "at-risk",
  unreachable: "no-go",
  auth_failed: "no-go",
  unknown: "neutral",
};

const CONFIG_TONE: Record<SystemConfigState, PillTone> = {
  loaded: "go",
  with_gaps: "at-risk",
  loading: "neutral",
  not_loaded: "neutral",
  failed: "no-go",
  not_available: "neutral",
};
const CONFIG_LABEL: Record<SystemConfigState, string> = {
  loaded: "Loaded",
  with_gaps: "Loaded with gaps",
  loading: "Loading",
  not_loaded: "Not loaded",
  failed: "Failed",
  not_available: "Not available",
};
/** Second line under the Configuration badge: when it was loaded, or progress while loading. */
function configSub(status: SystemConfigState, loadedAt: string | null, areasLoaded: number, areasTotal: number): string {
  if (status === "loading") return areasTotal ? `${areasLoaded} of ${areasTotal} areas` : "Reading…";
  if (loadedAt) return formatDate(loadedAt, "date");
  return "—";
}

export default function SystemsPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const { data, isLoading, isError, error, refetch } = useQuery({ queryKey: queryKeys.systems(), queryFn: getSystems });
  const systems = data ?? [];
  const versionsQ = useQueries({
    queries: systems.map((s) => ({ queryKey: queryKeys.systemVersions(s.id), queryFn: () => getSystemVersions(s.id) })),
  });
  const dqsById = new Map(
    systems.map((s, i) => [s.id, versionsQ[i]?.data ? latestDqs(versionsQ[i]!.data!.versions).dqs : null]),
  );
  const configQ = useQuery({ queryKey: queryKeys.configLandscape(), queryFn: getConfigLandscape });
  const configById = new Map(configQ.data?.systems.map((c) => [c.system_id, c]) ?? []);

  const test = useMutation({
    mutationFn: (systemId: string) => testConnection(systemId),
    onSuccess: (res) => toast(res.status === "ok" || res.status === "healthy" ? "Connection OK" : res.message),
    onError: () => toast.error("Connection test failed"),
    onSettled: () => qc.invalidateQueries({ queryKey: queryKeys.systems() }),
  });

  const columns: ColumnDef<SAPSystemExtended>[] = [
    { accessorKey: "name", header: "System" },
    { accessorKey: "system_type", header: "Type" },
    {
      accessorKey: "health_status",
      header: "Health",
      cell: ({ row }) => (
        <Pill tone={HEALTH_TONE[row.original.health_status]}>{HEALTH_LABEL[row.original.health_status]}</Pill>
      ),
    },
    {
      id: "dqs",
      header: "Latest DQS",
      cell: ({ row }) => {
        const dqs = dqsById.get(row.original.id);
        return dqs == null ? "—" : dqs.toFixed(1);
      },
    },
    {
      id: "config",
      header: "Configuration",
      cell: ({ row }) => {
        const c = configById.get(row.original.id);
        if (!c) return "—";
        return (
          <div className="flex flex-col">
            <Pill tone={CONFIG_TONE[c.status]}>{CONFIG_LABEL[c.status]}</Pill>
            <span className="text-[12px]" style={{ color: "var(--m-ink-2)" }}>
              {configSub(c.status, c.loaded_at, c.areas_loaded, c.areas_total)}
            </span>
          </div>
        );
      },
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => (
        <Button
          variant="secondary"
          disabled={test.isPending}
          onClick={(e) => {
            e.stopPropagation();
            test.mutate(row.original.id);
          }}
        >
          Test
        </Button>
      ),
    },
  ];

  let state: "loading" | "empty" | "error" | undefined;
  if (isLoading) state = "loading";
  else if (isError) state = "error";
  else if (systems.length === 0) state = "empty";

  return (
    <ExplorerPage
      summary={
        configQ.data ? (
          <div className="flex gap-6">
            <Stat label="Configuration loaded" value={`${configQ.data.loaded} of ${configQ.data.total}`} />
          </div>
        ) : undefined
      }
      table={
        <DataTable
          columns={columns}
          data={systems}
          getRowId={(r) => r.id}
          onRowClick={(r) => router.push(`/systems/${r.id}`)}
        />
      }
      state={state}
      emptyProps={{ title: "No systems connected. Connect a SAP system to start extracting data." }}
      errorProps={{ message: `Couldn't load systems. ${error?.message ?? ""}`.trim(), onRetry: () => refetch() }}
    />
  );
}
