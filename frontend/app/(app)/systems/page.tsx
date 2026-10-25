"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQueries, useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { DrillLink, Button, Delta, DataTable, ExplorerPage, ExportMenu, Mono, PageHeader, Pill, Score, Skeleton, Stat, Status, emptyExportOptions } from "@/design";
import { HEALTH_LABEL, HEALTH_VERDICT, dqsTrend, latestDqs, nextRun } from "./_health";
import { usePreferences } from "@/hooks/use-preferences";
import { useUrlState } from "@/hooks/use-url-state";
import { usePermissions, useSystemScope } from "@/lib/permissions";
import { ConnectSystemDialog } from "@/components/systems/connect-system-dialog";
import { getSystemModules, getSystems } from "@/lib/api/connectivity";
import { getSystemVersions } from "@/lib/api/system-objects";
import { getSyncProfiles } from "@/lib/api/systems";
import { getConfigLandscape, type SystemConfigState } from "@/lib/api/config-load";
import { exportRuns } from "@/lib/api/versions";
import { apiErrorMessage, isListFailure } from "@/lib/error";
import { formatDate, relativeTime, systemTypeLabel } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";
import type { HealthStatus, SAPSystemExtended } from "@/types/api";

/** Worst first, so the ledger leads with what needs a hand. */
const HEALTH_RANK: Record<HealthStatus, number> = { unreachable: 0, auth_failed: 0, degraded: 1, unknown: 2, healthy: 3 };
const isDown = (h: HealthStatus) => h === "unreachable" || h === "auth_failed";

/** A configuration load as the lifecycle vocabulary; the states outside it (not loaded, not available) render neutral by name. */
const CONFIG_LIFECYCLE: Record<SystemConfigState, string> = {
  loaded: "done",
  with_gaps: "done",
  loading: "running",
  not_loaded: "not_loaded",
  failed: "failed",
  not_available: "not_available",
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
      return c.loaded_at ? `${relativeTime(c.loaded_at)}, ${c.areas_loaded} of ${c.areas_total} areas` : "—";
    case "with_gaps":
      return c.loaded_at ? `With gaps: ${c.areas_loaded} of ${c.areas_total} areas, ${relativeTime(c.loaded_at)}` : "With gaps";
    default:
      return "—";
  }
}

