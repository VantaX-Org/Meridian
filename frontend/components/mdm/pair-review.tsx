"use client";

/**
 * One scored pair, decided in one place: why the matcher paired them, the golden record a merge would build
 * (pick a value per field, preview exactly what would be stored), and the verdict: merge, not a match, or
 * decide later.
 */

import { createContext, useContext, useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CellContext, ColumnDef } from "@tanstack/react-table";
import { Button, DataTable, ErrorState, Field, Mono, Notice, Pill, Radio, Skeleton, Textarea, toast } from "@/design";
import { useRole } from "@/hooks/use-role";
import { GatedPrimary, primaryRole } from "@/components/gated-primary";
import { apiErrorMessage, apiErrorState } from "@/lib/error";
import { formatModuleName } from "@/lib/format";
import { getReviewPair, mergePair, type ReviewPairDetail } from "@/lib/api/match-review";
import { clearPairConstraint, decidePair, undoLastMerge, type AttributeExplanation } from "@/lib/api/merge-explain";
import {
  BAND_LABEL, attributeVerdict, defaultPicks, overridesFromPicks, pairFields, pct, show, whyMatched, winnerPicks,
  type Picks, type Side,
} from "./match-review-model";

export const matchReviewKey = ["mdm", "match-review"] as const;

const VERDICT_PILL = {
  matched: { tone: "go", label: "Matched" },
  differs: { tone: "at-risk", label: "Differs" },
  skipped: { tone: "neutral", label: "Not compared" },
} as const;

const ATTR_COLUMNS: ColumnDef<AttributeExplanation>[] = [
  { id: "field", header: "Field", cell: ({ row }) => <Mono>{row.original.field}</Mono> },
  { id: "a", header: "Record A", cell: ({ row }) => (row.original.masked ? "Hidden" : show(row.original.value_a) || <span className="m-ink-3">blank</span>) },
  { id: "b", header: "Record B", cell: ({ row }) => (row.original.masked ? "Hidden" : show(row.original.value_b) || <span className="m-ink-3">blank</span>) },
  { id: "sim", header: "Similarity", meta: { numeric: true }, cell: ({ row }) => (row.original.similarity == null ? "" : pct(row.original.similarity)) },
  { id: "verdict", header: "Result", cell: ({ row }) => { const v = VERDICT_PILL[attributeVerdict(row.original)]; return <Pill tone={v.tone}>{v.label}</Pill>; } },
];

/** The per-attribute comparison the score came from. */
export function WhyMatched({ pair }: { pair: Pick<ReviewPairDetail, "explanation" | "total" | "band"> }) {
  const attrs = pair.explanation?.attributes ?? [];
  return (
    <section aria-label="Why these match" className="flex flex-col gap-2">
      <h3 className="m-text-h font-semibold m-ink">Why these match</h3>
      <p className="m-text-body m-ink-2">
        Score {pct(pair.total)}, {BAND_LABEL[pair.band].toLowerCase()}. {whyMatched(pair.explanation)}.
      </p>
      {attrs.length ? <DataTable columns={ATTR_COLUMNS} data={attrs} getRowId={(a) => a.field} hideToolbar hideSearch height="auto" /> : null}
    </section>
  );
}

type FieldRow = { field: string; a: unknown; b: unknown; same: boolean };

/** The picks live in context so the column definitions stay one stable set: a cell that is redefined on every
 * render remounts, and a radio would lose its click and its focus. */
type PickState = {
  picks: Picks; overrides: Record<string, string>; golden: Record<string, unknown> | undefined; editable: boolean;
  aKey: string; bKey: string; pick: (field: string, side: Side) => void;
};
const PickContext = createContext<PickState | null>(null);
const usePicks = () => { const c = useContext(PickContext); if (!c) throw new Error("PickContext missing"); return c; };

