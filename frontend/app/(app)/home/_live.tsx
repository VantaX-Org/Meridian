"use client";

/**
 * Live operations, the top of the Basis home: per connected system its health (with the reason when it is not
 * healthy and when it was last checked), its last successful extraction, its last error and why, and its next
 * scheduled run; then the jobs running now and the latest that finished. The score follows below.
 */

import Link from "next/link";
import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { useQueries, useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Button, Card, DataTable, EmptyState, ErrorState, Pill, Skeleton, Status } from "@/design";
import { HEALTH_LABEL, HEALTH_VERDICT, nextRun } from "@/app/(app)/systems/_health";
import { useJobs } from "@/hooks/use-jobs";
import { useRole } from "@/hooks/use-role";
import { getSystems } from "@/lib/api/connectivity";
import { getSyncProfiles } from "@/lib/api/systems";
import { isListFailure } from "@/lib/error";
import { formatDate, formatDuration, labelOf, relativeTime } from "@/lib/format";
import { explainJobError } from "@/lib/job-error";
import { queryKeys } from "@/lib/query-keys";
import type { SAPSystemExtended } from "@/types/api";
import type { Job } from "@/types/jobs";

/** How many finished jobs the Jobs card lists under the running ones. */
const RECENT_JOBS = 5;

/** A system's row: the system plus what its jobs and schedules say about it. */
interface SystemRow {
  system: SAPSystemExtended;
  /** ISO time of the last successful extraction. */
  lastSuccess: string | null;
  /** The last failure: when, and why in one line. */
  lastError: { at: string; reason: string } | null;
  /** ISO time of the next scheduled run; null when it runs manually only, undefined while unknown. */
  next: string | null | undefined;
}

const iso = (unixSeconds: number) => new Date(unixSeconds * 1000).toISOString();
const failedSync = (status: string | null) => !!status && /fail|error/i.test(status);

/** Rows for the systems table from the systems, the job registry (newest first) and each system's next run. */
export function systemRows(
  systems: readonly SAPSystemExtended[],
  jobs: readonly Job[],
  nextById: ReadonlyMap<string, string | null | undefined>,
): SystemRow[] {
  return systems.map((s) => {
    const own = jobs.filter((j) => j.system_id === s.id && j.kind === "extraction");
    const ok = own.find((j) => j.status === "completed" && j.finished_at);
    const failed = own.find((j) => j.status === "failed");
    const okAt = ok?.finished_at ? iso(ok.finished_at) : null;
    const lastSuccess = okAt ?? (s.last_sync_at && !failedSync(s.last_sync_status) ? s.last_sync_at : null);
    // The connection's own failure (health check) is the newest error when it is newer than any failed job.
    const healthError = s.health_status !== "healthy" && s.health_status !== "unknown" && s.last_health_check
      ? { at: s.last_health_check, reason: s.health_message || HEALTH_LABEL[s.health_status] }
      : null;
    const jobError = failed
      ? { at: iso(failed.finished_at ?? failed.updated_at), reason: explainJobError(failed.error)?.summary ?? failed.message ?? "Failed" }
      : null;
    const lastError = [healthError, jobError]
      .filter((e): e is { at: string; reason: string } => e !== null)
      .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0] ?? null;
    return { system: s, lastSuccess, lastError, next: nextById.get(s.id) };
  });
}

const systemColumns: ColumnDef<SystemRow>[] = [
  { id: "name", header: "System", accessorFn: (r) => r.system.name },
  {
    id: "health", header: "Health",
    cell: ({ row: { original: { system: s } } }) => {
      if (!s.is_active) return <Pill tone="neutral">Inactive</Pill>;
      const verdict = HEALTH_VERDICT[s.health_status ?? "unknown"];
      return (
        <span className="inline-flex flex-col items-start">
          {verdict ? <Status kind="verdict" value={verdict} /> : <span className="m-ink-3">{HEALTH_LABEL.unknown}</span>}
          <span className="m-text-meta m-ink-3">
            {s.last_health_check ? `${verdict && verdict !== "go" ? `${HEALTH_LABEL[s.health_status]}, checked` : "Checked"} ${relativeTime(s.last_health_check)}` : verdict ? "Never checked" : ""}
          </span>
        </span>
      );
    },
  },
  { id: "success", header: "Last success", cell: ({ row: { original: r } }) => (r.lastSuccess ? relativeTime(r.lastSuccess) : "Never") },
  {
    id: "error", header: "Last error",
    cell: ({ row: { original: r } }) => (r.lastError ? (
      <span className="inline-flex flex-col items-start">
        <span>{r.lastError.reason}</span>
        <span className="m-text-meta m-ink-3">{relativeTime(r.lastError.at)}</span>
      </span>
    ) : <span className="m-ink-3">None</span>),
  },
  {
    id: "next", header: "Next scheduled",
    cell: ({ row: { original: r } }) => (r.next === undefined ? "—" : r.next ? formatDate(r.next, "datetime") : <span className="m-ink-3">Manual only</span>),
  },
];

