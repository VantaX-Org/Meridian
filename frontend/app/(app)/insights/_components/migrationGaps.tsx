"use client";

// A readiness cell's `blocker_count` is the number of migration gaps of its object in its wave (every gap type but the
// informational ones, api/services/insights_readiness.py `blocking_gaps`), not a count of rules or findings. Its drill
// is the wave's gap view: the Blockers tab of the wave cockpit (/migration/<wave id>?tab=blockers). Readiness cells
// carry the wave's name, so the waves list maps a name to its id.
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { getWaves } from "@/lib/api/migration";
import type { ReadinessCell } from "@/lib/api/insights";
import { formatModuleName, plural } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";
import { DrillCount } from "./DrillCount";

/** The column header of `blocker_count` on every page that shows it. */
export const MIGRATION_GAPS = "Migration gaps";

/** Wave name to wave id, from the migration waves list (the same request and cache entry as the cockpit's list). */
export function useWaveIds(): ReadonlyMap<string, string> {
  const q = useQuery({ queryKey: queryKeys.migrationWaves(), queryFn: getWaves, staleTime: 60_000, meta: { ignoreError: true } });
  return new Map((q.data ?? []).map((w) => [w.name, w.id]));
}

/** The wave's gap view (the cockpit's Blockers tab); the waves list while the wave's id is not known. */
export function waveGapsHref(waveIds: ReadonlyMap<string, string>, wave: string): string {
  const id = waveIds.get(wave);
  return id ? `/migration/${id}?tab=blockers` : "/migration";
}

/** The Migration gaps and Records blocked columns of a readiness ledger, both opening the wave's gap view. */
export function migrationGapColumns(waveIds: ReadonlyMap<string, string>): ColumnDef<ReadinessCell>[] {
  const where = (c: ReadinessCell) => `${formatModuleName(c.module)} in ${c.wave}`;
  return [
    {
      accessorKey: "blocker_count",
      header: MIGRATION_GAPS,
      meta: { numeric: true },
      cell: ({ row: { original: c } }) => (
        <DrillCount href={waveGapsHref(waveIds, c.wave)} count={c.blocker_count} label={`Open the ${plural(c.blocker_count, "migration gap")} of ${where(c)}`}>
          {c.blocker_count.toLocaleString()}
        </DrillCount>
      ),
    },
    {
      accessorKey: "records_blocked",
      header: "Records blocked",
      meta: { numeric: true },
      cell: ({ row: { original: c } }) => (
        <DrillCount href={waveGapsHref(waveIds, c.wave)} count={c.records_blocked} label={`Open the migration gaps behind the ${plural(c.records_blocked, "blocked record")} of ${where(c)}`}>
          {c.records_blocked.toLocaleString()}
        </DrillCount>
      ),
    },
  ];
}