export default function SystemsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { prefs } = usePreferences();
  const tz = prefs.timezone || "UTC";
  const systemScope = useSystemScope();
  const { data, isLoading, isError, error, refetch } = useQuery({ queryKey: queryKeys.systems(), queryFn: getSystems, select: systemScope });
  const systems = data ?? [];
  const versionsQ = useQueries({
    queries: systems.map((s) => ({ queryKey: queryKeys.systemVersions(s.id), queryFn: () => getSystemVersions(s.id) })),
  });
  const dqsById = new Map(
    systems.map((s, i) => {
      const vs = versionsQ[i]?.data?.versions;
      return [s.id, vs ? { dqs: latestDqs(vs).dqs, trend: dqsTrend(vs) } : null];
    }),
  );
  const modulesQ = useQueries({
    queries: systems.map((s) => ({ queryKey: queryKeys.systemModules(s.id), queryFn: () => getSystemModules(s.id), meta: { ignoreError: true } })),
  });
  const objectsById = new Map(
    systems.map((s, i) => {
      const ms = modulesQ[i]?.data;
      return [s.id, ms ? { loaded: ms.filter((m) => m.enabled && m.row_count > 0).length, total: ms.length } : null];
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
  const healthFilter = rawHealth === "unhealthy" || rawHealth === "down" || Object.hasOwn(HEALTH_LABEL, rawHealth) ? rawHealth : "";
  const isUnhealthy = (h: HealthStatus) => h === "degraded" || h === "unreachable" || h === "auth_failed";
  const matchesHealth = (h: HealthStatus) =>
    !healthFilter || (healthFilter === "unhealthy" ? isUnhealthy(h) : healthFilter === "down" ? isDown(h) : h === healthFilter);
  const dqsOf = (id: string) => dqsById.get(id)?.dqs ?? null;
  const shown = systems
    .filter((s) => !configFilter || configById.get(s.id)?.status === configFilter)
    .filter((s) => matchesHealth(s.health_status))
    .sort((a, b) => HEALTH_RANK[a.health_status] - HEALTH_RANK[b.health_status]
      || (dqsOf(a.id) ?? Infinity) - (dqsOf(b.id) ?? Infinity)
      || a.name.localeCompare(b.name));

  const columns: ColumnDef<SAPSystemExtended>[] = [
    { accessorKey: "name", header: "System", size: 240, cell: ({ row }) => (<span className="inline-flex items-baseline gap-2">{row.original.name}<Mono>{row.original.client ? `${row.original.environment}/${row.original.client}` : row.original.environment}</Mono></span>) },
    { accessorKey: "system_type", header: "Type", size: 150, cell: ({ row }) => `${systemTypeLabel(row.original.system_type)}${row.original.role === "target" ? ", target" : ""}` },
    {
      accessorKey: "health_status",
      header: "Health",
      size: 190,
      cell: ({ row }) => {
        const h = row.original.health_status;
        const verdict = HEALTH_VERDICT[h];
        return (
          <span className="inline-flex flex-col items-start">
            {verdict ? <Status kind="verdict" value={verdict} /> : <span className="m-ink-3">{HEALTH_LABEL.unknown}</span>}
            <span className="m-text-meta m-ink-3">
              {row.original.last_health_check
                ? `${verdict && verdict !== "go" ? `${HEALTH_LABEL[h]}, checked` : "Checked"} ${relativeTime(row.original.last_health_check)}`
                : verdict ? `${HEALTH_LABEL[h]}, never checked` : ""}
            </span>
          </span>
        );
      },
    },
    {
      id: "objects",
      header: "Objects loaded",
      size: 130,
      meta: { numeric: true },
      cell: ({ row }) => {
        const o = objectsById.get(row.original.id);
        if (!o) return modulesQ.some((q) => q.isLoading) ? <Skeleton height={16} width={48} /> : "—";
        return <DrillLink href={`/systems/${row.original.id}?tab=objects`}>{o.total ? `${o.loaded.toLocaleString()} of ${o.total.toLocaleString()}` : "0"}</DrillLink>;
      },
    },
    {
      id: "dqs",
      header: "Latest DQS",
      size: 190,
      cell: ({ row }) => {
        const d = dqsById.get(row.original.id);
        if (!d || d.dqs == null) return "—";
        const t = d.trend;
        return (
          <span className="inline-flex items-center gap-2">
            <Score size="sm" value={d.dqs}><DrillLink href={`/systems/${row.original.id}?tab=overview`}>{d.dqs.toFixed(1)}</DrillLink></Score>
            {t != null && Math.abs(t) >= 0.05 ? <Delta value={t} run="the previous run" /> : null}
          </span>
        );
      },
    },
    {
      id: "config",
      header: "Configuration",
      size: 190,
      cell: ({ row }) => {
        if (configQ.isLoading) return <Skeleton height={16} width={96} />;
        const c = configById.get(row.original.id);
        if (!c) return "No configuration yet";
        return (
          <Link href={`/systems/${row.original.id}?tab=health&part=config`} className="flex flex-col items-start" onClick={(e) => e.stopPropagation()}>
            <Status kind="lifecycle" value={CONFIG_LIFECYCLE[c.status]} />
            <span className="m-text-meta m-ink-2">{configSub(c)}</span>
          </Link>
        );
      },
    },
    {
      id: "last_sync",
      header: "Last extracted",
      size: 190,
      cell: ({ row }) => {
        const n = nextRunById.get(row.original.id);
        return (
          <span className="inline-flex flex-col items-start">
            {row.original.last_sync_at ? relativeTime(row.original.last_sync_at) : "Never"}
            <span className="m-text-meta m-ink-3">{n ? `Next ${formatDate(n, "datetime")} ${tz}` : "Manual only"}</span>
          </span>
        );
      },
    },
    {
      id: "open",
      header: "",
      size: 80,
      cell: ({ row }) => (
        <Link href={`/systems/${row.original.id}`} className="m-ink-accent-ink underline" aria-label={`Open ${row.original.name}`} onClick={(e) => e.stopPropagation()}>Open</Link>
      ),
    },
  ];

  let state: "loading" | "empty" | "error" | undefined;
  if (isLoading) state = "loading";
  else if (isListFailure({ isError, error })) state = "error";
  else if (systems.length === 0) state = "empty";

  const exportOptions = [{ format: "xlsx" as const, label: "Runs (.xlsx)", run: () => exportRuns("xlsx") }];

  const count = (f: (h: HealthStatus) => boolean) => systems.filter((s) => f(s.health_status)).length;
  const healthy = count((h) => h === "healthy");
  const degraded = count((h) => h === "degraded");
  const down = count(isDown);
  const untested = count((h) => h === "unknown");
  const attention = systems.length - healthy;
  const filtering = Boolean(configFilter || healthFilter);
  const canConnect = usePermissions().has("systems", "create");
  // `/systems?connect=1` (the day-one step, the home empty state) lands with the connect dialog open.
  const [connecting, setConnecting] = useState(searchParams.get("connect") === "1");
  const openConnect = (open: boolean) => {
    setConnecting(open);
    if (!open && searchParams.get("connect")) router.replace("/systems", { scroll: false });
  };

  return (
    <>
    <ExplorerPage
      header={
        <PageHeader
          title="Systems"
          actions={
            <>
              <ExportMenu options={systems.length === 0 ? emptyExportOptions(exportOptions) : exportOptions} />
              {canConnect ? <Button onClick={() => openConnect(true)}>Connect system</Button> : null}
            </>
          }
          meta={isLoading ? "\u00a0" : `${systems.length} ${systems.length === 1 ? "system" : "systems"}${attention ? `, ${attention} need attention` : ""}`}
        />
      }
      filterBar={
        filtering ? (
          <div className="flex items-center gap-2 m-text-body">
            <Pill tone="neutral">{healthFilter ? (healthFilter === "unhealthy" ? "Unhealthy" : healthFilter === "down" ? "Unreachable" : HEALTH_LABEL[healthFilter as HealthStatus]) : `Configuration ${(CONFIG_LABEL[configFilter as SystemConfigState] ?? configFilter).toLowerCase()}`}</Pill>
            <Button variant="ghost" onClick={() => { setConfigFilter(""); setHealthFilter(""); }}>Clear filter</Button>
          </div>
        ) : undefined
      }
      summary={
        isLoading || systems.length > 0 ? (
          <div className="m-stat-grid m-motion-stagger" data-testid="systems-health">
            <Stat label="Healthy" loading={isLoading} value={isLoading ? "" : healthy} tone={isLoading ? undefined : healthy > 0 ? "go" : undefined} href="?health=healthy" />
            <Stat label="Degraded" loading={isLoading} value={isLoading ? "" : degraded} tone={isLoading ? undefined : degraded > 0 ? "at-risk" : undefined} href="?health=degraded" />
            <Stat label="Unreachable" loading={isLoading} value={isLoading ? "" : down} tone={isLoading ? undefined : down > 0 ? "no-go" : undefined} href="?health=down" />
            {untested > 0 ? <Stat label="Not tested" value={untested} href="?health=unknown" /> : null}
          </div>
        ) : undefined
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
        action: (
          <div className="flex gap-2">
            {canConnect ? <Button onClick={() => openConnect(true)}>Connect system</Button> : null}
            <Button variant={canConnect ? "secondary" : "primary"} render={<Link href="/import">Import file</Link>} />
          </div>
        ),
        ghost: "table",
      }}
      errorProps={{ message: apiErrorMessage(error), onRetry: () => refetch() }}
    />
    <ConnectSystemDialog open={connecting} onOpenChange={openConnect} />
    </>
  );
}