const jobDuration = (j: Job) => {
  const end = j.finished_at ?? Date.now() / 1000;
  return j.started_at ? Math.max(0, end - j.started_at) * 1000 : null;
};

const jobColumns = (systemName: ReadonlyMap<string, string>): ColumnDef<Job>[] => [
  { id: "status", header: "Status", cell: ({ row: { original: j } }) => <Status kind="lifecycle" value={j.status} /> },
  { accessorKey: "label", header: "Job" },
  { id: "system", header: "System", cell: ({ row: { original: j } }) => (j.system_id ? systemName.get(j.system_id) ?? "—" : "—") },
  { id: "kind", header: "Kind", cell: ({ row: { original: j } }) => labelOf(j.kind) },
  {
    id: "progress", header: "Progress", meta: { numeric: true },
    cell: ({ row: { original: j } }) => (j.status === "running" || j.status === "queued" ? `${Math.round(j.percent)}%` : formatDuration(jobDuration(j))),
  },
];

const link = (href: string, label: string) => <Button variant="secondary" render={<Link href={href}>{label}</Link>} />;
const healthHref = (r: SystemRow) => `/systems/${r.system.id}?tab=health`;

/**
 * Where "Run extraction" goes: the Extract drawer of the active system extracted longest ago (never first), so
 * Basis starts an extraction from home in two clicks instead of finding the system on the Systems list.
 */
export function extractHref(systems: readonly SAPSystemExtended[]): string {
  const stalest = systems
    .filter((s) => s.is_active)
    .sort((a, b) => (a.last_sync_at ?? "").localeCompare(b.last_sync_at ?? ""))[0];
  return stalest ? `/systems/${stalest.id}?extract=1` : "/systems";
}

export function LiveSection() {
  const router = useRouter();
  const systemsQ = useQuery({ queryKey: queryKeys.systems(), queryFn: getSystems });
  const { jobs, active } = useJobs();
  const { can } = useRole();
  const systems = useMemo(() => systemsQ.data ?? [], [systemsQ.data]);
  const profilesQ = useQueries({
    queries: systems.map((s) => ({ queryKey: queryKeys.syncProfiles(s.id), queryFn: () => getSyncProfiles(s.id), meta: { ignoreError: true } })),
  });
  const nextById = new Map(systems.map((s, i) => {
    const p = profilesQ[i]?.data;
    return [s.id, p ? nextRun(p) : undefined] as const;
  }));
  const rows = systemRows(systems, jobs, nextById);
  const systemName = useMemo(() => new Map(systems.map((s) => [s.id, s.name])), [systems]);
  const shownJobs = [...active, ...jobs.filter((j) => j.status === "completed" || j.status === "failed").slice(0, RECENT_JOBS)];

  return (
    <div className="flex flex-col gap-6" data-testid="home-live">
      <Card title="Systems" padding="sm" actions={link("/systems", "All systems")}>
        {systemsQ.isLoading ? (
          <div className="flex flex-col gap-1">{[0, 1, 2].map((i) => <Skeleton key={i} height={36} />)}</div>
        ) : isListFailure(systemsQ) ? (
          <ErrorState message="Live system state could not be read" onRetry={() => void systemsQ.refetch()} />
        ) : systems.length ? (
          <DataTable columns={systemColumns} data={rows} getRowId={(r) => r.system.id} rowHref={healthHref} onRowClick={(r) => router.push(healthHref(r))} height="auto" hideToolbar tableId="home-systems" />
        ) : (
          <EmptyState title="No systems connected" action={can("manage_systems") ? link("/systems?connect=1", "Connect a system") : undefined} />
        )}
      </Card>

      <Card title={active.length ? `Jobs, ${active.length} running` : "Jobs"} padding="sm" actions={link("/admin/jobs", "All jobs")}>
        {shownJobs.length ? (
          <DataTable columns={jobColumns(systemName)} data={shownJobs} getRowId={(j) => j.id} height="auto" hideToolbar tableId="home-jobs" />
        ) : null}
        {active.length === 0 ? (
          <EmptyState variant="inline" title="Nothing is running" action={can("trigger_sync") ? link(extractHref(systems), "Run extraction") : undefined} />
        ) : null}
      </Card>
    </div>
  );
}
