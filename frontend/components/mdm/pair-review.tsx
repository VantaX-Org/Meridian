"use client";

/**
 * One scored pair, decided in one place (the right pane of the match review workbench): the two records side by
 * side, field by field, with the values that differ washed in the at-risk tone and the identical ones folded away;
 * the golden record a merge would build (pick a value per field, preview exactly what would be stored); and the
 * verdict: merge, not a match, or skip. `m`, `n` and `s` decide from the keyboard (the workbench owns `j` / `k`).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, ErrorState, Field, Mono, Notice, Pill, Radio, Skeleton, Textarea, toast } from "@/design";
import { useRole } from "@/hooks/use-role";
import { GatedPrimary, primaryRole } from "@/components/gated-primary";
import { apiErrorMessage, apiErrorState } from "@/lib/error";
import { keyBelongsElsewhere } from "@/lib/inbox-keys";
import { useIsMac } from "@/lib/shortcuts";
import { queryKeys } from "@/lib/query-keys";
import { formatModuleName } from "@/lib/format";
import { getReviewPair, mergePair, type ReviewPairDetail } from "@/lib/api/match-review";
import { clearPairConstraint, decidePair, undoLastMerge, type AttributeExplanation } from "@/lib/api/merge-explain";
import { CompareTable, TD, TD_DIFFERS, TH } from "./compare-table";
import {
  BAND_LABEL, defaultPicks, overridesFromPicks, pairFields, pct, show, whyMatched, winnerPicks,
  type Picks, type Side,
} from "./match-review-model";

export const matchReviewKey = ["mdm", "match-review"] as const;

type Verdict = "merge" | "reject";
type FieldRow = { field: string; a: unknown; b: unknown; same: boolean; attr: AttributeExplanation | undefined };

/** One sentence on why the matcher paired them: the score, its band and the fields that agreed or differed. */
export function WhyMatched({ pair }: { pair: Pick<ReviewPairDetail, "explanation" | "total" | "band"> }) {
  return (
    <p className="m-text-body m-ink-2">
      Score {pct(pair.total)}, {BAND_LABEL[pair.band].toLowerCase()}. {whyMatched(pair.explanation)}.
    </p>
  );
}

