// frontend/app/(app)/mdm/golden/merge/page.tsx
"use client";

/**
 * MDM › Match review, the one place every duplicate pair is reviewed. Without `?id` it is the review queue,
 * from one of two sources: the match engine's scored pairs (default) as a split-pane workbench (the pair list on
 * the left, the selected pair side by side on the right; `j` / `k` move, `m` merges, `n` marks not a match, `s`
 * skips, and the next pair is selected after each verdict) or, with `?source=cleaning`, the cleaning engine's
 * duplicate candidates (compare and keep one record). `?object=<module>&record=<key>` keeps one record's pairs
 * in either source; `&with=<key>` selects the pair of `record` and `with` (Insights › Duplicates links here).
 * `?id` is the old "compare sources" view of one golden record; its field × source grid now lives on the golden
 * record's own page, so it redirects there.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Button, Card, ChoiceGroup, ConfirmDialog, ExplorerPage, FilterChip, Mono, Notice, PageHeader, Pager, Pill, RankedRow,
  Select, Skeleton, asyncStateOf, toast,
} from "@/design";
import { CleaningPairs, cleaningPairsKey } from "@/components/mdm/cleaning-pairs";
import { BAND_LABEL, pct, whyMatched } from "@/components/mdm/match-review-model";
import { PairReview, matchReviewKey } from "@/components/mdm/pair-review";
import { useRole } from "@/hooks/use-role";
import { getDedupCandidates } from "@/lib/api/cleaning";
import { bulkMergePairs, getReviewPairs, type ScoreBand } from "@/lib/api/match-review";
import { apiErrorMessage } from "@/lib/error";
import { formatModuleName } from "@/lib/format";
import { keyBelongsElsewhere } from "@/lib/inbox-keys";

const PAGE = 50;
const BULK_LIMIT = 500;
const BANDS: (ScoreBand | "all")[] = ["review", "auto_merge", "low", "all"];
const DOMAINS = ["business_partner", "material_master", "sd_customer_master", "accounts_payable", "accounts_receivable", "employee_central"];
const BAND_PILL: Record<ScoreBand, "info" | "go" | "neutral"> = { review: "info", auto_merge: "go", low: "neutral" };
/** The list row's tone (it draws no bar: the rows are not ranked by a share). */
const BAND_TONE: Record<ScoreBand, "medium" | "pass" | "low"> = { review: "medium", auto_merge: "pass", low: "low" };
type Source = "matcher" | "cleaning";
const SOURCE_LABEL: Record<Source, string> = { matcher: "Match engine", cleaning: "Cleaning engine" };

export default function GoldenRecordMergePage() {
  const id = useSearchParams().get("id");
  return id ? <ToGoldenRecord id={id} /> : <MatchReview />;
}

/** The old `?id` link: the golden record's page holds its field × source grid now. */
function ToGoldenRecord({ id }: { id: string }) {
  const router = useRouter();
  useEffect(() => { router.replace(`/mdm/golden/${encodeURIComponent(id)}`); }, [router, id]);
  return <Skeleton height={120} />;
}

/* ---------- Review queue ---------- */

