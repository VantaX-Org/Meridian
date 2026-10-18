"use client";

/**
 * Live operations for the Basis home: the health of every connected system,
 * when each was last extracted, and the jobs running right now.
 */

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Button, Card, DataTable, EmptyState, ErrorState, Pill, Skeleton, type PillTone, Status } from "@/design";
import { useJobs } from "@/hooks/use-jobs";
import { useRole } from "@/hooks/use-role";
import { getSystems } from "@/lib/api/connectivity";
import { isListFailure } from "@/lib/error";
import { relativeTime } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";
import type { SAPSystemExtended } from "@/types/api";
import type { Job } from "@/types/jobs";

const HEALTH: Record<string, { tone: PillTone; label: string }> = {
  healthy: { tone: "go", label: "Healthy" },
  degraded: { tone: "at-risk", label: "Degraded" },
  unreachable: { tone: "no-go", label: "Unreachable" },
  auth_failed: { tone: "no-go", label: "Sign-in refused" },
  unknown: { tone: "neutral", label: "Not tested" },
};

const systemColumns: ColumnDef<SAPSystemExtended>[] = [
  {
    id: "health", header: "Health",
    cell: ({ row: { original: s } }) => {
      const h = HEALTH[s.health_status ?? "unknown"] ?? HEALTH.unknown;
      return <Pill tone={s.is_active ? h.tone : "neutral"}>{s.is_active ? h.label : "Inactive"}</Pill>;
    },
  },
  { accessorKey: "name", header: "System" },
  { id: "last", header: "Last extracted", cell: ({ row: { original: s } }) => (s.last_sync_at ? relativeTime(s.last_sync_at) : "Never") },
];

const jobColumns: ColumnDef<Job>[] = [
  { id: "status", header: "Status", cell: ({ row: { original: j } }) => <Status kind="lifecycle" value={j.status} /> },
  { accessorKey: "label", header: "Job" },
  { id: "progress", header: "Progress", meta: { numeric: true }, cell: ({ row: { original: j } }) => `${Math.round(j.percent)}%` },
];

const link = (href: string, label: string) => <Button variant="secondary" render={<Link href={href}>{label}</Link>} />;

export function LiveSection() {
  const systemsQ = useQuery({ queryKey: queryKeys.systems(), queryFn: getSystems });
  const { active } = useJobs();
  const { can } = useRole();
  const systems = systemsQ.data ?? [];

  return (
    <div className="flex flex-col gap-6">
      <Card title="Systems" padding="sm">
        {systemsQ.isLoading ? (
          <div className="flex flex-col gap-1">{[0, 1, 2].map((i) => <Skeleton key={i} height={36} />)}</div>
        ) : isListFailure(systemsQ) ? (
          <ErrorState message="Live system state could not be read" onRetry={() => void systemsQ.refetch()} />
        ) : systems.length ? (
          <DataTable columns={systemColumns} data={systems} getRowId={(s) => s.id} height="auto" dense hideToolbar tableId="home-systems" />
        ) : (
          <EmptyState title="No systems connected" action={can("manage_systems") ? link("/systems?new=1", "Connect a system") : undefined} />
        )}
      </Card>

      <Card title="Jobs running" padding="sm">
        {active.length ? (
          <DataTable columns={jobColumns} data={active} getRowId={(j) => j.id} height="auto" dense hideToolbar tableId="home-jobs" />
        ) : (
          <EmptyState title="Nothing is running" action={can("trigger_sync") ? link("/systems", "Run extraction") : undefined} />
        )}
      </Card>
    </div>
  );
}
