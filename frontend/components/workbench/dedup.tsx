"use client";

/**
 * Workbench → Duplicates: candidate pairs the matcher found, each with its
 * score and the signals that matched. The steward picks which record
 * survives and approves the merge; pairs at 95%+ can be merged in bulk.
 */

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Banner, Button, Chip, EmptyState, Input, KpiRail, Stack, Stat, Text } from "@/components/aurora";
import { useRole } from "@/hooks/use-role";
import { useUrlState } from "@/hooks/use-url-state";
import { getDedupCandidates, mergeDedupCandidate, type DedupCandidate } from "@/lib/api/cleaning";
import { formatModuleName, relativeTime } from "@/lib/format";

const BULK_MIN = 95;
/** Scores are 0..100 once stored; a detector may still hand back 0..1. */
const score = (s: number): number => Math.round(s <= 1 ? s * 100 : s);
const grade = (s: number) => (score(s) >= BULK_MIN ? "high" : score(s) >= 85 ? "mid" : "low");
const matches = (c: DedupCandidate, q: string) => !q || [c.record_key_a, c.record_key_b, c.match_method, c.object_type].join(" ").toLowerCase().includes(q.toLowerCase());

function ScoreRing({ value }: { value: number }) {
  const r = 20, c = 2 * Math.PI * r;
  return (
    <div className="aurora-ring" data-grade={grade(value)} role="img" aria-label={`Match score ${score(value)}%`}>
      <svg width="48" height="48" viewBox="0 0 48 48" aria-hidden="true">
        <circle cx="24" cy="24" r={r} fill="none" stroke="var(--aurora-canvas-line)" strokeWidth="4" />
        <circle cx="24" cy="24" r={r} fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - score(value) / 100)} transform="rotate(-90 24 24)" />
      </svg>
      <span className="aurora-ring__value aurora-number">{score(value)}</span>
    </div>
  );
}

