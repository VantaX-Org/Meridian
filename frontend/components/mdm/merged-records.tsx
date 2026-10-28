"use client";

/**
 * The records merged into one golden record, why each pair matched, and splitting one back out with a preview
 * of what the golden record keeps before anything is saved.
 */

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { ConfirmDialog, DataTable, ErrorState, Field, Mono, Notice, Skeleton, Textarea, toast } from "@/design";
import { useRole } from "@/hooks/use-role";
import { apiErrorMessage, apiErrorState } from "@/lib/error";
import { previewUnmerge } from "@/lib/api/match-review";
import { getClusterGraph, getMergeExplanation, revertMergeEvent, unmergeRecords, type PairExplanation, type WeakChain } from "@/lib/api/merge-explain";
import { LedgerHead, RowButton, actionColumn } from "./ledger";
import { pct, show, whyMatched } from "./match-review-model";

type Member = { key: string; pair: PairExplanation | undefined; links: number | null };

/** Why two members sit in one golden record only through a third (api/services/merge_explain.py cluster_graph). */
const WEAK_REASON: Record<WeakChain["reason"], string> = {
  no_direct_score: "they were never scored against each other",
  direct_score_below_threshold: "their own score is below the auto-merge threshold",
  do_not_match: "a steward marked them not a match",
};

/** Fields whose golden value a split would change, as before / after. */
export function changedFields(before: Record<string, unknown>, after: Record<string, unknown>): { field: string; before: string; after: string }[] {
  return Array.from(new Set([...Object.keys(before), ...Object.keys(after)])).sort()
    .map((field) => ({ field, before: show(before[field]), after: show(after[field]) }))
    .filter((r) => r.before !== r.after);
}

export function MergedRecords({ id, onChanged }: { id: string; onChanged: () => void }) {
  const qc = useQueryClient();
  const canSplit = useRole().can("approve");
  const key = ["mdm", "merge-explain", id];
  const q = useQuery({ queryKey: key, queryFn: () => getMergeExplanation(id), retry: false, meta: { ignoreError: true } });
  // The cluster's shape: how many scored links each member has, and members joined only through another.
  const graph = useQuery({ queryKey: [...key, "cluster-graph"], queryFn: () => getClusterGraph(id), retry: false, meta: { ignoreError: true } });
  const [splitKey, setSplitKey] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  const preview = useQuery({
    queryKey: [...key, "split-preview", splitKey],
    queryFn: () => previewUnmerge(id, [splitKey ?? ""], "Preview"),
    enabled: !!splitKey,
  });
  const split = useMutation({
    mutationFn: () => unmergeRecords(id, [splitKey ?? ""], reason.trim()),
    onSuccess: (r) => {
      toast.undoable(`Split ${r.split_keys.join(", ")} out. It will not be merged back automatically`, {
        undo: async () => { await revertMergeEvent(r.event_id, "Undone from the golden record"); await qc.invalidateQueries({ queryKey: key }); onChanged(); },
      });
      setSplitKey(null);
      setReason("");
      void qc.invalidateQueries({ queryKey: key });
      onChanged();
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  // Stable columns: a cell redefined on every render remounts, and its button loses the click.
  const cols = useMemo<ColumnDef<Member>[]>(() => [
    { id: "key", header: "Record", cell: ({ row }) => <Mono>{row.original.key}</Mono> },
    { id: "links", header: "Links", size: 80, meta: { numeric: true }, cell: ({ row }) => (row.original.links == null ? "" : row.original.links.toLocaleString()) },
    { id: "score", header: "Score", size: 90, meta: { numeric: true }, cell: ({ row }) => (row.original.pair ? pct(row.original.pair.total) : "") }, // counts-ok: a match score, not the data quality score
    { id: "why", header: "Why it was merged", cell: ({ row }) => <span className="m-ink-2">{row.original.pair ? whyMatched(row.original.pair.explanation) : "Merged by a steward"}</span> },
    actionColumn((m) => (canSplit ? <RowButton label={`Split ${m.key} out`} onClick={() => setSplitKey(m.key)}>Split out</RowButton> : null)),
  ], [canSplit]);

  if (q.isLoading) return <Skeleton height={80} />;
  if (q.isError || !q.data) return <ErrorState {...apiErrorState(q.error)} onRetry={() => void q.refetch()} />;
  const ex = q.data;
  if (!ex.members.length) return null;

  const pairWith = (k: string) => ex.pairs.find((p) => (p.a === k && p.b === ex.key) || (p.b === k && p.a === ex.key)) ?? ex.pairs.find((p) => p.a === k || p.b === k);
  const degree = new Map((graph.data?.nodes ?? []).map((n) => [n.key, n.degree]));
  const rows: Member[] = ex.members.map((k) => ({ key: k, pair: pairWith(k), links: degree.get(k) ?? null }));
  const weak = graph.data?.weak_chains ?? [];
  const changes = preview.data ? changedFields(ex.golden_fields, preview.data.golden_fields) : [];

  return (
    <section aria-label="Merged records">
      <LedgerHead title="Merged records" meta={`${ex.members.length.toLocaleString()} merged into ${ex.key}`} />
      <DataTable columns={cols} data={rows} getRowId={(r) => r.key} hideToolbar hideSearch height="auto" />
      {weak.length ? (
        <div className="mt-2">
          <Notice tone="warning" title={`${weak.length.toLocaleString()} ${weak.length === 1 ? "pair is" : "pairs are"} joined only through another record`}>
            <ul className="flex flex-col gap-1">
              {weak.map((w) => (
                <li key={`${w.a}|${w.via}|${w.b}`}>
                  <Mono inline>{w.a}</Mono> and <Mono inline>{w.b}</Mono> are linked through <Mono inline>{w.via}</Mono>: {WEAK_REASON[w.reason] ?? w.reason}
                </li>
              ))}
            </ul>
          </Notice>
        </div>
      ) : null}
      <ConfirmDialog
        open={!!splitKey}
        onOpenChange={(o) => { if (!o) { setSplitKey(null); setReason(""); } }}
        title={`Split ${splitKey ?? ""} out of this golden record?`}
        confirmLabel="Split out"
        cancelLabel="Keep merged"
        tone="danger"
        pending={split.isPending}
        confirmDisabled={!reason.trim()}
        onConfirm={() => { if (reason.trim()) split.mutate(); }}
        body={
          <div className="flex flex-col gap-3 m-text-body">
            <p className="m-ink-2">It becomes its own record again and is marked not a match with the rest, so a later match run does not merge it back.</p>
            {preview.isLoading ? <Skeleton height={60} /> : preview.isError ? (
              <Notice tone="warning">{apiErrorMessage(preview.error)}</Notice>
            ) : changes.length ? (
              <table className="m-table" aria-label="What the golden record keeps">
                <thead><tr><th>Field</th><th>Now</th><th>After the split</th></tr></thead>
                <tbody>
                  {changes.map((c) => (
                    <tr key={c.field}>
                      <td><Mono>{c.field}</Mono></td>
                      <td>{c.before || "blank"}</td>
                      <td className="font-semibold">{c.after || "blank"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="m-ink-3">No golden value changes; this record only added a duplicate.</p>
            )}
            <Field label="Reason (required), kept in the merge history">
              <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="Different legal entity" aria-required="true" />
            </Field>
            {reason.trim() ? null : <p className="m-text-meta m-ink-3">Give a reason to split it out</p>}
          </div>
        }
      />
    </section>
  );
}
