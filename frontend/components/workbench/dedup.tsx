"use client";

/**
 * Workbench, Duplicates: candidate pairs the matcher found, each with its
 * score and the signals that matched. The steward picks which record
 * survives and approves the merge; pairs at 95% or higher can be merged in bulk.
 */

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import {
  Banner, Button, Chip, DataTable, DetailDrawer, EmptyState, FilterBar, KeyValue, Metric, MetricStrip, Mono,
  PageHeader, TableSkeleton, useDrawerParam, type AuroraColumnMeta,
} from "@/components/ui-core";
import { useRole } from "@/hooks/use-role";
import { useUrlState } from "@/hooks/use-url-state";
import { getDedupCandidates, mergeDedupCandidate, type DedupCandidate } from "@/lib/api/cleaning";
import { formatModuleName, relativeTime } from "@/lib/format";

const meta = (m: AuroraColumnMeta) => m;
const BULK_MIN = 95;
/** Scores are 0..100 once stored; a detector may still hand back 0..1. */
const score = (s: number): number => Math.round(s <= 1 ? s * 100 : s);
const matches = (c: DedupCandidate, q: string) => !q || [c.record_key_a, c.record_key_b, c.match_method, c.object_type].join(" ").toLowerCase().includes(q.toLowerCase());
const signalsOf = (c: DedupCandidate) => Object.keys(c.match_fields ?? {}).map((s) => s.replace(/_/g, " "));

