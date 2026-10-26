"use client";

/**
 * A golden record's merge history (GET /master-records/{id}/merge-events): every merge, split, undo,
 * steward override and pair decision on its cluster, newest first, with who did it and why.
 */

import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable, EmptyState, ErrorState, Mono, Pill, Skeleton } from "@/design";
import { apiErrorState } from "@/lib/error";
import { formatDate } from "@/lib/format";
import { getMergeEvents, type MergeEvent, type MergeEventType } from "@/lib/api/merge-explain";
import { LedgerHead } from "./ledger";
import { usePeople } from "./use-people";

export const EVENT_LABEL: Record<MergeEventType, string> = {
  merge: "Merged",
  unmerge: "Split out",
  undo: "Merge undone",
  remerge: "Merged back",
  override: "Steward override",
  pair_accept: "Pair marked a match",
  pair_reject: "Pair marked not a match",
  pair_clear: "Pair decision cleared",
};

export const mergeEventsKey = (id: string) => ["mdm", "merge-events", id] as const;

export function MergeHistory({ id }: { id: string }) {
  const q = useQuery({ queryKey: mergeEventsKey(id), queryFn: () => getMergeEvents(id) });
  const { nameOf } = usePeople();
  const events = q.data ?? [];
  const cols: ColumnDef<MergeEvent>[] = [
    { id: "when", header: "When", accessorFn: (e) => e.created_at, cell: ({ row }) => formatDate(row.original.created_at, "datetime") },
    {
      id: "event",
      header: "Change",
      cell: ({ row }) => (
        <span className="inline-flex items-center gap-2">
          {EVENT_LABEL[row.original.event_type] ?? row.original.event_type}
          {row.original.reversed ? <Pill>Reversed</Pill> : null}
        </span>
      ),
    },
    // An override lists the fields it set; every other event lists the record keys it moved.
    { id: "what", header: "Records or fields", cell: ({ row }) => <Mono>{row.original.member_keys.join(", ")}</Mono> },
    { id: "by", header: "By", accessorFn: (e) => (e.actor ? nameOf(e.actor) ?? "A user" : "System") },
    { id: "why", header: "Reason", accessorFn: (e) => e.reason ?? "" },
  ];

  return (
    <section aria-label="Merge history">
      <LedgerHead title="Merge history" meta={String(events.length)} />
      {q.isLoading ? <Skeleton height={80} /> : q.isError ? (
        <ErrorState {...apiErrorState(q.error)} onRetry={() => void q.refetch()} />
      ) : events.length === 0 ? (
        <EmptyState variant="inline" title="No merges recorded" detail="Merges, splits and steward overrides on this record are listed here." />
      ) : (
        <DataTable columns={cols} getRowId={(e) => e.id} data={events} height="auto" />
      )}
    </section>
  );
}
