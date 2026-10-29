"use client";

/**
 * MDM › Overview: the MDM health figure with its four inputs, then the match work waiting on a steward.
 * Counts read the same endpoints as the pages they link to: master records (Golden records) and scored pairs
 * (Match review). Only the health score and its four inputs come from the daily snapshot.
 */

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Button, Card, DataTable, ExplorerPage, InsightHeader, Line, PageHeader, Stat, statusLabel, type CellMeta } from "@/design";
import { useScoreBands } from "@/hooks/use-score-bands";
import { readinessOf } from "@/lib/home-metrics";
import { actionColumn, LedgerHead, RowLink } from "@/components/mdm/ledger";
import { getMdmDashboard, getMdmHistory } from "@/lib/api/mdm-metrics";
import { getMasterRecords } from "@/lib/api/master-records";
import { getReviewPairs, type ReviewPair } from "@/lib/api/match-review";
import { pct } from "@/components/mdm/match-review-model";
import { formatModuleName } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";
import { isListFailure } from "@/lib/error";

const SHOWN = 10;

/** The four health inputs arrive as fractions 0 to 1 (api/services/mdm_scoring.py); the tiles print them as percents. */
const asPct = (fraction: number) => `${Math.round(fraction * 100)}%`;
/** The snapshot's backlog counts stewardship tasks of every kind, so it is named apart from the match work below. */
const backlogText = (n: number) => `${n.toLocaleString()} stewardship ${n === 1 ? "task" : "tasks"} open`;

/** Nothing is set up when no record is promoted and neither matching nor survivorship has produced a figure. */
const notStarted = (m: { golden_record_count: number; avg_match_confidence: number; source_consistency_pct: number }) =>
  m.golden_record_count === 0 && m.avg_match_confidence === 0 && m.source_consistency_pct === 0;

const SETUP_STEPS = [
  { href: "/mdm/match-rules", label: "Set the match rules", detail: "Say which fields decide that two records are the same." },
  { href: "/mdm/survivorship", label: "Set the survivorship rules", detail: "Say which value wins when the records disagree." },
  { href: "/mdm/golden/merge", label: "Review the match pairs", detail: "Merge the pairs the engine found to build golden records." },
];

const columns: ColumnDef<ReviewPair>[] = [
  { id: "item", header: "Work", cell: ({ row }) => <span>Merge pair <span className="font-mono">{row.original.a}</span> and <span className="font-mono">{row.original.b}</span></span> },
  { id: "object", header: "Object", cell: ({ row }) => formatModuleName(row.original.domain) },
  { id: "score", header: "Match score", meta: { numeric: true } satisfies CellMeta, cell: ({ row }) => pct(row.original.total) },
  // `pair` opens Match review on this pair.
  actionColumn((r) => <RowLink href={`/mdm/golden/merge?pair=${encodeURIComponent(r.id)}`}>Open</RowLink>),
];

