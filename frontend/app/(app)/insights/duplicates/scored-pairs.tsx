"use client";

/**
 * Insights › Duplicates › Scored pairs: the matcher's candidate pairs for one object, best first. Each row opens Match
 * review with that pair's record selected (`/mdm/golden/merge?source=cleaning`), where every merge is decided.
 */

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable, EmptyState, ErrorState, Mono, RowAction, Select, Skeleton, actionColumn } from "@/design";
import { getDedupCandidatesByObject, type DedupCandidate } from "@/lib/api/cleaning";
import { apiErrorState } from "@/lib/error";
import { formatModuleName, labelOf, plural } from "@/lib/format";

/** Local key: the typed candidates are read per object. */
export const scoredPairsKey = (object: string) => ["dedup", "candidates", object] as const;

/** Match review with this pair's first record selected, from the cleaning engine's candidates. */
export function scoredPairHref(c: Pick<DedupCandidate, "object_type" | "record_key_a">): string {
  return `/mdm/golden/merge?source=cleaning&object=${encodeURIComponent(c.object_type)}&record=${encodeURIComponent(c.record_key_a)}`;
}

const score = (n: number) => `${Math.round(n)}%`;

export function ScoredPairs({ objects }: { objects: { value: string; label: string }[] }) {
  const [object, setObject] = useState("");
  const q = useQuery({
    queryKey: scoredPairsKey(object),
    queryFn: () => getDedupCandidatesByObject(object),
    enabled: !!object,
  });
  const columns = useMemo<ColumnDef<DedupCandidate>[]>(() => [
    { id: "a", header: "Record A", cell: ({ row }) => <Mono>{row.original.record_key_a}</Mono> },
    { id: "b", header: "Record B", cell: ({ row }) => <Mono>{row.original.record_key_b}</Mono> },
    { id: "score", header: "Match score", meta: { numeric: true }, accessorFn: (c) => c.match_score, cell: ({ row }) => score(row.original.match_score) },
    { id: "method", header: "Method", meta: { priority: "low" }, cell: ({ row }) => labelOf(row.original.match_method) },
    actionColumn((c) => (
      <RowAction href={scoredPairHref(c)} label={`Review ${c.record_key_a} and ${c.record_key_b} in Match review`}>Review</RowAction>
    )),
  ], []);

  return (
    <div className="flex flex-col gap-3">
      <Select label="Object for scored pairs" value={object} onValueChange={setObject} options={objects} placeholder="Choose an object" />
      {!object ? (
        <EmptyState variant="inline" title="No object chosen" detail="Its scored candidate pairs, best match first, appear here" />
      ) : q.isLoading ? (
        <div aria-busy="true"><Skeleton height={200} /></div>
      ) : q.isError ? (
        <ErrorState {...apiErrorState(q.error)} onRetry={() => void q.refetch()} />
      ) : !q.data?.items.length ? (
        <EmptyState variant="inline" title="No pending pairs" detail={`The matcher has no pair left to review for ${formatModuleName(object)}`} />
      ) : (
        <>
          <p className="m-text-meta m-ink-3">{plural(q.data.total, "pending pair")} for {formatModuleName(object)}, best match first</p>
          <DataTable columns={columns} data={q.data.items} getRowId={(c) => c.id} tableId="scored-pairs" exportName="scored-pairs" height={420} />
        </>
      )}
    </div>
  );
}
