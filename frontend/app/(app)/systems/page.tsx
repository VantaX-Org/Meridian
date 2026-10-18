"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQueries, useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { DrillLink, Button, Delta, DataTable, ExplorerPage, ExportMenu, Mono, PageHeader, Pill, Skeleton, Sparkline, Stat, emptyExportOptions, type PillTone } from "@/design";
import { HEALTH_LABEL, dqsSeries, dqsTrend, latestDqs, nextRun } from "./_health";
import { useUrlState } from "@/hooks/use-url-state";
import { usePermissions, useSystemScope } from "@/lib/permissions";
import { ConnectSystemDialog } from "@/components/systems/connect-system-dialog";
import { getSystems } from "@/lib/api/connectivity";
import { getSystemVersions } from "@/lib/api/system-objects";
import { getSyncProfiles } from "@/lib/api/systems";
import { getConfigLandscape, type SystemConfigState } from "@/lib/api/config-load";
import { exportRuns } from "@/lib/api/versions";
import { apiErrorMessage, isListFailure } from "@/lib/error";
import { formatDate, relativeTime } from "@/lib/format";
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
      return c.loaded_at ? `${relativeTime(c.loaded_at)}, ${c.areas_loaded} of ${c.areas_total} areas` : "—";
    default:
      return "—";
  }
}

