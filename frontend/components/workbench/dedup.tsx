"use client";

/**
 * Workbench, Duplicates: candidate pairs the matcher found, each with its
 * score and the signals that matched. The steward picks which record
 * survives and approves the merge; pairs at 95% or higher can be merged in bulk.
 */

import { useMemo, useState } from "react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { toast } from "sonner";
import {
  Banner, Button, Chip, CountChips, DataTable, DetailDrawer, EmptyState, FieldChip, FilterBar, KeyValue, Mono,
  PageHeader, TableSkeleton, Tally, useDrawerParam, type AuroraColumnMeta,
} from "@/components/ui-core";
import { useRole } from "@/hooks/use-role";
import { useUrlState } from "@/hooks/use-url-state";
import { getDedupCandidates, getDedupPreview, mergeDedupCandidate, type DedupCandidate } from "@/lib/api/cleaning";
import { formatModuleName, labelOf, relativeTime, formatDate } from "@/lib/format";

const meta = (m: AuroraColumnMeta) => m;
const BULK_MIN = 95;
/** Scores are 0..100 once stored; a detector may still hand back 0..1. */
const score = (s: number): number => Math.round(s <= 1 ? s * 100 : s);
const matches = (c: DedupCandidate, q: string) => !q || [c.record_key_a, c.record_key_b, c.match_method, c.object_type].join(" ").toLowerCase().includes(q.toLowerCase());
const signalsOf = (c: DedupCandidate) => Object.keys(c.match_fields ?? {});
type Preview = Record<string, { a: string; b: string; survivor: string }>;
/** The business name of one side of a pair, read from the field that ends in NAME1 or NAME. */
const nameOf = (p: Preview | undefined, side: "a" | "b"): string | null => {
  const k = Object.keys(p ?? {}).find((f) => /(^|\.)NAME1?$/.test(f));
  return (k && p?.[k][side]) || null;
};
/** The SAP number of one side, from the field that ends in LIFNR, KUNNR, MATNR or PARTNER. */
const numberOf = (p: Preview | undefined, side: "a" | "b"): { field: string; value: string } | null => {
  const k = Object.keys(p ?? {}).find((f) => /(LIFNR|KUNNR|MATNR|PARTNER)$/.test(f));
  return k && p?.[k][side] ? { field: k.slice(k.lastIndexOf(".") + 1), value: p[k][side] } : null;
};
const PREVIEW_LIMIT = 50;
const BULK_SHOWN = 5;

