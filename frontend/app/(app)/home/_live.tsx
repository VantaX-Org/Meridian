"use client";

/**
 * Live operations for the Basis home: the health of every connected system,
 * when each was last extracted, and the jobs running right now.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Button, Card, DataTable, EmptyState, ErrorState, Pill, Skeleton, Status } from "@/design";
import { HEALTH_LABEL, HEALTH_VERDICT } from "@/app/(app)/systems/_health";
import { useJobs } from "@/hooks/use-jobs";
import { useRole } from "@/hooks/use-role";
import { getSystems } from "@/lib/api/connectivity";
import { isListFailure } from "@/lib/error";
import { relativeTime } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";
import type { SAPSystemExtended } from "@/types/api";
import type { Job } from "@/types/jobs";

const systemColumns: ColumnDef<SAPSystemExtended>[] = [
  {
    id: "health", header: "Health",
    cell: ({ row: { original: s } }) => {
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
  { accessorKey: "name", header: "System" },
  { id: "last", header: "Last extracted", cell: ({ row: { original: s } }) => (s.last_sync_at ? relativeTime(s.last_sync_at) : "Never") },
];

const jobColumns: ColumnDef<Job>[] = [
  { id: "status", header: "Status", cell: ({ row: { original: j } }) => <Status kind="lifecycle" value={j.status} /> },
  { accessorKey: "label", header: "Job" },
  { id: "progress", header: "Progress", meta: { numeric: true }, cell: ({ row: { original: j } }) => `${Math.round(j.percent)}%` },
];

const link = (href: string, label: string) => <Button variant="secondary" render={<Link href={href}>{label}</Link>} />;
const healthHref = (s: SAPSystemExtended) => `/systems/${s.id}?tab=health`;

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
          <DataTable columns={systemColumns} data={systems} getRowId={(s) => s.id} rowHref={healthHref} onRowClick={(s) => router.push(healthHref(s))} height="auto" hideToolbar tableId="home-systems" />
        ) : (
          <EmptyState title="No systems connected" action={can("manage_systems") ? link("/systems?connect=1", "Connect a system") : undefined} />
        )}
      </Card>

      <Card title="Jobs running" padding="sm">
        {active.length ? (
          <DataTable columns={jobColumns} data={active} getRowId={(j) => j.id} height="auto" hideToolbar tableId="home-jobs" />
        ) : (
          <EmptyState title="Nothing is running" action={can("trigger_sync") ? link(extractHref(systems), "Run extraction") : undefined} />
        )}
      </Card>
    </div>
  );
}