export function PairReview({ pairId, onDone, onSkip }: { pairId: string; onDone: () => void; onSkip: () => void }) {
  const qc = useQueryClient();
  const router = useRouter();
  const canDecide = useRole().can("approve");
  const detail = useQuery({ queryKey: [...matchReviewKey, "pair", pairId], queryFn: () => getReviewPair(pairId) });
  const [survivorPick, setSurvivorPick] = useState<Side | null>(null);
  const [userPicks, setUserPicks] = useState<Picks>({});
  const [reason, setReason] = useState("");
  const [armed, setArmed] = useState<Verdict | null>(null);
  const [showSame, setShowSame] = useState(false);
  // The reason box, focused when a verdict key needs a reason first (Textarea takes no ref, so its wrapper does).
  const reasonRef = useRef<HTMLDivElement>(null);
  const isMac = useIsMac();

  const d = detail.data;
  const a = useMemo(() => d?.record_a.fields ?? {}, [d]);
  const b = useMemo(() => d?.record_b.fields ?? {}, [d]);
  const survivor: Side = survivorPick ?? (d && d.default_survivor === d.b ? "b" : "a");
  const survivorKey = d ? (survivor === "a" ? d.a : d.b) : "";
  const mergeable = !!d && !d.same_cluster && !d.constraint && !!d.a_record_id && !!d.b_record_id;
  const decidable = canDecide && mergeable;

  const base = useQuery({
    queryKey: [...matchReviewKey, "preview", pairId, survivorKey],
    queryFn: () => mergePair(pairId, { survivor: survivorKey, dry_run: true }),
    enabled: decidable,
  });
  const basePicks = useMemo(
    () => winnerPicks(base.data?.survivorship, d?.a ?? "", d?.b ?? "", defaultPicks(a, b, survivor)),
    [base.data, d, a, b, survivor],
  );
  const picks: Picks = { ...basePicks, ...userPicks };
  const overrides = overridesFromPicks(picks, basePicks, a, b);
  const hasOverrides = Object.keys(overrides).length > 0;
  const picked = useQuery({
    queryKey: [...matchReviewKey, "preview", pairId, survivorKey, overrides],
    queryFn: () => mergePair(pairId, { survivor: survivorKey, overrides, dry_run: true }),
    enabled: decidable && hasOverrides,
  });
  const preview = hasOverrides ? picked : base;

  const refresh = () => qc.invalidateQueries({ queryKey: matchReviewKey });
  const merge = useMutation({
    mutationFn: () => mergePair(pairId, { survivor: survivorKey, overrides, reason: reason.trim() }),
    onSuccess: (r) => {
      const undo = async () => { await undoLastMerge(r.golden_record_id, "Undone from match review"); await refresh(); };
      // Undo stays the action; the golden record the merge produced is one click away beside it.
      toast(`Merged ${r.merged_key} into ${r.survivor_key}`, {
        duration: 8000,
        action: { label: "Undo", onClick: () => { undo().then(() => { toast("Undone"); }, () => { toast.error("Could not undo"); }); } },
        cancel: r.golden_record_id ? { label: "Open golden record", onClick: () => router.push(`/mdm/golden/${r.golden_record_id}`) } : undefined,
      });
      void refresh();
      // The pair's merge_decision task in the Inbox is resolved by the merge.
      void qc.invalidateQueries({ queryKey: ["inbox"] });
      void qc.invalidateQueries({ queryKey: queryKeys.shellCounts() });
      onDone();
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });
  const reject = useMutation({
    mutationFn: () => decidePair(pairId, "reject", reason.trim()),
    onSuccess: (r) => {
      toast.undoable("Marked not a match. This pair will not be suggested again", {
        undo: async () => { await clearPairConstraint(r.constraint_id, "Undone from match review"); await refresh(); },
      });
      void refresh();
      onDone();
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  const busy = merge.isPending || reject.isPending;
  const noReason = !reason.trim();
  const mergeBlocked = busy || noReason || (hasOverrides && picked.isLoading);

  /** A verdict from the keyboard: with a reason it is sent; without one the reason box takes focus and remembers it. */
  const decide = (v: Verdict) => {
    if (!decidable || busy) return;
    if (noReason) { setArmed(v); reasonRef.current?.querySelector("textarea")?.focus(); return; }
    if (v === "merge") { if (!mergeBlocked) merge.mutate(); } else reject.mutate();
  };

  // m merges, n marks not a match, s skips. Fields, dialogs and menus keep their keys.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // A held key repeats; a verdict is sent once.
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey || keyBelongsElsewhere(e)) return;
      if (e.key === "m") { e.preventDefault(); decide("merge"); }
      else if (e.key === "n") { e.preventDefault(); decide("reject"); }
      else if (e.key === "s" && !busy) { e.preventDefault(); onSkip(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (detail.isLoading) return <Skeleton height={320} />;
  if (detail.isError || !d) return <ErrorState {...apiErrorState(detail.error)} onRetry={() => void detail.refetch()} />;

  const attrs = new Map((d.explanation?.attributes ?? []).map((x) => [x.field, x]));
  const rows: FieldRow[] = pairFields(a, b)
    .map((field) => ({ field, a: a[field], b: b[field], same: show(a[field]) === show(b[field]), attr: attrs.get(field) }));
  const differing = rows.filter((r) => !r.same);
  const same = rows.filter((r) => r.same);
  const golden = preview.data?.golden_fields;
  const editable = decidable;

  const sideCell = (r: FieldRow, side: Side) => {
    const text = show(side === "a" ? r.a : r.b);
    if (r.same || !editable) return text || <span className="m-ink-3">blank</span>;
    return (
      <Radio
        name={`pick-${r.field}`}
        label={text || "blank"}
        checked={picks[r.field] === side}
        onChange={() => setUserPicks((p) => ({ ...p, [r.field]: side }))}
        aria-label={`Use ${side === "a" ? "record A" : "record B"} value for ${r.field}`}
      />
    );
  };
  const goldenCell = (r: FieldRow) => {
    const v = golden ? show(golden[r.field]) : show(picks[r.field] === "a" ? r.a : r.b);
    return r.field in overrides
      ? <span className="inline-flex items-center gap-2 font-semibold m-ink-accent-ink">{v || "blank"}<Pill tone="info">Your pick</Pill></span>
      : <>{v || <span className="m-ink-3">blank</span>}</>;
  };
  const row = (r: FieldRow) => (
    <tr key={r.field} data-differs={r.same ? undefined : "true"}>
      <th scope="row" className={`${TD} text-left font-normal`}>
        <span className="inline-flex flex-wrap items-center gap-2"><Mono>{r.field}</Mono>{r.same ? null : <Pill tone="at-risk">Differs</Pill>}</span>
      </th>
      <td className={`${TD} ${r.same ? "" : TD_DIFFERS}`}>{sideCell(r, "a")}</td>
      <td className={`${TD} ${r.same ? "" : TD_DIFFERS}`}>{sideCell(r, "b")}</td>
      <td className={`${TD} text-right m-numeric m-ink-2`}>{r.attr?.similarity == null ? "" : pct(r.attr.similarity)}</td>
      <td className={TD}>{goldenCell(r)}</td>
    </tr>
  );

  return (
    <div className="flex flex-col gap-4" data-testid="pair-review">
      <header className="flex flex-col gap-1">
        <h2 className="m-text-h font-semibold m-ink inline-flex flex-wrap items-center gap-2">
          <Mono>{d.a}</Mono><span className="m-ink-3 font-normal">and</span><Mono>{d.b}</Mono>
        </h2>
        <p className="m-text-meta m-ink-3">
          {formatModuleName(d.domain)}
          {d.record_a.record_id ? <>, <Link className="m-ink-accent-ink underline" href={`/mdm/golden/${d.record_a.record_id}`}>open A</Link></> : null}
          {d.record_b.record_id ? <>, <Link className="m-ink-accent-ink underline" href={`/mdm/golden/${d.record_b.record_id}`}>open B</Link></> : null}
        </p>
        <WhyMatched pair={d} />
      </header>

      {d.same_cluster ? (
        <Notice tone="success">These records are already in one golden record.</Notice>
      ) : d.constraint === "do_not_match" ? (
        <Notice tone="info">A steward marked these as not a match. Clear it under Match rules, Settled pairs, to review them again.</Notice>
      ) : !d.a_record_id || !d.b_record_id ? (
        <Notice tone="warning">One of these records has no golden record yet, so it cannot be merged. Golden records are built after matching runs.</Notice>
      ) : !canDecide ? (
        <section aria-label="Decision" className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <GatedPrimary kind="approve" allowed={false}>Merge</GatedPrimary>
            <Button variant="ghost" onClick={onSkip}>Skip</Button>
          </div>
          <p className="m-text-meta m-ink-3">Merging a pair or marking it not a match needs {primaryRole("approve")} on all systems</p>
        </section>
      ) : (
        <section aria-label="Decision" className="flex flex-col gap-3">
          <div ref={reasonRef}><Field label="Reason (required), kept in the merge history">
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") { e.currentTarget.blur(); setArmed(null); }
                else if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && armed) { e.preventDefault(); const v = armed; setArmed(null); if (reason.trim()) decide(v); }
              }}
              rows={2}
              placeholder="Same tax number and address"
              aria-required="true"
            />
          </Field></div>
          <div className="flex flex-wrap items-center gap-2">
            <Button pending={merge.isPending} disabled={mergeBlocked} onClick={() => merge.mutate()}>Merge</Button>
            <Button variant="secondary" pending={reject.isPending} disabled={busy || noReason} onClick={() => reject.mutate()}>Not a match</Button>
            <Button variant="ghost" disabled={busy} onClick={onSkip}>Skip</Button>
            {armed
              ? <span className="m-text-meta m-ink-3">{noReason ? "Give a reason, then press" : "Press"} <kbd className="m-kbd">{isMac ? "⌘" : "Ctrl"}</kbd> <kbd className="m-kbd">Enter</kbd> to {armed === "merge" ? "merge" : "mark not a match"}</span>
              : noReason ? <span className="m-text-meta m-ink-3">Give a reason to merge or mark not a match</span> : null}
          </div>
        </section>
      )}

      <section aria-label="Field comparison" className="flex flex-col gap-2">
        {decidable ? (
          <div className="flex flex-wrap items-center gap-4 m-text-body" role="radiogroup" aria-label="Record that keeps its key">
            <span className="m-ink-3">Keeps its key</span>
            <Radio name="survivor" label={`Record A ${d.a}`} checked={survivor === "a"} onChange={() => { setSurvivorPick("a"); setUserPicks({}); }} />
            <Radio name="survivor" label={`Record B ${d.b}`} checked={survivor === "b"} onChange={() => { setSurvivorPick("b"); setUserPicks({}); }} />
          </div>
        ) : null}
        {preview.isError ? (
          <Notice tone="warning">The preview could not be built: {apiErrorMessage(preview.error)}</Notice>
        ) : null}
        {rows.length ? (
          <CompareTable
            label="Field comparison"
            head={<>
              <th scope="col" className={TH}>Field</th>
              <th scope="col" className={TH}>Record A <Mono>{d.a}</Mono></th>
              <th scope="col" className={TH}>Record B <Mono>{d.b}</Mono></th>
              <th scope="col" className={`${TH} text-right`}>Similarity</th>
              <th scope="col" className={TH}>Golden record</th>
            </>}
          >
            <tbody>{differing.map(row)}</tbody>
            {same.length ? (
              <tbody>
                <tr>
                  <td colSpan={5} className={TD}>
                    <Button variant="ghost" size="sm" aria-expanded={showSame} onClick={() => setShowSame((v) => !v)}>
                      {showSame ? "Hide" : "Show"} {same.length.toLocaleString()} identical {same.length === 1 ? "field" : "fields"}
                    </Button>
                  </td>
                </tr>
                {showSame ? same.map(row) : null}
              </tbody>
            ) : null}
          </CompareTable>
        ) : (
          <Notice tone="info">Neither record has field values yet, so there is nothing to compare. Run a match after the next extraction.</Notice>
        )}
        {decidable ? (
          <p className="m-text-meta m-ink-3">Where the records differ, pick the value to keep. A value you pick stays on the golden record until you clear it there.</p>
        ) : null}
      </section>
    </div>
  );
}