export function DedupSurface() {
  const qc = useQueryClient();
  // Merging needs `approve` (api/routes/cleaning.py /dedup/merge).
  const canMerge = useRole().can("approve");
  const [kind, setKind] = useUrlState("kind", "all");
  const [sort, setSort] = useUrlState("sort");
  const drawer = useDrawerParam("pair");
  const [search, setSearch] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [confirmOne, setConfirmOne] = useState<string | null>(null);
  // Which record survives a merge, per candidate. Defaults to A (listed first); the steward can switch.
  const [survivors, setSurvivors] = useState<Record<string, "a" | "b">>({});
  const survivorKey = (p: DedupCandidate) => ((survivors[p.id] ?? "a") === "a" ? p.record_key_a : p.record_key_b);

  const q = useQuery({ queryKey: ["dedup.candidates"], queryFn: () => getDedupCandidates({ status: "pending" }) });
  const all = useMemo(() => q.data?.items ?? [], [q.data]);
  const objectTypes = useMemo(() => Array.from(new Set(all.map((c) => c.object_type))).sort(), [all]);
  const refresh = () => qc.invalidateQueries({ queryKey: ["dedup.candidates"] });
  // Names live on the merge preview, one call per pair; a failed call leaves the key.
  const previews = useQueries({
    queries: all.slice(0, PREVIEW_LIMIT).map((c) => ({
      queryKey: ["dedup.preview", c.id],
      queryFn: () => getDedupPreview({ record_key_a: c.record_key_a, record_key_b: c.record_key_b, object_type: c.object_type }),
      retry: false, staleTime: 5 * 60_000, meta: { ignoreError: true },
    })),
  });
  const previewOf = new Map<string, Preview>();
  all.slice(0, PREVIEW_LIMIT).forEach((c, i) => { const d = previews[i]?.data; if (d) previewOf.set(c.id, d.merge_preview); });

  const merge = useMutation({
    mutationFn: (p: DedupCandidate) => mergeDedupCandidate({ candidate_id: p.id, survivor_key: survivorKey(p) }),
    onSuccess: (d) => { toast.success(`Merged into ${d.survivor_key}`); setConfirmOne(null); drawer.close(); refresh(); },
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
  const high = all.filter((c) => score(c.match_score) >= BULK_MIN).length;
  const records = new Set(all.flatMap((c) => [c.record_key_a, c.record_key_b])).size;
  const selected = drawer.value ? all.find((c) => c.id === drawer.value) ?? null : null;

  const side = (c: DedupCandidate, which: "a" | "b") => {
    const pv = previewOf.get(c.id), name = nameOf(pv, which), no = numberOf(pv, which);
    const key = which === "a" ? c.record_key_a : c.record_key_b;
    return (
      <span className="ui-cell-stack">
        <span className="ui-cell-stack__main">{name ?? <Mono>{key}</Mono>}</span>
        {name ? <span className="ui-cell-stack__sub">{no ? <><FieldChip field={no.field} /> <Mono>{no.value}</Mono></> : <Mono>{key}</Mono>}</span> : null}
      </span>
    );
  };
  const columns: ColumnDef<DedupCandidate, unknown>[] = [
    { id: "left", header: "Left record", accessorFn: (c) => nameOf(previewOf.get(c.id), "a") ?? c.record_key_a, meta: meta({ sticky: "start", minWidth: 200 }), cell: ({ row }) => side(row.original, "a") },
    { id: "right", header: "Right record", accessorFn: (c) => nameOf(previewOf.get(c.id), "b") ?? c.record_key_b, meta: meta({ minWidth: 200 }), cell: ({ row }) => side(row.original, "b") },
    { id: "object", header: "Object", accessorFn: (c) => formatModuleName(c.object_type), meta: meta({ width: 150 }) },
    { id: "method", header: "Method", accessorFn: (c) => labelOf(c.match_method), meta: meta({ width: 140 }) },
    { id: "signals", header: "Matched on", enableSorting: false, meta: meta({ minWidth: 200 }), cell: ({ row }) => {
      const s = signalsOf(row.original);
      return s.length ? <span className="ui-filterbar__chips">{s.slice(0, 3).map((f) => <FieldChip key={f} field={f} />)}{s.length > 3 ? ` and ${s.length - 3} more` : ""}</span> : <span className="ui-micro">—</span>;
    } },
    { id: "score", header: "Score", accessorFn: (c) => score(c.match_score), meta: meta({ width: 80, align: "end", numeric: true }), cell: ({ row }) => `${score(row.original.match_score)}%` },
    { id: "age", header: "Found", accessorFn: (c) => c.created_at, meta: meta({ width: 100, align: "end" }), cell: ({ row }) => relativeTime(row.original.created_at) },
  ];

  return (
    <div className="ui-page">
      <PageHeader title="Duplicates"
        summary={q.data ? `${all.length.toLocaleString()} candidate pair${all.length === 1 ? "" : "s"} waiting for a merge decision.` : undefined}
        actions={canMerge ? (
          <Button onClick={() => setConfirming(true)} disabled={!highConfidence.length || bulk.isPending || confirming}>
            Merge {highConfidence.length} pair{highConfidence.length === 1 ? "" : "s"} at {BULK_MIN}% or higher
          </Button>) : null} />
      <Tally level={2} label="Duplicate pairs" figures={[
        { label: "Pairs to review", value: q.isLoading ? null : all.length, loading: q.isLoading, tone: all.length ? "warning" : undefined, verdict: all.length ? "Waiting for a merge decision." : "No duplicates waiting.", href: "/dedup" },
        ...(all.length < 5
          ? [{ label: "Records affected", value: q.isLoading ? null : records, loading: q.isLoading, verdict: records ? "Records in these pairs." : "No records are in a pair.", href: "/dedup" }]
          : [
            { label: `At ${BULK_MIN}% or higher`, value: q.isLoading ? null : high, loading: q.isLoading, verdict: high ? "Safe to merge in bulk after a check." : "No pairs safe to bulk merge.", href: "/dedup" },
            { label: "Objects", value: q.isLoading ? null : objectTypes.length, loading: q.isLoading, verdict: objectTypes.length ? "With pairs to review." : "No objects have duplicates.", href: "/dedup" },
          ]),
      ]} />
      {confirming ? (
        <Banner tone="danger" title={`Merge ${highConfidence.length} pair${highConfidence.length === 1 ? "" : "s"} scoring ${BULK_MIN}% or higher?`} action={
          <div className="ui-page-header__actions">
            <Button size="sm" variant="danger" onClick={() => bulk.mutate(highConfidence)} disabled={bulk.isPending}>{bulk.isPending ? "Merging" : "Merge pairs"}</Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>Keep reviewing</Button>
          </div>}>
          <ul className="ui-plain-list">
            {highConfidence.slice(0, BULK_SHOWN).map((c) => {
              const pv = previewOf.get(c.id), keepA = (survivors[c.id] ?? "a") === "a";
              const label = (w: "a" | "b") => nameOf(pv, w) ?? (w === "a" ? c.record_key_a : c.record_key_b);
              return <li key={c.id}>Keep {label(keepA ? "a" : "b")}, retire {label(keepA ? "b" : "a")}, {score(c.match_score)}% match.</li>;
            })}
            {highConfidence.length > BULK_SHOWN ? <li>And {highConfidence.length - BULK_SHOWN} more pairs.</li> : null}
          </ul>
          Each merge keeps the survivor chosen for that pair, the left record unless you changed it, and retires the other record. Merges are undone one at a time, not in bulk. Nothing is written to SAP.
        </Banner>
      ) : null}
      <FilterBar search={{ value: search, onChange: setSearch, placeholder: "Search record keys" }}>
        <CountChips value={kind === "all" ? "" : kind} onChange={(v) => setKind(v || "all")}
          options={objectTypes.map((t) => ({ value: t, label: formatModuleName(t), count: counts[t] }))} />
      </FilterBar>
      {q.isLoading ? <TableSkeleton rows={8} label="Loading candidate pairs" />
        : q.error ? <Banner tone="danger" title="Candidate pairs could not be read">{(q.error as Error).message}</Banner>
        : filtered.length ? <DataTable columns={columns} data={filtered} getRowId={(c) => c.id} onRowActivate={(c) => drawer.open(c.id)}
            ariaLabel="Candidate pairs. Use j and k to move, Enter to open." maxHeight="62vh"
            sort={sort} onSortChange={setSort} collapseUniform />
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
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--aurora-space-3)" }}>
                {(["a", "b"] as const).map((side) => {
                  const key = side === "a" ? selected.record_key_a : selected.record_key_b;
                  const keep = (survivors[selected.id] ?? "a") === side;
                  return (
                    <label key={side} className="ui-note" style={{ display: "flex", flexDirection: "column", gap: "var(--aurora-space-1)", padding: "var(--aurora-space-3)", border: `1px solid ${keep ? "var(--aurora-fg-primary)" : "var(--aurora-canvas-line)"}` }}>
                      <span><input type="radio" name={`survivor-${selected.id}`} checked={keep}
                        onChange={() => { setConfirmOne(null); setSurvivors((x) => ({ ...x, [selected.id]: side })); }} /> {keep ? "Survivor" : "Retired"}</span>
                      {nameOf(previewOf.get(selected.id), side) ? <span>{nameOf(previewOf.get(selected.id), side)}</span> : null}
                      <Mono>{key}</Mono>
                    </label>
                  );
                })}
              </div>
              <p className="ui-micro">The other record is retired and its references point to the survivor.</p>
            </fieldset>
            <KeyValue rows={[
              { k: "Match score", v: `${score(selected.match_score)}%` },
              { k: "Method", v: selected.match_method, mono: true },
              { k: "Object", v: formatModuleName(selected.object_type) },
              { k: "Found", v: formatDate(selected.created_at, "datetime") },
            ]} />
            {signalsOf(selected).length ? (
              <section className="ui-detail-part">
                <h3 className="ui-detail-part__title">Matched on</h3>
                <div className="ui-filterbar__chips">{signalsOf(selected).map((s) => <Chip key={s}>{s}</Chip>)}</div>
              </section>
            ) : null}
            {canMerge ? (
              confirmOne === selected.id ? (
                <Banner tone="danger" title={`Merge into ${survivorKey(selected)}?`} action={
                  <div className="ui-page-header__actions">
                    <Button size="sm" variant="danger" onClick={() => merge.mutate(selected)} disabled={merge.isPending}>{merge.isPending ? "Merging" : "Merge records"}</Button>
                    <Button size="sm" variant="ghost" onClick={() => setConfirmOne(null)}>Keep reviewing</Button>
                  </div>}>
                  The other record is retired. This changes Meridian&apos;s data only, nothing is written to SAP.
                </Banner>
              ) : (
                <div className="ui-page-header__actions">
                  <Button onClick={() => setConfirmOne(selected.id)}>Merge into {survivorKey(selected)}</Button>
                </div>
              )
            ) : <p className="ui-micro">Merging needs the approve permission.</p>}
          </div>
        ) : null}
      </DetailDrawer>
    </div>
  );
}