function SideValue({ row, side }: { row: FieldRow; side: Side }) {
  const { picks, editable, pick } = usePicks();
  const text = show(side === "a" ? row.a : row.b);
  if (row.same || !editable) return text || <span className="m-ink-3">blank</span>;
  return (
    <Radio
      name={`pick-${row.field}`}
      label={text || "blank"}
      checked={picks[row.field] === side}
      onChange={() => pick(row.field, side)}
      aria-label={`Use ${side === "a" ? "record A" : "record B"} value for ${row.field}`}
    />
  );
}
function GoldenValue({ row }: { row: FieldRow }) {
  const { picks, overrides, golden } = usePicks();
  const v = golden ? show(golden[row.field]) : show(picks[row.field] === "a" ? row.a : row.b);
  return row.field in overrides
    ? <span className="inline-flex items-center gap-2 font-semibold m-ink-accent-ink">{v || "blank"}<Pill tone="info">Your pick</Pill></span>
    : <>{v || <span className="m-ink-3">blank</span>}</>;
}
function SideHeader({ side }: { side: Side }) {
  const { aKey, bKey } = usePicks();
  return <>Record {side === "a" ? "A" : "B"} <Mono>{side === "a" ? aKey : bKey}</Mono></>;
}
const SideACell = ({ row }: CellContext<FieldRow, unknown>) => <SideValue row={row.original} side="a" />;
const SideBCell = ({ row }: CellContext<FieldRow, unknown>) => <SideValue row={row.original} side="b" />;
const GoldenCell = ({ row }: CellContext<FieldRow, unknown>) => <GoldenValue row={row.original} />;
const SideAHeader = () => <SideHeader side="a" />;
const SideBHeader = () => <SideHeader side="b" />;
const FieldCell = ({ row }: CellContext<FieldRow, unknown>) => <Mono>{row.original.field}</Mono>;
const PICK_COLUMNS: ColumnDef<FieldRow>[] = [
  { id: "field", header: "Field", cell: FieldCell },
  { id: "a", header: SideAHeader, cell: SideACell },
  { id: "b", header: SideBHeader, cell: SideBCell },
  { id: "golden", header: "Golden record", cell: GoldenCell },
];

