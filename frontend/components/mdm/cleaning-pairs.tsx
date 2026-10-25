"use client";

/**
 * Match review, cleaning engine source: the duplicate candidates the cleaning engine found (dedup_candidates,
 * api/routes/cleaning.py), a page at a time. Open a pair to compare it field by field and keep one record.
 */

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Button, DataTable, Drawer, ExplorerPage, Mono, Notice, Pager, Pill, Skeleton, asyncStateOf, toast } from "@/design";
import { useRole } from "@/hooks/use-role";
import { getDedupCandidates, getDedupPreview, mergeDedupCandidate, type DedupCandidate } from "@/lib/api/cleaning";
import { apiErrorMessage } from "@/lib/error";
import { labelOf } from "@/lib/format";

const PAGE_SIZE = 100;

/** Every cleaning-engine pair query (list and counts) sits under this key, so a merge refreshes them all. */
export const cleaningPairsKey = ["dedup", "candidates"] as const;

export interface CleaningFilters { object_type?: string; record?: string }

const columns: ColumnDef<DedupCandidate>[] = [
  { accessorKey: "object_type", header: "Object", cell: ({ row }) => labelOf(row.original.object_type) },
  { id: "a", header: "Record A", cell: ({ row }) => <Mono>{row.original.record_key_a}</Mono> },
  { id: "b", header: "Record B", cell: ({ row }) => <Mono>{row.original.record_key_b}</Mono> },
  { accessorKey: "match_score", header: "Match", cell: ({ row }) => `${Math.round(row.original.match_score)}%` },
  { accessorKey: "match_method", header: "Method", cell: ({ row }) => labelOf(row.original.match_method) },
  { accessorKey: "status", header: "Status", cell: ({ row }) => <Pill tone={row.original.status === "merged" ? "go" : "neutral"}>{labelOf(row.original.status)}</Pill> },
];

/** One pair side by side, field by field, with the merge decision: which record survives. */
export function CleaningPairDetail({ pair, onMerged }: { pair: DedupCandidate; onMerged: () => void }) {
  const canMerge = useRole().can("approve");
  const preview = useQuery({
    queryKey: ["dedup", "preview", pair.id],
    queryFn: () => getDedupPreview({ record_key_a: pair.record_key_a, record_key_b: pair.record_key_b, object_type: pair.object_type }),
  });
  const merge = useMutation({
    mutationFn: (survivor: string) => mergeDedupCandidate({ candidate_id: pair.id, survivor_key: survivor }),
    onSuccess: (r) => { toast.success(`Merged. ${r.survivor_key} is the surviving record.`); onMerged(); },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });
  const fields = Object.entries(preview.data?.merge_preview ?? {});
  const fieldColumns: ColumnDef<[string, { a: string; b: string }]>[] = [
    { id: "field", header: "Field", cell: ({ row }) => <Mono>{row.original[0]}</Mono> },
    { id: "a", header: "Record A", cell: ({ row }) => row.original[1].a || <span className="m-ink-3">blank</span> },
    { id: "b", header: "Record B", cell: ({ row }) => row.original[1].b || <span className="m-ink-3">blank</span> },
  ];
  return (
    <div className="flex flex-col gap-4">
      <p className="m-text-body m-ink-2">
        {labelOf(pair.object_type)}, {Math.round(pair.match_score)}% match by {labelOf(pair.match_method).toLowerCase()}. Merging keeps one record and folds the other into it in the golden record.
      </p>
      {preview.isLoading ? <Skeleton height={160} /> : fields.length ? (
        <DataTable columns={fieldColumns} data={fields} getRowId={(r) => r[0]} hideSearch maxHeight={360} />
      ) : (
        <Notice tone="info">No field values were captured for these records, so they cannot be compared here. Open them in Objects to compare.</Notice>
      )}
      {pair.status === "merged" ? (
        <Notice tone="info">Already merged.</Notice>
      ) : canMerge ? (
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" pending={merge.isPending && merge.variables === pair.record_key_a} onClick={() => merge.mutate(pair.record_key_a)}>Keep A</Button>
          <Button variant="secondary" pending={merge.isPending && merge.variables === pair.record_key_b} onClick={() => merge.mutate(pair.record_key_b)}>Keep B</Button>
        </div>
      ) : (
        <Notice tone="info">Merging needs the approve permission.</Notice>
      )}
    </div>
  );
}

/** The cleaning engine's pairs under Match review's header and filter bar. Remount it (a `key`) when the
 * filters change, so it starts again from page one. */
export function CleaningPairs({ header, filterBar, filters }: { header: ReactNode; filterBar: ReactNode; filters: CleaningFilters }) {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<DedupCandidate | null>(null);
  const q = useQuery({
    queryKey: [...cleaningPairsKey, filters, page],
    queryFn: () => getDedupCandidates({ ...filters, page, per_page: PAGE_SIZE }),
  });
  const items = q.data?.items ?? [];
  const total = q.data?.total ?? 0;
  const empty = filters.record
    ? { title: `No cleaning engine pairs for ${filters.record}`, detail: "The cleaning engine has no open duplicate candidate for this record." }
    : { title: "No duplicate candidates", detail: "Candidates appear after the cleaning engine runs on a master-data object" };
  return (
    <ExplorerPage
      header={header}
      filterBar={filterBar}
      state={asyncStateOf(q, () => items.length === 0, true)}
      emptyProps={{ ...empty, action: <Button variant="secondary" render={<Link href="/mdm/match-rules">Tune match rules</Link>} />, ghost: "table" }}
      errorProps={{ message: apiErrorMessage(q.error), onRetry: () => void q.refetch() }}
      table={
        <div className="flex flex-col gap-3">
          <DataTable columns={columns} data={items} getRowId={(r) => r.id} onRowClick={setSelected} tableId="mdm-match-review-cleaning" />
          {total > PAGE_SIZE ? <Pager page={page} pageCount={Math.ceil(total / PAGE_SIZE)} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} /> : null}
        </div>
      }
      drawer={
        <Drawer open={!!selected} onOpenChange={(open) => { if (!open) setSelected(null); }} title={selected ? `${selected.record_key_a} and ${selected.record_key_b}` : "Duplicate pair"}>
          {selected ? <CleaningPairDetail pair={selected} onMerged={() => { setSelected(null); void qc.invalidateQueries({ queryKey: cleaningPairsKey }); }} /> : null}
        </Drawer>
      }
    />
  );
}
