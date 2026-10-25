// frontend/app/(app)/mdm/golden/merge/page.tsx
"use client";

/**
 * MDM › Match review, the one place every duplicate pair is reviewed. Without `?id` it is the review queue,
 * from one of two sources: the match engine's scored pairs (default; uncertain ones first, each opened in a
 * drawer to merge, mark not a match or leave for later) or, with `?source=cleaning`, the cleaning engine's
 * duplicate candidates (compare and keep one record). `?object=<module>&record=<key>` keeps one record's pairs
 * in either source. With `?id` it compares one golden record field by field against every contributing source.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import {
  Button, ConfirmDialog, DataTable, Drawer, EmptyState, ErrorState, ExplorerPage, FilterChip, Mono, PageHeader, Pager, Pill,
  Select, Skeleton, asyncStateOf, toast,
} from "@/design";
import { CleaningPairs, cleaningPairsKey } from "@/components/mdm/cleaning-pairs";
import { LedgerHead, RowButton, actionColumn } from "@/components/mdm/ledger";
import { BAND_LABEL, pct, whyMatched } from "@/components/mdm/match-review-model";
import { PairReview, matchReviewKey } from "@/components/mdm/pair-review";
import { useRole } from "@/hooks/use-role";
import { getDedupCandidates } from "@/lib/api/cleaning";
import { getMasterRecord } from "@/lib/api/master-records";
import { bulkMergePairs, getReviewPairs, type ReviewPair, type ScoreBand } from "@/lib/api/match-review";
import { apiErrorMessage, apiErrorState } from "@/lib/error";
import { formatModuleName } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";

const PAGE = 50;
const BULK_LIMIT = 500;
const BANDS: (ScoreBand | "all")[] = ["review", "auto_merge", "low", "all"];
const DOMAINS = ["business_partner", "material_master", "sd_customer_master", "accounts_payable", "accounts_receivable", "employee_central"];
const BAND_TONE: Record<ScoreBand, "info" | "go" | "neutral"> = { review: "info", auto_merge: "go", low: "neutral" };
type Source = "matcher" | "cleaning";
const SOURCE_LABEL: Record<Source, string> = { matcher: "Match engine", cleaning: "Cleaning engine" };

export default function GoldenRecordMergePage() {
  const id = useSearchParams().get("id");
  return id ? <CompareSources id={id} /> : <MatchReview />;
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

  /** After a verdict, open the next pair in the list (or close when it was the last). */
  const next = () => {
    const i = pairs.findIndex((p) => p.id === pairId);
    const following = i >= 0 ? pairs[i + 1] ?? null : null;
    setParams({ pair: following?.id ?? null });
  };

  // Stable columns between URL changes: a cell redefined on every render remounts and drops its click.
  const columns = useMemo<ColumnDef<ReviewPair>[]>(() => [
    { id: "pair", header: "Records", cell: ({ row }) => <span className="inline-flex gap-2"><Mono>{row.original.a}</Mono><span className="m-ink-3">and</span><Mono>{row.original.b}</Mono></span> },
    { id: "object", header: "Object", size: 160, cell: ({ row }) => formatModuleName(row.original.domain) },
    { id: "score", header: "Score", size: 170, cell: ({ row }) => <span className="inline-flex items-center gap-2 tabular-nums">{pct(row.original.total)}<Pill tone={BAND_TONE[row.original.band]}>{BAND_LABEL[row.original.band]}</Pill></span> },
    { id: "why", header: "Why", cell: ({ row }) => <span className="m-ink-2">{whyMatched(row.original.explanation)}</span> },
    actionColumn((r) => <RowButton label={`Review ${r.a} and ${r.b}`} onClick={() => setParams({ pair: r.id })}>Review</RowButton>),
  // eslint-disable-next-line react-hooks/exhaustive-deps -- setParams only reads the URL, which is the dependency
  ], [sp]);

  const filterBar = (
    <div className="flex flex-wrap items-end gap-3">
      <div role="group" aria-label="Source" className="flex flex-wrap gap-1">
        {(["matcher", "cleaning"] as const).map((s) => (
          <Button key={s} size="sm" variant={source === s ? "secondary" : "ghost"} aria-pressed={source === s} onClick={() => setParams({ source: s === "matcher" ? null : s, band: null, pair: null, page: null })}>
            {SOURCE_LABEL[s]}{counts[s] != null ? ` (${counts[s].toLocaleString()})` : ""}
          </Button>
        ))}
      </div>
      {source === "matcher" ? <div role="group" aria-label="Score band" className="flex flex-wrap gap-1">
        {BANDS.map((b) => {
          const n = b === "all" ? waiting : bands?.[b];
          return (
            <Button key={b} size="sm" variant={band === b ? "secondary" : "ghost"} aria-pressed={band === b} onClick={() => setParams({ band: b === "review" ? null : b, page: null })}>
              {b === "all" ? "All waiting" : BAND_LABEL[b]}{n != null ? ` (${n.toLocaleString()})` : ""}
            </Button>
          );
        })}
      </div> : null}
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

  const open = pairs.find((p) => p.id === pairId);

  return (
    <ExplorerPage
      header={header}
      filterBar={filterBar}
      state={asyncStateOf(list, () => pairs.length === 0)}
      emptyProps={empty}
      errorProps={{ message: apiErrorMessage(list.error), onRetry: () => void list.refetch() }}
      table={
        <div className="flex flex-col gap-3">
          <DataTable columns={columns} data={pairs} getRowId={(r) => r.id} onRowClick={(r) => setParams({ pair: r.id })} tableId="mdm-match-review" />
          {(list.data?.total ?? 0) > PAGE ? (
            <Pager page={page} pageCount={Math.ceil((list.data?.total ?? 0) / PAGE)} pageSize={PAGE} total={list.data?.total ?? 0} onPageChange={(n) => setParams({ page: n > 1 ? String(n) : null })} />
          ) : null}
        </div>
      }
      drawer={
        <>
          <Drawer
            open={!!pairId}
            onOpenChange={(o) => { if (!o) setParams({ pair: null }); }}
            title={open ? `${open.a} and ${open.b}` : "Pair"}
            subtitle={open ? `${formatModuleName(open.domain)}, score ${pct(open.total)}` : undefined}
          >
            {pairId ? <PairReview key={pairId} pairId={pairId} onDone={next} onLater={next} /> : null}
          </Drawer>
          <BulkMerge open={bulkOpen} onOpenChange={setBulkOpen} domain={domain} floor={thresholds.auto_merge} />
        </>
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

/* ---------- One golden record against its sources ---------- */

function CompareSources({ id }: { id: string }) {
  const query = useQuery({ queryKey: queryKeys.masterRecord(id), queryFn: () => getMasterRecord(id) });
  if (query.isLoading) {
    return (
      <div className="flex flex-col gap-2">
        <Skeleton height={32} />
        <Skeleton height={120} />
      </div>
    );
  }
  if (query.isError) return <ErrorState {...apiErrorState(query.error)} onRetry={() => void query.refetch()} />;
  const record = query.data;
  if (!record) {
    return (
      <EmptyState
        title="Record not found"
        detail="It may have been removed or merged already."
        action={<Button render={<Link href="/mdm/golden">All golden records</Link>} />}
      />
    );
  }

  const fields = Object.entries(record.golden_fields);
  const sources = Object.entries(record.source_contributions);
  const rows = fields.map(([field, value]) => ({ field, value }));
  const conflicts = rows.filter((r) => sources.some(([, s]) => s.value !== r.value)).length;
  const cols: ColumnDef<{ field: string; value: unknown }>[] = [
    { id: "field", header: "Field", cell: ({ row }) => <Mono>{row.original.field}</Mono> },
    { id: "golden", header: "Golden value", accessorFn: (r) => (r.value == null ? "None" : String(r.value)) },
    ...sources.map(([system, s]): ColumnDef<{ field: string; value: unknown }> => ({
      id: `src-${system}`,
      header: () => <Mono>{system}</Mono>,
      cell: ({ row }) => {
        const differs = s.value !== row.original.value;
        return (
          <span className={differs ? "m-ink-critical" : undefined}>
            {s.value == null ? "None" : String(s.value)} ({Math.round(s.confidence * 100)}%){differs ? " differs" : ""}
          </span>
        );
      },
    })),
  ];

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={`Merge conflicts for ${record.sap_object_key}`}
        meta="Each field's golden value against every source that contributed it. A source that differs is marked in red."
        actions={<Button variant="secondary" render={<Link href={`/mdm/golden/${record.id}`}>Back to record</Link>} />}
      />
      <section aria-label="Field comparison">
        <LedgerHead title="Field comparison" meta={`${fields.length.toLocaleString()} fields, ${conflicts.toLocaleString()} with a differing source`} />
        {fields.length === 0 ? (
          <EmptyState
            title="No golden fields to compare"
            detail="This record has no consolidated fields yet."
            action={<Button variant="secondary" render={<Link href={`/mdm/golden/${record.id}`}>Back to record</Link>} />}
          />
        ) : (
          <DataTable columns={cols} getRowId={(r) => r.field} data={rows} height="auto" />
        )}
      </section>
      <div>
        <Button variant="ghost" render={<Link href="/mdm/golden/merge">Review other match pairs</Link>} />
      </div>
    </div>
  );
}