function MatchReview() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const canDecide = useRole().can("approve");
  const bandRaw = sp.get("band") ?? "review";
  const band = (BANDS as string[]).includes(bandRaw) ? (bandRaw as ScoreBand | "all") : "review";
  const source: Source = sp.get("source") === "cleaning" ? "cleaning" : "matcher";
  // `object` comes with `record` from a record's page (the record panel); `domain` is the Object picker.
  const domain = sp.get("object") ?? sp.get("domain") ?? "";
  const record = sp.get("record") ?? "";
  const pairId = sp.get("pair");
  // From Insights › Duplicates: the pair of `record` and `with`, selected once the list holds it.
  const withKey = sp.get("with") ?? "";
  const page = Math.max(1, Number(sp.get("page")) || 1);
  const [bulkOpen, setBulkOpen] = useState(false);

  const setParams = (patch: Record<string, string | null>) => {
    const params = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) { if (v) params.set(k, v); else params.delete(k); }
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  const filters = { band: band === "all" ? undefined : band, domain: domain || undefined, record: record || undefined };
  const list = useQuery({
    queryKey: [...matchReviewKey, "list", filters, page],
    queryFn: () => getReviewPairs({ ...filters, limit: PAGE, offset: (page - 1) * PAGE }),
    enabled: source === "matcher",
  });
  // What the other source holds under the same object and record, for the source switch.
  const matcherCount = useQuery({
    queryKey: [...matchReviewKey, "count", domain, record],
    queryFn: () => getReviewPairs({ domain: domain || undefined, record: record || undefined, limit: 1 }),
    enabled: source !== "matcher",
  });
  const cleaningFilters = { object_type: domain || undefined, record: record || undefined };
  const cleaningCount = useQuery({
    queryKey: [...cleaningPairsKey, "count", cleaningFilters],
    queryFn: () => getDedupCandidates({ ...cleaningFilters, per_page: 1 }),
  });
  const pairs = useMemo(() => list.data?.pairs ?? [], [list.data]);
  const bands = list.data?.bands;
  const waiting = bands ? bands.review + bands.auto_merge + bands.low : 0;
  const countBands = source === "matcher" ? bands : matcherCount.data?.bands;
  const counts: Record<Source, number | undefined> = {
    matcher: countBands ? countBands.review + countBands.auto_merge + countBands.low : undefined,
    cleaning: cleaningCount.data?.total,
  };
  const thresholds = list.data?.thresholds ?? { auto_merge: 0.95, review_floor: 0.3 };

  // The selected pair: the URL's, else the pair of `record` and `with`, else the first listed. Selecting the
  // first is not written to the URL, so skipping the last pair falls back to the top of the list.
  const linked = withKey ? pairs.find((p) => p.a === withKey || p.b === withKey) : undefined;
  const selectedId = pairId ?? linked?.id ?? pairs[0]?.id ?? null;
  const index = pairs.findIndex((p) => p.id === selectedId);
  const select = (id: string | null) => setParams({ pair: id, with: null });

  /** After a verdict the pair leaves the queue: select the one below it, else the one above. */
  const next = () => select((index >= 0 ? pairs[index + 1] ?? pairs[index - 1] : undefined)?.id ?? null);
  /** Skip saves nothing and moves down, wrapping to the top. */
  const skip = () => {
    const following = index >= 0 ? pairs[index + 1] ?? pairs[0] : undefined;
    select(following && following.id !== selectedId ? following.id : null);
  };

  // j / k (or the arrows) move through the pairs; the pane owns m, n and s. Fields, dialogs and menus keep their keys.
  useEffect(() => {
    if (source !== "matcher") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || keyBelongsElsewhere(e) || !pairs.length) return;
      const down = e.key === "j" || e.key === "ArrowDown";
      const up = e.key === "k" || e.key === "ArrowUp";
      if (!down && !up) return;
      e.preventDefault();
      const to = pairs[Math.min(pairs.length - 1, Math.max(0, index + (down ? 1 : -1)))];
      if (to && to.id !== selectedId) select(to.id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const filterBar = (
    <div className="flex flex-wrap items-end gap-3">
      <ChoiceGroup
        label="Source"
        value={source}
        onChange={(s) => setParams({ source: s === "matcher" ? null : s, band: null, pair: null, page: null })}
        options={(["matcher", "cleaning"] as const).map((s) => ({ value: s, label: `${SOURCE_LABEL[s]}${counts[s] != null ? ` (${counts[s].toLocaleString()})` : ""}` }))}
      />
      {source === "matcher" ? (
        <ChoiceGroup
          label="Score band"
          value={band}
          onChange={(b) => setParams({ band: b === "review" ? null : b, page: null })}
          options={BANDS.map((b) => {
            const n = b === "all" ? waiting : bands?.[b];
            return { value: b, label: `${b === "all" ? "All waiting" : BAND_LABEL[b]}${n != null ? ` (${n.toLocaleString()})` : ""}` };
          })}
        />
      ) : null}
      <Select
        label="Object"
        placeholder="All objects"
        value={domain}
        options={[{ value: "", label: "All objects" }, ...DOMAINS.map((d) => ({ value: d, label: formatModuleName(d) }))]}
        onValueChange={(v) => setParams({ domain: v || null, object: null, record: null, pair: null, page: null })}
      />
      {record ? <FilterChip label="Pairs of" value={record} onRemove={() => setParams({ record: null, object: null, pair: null, page: null })} /> : null}
    </div>
  );

  const header = (
    <PageHeader
      title="Match review"
      meta={source === "cleaning"
        ? "Every duplicate pair is reviewed here. These are the pairs the cleaning engine found: compare the two records and keep one."
        : `Every duplicate pair is reviewed here. Pairs the match engine scored between ${pct(thresholds.review_floor)} and ${pct(thresholds.auto_merge)} need a person. Merge them, mark them not a match, or leave them for later.`}
      actions={source === "matcher" && !record && canDecide && bands && bands.auto_merge > 0 ? (
        <Button onClick={() => setBulkOpen(true)}>Merge likely duplicates</Button>
      ) : undefined}
    />
  );

  if (source === "cleaning") {
    return <CleaningPairs key={`${domain}|${record}`} header={header} filterBar={filterBar} filters={cleaningFilters} />;
  }

  const empty = record && waiting === 0
    ? {
        title: `No match engine pairs for ${record}`,
        detail: "The match engine has no undecided pair holding this record.",
        action: <Button variant="secondary" onClick={() => setParams({ source: "cleaning", band: null, page: null })}>Show cleaning engine pairs</Button>,
        ghost: "table" as const,
      }
    : waiting === 0
    ? {
        title: "No pairs waiting",
        detail: domain
          ? `Every scored pair for ${formatModuleName(domain)} has a decision.`
          : "Pairs appear here after a match run scores candidate records, and leave once someone decides on them.",
        action: <Button variant="secondary" render={<Link href="/mdm/match-rules">Open match rules</Link>} />,
        ghost: "table" as const,
      }
    : {
        title: `No ${band === "all" ? "" : BAND_LABEL[band as ScoreBand].toLowerCase()} pairs`,
        detail: "Other bands still have pairs waiting.",
        action: <Button variant="secondary" onClick={() => setParams({ band: "all", page: null })}>Show all waiting</Button>,
        ghost: "table" as const,
      };

  const total = list.data?.total ?? 0;
  const linkMissing = !!withKey && !!record && list.isSuccess && !linked && !pairId;

  return (
    <ExplorerPage
      header={header}
      filterBar={filterBar}
      state={asyncStateOf(list, () => pairs.length === 0)}
      emptyProps={empty}
      errorProps={{ error: list.error, onRetry: () => void list.refetch() }}
      table={
        <div className="grid items-start gap-4 [grid-template-columns:minmax(0,1fr)] lg:[grid-template-columns:360px_minmax(0,1fr)]" data-testid="match-workbench">
          <Card title="Pairs" meta={`${total.toLocaleString()} waiting, best first`} padding="sm">
            <ul className="flex flex-col [max-height:calc(100vh-300px)] overflow-y-auto" aria-label="Pairs to review">
              {pairs.map((p) => (
                <RankedRow
                  key={p.id}
                  tone={BAND_TONE[p.band]}
                  selected={p.id === selectedId}
                  onSelect={() => select(p.id)}
                  testId="match-pair"
                  label={<span className="inline-flex min-w-0 items-center gap-2"><Mono>{p.a}</Mono><span className="m-ink-3 font-normal">and</span><Mono>{p.b}</Mono></span>}
                  magnitude={pct(p.total)}
                  meta={<><span>{formatModuleName(p.domain)}</span><span className="truncate">{whyMatched(p.explanation)}</span></>}
                  aside={<Pill tone={BAND_PILL[p.band]}>{BAND_LABEL[p.band]}</Pill>}
                />
              ))}
            </ul>
            {total > PAGE ? (
              <Pager page={page} pageCount={Math.ceil(total / PAGE)} pageSize={PAGE} total={total} onPageChange={(n) => setParams({ page: n > 1 ? String(n) : null, pair: null })} />
            ) : null}
            <p className="px-3 pt-2 m-text-meta m-ink-3">
              Keys: <kbd className="m-kbd">j</kbd> <kbd className="m-kbd">k</kbd> move, <kbd className="m-kbd">m</kbd> merge, <kbd className="m-kbd">n</kbd> not a match, <kbd className="m-kbd">s</kbd> skip
            </p>
          </Card>
          <div className="m-card min-w-0 lg:sticky lg:top-4">
            {linkMissing ? (
              <div className="mb-4"><Notice tone="info">The match engine has not scored <Mono inline>{record}</Mono> against <Mono inline>{withKey}</Mono>. These are the pairs it has for <Mono inline>{record}</Mono>.</Notice></div>
            ) : null}
            {selectedId ? <PairReview key={selectedId} pairId={selectedId} onDone={next} onSkip={skip} /> : null}
          </div>
          <BulkMerge open={bulkOpen} onOpenChange={setBulkOpen} domain={domain} floor={thresholds.auto_merge} />
        </div>
      }
    />
  );
}

/** Merge every waiting pair at or above a score, after saying how many that is. */
function BulkMerge({ open, onOpenChange, domain, floor }: { open: boolean; onOpenChange: (o: boolean) => void; domain: string; floor: number }) {
  const qc = useQueryClient();
  const options = Array.from(new Set([floor, 0.97, 0.99].filter((t) => t >= floor && t >= 0.5)));
  const [threshold, setThreshold] = useState(String(floor));
  const min = Number(threshold);
  const count = useQuery({
    queryKey: [...matchReviewKey, "bulk-count", domain, min],
    queryFn: () => getReviewPairs({ min_score: min, domain: domain || undefined, limit: 1 }),
    enabled: open,
  });
  const n = count.data?.total ?? 0;
  const run = useMutation({
    mutationFn: () => bulkMergePairs({ min_score: min, domain: domain || undefined, limit: BULK_LIMIT, reason: `Merged in bulk: pairs scoring ${pct(min)} or more` }),
    onSuccess: (r) => {
      const skipped = r.blocked + r.missing_record;
      toast.success(`Merged ${r.merged.toLocaleString()} pairs${skipped ? `, skipped ${skipped.toLocaleString()} (marked not a match or without a golden record)` : ""}`);
      void qc.invalidateQueries({ queryKey: matchReviewKey });
      onOpenChange(false);
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Merge likely duplicates?"
      confirmLabel={n ? `Merge ${Math.min(n, BULK_LIMIT).toLocaleString()} pairs` : "Merge pairs"}
      cancelLabel="Review them one by one"
      pending={run.isPending}
      onConfirm={() => { if (n) run.mutate(); }}
      body={
        <div className="flex flex-col gap-3 m-text-body">
          <Select label="Score at least" value={threshold} options={options.map((t) => ({ value: String(t), label: pct(t) }))} onValueChange={setThreshold} />
          {count.isLoading ? <Skeleton height={20} /> : (
            <p className="m-ink-2">
              {n
                ? `${n.toLocaleString()} waiting ${n === 1 ? "pair scores" : "pairs score"} ${pct(min)} or more${domain ? ` for ${formatModuleName(domain)}` : ""}. Each merges into one golden record; the higher-confidence record keeps its key.`
                : `No waiting pair scores ${pct(min)} or more.`}
              {n > BULK_LIMIT ? ` The ${BULK_LIMIT.toLocaleString()} highest run now; run it again for the rest.` : ""}
            </p>
          )}
          <p className="m-text-meta m-ink-3">A pair marked not a match is skipped. Any merge can be undone from its golden record.</p>
        </div>
      }
    />
  );
}
