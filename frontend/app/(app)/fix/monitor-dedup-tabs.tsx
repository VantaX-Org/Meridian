"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";
import { Button, ConfirmDialog, DataTable, Drawer, ExplorerPage, Mono, Notice, Pager, Pill, Skeleton, asyncStateOf, toast } from "@/design";
import { useRole } from "@/hooks/use-role";
import { getDedupCandidates, getDedupPreview, mergeDedupCandidate, type DedupCandidate } from "@/lib/api/cleaning";
import { apiErrorMessage } from "@/lib/error";
import { formatModuleName, labelOf } from "@/lib/format";

const PAGE_SIZE = 100;

const dedupColumns: ColumnDef<DedupCandidate>[] = [
  { accessorKey: "object_type", header: "Object", cell: ({ row }) => formatModuleName(row.original.object_type) },
  { id: "a", header: "Record A", cell: ({ row }) => <Mono>{row.original.record_key_a}</Mono> },
  { id: "b", header: "Record B", cell: ({ row }) => <Mono>{row.original.record_key_b}</Mono> },
  { accessorKey: "match_score", header: "Match", cell: ({ row }) => `${Math.round(row.original.match_score)}%` },
  { accessorKey: "match_method", header: "Method", cell: ({ row }) => labelOf(row.original.match_method) },
  { accessorKey: "status", header: "Status", cell: ({ row }) => <Pill tone={row.original.status === "merged" ? "go" : "neutral"}>{labelOf(row.original.status)}</Pill> },
];

/** One pair side by side, field by field, with the merge decision: which record survives. */
function PairDetail({ pair, onMerged }: { pair: DedupCandidate; onMerged: () => void }) {
  const canMerge = useRole().can("approve");
  /** The record that would survive; null closes the confirmation. */
  const [survivor, setSurvivor] = useState<string | null>(null);
  const preview = useQuery({
    queryKey: ["dedup", "preview", pair.id],
    queryFn: () => getDedupPreview({ record_key_a: pair.record_key_a, record_key_b: pair.record_key_b, object_type: pair.object_type }),
  });
  const merge = useMutation({
    mutationFn: (survivor: string) => mergeDedupCandidate({ candidate_id: pair.id, survivor_key: survivor }),
    onSuccess: (r) => { setSurvivor(null); toast.success(`Merged. ${r.survivor_key} is the surviving record.`); onMerged(); },
    onError: (e) => { setSurvivor(null); toast.error(apiErrorMessage(e)); },
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
        {formatModuleName(pair.object_type)}, {Math.round(pair.match_score)}% match by {labelOf(pair.match_method).toLowerCase()}. Merging keeps one record and folds the other into it in the golden record.
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
          <Button variant="primary" disabled={merge.isPending} onClick={() => setSurvivor(pair.record_key_a)}>Keep A</Button>
          <Button variant="secondary" disabled={merge.isPending} onClick={() => setSurvivor(pair.record_key_b)}>Keep B</Button>
        </div>
      ) : (
        <Notice tone="info">Merging needs the approve permission.</Notice>
      )}
      <ConfirmDialog
        open={survivor !== null}
        onOpenChange={(open) => { if (!open) setSurvivor(null); }}
        title="Merge these records?"
        body={survivor ? <><Mono>{survivor}</Mono> survives and <Mono>{survivor === pair.record_key_a ? pair.record_key_b : pair.record_key_a}</Mono> is retired into it in the golden record.</> : null}
        confirmLabel={survivor ? `Keep ${survivor === pair.record_key_a ? "A" : "B"}` : "Merge"}
        cancelLabel="Keep both"
        pending={merge.isPending}
        onConfirm={() => survivor && merge.mutate(survivor)}
      />
    </div>
  );
}

/** Duplicate candidate pairs, a page at a time; open a pair to compare it and merge. */
export function DedupTab() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<DedupCandidate | null>(null);
  const q = useQuery({ queryKey: ["dedup", "candidates", page], queryFn: () => getDedupCandidates({ page, per_page: PAGE_SIZE }) });
  const items = q.data?.items ?? [];
  const total = q.data?.total ?? 0;
  return (
    <>
      <ExplorerPage
        state={asyncStateOf(q, () => items.length === 0, true)}
        emptyProps={{ title: "No duplicate candidates", detail: "Candidates appear after matching runs on a master-data object", action: <Button variant="secondary" render={<Link href="/mdm/match-rules">Tune match rules</Link>} /> }}
        errorProps={{ message: apiErrorMessage(q.error), onRetry: () => q.refetch() }}
        table={
          <div className="flex flex-col gap-3">
            <DataTable columns={dedupColumns} data={items} getRowId={(r) => r.id} onRowClick={setSelected} />
            {total > PAGE_SIZE ? <Pager page={page} pageCount={Math.ceil(total / PAGE_SIZE)} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} /> : null}
          </div>
        }
      />
      <Drawer open={!!selected} onOpenChange={(open) => { if (!open) setSelected(null); }} title={selected ? `${selected.record_key_a} and ${selected.record_key_b}` : "Duplicate pair"}>
        {selected ? <PairDetail pair={selected} onMerged={() => { setSelected(null); void qc.invalidateQueries({ queryKey: ["dedup", "candidates"] }); }} /> : null}
      </Drawer>
    </>
  );
}