export function PairReview({ pairId, onDone, onLater }: { pairId: string; onDone: () => void; onLater: () => void }) {
  const qc = useQueryClient();
  const canDecide = useRole().can("approve");
  const detail = useQuery({ queryKey: [...matchReviewKey, "pair", pairId], queryFn: () => getReviewPair(pairId) });
  const [survivorPick, setSurvivorPick] = useState<Side | null>(null);
  const [userPicks, setUserPicks] = useState<Picks>({});
  const [reason, setReason] = useState("");

  const d = detail.data;
  const a = useMemo(() => d?.record_a.fields ?? {}, [d]);
  const b = useMemo(() => d?.record_b.fields ?? {}, [d]);
  const survivor: Side = survivorPick ?? (d && d.default_survivor === d.b ? "b" : "a");
  const survivorKey = d ? (survivor === "a" ? d.a : d.b) : "";
  const mergeable = !!d && !d.same_cluster && !d.constraint && !!d.a_record_id && !!d.b_record_id;
  const previewable = canDecide && mergeable;

  const base = useQuery({
    queryKey: [...matchReviewKey, "preview", pairId, survivorKey],
    queryFn: () => mergePair(pairId, { survivor: survivorKey, dry_run: true }),
    enabled: previewable,
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
    enabled: previewable && hasOverrides,
  });
  const preview = hasOverrides ? picked : base;

  const refresh = () => qc.invalidateQueries({ queryKey: matchReviewKey });
  const merge = useMutation({
    mutationFn: () => mergePair(pairId, { survivor: survivorKey, overrides, reason: reason.trim() }),
    onSuccess: (r) => {
      toast.undoable(`Merged ${r.merged_key} into ${r.survivor_key}`, {
        undo: async () => { await undoLastMerge(r.golden_record_id, "Undone from match review"); await refresh(); },
      });
      void refresh();
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

  if (detail.isLoading) return <Skeleton height={320} />;
  if (detail.isError || !d) return <ErrorState {...apiErrorState(detail.error)} onRetry={() => void detail.refetch()} />;

  const rows: FieldRow[] = pairFields(a, b)
    .map((field) => ({ field, a: a[field], b: b[field], same: show(a[field]) === show(b[field]) }))
    .sort((x, y) => Number(x.same) - Number(y.same) || x.field.localeCompare(y.field));
  const ctx: PickState = {
    picks, overrides, golden: preview.data?.golden_fields, editable: canDecide && mergeable, aKey: d.a, bKey: d.b,
    pick: (field, side) => setUserPicks((p) => ({ ...p, [field]: side })),
  };
  const busy = merge.isPending || reject.isPending;
  const noReason = !reason.trim();

  return (
    <div className="flex flex-col gap-5">
      <p className="m-text-body m-ink-2">
        {formatModuleName(d.domain)}: <Mono>{d.a}</Mono> and <Mono>{d.b}</Mono>.
        {d.record_a.record_id ? <> <Link className="m-ink-accent-ink hover:underline" href={`/mdm/golden/${d.record_a.record_id}`}>Open A</Link></> : null}
        {d.record_b.record_id ? <> <Link className="m-ink-accent-ink hover:underline" href={`/mdm/golden/${d.record_b.record_id}`}>Open B</Link></> : null}
      </p>

      <WhyMatched pair={d} />

      <section aria-label="Golden record preview" className="flex flex-col gap-2">
        <h3 className="m-text-h font-semibold m-ink">The golden record a merge builds</h3>
        {mergeable && canDecide ? (
          <>
            <p className="m-text-meta m-ink-3">
              Pick the value to keep where the records differ. A value you pick stays on the golden record until you clear it there.
            </p>
            <div className="flex items-center gap-4 m-text-body" role="radiogroup" aria-label="Record that keeps its key">
              <span className="m-ink-3">Keeps its key</span>
              <Radio name="survivor" label={`Record A ${d.a}`} checked={survivor === "a"} onChange={() => { setSurvivorPick("a"); setUserPicks({}); }} />
              <Radio name="survivor" label={`Record B ${d.b}`} checked={survivor === "b"} onChange={() => { setSurvivorPick("b"); setUserPicks({}); }} />
            </div>
          </>
        ) : null}
        {preview.isError ? (
          <Notice tone="warning">The preview could not be built: {apiErrorMessage(preview.error)}</Notice>
        ) : null}
        {rows.length ? (
          <PickContext.Provider value={ctx}>
            <DataTable columns={PICK_COLUMNS} data={rows} getRowId={(r) => r.field} hideToolbar hideSearch height="auto" />
          </PickContext.Provider>
        ) : (
          <Notice tone="info">Neither record has field values yet, so there is nothing to compare. Run a match after the next extraction.</Notice>
        )}
      </section>

      {d.same_cluster ? (
        <Notice tone="success">These records are already in one golden record.</Notice>
      ) : d.constraint === "do_not_match" ? (
        <Notice tone="info">A steward marked these as not a match. Clear it under Match rules, Settled pairs, to review them again.</Notice>
      ) : !d.a_record_id || !d.b_record_id ? (
        <Notice tone="warning">One of these records has no golden record yet, so it cannot be merged. Golden records are built after matching runs.</Notice>
      ) : !canDecide ? (
        <section aria-label="Decision" className="flex flex-col gap-2">
          <div><GatedPrimary kind="approve" allowed={false}>Merge</GatedPrimary></div>
          <p className="m-text-meta m-ink-3">Merging a pair or marking it not a match needs {primaryRole("approve")} on all systems</p>
        </section>
      ) : (
        <section aria-label="Decision" className="flex flex-col gap-3">
          <Field label="Reason (required), kept in the merge history">
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} placeholder="Same tax number and address" aria-required="true" />
          </Field>
          <div className="flex flex-wrap items-center gap-2">
            <Button pending={merge.isPending} disabled={busy || noReason || (hasOverrides && picked.isLoading)} onClick={() => merge.mutate()}>Merge</Button>
            <Button variant="secondary" pending={reject.isPending} disabled={busy || noReason} onClick={() => reject.mutate()}>Not a match</Button>
            <Button variant="ghost" disabled={busy} onClick={onLater}>Decide later</Button>
            {noReason ? <span className="m-text-meta m-ink-3">Give a reason to merge or mark not a match</span> : null}
          </div>
        </section>
      )}
    </div>
  );
}
