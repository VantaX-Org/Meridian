"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import { Button, DataTable, ExplorerPage, Pill, Skeleton, Stat, type PillTone } from "@/design";
import { HEALTH_LABEL, latestDqs } from "./_health";
import { useUrlState } from "@/hooks/use-url-state";
import { getSystems, testConnection } from "@/lib/api/connectivity";
import { getSystemVersions } from "@/lib/api/system-objects";
import { getConfigLandscape, type SystemConfigState } from "@/lib/api/config-load";
import { apiErrorMessage } from "@/lib/error";
import { relativeTime } from "@/lib/format";
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
/** Second line under the Configuration badge: status detail, progress while loading, or the cause of a failure. */
function configSub(c: {
  status: SystemConfigState; loaded_at: string | null; areas_loaded: number; areas_total: number;
  current_area: string | null; error: string | null;
}): string {
  switch (c.status) {
    case "loading":
      return c.current_area ? `Reading ${c.current_area}…` : c.areas_total ? `${c.areas_loaded} of ${c.areas_total} areas` : "Reading…";
    case "not_loaded":
      return "Rules apply by default";
    case "failed":
      return c.error ? (c.error.split(/\.\s|\.$/)[0] + ".") : "Load failed";
    case "not_available":
      return "No configuration to read";
    case "loaded":
    case "with_gaps":
      return c.loaded_at ? `${relativeTime(c.loaded_at)} · ${c.areas_loaded} of ${c.areas_total} areas` : "—";
    default:
      return "—";
  }
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
  const configQ = useQuery({
    queryKey: queryKeys.configLandscape(),
    queryFn: getConfigLandscape,
    retry: false,
    meta: { ignoreError: true },
    refetchInterval: (q) => ((q.state.data?.counts.loading ?? 0) > 0 ? 2000 : false),
  });
  const configById = new Map(configQ.data?.systems.map((c) => [c.system_id, c]) ?? []);
  const [configFilter, setConfigFilter] = useUrlState("config", "");
  const shown = configFilter ? systems.filter((s) => configById.get(s.id)?.status === configFilter) : systems;

  const cfgTotal = configQ.data?.total ?? 0;
  const cfgLoaded = configQ.data?.loaded ?? 0;
  const cfgCounts = configQ.data?.counts ?? {};
  const cfgNotLoaded = cfgTotal - cfgLoaded;
  const cfgVerdict = (cfgCounts.failed ?? 0) > 0
    ? `${cfgCounts.failed} failed`
    : (cfgCounts.loading ?? 0) > 0
      ? `${cfgCounts.loading} loading`
      : cfgNotLoaded > 0
        ? `${cfgNotLoaded} not loaded`
        : "All loaded";
  const cfgVerdictTone: PillTone = (cfgCounts.failed ?? 0) > 0 ? "no-go" : (cfgCounts.loading ?? 0) > 0 ? "neutral" : cfgNotLoaded > 0 ? "at-risk" : "go";
  const cfgHref = (cfgCounts.failed ?? 0) > 0 ? "?config=failed" : (cfgCounts.loading ?? 0) > 0 ? "?config=loading" : cfgNotLoaded > 0 ? "?config=not_loaded" : undefined;

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
        if (configQ.isLoading) return <Skeleton height={16} width={96} />;
        const c = configById.get(row.original.id);
        if (!c) return "No configuration yet";
        return (
          <Link href={`/systems/${row.original.id}?tab=health&part=config`} className="flex flex-col" onClick={(e) => e.stopPropagation()}>
            <Pill tone={CONFIG_TONE[c.status]}>{CONFIG_LABEL[c.status]}</Pill>
            <span className="text-[12px]" style={{ color: "var(--m-ink-2)" }}>{configSub(c)}</span>
          </Link>
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
      filterBar={
        configFilter ? (
          <div className="flex items-center gap-2 text-[13px]">
            <span style={{ color: "var(--m-ink-2)" }}>Showing systems with configuration {CONFIG_LABEL[configFilter as SystemConfigState] ?? configFilter}.</span>
            <Button variant="secondary" onClick={() => setConfigFilter("")}>Show all systems</Button>
          </div>
        ) : undefined
      }
      summary={
        configQ.data ? (
          <div className="flex gap-6">
            <Stat
              label="Configuration loaded"
              value={
                cfgHref ? (
                  <Link href={cfgHref} className="underline">{`${cfgLoaded} of ${cfgTotal}`}</Link>
                ) : (
                  `${cfgLoaded} of ${cfgTotal}`
                )
              }
              delta={<Pill tone={cfgVerdictTone}>{cfgVerdict}</Pill>}
            />
          </div>
        ) : undefined
      }
      table={
        <DataTable
          columns={columns}
          data={shown}
          getRowId={(r) => r.id}
          onRowClick={(r) => router.push(`/systems/${r.id}`)}
        />
      }
      state={state}
      emptyProps={{
        title: "No systems connected.",
        detail: "Connect a SAP system, or import a file if you have an export.",
        ghost: "table",
      }}
      errorProps={{ message: apiErrorMessage(error), onRetry: () => refetch() }}
    />
  );
}