export default function MdmOverviewPage() {
  const dash = useQuery({ queryKey: ["mdm", "dashboard"], queryFn: getMdmDashboard });
  // The aggregate snapshots (domain unset) of the last eight weeks, from the same API as the latest one.
  const health = useQuery({ queryKey: ["mdm", "history", 56], queryFn: () => getMdmHistory({ days: 56 }) });
  // Match work is Match review's own list, so the two pages cannot count different pairs: the scored pairs a
  // steward has not decided, best first. `bands` counts every band that is waiting.
  const pairsQ = useQuery({ queryKey: ["mdm", "review-pairs", SHOWN], queryFn: () => getReviewPairs({ limit: SHOWN }), meta: { ignoreError: true } });
  // The golden records figure is the live master-record count, which Golden records shows, not the daily snapshot.
  const goldenQ = useQuery({ queryKey: queryKeys.masterRecords({ status: "golden", per_page: 1 }), queryFn: () => getMasterRecords({ status: "golden", per_page: 1 }), meta: { ignoreError: true } });
  const allQ = useQuery({ queryKey: queryKeys.masterRecords({ per_page: 1 }), queryFn: () => getMasterRecords({ per_page: 1 }), meta: { ignoreError: true } });
  const m = dash.data?.latest ?? null;
  const points = health.data?.history ?? [];
  const items = pairsQ.data?.pairs ?? [];
  const pairBands = pairsQ.data?.bands;
  const total = pairBands ? pairBands.review + pairBands.auto_merge + pairBands.low : pairsQ.data?.total ?? 0;
  const goldenCount = goldenQ.data?.total ?? m?.golden_record_count ?? 0;
  const recordTotal = allQ.data?.total;
  // The real next step: merge decisions if any wait, else the other stewardship tasks, else rules so matching can find pairs.
  const next = total > 0
    ? { href: "/mdm/golden/merge", label: "Review match pairs" }
    : (m?.backlog_count ?? 0) > 0
      ? { href: "/inbox", label: "Open stewardship tasks" }
      : { href: "/mdm/match-rules", label: "Set up match rules" };
  const failed = isListFailure(dash) ? dash : isListFailure(health) ? health : null;
  const state = dash.isLoading || health.isLoading ? "loading" : failed ? "error" : !m && points.length === 0 && items.length === 0 ? "empty" : undefined;
  // The tenant's score bands set the target tick and the verdict, as they do for every other score.
  const { bands } = useScoreBands();
  const fresh = !!m && notStarted(m) && goldenCount === 0 && total === 0;
  const tone = m && !fresh ? readinessOf(m.mdm_health_score, bands) : undefined;
  const verdict = fresh ? "Not started" : tone ? statusLabel("verdict", tone) : "";
  const backlog = m ? <Link href="/inbox" className="m-ink-accent-ink underline">{backlogText(m.backlog_count)}</Link> : null;

  return (
    <ExplorerPage
      header={
        <PageHeader
          title="MDM overview"
          meta={m
            ? <>{`${goldenCount.toLocaleString()} golden ${goldenCount === 1 ? "record" : "records"}${recordTotal != null ? ` of ${recordTotal.toLocaleString()} master records` : ""}, `}{backlog}</>
            : "How complete and consistent your golden records are, and the match work waiting on a steward"}
          actions={<>
            <Button variant="secondary" render={<Link href="/mdm/survivorship">Survivorship rules</Link>} />
            {pairsQ.isLoading || dash.isLoading ? null : <Button render={<Link href={next.href}>{next.label}</Link>} />}
          </>}
        />
      }
      summary={m ? (
        <InsightHeader
          hero
          bare
          lead={
            <div className="m-hero-lead">
              <div className="m-score-hero" data-testid="score-hero">
                {fresh
                  ? <Stat hero label="MDM health" value="—" />
                  : <Stat hero label="MDM health" value={m.mdm_health_score} bar={m.mdm_health_score} rule={{ target: bands.target }} tone={tone} versionId={m.snapshot_date} />}
              </div>
              <div className="m-hero-verdict" data-testid="hero-verdict">
                <span className="font-semibold m-text-verdict-line m-ink [letter-spacing:var(--m-tracking-title)]">{verdict}</span>
                <span className="m-text-body m-ink-2">{fresh ? "Nothing is scored until matching is set up. " : `Target ${bands.target}, `}{backlog}</span>
              </div>
            </div>
          }
          stats={fresh ? [] : [
            { label: "Coverage", value: asPct(m.golden_record_coverage_pct), to: "/mdm/golden", hint: "Weight 40%" },
            { label: "Match confidence", value: asPct(m.avg_match_confidence), to: "/mdm/match-rules", hint: "Weight 30%" },
            { label: "Steward SLA", value: asPct(m.steward_sla_compliance_pct), to: "/inbox", hint: "Weight 20%" },
            { label: "Source consistency", value: asPct(m.source_consistency_pct), to: "/mdm/golden", hint: "Weight 10%" },
          ]}
          // `bare` sets the score band alone; the cells below are not drawn.
          situation={{ sentence: fresh ? "MDM setup has not started" : `MDM health ${m.mdm_health_score}, ${verdict}`, tone }}
          changed={{ sentence: "" }}
          why={{ sentence: "" }}
          next={{ sentence: "" }}
        />
      ) : undefined}
      strip={fresh ? (
        <Card title="Set up MDM" meta="Three steps">
          <ol className="flex flex-col gap-2 m-text-body" aria-label="Setup steps">
            {SETUP_STEPS.map((s, i) => (
              <li key={s.href}>{i + 1}. <Link href={s.href} className="m-ink-accent-ink underline">{s.label}</Link> <span className="m-ink-3">{s.detail}</span></li>
            ))}
          </ol>
        </Card>
      ) : undefined}
      state={state}
      emptyProps={{
        title: "No MDM health snapshot",
        detail: "The first snapshot is taken after golden records are built.",
        action: <Button variant="secondary" render={<Link href="/mdm/golden">Open golden records</Link>} />,
        ghost: "chart",
      }}
      errorProps={{ error: failed?.error, onRetry: () => { void dash.refetch(); void health.refetch(); } }}
      table={
        <section aria-label="Match work">
          <LedgerHead title="Match work" meta={total > items.length ? `${items.length.toLocaleString()} of ${total.toLocaleString()} pairs waiting` : `${total.toLocaleString()} ${total === 1 ? "pair" : "pairs"} waiting`} action={<Link href="/mdm/golden/merge" className="m-text-meta m-ink-accent-ink hover:underline">Open match review</Link>} />
          <DataTable
            columns={columns}
            data={items}
            getRowId={(r) => r.id}
            hideToolbar
            hideSearch
            height="auto"
            tableId="mdm-match-work"
            emptyMessage="No match work waiting"
          />
        </section>
      }
      aside={state || points.length === 0 ? undefined : (
        <Card title="Health over time" meta="Snapshots">
          <Line data={points.map((p) => ({ x: p.snapshot_date, y: p.mdm_health_score }))} label="MDM health score" height={140} />
        </Card>
      )}
    />
  );
}