export default function SystemsPage() {
  const router = useRouter();
  const systemScope = useSystemScope();
  const { data, isLoading, isError, error, refetch } = useQuery({ queryKey: queryKeys.systems(), queryFn: getSystems, select: systemScope });
  const systems = data ?? [];
  const versionsQ = useQueries({
    queries: systems.map((s) => ({ queryKey: queryKeys.systemVersions(s.id), queryFn: () => getSystemVersions(s.id) })),
  });
  const dqsById = new Map(
    systems.map((s, i) => {
      const vs = versionsQ[i]?.data?.versions;
      return [s.id, vs ? { dqs: latestDqs(vs).dqs, trend: dqsTrend(vs), series: dqsSeries(vs) } : null];
    }),
  );
  const profilesQ = useQueries({
    queries: systems.map((s) => ({ queryKey: queryKeys.syncProfiles(s.id), queryFn: () => getSyncProfiles(s.id) })),
  });
  const nextRunById = new Map(
    systems.map((s, i) => {
      const p = profilesQ[i]?.data;
      return [s.id, p ? nextRun(p) : null];
    }),
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
  const [rawHealth, setHealthFilter] = useUrlState("health", "");
  const healthFilter = rawHealth === "unhealthy" || Object.hasOwn(HEALTH_LABEL, rawHealth) ? rawHealth : "";
  const isUnhealthy = (h: HealthStatus) => h === "degraded" || h === "unreachable" || h === "auth_failed";
  const shown = systems
    .filter((s) => !configFilter || configById.get(s.id)?.status === configFilter)
    .filter((s) => !healthFilter || (healthFilter === "unhealthy" ? isUnhealthy(s.health_status) : s.health_status === healthFilter));

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

  const columns: ColumnDef<SAPSystemExtended>[] = [
    { accessorKey: "name", header: "System", size: 240, cell: ({ row }) => (<span className="inline-flex items-baseline gap-2">{row.original.name}<Mono>{row.original.client ? `${row.original.environment}/${row.original.client}` : row.original.environment}</Mono></span>) },
    { accessorKey: "system_type", header: "Type", size: 100 },
    { accessorKey: "role", header: "Role", size: 90, cell: ({ row }) => <Pill tone="neutral">{row.original.role === "target" ? "Target" : "Source"}</Pill> },
    {
      accessorKey: "health_status",
      header: "Health",
      size: 170,
      cell: ({ row }) => (
        <span className="inline-flex flex-wrap items-center gap-x-2">
          <Pill tone={HEALTH_TONE[row.original.health_status]}>{HEALTH_LABEL[row.original.health_status]}</Pill>
          {row.original.last_health_check ? (
            <span className="m-text-meta m-ink-3">checked {relativeTime(row.original.last_health_check)}</span>
          ) : null}
        </span>
      ),
    },
    {
      id: "dqs",
      header: "Latest DQS",
      size: 150,
      cell: ({ row }) => {
        const d = dqsById.get(row.original.id);
        if (!d || d.dqs == null) return "—";
        const t = d.trend;
        return (
          <span className="inline-flex items-center gap-1">
            <DrillLink href={`/systems/${row.original.id}?tab=overview`}>{d.dqs.toFixed(1)}</DrillLink>
            {t != null && Math.abs(t) >= 0.05 ? <Delta value={t} run="the previous run" /> : null}
            {d.series.length >= 2 ? <Sparkline data={d.series.map((y, x) => ({ x, y }))} /> : null}
          </span>
        );
      },
    },
    {
      id: "next_run",
      header: "Next run",
      size: 160,
      cell: ({ row }) => {
        const n = nextRunById.get(row.original.id);
        return n ? formatDate(n, "datetime", "SAST") : "Manual only";
      },
    },
    {
      id: "config",
      header: "Configuration",
      size: 200,
      cell: ({ row }) => {
        if (configQ.isLoading) return <Skeleton height={16} width={96} />;
        const c = configById.get(row.original.id);
        if (!c) return "No configuration yet";
        return (
          <Link href={`/systems/${row.original.id}?tab=health&part=config`} className="flex flex-col" onClick={(e) => e.stopPropagation()}>
            <Pill tone={CONFIG_TONE[c.status]}>{CONFIG_LABEL[c.status]}</Pill>
            <span className="m-text-meta m-ink-2">{configSub(c)}</span>
          </Link>
        );
      },
    },
    {
      id: "last_sync",
      header: "Last extracted",
      size: 130,
      cell: ({ row }) => (row.original.last_sync_at ? relativeTime(row.original.last_sync_at) : "Never"),
    },
  ];

  let state: "loading" | "empty" | "error" | undefined;
  if (isLoading) state = "loading";
  else if (isListFailure({ isError, error })) state = "error";
  else if (systems.length === 0) state = "empty";

  const exportOptions = [{ format: "xlsx" as const, label: "Runs (.xlsx)", run: () => exportRuns("xlsx") }];

  const active = systems.filter((s) => s.is_active !== false);
  const unhealthy = active.filter((s) => isUnhealthy(s.health_status)).length;
  const attention = systems.filter((s) => s.health_status !== "healthy").length;
  const lastExtraction = systems.flatMap((s) => (s.last_sync_at ? [s.last_sync_at] : [])).sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? null;
  const filtering = Boolean(configFilter || healthFilter);
  const canConnect = usePermissions().has("systems", "create");
  const [connecting, setConnecting] = useState(false);

  return (
    <>
    <ExplorerPage
      header={
        <PageHeader
          title="Systems"
          actions={canConnect ? <Button onClick={() => setConnecting(true)}>Connect system</Button> : undefined}
          meta={isLoading ? "\u00a0" : `${systems.length} ${systems.length === 1 ? "system" : "systems"}${attention ? `, ${attention} need attention` : ""}`}
        />
      }
      filterBar={
        filtering ? (
          <div className="flex items-center gap-2 m-text-body">
            <Pill tone="neutral">{healthFilter ? (healthFilter === "unhealthy" ? "Unhealthy" : HEALTH_LABEL[healthFilter as HealthStatus]) : `Configuration ${(CONFIG_LABEL[configFilter as SystemConfigState] ?? configFilter).toLowerCase()}`}</Pill>
            <Button variant="ghost" onClick={() => { setConfigFilter(""); setHealthFilter(""); }}>Clear filter</Button>
          </div>
        ) : undefined
      }
      toolbarEnd={<ExportMenu options={systems.length === 0 ? emptyExportOptions(exportOptions) : exportOptions} />}
      summary={
        <div className="m-stat-grid m-motion-stagger">
          {isLoading || systems.length > 0 ? (
            <Stat label="Systems" loading={isLoading} value={isLoading ? "" : systems.length} />
          ) : null}
          {isLoading || systems.length > 0 ? (
            <Stat
              label="Unhealthy"
              loading={isLoading}
              value={isLoading ? "" : `${unhealthy} of ${active.length}`}
              tone={isLoading ? undefined : unhealthy === 0 ? "go" : active.some((s) => s.health_status !== "healthy" && s.health_status !== "degraded" && s.health_status !== "unknown") ? "no-go" : "at-risk"}
              href="?health=unhealthy"
            />
          ) : null}
          {configQ.data || configQ.isLoading ? (
            <Stat
              label="Configuration missing"
              loading={configQ.isLoading}
              value={cfgNotLoaded}
              tone={configQ.isLoading ? undefined : cfgNotLoaded > 0 ? "at-risk" : "go"}
              href="?config=not_loaded"
            />
          ) : null}
          {configQ.data || configQ.isLoading ? (
            <Stat
              label="Configuration loaded"
              loading={configQ.isLoading}
              value={`${cfgLoaded} of ${cfgTotal}`}
              tone={configQ.isLoading || cfgVerdictTone === "neutral" ? undefined : cfgVerdictTone}
              delta={<Pill tone={cfgVerdictTone}>{cfgVerdict}</Pill>}
              onClick={cfgHref ? () => { setHealthFilter(""); setConfigFilter(cfgHref.slice("?config=".length)); } : undefined}
            />
          ) : null}
          {!isLoading && lastExtraction ? <Stat label="Last extraction" value={relativeTime(lastExtraction)} /> : null}
        </div>
      }
      table={
        <DataTable
          columns={columns}
          data={shown}
          getRowId={(r) => r.id}
          dataTour="systems-list"
          onRowClick={(r) => router.push(`/systems/${r.id}`)}
          rowHref={(r) => `/systems/${r.id}`}
        />
      }
      state={state}
      emptyProps={{
        title: "No systems yet",
        detail: "Connect an SAP system or import a file.",
        action: <Button render={<Link href="/import">Import file</Link>} />,
        ghost: "table",
      }}
      errorProps={{ message: apiErrorMessage(error), onRetry: () => refetch() }}
    />
    <ConnectSystemDialog open={connecting} onOpenChange={setConnecting} />
    </>
  );
}
