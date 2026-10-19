"use client";

import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";
import { Button, DataTable, ExplorerPage, Mono, Pill, asyncStateOf } from "@/design";
import { getDedupCandidates, type DedupCandidate } from "@/lib/api/cleaning";
import { apiErrorMessage } from "@/lib/error";
import { labelOf } from "@/lib/format";

const dedupColumns: ColumnDef<DedupCandidate>[] = [
  { accessorKey: "object_type", header: "Object", cell: ({ row }) => labelOf(row.original.object_type) },
  { id: "a", header: "Record A", cell: ({ row }) => <Mono>{row.original.record_key_a}</Mono> },
  { id: "b", header: "Record B", cell: ({ row }) => <Mono>{row.original.record_key_b}</Mono> },
  { accessorKey: "match_score", header: "Match", cell: ({ row }) => `${Math.round(row.original.match_score)}%` },
  { accessorKey: "match_method", header: "Method", cell: ({ row }) => labelOf(row.original.match_method) },
  { accessorKey: "status", header: "Status", cell: ({ row }) => <Pill tone={row.original.status === "merged" ? "go" : "neutral"}>{labelOf(row.original.status)}</Pill> },
];

/** Duplicate candidate pairs; merging happens in MDM, so this is read-only. */
export function DedupTab() {
  const q = useQuery({ queryKey: ["dedup", "candidates"], queryFn: () => getDedupCandidates() });
  const items = q.data?.items ?? [];
  return (
    <ExplorerPage
      state={asyncStateOf(q, () => items.length === 0, true)}
      emptyProps={{ title: "No duplicate candidates", detail: "Candidates appear after matching runs on a master-data object", action: <Button variant="secondary" render={<Link href="/mdm/match-rules">Tune match rules</Link>} /> }}
      errorProps={{ message: apiErrorMessage(q.error), onRetry: () => q.refetch() }}
      table={<DataTable columns={dedupColumns} data={items} getRowId={(r) => r.id} />}
    />
  );
}