export function DedupSurface() {
  const qc = useQueryClient();
  // Merging needs `approve` (api/routes/cleaning.py /dedup/merge).
  const canMerge = useRole().can("approve");
  const [kind, setKind] = useUrlState("kind", "all");
  const [search, setSearch] = useState("");
  const [confirming, setConfirming] = useState(false);
  // Which record survives a merge, per candidate. Defaults to A (listed first); the steward can swap.
  const [survivors, setSurvivors] = useState<Record<string, "a" | "b">>({});
  const survivorKey = (p: DedupCandidate) => ((survivors[p.id] ?? "a") === "a" ? p.record_key_a : p.record_key_b);

  const q = useQuery({ queryKey: ["dedup.candidates"], queryFn: () => getDedupCandidates({ status: "pending" }) });
  const loading = q.isLoading;
  const error = q.error as Error | null;
  const all = useMemo(() => q.data?.items ?? [], [q.data]);
  const objectTypes = useMemo(() => Array.from(new Set(all.map((c) => c.object_type))).sort(), [all]);
  const refresh = () => qc.invalidateQueries({ queryKey: ["dedup.candidates"] });

  const merge = useMutation({
    mutationFn: (p: DedupCandidate) => mergeDedupCandidate({ candidate_id: p.id, survivor_key: survivorKey(p) }),
    onSuccess: (d) => { toast.success(`Merged into ${d.survivor_key}`); refresh(); },
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

  return (
    <Stack gap={5} className="aurora-page">
      <KpiRail>
        <Stat label="Pairs to review" value={all.length} tone={all.length ? "warning" : "neutral"} />
        <Stat label={`Scoring ${BULK_MIN}%+`} value={all.filter((c) => score(c.match_score) >= BULK_MIN).length} tone="neutral" />
        <Stat label="Mean match" value={mean ?? "—"} unit={mean === null ? undefined : "%"} />
        <Stat label="Objects" value={objectTypes.length} />
      </KpiRail>
      <Stack direction="row" gap={2} wrap align="center">
        <Chip selected={kind === "all"} onClick={() => setKind("all")}>All · {all.length}</Chip>
        {objectTypes.map((t) => <Chip key={t} selected={kind === t} onClick={() => setKind(t)}>{formatModuleName(t)} · {counts[t]}</Chip>)}
        <span style={{ flex: 1 }} />
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Filter pairs…" aria-label="Filter pairs" style={{ width: 220 }} />
        {canMerge ? <Button onClick={() => setConfirming(true)} disabled={!highConfidence.length || bulk.isPending || confirming}>Bulk merge {highConfidence.length ? `(${highConfidence.length})` : ""}</Button> : null}
      </Stack>
      {confirming ? (
        <Banner tone="danger" title={`Merge ${highConfidence.length} pair${highConfidence.length === 1 ? "" : "s"} scoring ${BULK_MIN}% or higher?`} action={
          <Stack direction="row" gap={2}>
            <Button size="sm" variant="danger" onClick={() => bulk.mutate(highConfidence)} disabled={bulk.isPending}>{bulk.isPending ? "Merging…" : "Merge"}</Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>Keep reviewing</Button>
          </Stack>}>
          Each merge keeps the survivor selected on its card and retires the other record. Merges are undone one at a time, not in bulk.
        </Banner>
      ) : null}
      {loading && !all.length ? <Text tone="muted">Reading candidate pairs.</Text>
        : error && !all.length ? <Banner tone="danger" title="Candidate pairs could not be read">{error.message}</Banner>
        : filtered.length ? (
          <div className="aurora-dedup">
            {filtered.map((p) => {
              const keep = survivors[p.id] ?? "a";
              const signals = Object.keys(p.match_fields ?? {});
              return (
                <article key={p.id} className="aurora-dedup__card" aria-label={`${p.record_key_a} and ${p.record_key_b}`}>
                  <Stack direction="row" gap={2} align="center">
                    <Chip>{formatModuleName(p.object_type)}</Chip>
                    <Text variant="text-micro" tone="muted" className="aurora-number">{p.id.slice(0, 8)} · {p.match_method} · {relativeTime(p.created_at)}</Text>
                    <span style={{ flex: 1 }} />
                    <ScoreRing value={p.match_score} />
                  </Stack>
                  <div className="aurora-dedup__pair">
                    <div className="aurora-dedup__rec" data-keep={keep === "a"}>
                      <Text variant="text-micro" tone="muted" className="aurora-exec__eyebrow">{keep === "a" ? "Keep" : "Merge from"}</Text>
                      <Text variant="text-body" className="aurora-number">{p.record_key_a}</Text>
                    </div>
                    <button type="button" className="aurora-dedup__swap aurora-focus-ring" onClick={() => setSurvivors((s) => ({ ...s, [p.id]: keep === "a" ? "b" : "a" }))}
                      title="Swap which record survives" aria-label="Swap which record survives the merge">⇄</button>
                    <div className="aurora-dedup__rec" data-keep={keep === "b"}>
                      <Text variant="text-micro" tone="muted" className="aurora-exec__eyebrow">{keep === "b" ? "Keep" : "Merge from"}</Text>
                      <Text variant="text-body" className="aurora-number">{p.record_key_b}</Text>
                    </div>
                  </div>
                  {signals.length ? <Stack direction="row" gap={1} wrap>{signals.slice(0, 8).map((s) => <Chip key={s} tone="success">{s.replace(/_/g, " ")}</Chip>)}</Stack> : null}
                  <Stack direction="row" gap={2} align="center">
                    <Text variant="text-small" tone="secondary">Survivor: <span className="aurora-number">{survivorKey(p)}</span></Text>
                    <span style={{ flex: 1 }} />
                    {canMerge ? <Button size="sm" onClick={() => merge.mutate(p)} disabled={merge.isPending}>Approve merge</Button> : null}
                  </Stack>
                </article>
              );
            })}
          </div>
        ) : <EmptyState title={all.length ? "No pairs match." : "No duplicate pairs waiting."} body={all.length ? "Loosen the filter or clear the search." : "The matcher proposes pairs after each analysis using the match rules."} />}
    </Stack>
  );
}