export function DedupSurface() {
  const qc = useQueryClient();
  // Merging needs `approve` (api/routes/cleaning.py /dedup/merge).
  const canMerge = useRole().can("approve");
  const [kind, setKind] = useUrlState("kind", "all");
  const drawer = useDrawerParam("pair");
  const [search, setSearch] = useState("");
  const [confirming, setConfirming] = useState(false);
  // Which record survives a merge, per candidate. Defaults to A (listed first); the steward can switch.
  const [survivors, setSurvivors] = useState<Record<string, "a" | "b">>({});
  const survivorKey = (p: DedupCandidate) => ((survivors[p.id] ?? "a") === "a" ? p.record_key_a : p.record_key_b);

  const q = useQuery({ queryKey: ["dedup.candidates"], queryFn: () => getDedupCandidates({ status: "pending" }) });
  const all = useMemo(() => q.data?.items ?? [], [q.data]);
  const objectTypes = useMemo(() => Array.from(new Set(all.map((c) => c.object_type))).sort(), [all]);
  const refresh = () => qc.invalidateQueries({ queryKey: ["dedup.candidates"] });

  const merge = useMutation({
    mutationFn: (p: DedupCandidate) => mergeDedupCandidate({ candidate_id: p.id, survivor_key: survivorKey(p) }),
    onSuccess: (d) => { toast.success(`Merged into ${d.survivor_key}`); drawer.close(); refresh(); },
    onError: (e) => toast.error((e as Error).message || "Not merged"),
  });
  const bulk = useMutation({
    mutationFn: async (cands: DedupCandidate[]) => {
      const results = await Promise.allSettled(cands.map((c) => mergeDedupCandidate({ candidate_id: c.id, survivor_key: survivorKey(c) })));
      return results.filter((r) => r.status === "fulfilled").length;
    },
    onSuccess: (ok, cands) => { (ok === cands.length ? toast.success : toast.warning)(`Merged ${ok} of ${cands.length} pairs`); setConfirming(false); refresh(); },
    onError: (e) => toast.error((e as Error).message || "Bulk merge failed"),
  });

  const filtered = all.filter((c) => (kind === "all" || c.object_type === kind) && matches(c, search));
  const highConfidence = filtered.filter((c) => score(c.match_score) >= BULK_MIN);
  const counts = Object.fromEntries(objectTypes.map((t) => [t, all.filter((c) => c.object_type === t).length])) as Record<string, number>;
  const mean = all.length ? Math.round(all.reduce((a, c) => a + score(c.match_score), 0) / all.length) : null;
  const selected = drawer.value ? all.find((c) => c.id === drawer.value) ?? null : null;

  const columns = useMemo<ColumnDef<DedupCandidate, unknown>[]>(() => [
    { id: "score", header: "Match", meta: meta({ sticky: "start", width: 80, align: "end", numeric: true }), cell: ({ row }) => `${score(row.original.match_score)}%` },
    { id: "pair", header: "Records", meta: meta({ minWidth: 300 }), cell: ({ row }) => (
      <span className="ui-cell-stack">
        <span className="ui-cell-stack__main"><Mono>{row.original.record_key_a}</Mono></span>
        <span className="ui-cell-stack__sub"><Mono>{row.original.record_key_b}</Mono></span>
      </span>) },
    { id: "object", header: "Object", meta: meta({ width: 150 }), cell: ({ row }) => formatModuleName(row.original.object_type) },
    { id: "method", header: "Method", meta: meta({ width: 130 }), cell: ({ row }) => <Mono>{row.original.match_method}</Mono> },
    { id: "signals", header: "Matched on", meta: meta({ minWidth: 200 }), cell: ({ row }) => {
      const s = signalsOf(row.original);
      return s.length ? `${s.slice(0, 3).join(", ")}${s.length > 3 ? `, and ${s.length - 3} more` : ""}` : <span className="ui-micro">—</span>;
    } },
    { id: "age", header: "Found", meta: meta({ width: 100, align: "end" }), cell: ({ row }) => relativeTime(row.original.created_at) },
  ], []);

  return (
    <div className="ui-page">
      <PageHeader title="Duplicates"
        summary={q.data ? `${all.length.toLocaleString()} candidate pair${all.length === 1 ? "" : "s"} waiting for a merge decision.` : undefined}
        actions={canMerge ? (
          <Button onClick={() => setConfirming(true)} disabled={!highConfidence.length || bulk.isPending || confirming}>
            Merge {highConfidence.length} pair{highConfidence.length === 1 ? "" : "s"} at {BULK_MIN}% or higher
          </Button>) : null} />
      <MetricStrip label="Duplicate pairs">
        <Metric label="Pairs to review" value={all.length} tone={all.length ? "warning" : "default"} />
        <Metric label={`At ${BULK_MIN}% or higher`} value={all.filter((c) => score(c.match_score) >= BULK_MIN).length} />
        <Metric label="Mean match" value={mean} unit="%" />
        <Metric label="Objects" value={objectTypes.length} />
      </MetricStrip>
      {confirming ? (
        <Banner tone="danger" title={`Merge ${highConfidence.length} pair${highConfidence.length === 1 ? "" : "s"} scoring ${BULK_MIN}% or higher?`} action={
          <div className="ui-page-header__actions">
            <Button size="sm" variant="danger" onClick={() => bulk.mutate(highConfidence)} disabled={bulk.isPending}>{bulk.isPending ? "Merging" : "Merge pairs"}</Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>Keep reviewing</Button>
          </div>}>
          Each merge keeps the survivor chosen for that pair, record A unless you changed it, and retires the other record. Merges are undone one at a time, not in bulk.
        </Banner>
      ) : null}
      <FilterBar search={{ value: search, onChange: setSearch, placeholder: "Search record keys" }}>
        <Chip selected={kind === "all"} onClick={() => setKind("all")}>All<span className="aurora-number ui-chip-count">{all.length}</span></Chip>
        {objectTypes.map((t) => (
          <Chip key={t} selected={kind === t} onClick={() => setKind(t)}>{formatModuleName(t)}<span className="aurora-number ui-chip-count">{counts[t]}</span></Chip>
        ))}
      </FilterBar>
      {q.isLoading ? <TableSkeleton rows={8} label="Loading candidate pairs" />
        : q.error ? <Banner tone="danger" title="Candidate pairs could not be read">{(q.error as Error).message}</Banner>
        : filtered.length ? <DataTable columns={columns} data={filtered} getRowId={(c) => c.id} onRowActivate={(c) => drawer.open(c.id)}
            ariaLabel="Candidate pairs. Use j and k to move, Enter to open." maxHeight="62vh" />
        : <EmptyState action={all.length ? <button type="button" className="ui-link-button" onClick={() => { setSearch(""); setKind("all"); }}>Clear filters</button> : undefined}>
            {all.length ? "No pairs match these filters." : "No duplicate pairs waiting. The matcher proposes pairs after each analysis, using the match rules."}
          </EmptyState>}

      <DetailDrawer open={!!selected} onClose={drawer.close} ariaLabel="Candidate pair"
        header={selected ? (
          <div className="ui-drawer-head">
            <span className="aurora-number">{score(selected.match_score)}%</span>
            <h2 className="ui-drawer-head__title">{formatModuleName(selected.object_type)} pair</h2>
          </div>) : null}>
        {selected ? (
          <div className="ui-detail">
            <fieldset className="ui-detail-part" style={{ border: 0, padding: 0, margin: 0 }}>
              <legend className="ui-detail-part__title">Record that survives</legend>
              {(["a", "b"] as const).map((side) => {
                const key = side === "a" ? selected.record_key_a : selected.record_key_b;
                return (
                  <label key={side} className="ui-note" style={{ display: "flex", gap: "var(--aurora-space-2)", alignItems: "center" }}>
                    <input type="radio" name={`survivor-${selected.id}`} checked={(survivors[selected.id] ?? "a") === side}
                      onChange={() => setSurvivors((s) => ({ ...s, [selected.id]: side }))} />
                    <Mono>{key}</Mono>
                  </label>
                );
              })}
              <p className="ui-micro">The other record is retired and its references point to the survivor.</p>
            </fieldset>
            <KeyValue rows={[
              { k: "Match score", v: `${score(selected.match_score)}%` },
              { k: "Method", v: selected.match_method, mono: true },
              { k: "Object", v: formatModuleName(selected.object_type) },
              { k: "Found", v: new Date(selected.created_at).toLocaleString() },
            ]} />
            {signalsOf(selected).length ? (
              <section className="ui-detail-part">
                <h3 className="ui-detail-part__title">Matched on</h3>
                <div className="ui-filterbar__chips">{signalsOf(selected).map((s) => <Chip key={s}>{s}</Chip>)}</div>
              </section>
            ) : null}
            {canMerge ? (
              <div className="ui-page-header__actions">
                <Button onClick={() => merge.mutate(selected)} disabled={merge.isPending}>{merge.isPending ? "Merging" : `Merge into ${survivorKey(selected)}`}</Button>
              </div>
            ) : <p className="ui-micro">Merging needs the approve permission.</p>}
          </div>
        ) : null}
      </DetailDrawer>
    </div>
  );
}
