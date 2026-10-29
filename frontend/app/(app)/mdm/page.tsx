"use client";

/** MDM › Overview: the MDM health figure with its four inputs, then the match work waiting on a steward. */

import Link from "next/link";
import { useQueries, useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Button, Card, DataTable, ExplorerPage, InsightHeader, Line, PageHeader, Pill, Stat, statusLabel, type CellMeta } from "@/design";
import { useScoreBands } from "@/hooks/use-score-bands";
import { readinessOf } from "@/lib/home-metrics";
import { actionColumn, LedgerHead, RowLink } from "@/components/mdm/ledger";
import { getMdmDashboard, getMdmHistory } from "@/lib/api/mdm-metrics";
import { getQueueItems } from "@/lib/api/stewardship";
import { formatModuleName, relativeTime } from "@/lib/format";
import type { StewardshipQueueItem, StewardshipStatus } from "@/types/api";
import { isListFailure } from "@/lib/error";

/** The statuses the inbox counts as live work (inbox/page.tsx LIVE). */
const LIVE: StewardshipStatus[] = ["open", "in_progress", "escalated"];
const MATCH_WORK = "merge_decision";
const SHOWN = 10;

/** The four health inputs arrive as fractions 0 to 1 (api/services/mdm_scoring.py); the tiles print them as percents. */
const asPct = (fraction: number) => `${Math.round(fraction * 100)}%`;
/** The snapshot's backlog counts stewardship tasks of every kind, so it is named apart from the match work below. */
const backlogText = (n: number) => `${n.toLocaleString()} stewardship ${n === 1 ? "task" : "tasks"} open`;

/** Escalated first, then the earliest due. */
const urgentFirst = (a: StewardshipQueueItem, b: StewardshipQueueItem) =>
  Number(b.status === "escalated") - Number(a.status === "escalated") ||
  (a.due_at ?? "9999").localeCompare(b.due_at ?? "9999");

const columns: ColumnDef<StewardshipQueueItem>[] = [
  { id: "item", header: "Work", cell: ({ row }) => <span className="inline-flex items-center gap-2">Merge decision{row.original.status === "escalated" ? <Pill tone="no-go">Escalated</Pill> : row.original.status === "in_progress" ? <Pill tone="at-risk">In progress</Pill> : null}</span> },
  { id: "object", header: "Object", cell: ({ row }) => formatModuleName(row.original.domain) },
  { id: "due", header: "Due", meta: { numeric: true } satisfies CellMeta, cell: ({ row }) => (row.original.due_at ? relativeTime(row.original.due_at) : `Opened ${relativeTime(row.original.created_at)}`) },
  // `focus` lands the inbox on this task; `type` keeps the list to its kind.
  actionColumn((r) => <RowLink href={`/inbox?type=${encodeURIComponent(r.item_type)}&focus=${encodeURIComponent(r.id)}`}>Open</RowLink>),
];

export default function MdmOverviewPage() {
  const dash = useQuery({ queryKey: ["mdm", "dashboard"], queryFn: getMdmDashboard });
  // The aggregate snapshots (domain unset) of the last eight weeks, from the same API as the latest one.
  const health = useQuery({ queryKey: ["mdm", "history", 56], queryFn: () => getMdmHistory({ days: 56 }) });
  // Match work only, in every status the inbox counts as live; the queue API filters one status a call.
  const queues = useQueries({
    queries: LIVE.map((status) => ({
      queryKey: ["mdm", "queue", MATCH_WORK, status],
      queryFn: () => getQueueItems({ item_type: MATCH_WORK, status, limit: SHOWN }),
      meta: { ignoreError: true },
    })),
  });
  const m = dash.data?.latest ?? null;
  const points = health.data?.history ?? [];
  // A task can change status between the three reads; keep each once.
  const items = [...new Map(queues.flatMap((q) => q.data?.items ?? []).map((t) => [t.id, t])).values()].sort(urgentFirst).slice(0, SHOWN);
  const total = queues.reduce((n, q) => n + (q.data?.total ?? 0), 0);
  const matchLoading = queues.some((q) => q.isLoading);
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
  const tone = m ? readinessOf(m.mdm_health_score, bands) : undefined;
  const verdict = tone ? statusLabel("verdict", tone) : "";

  return (
    <ExplorerPage
      header={
        <PageHeader
          title="MDM overview"
          meta={m
            ? `${m.golden_record_count.toLocaleString()} golden records, ${backlogText(m.backlog_count)}`
            : "How complete and consistent your golden records are, and the match work waiting on a steward"}
          actions={<>
            <Button variant="secondary" render={<Link href="/mdm/survivorship">Survivorship rules</Link>} />
            {matchLoading || dash.isLoading ? null : <Button render={<Link href={next.href}>{next.label}</Link>} />}
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
                <Stat hero label="MDM health" value={m.mdm_health_score} bar={m.mdm_health_score} rule={{ target: bands.target }} tone={tone} versionId={m.snapshot_date} />
              </div>
              <div className="m-hero-verdict" data-testid="hero-verdict">
                <span className="font-semibold m-text-verdict-line m-ink [letter-spacing:var(--m-tracking-title)]">{verdict}</span>
                <span className="m-text-body m-ink-2">{`Target ${bands.target}, ${backlogText(m.backlog_count)}`}</span>
              </div>
            </div>
          }
          stats={[
            { label: "Coverage", value: asPct(m.golden_record_coverage_pct), to: "/mdm/golden", hint: "Weight 40%" },
            { label: "Match confidence", value: asPct(m.avg_match_confidence), to: "/mdm/match-rules", hint: "Weight 30%" },
            { label: "Steward SLA", value: asPct(m.steward_sla_compliance_pct), to: "/inbox", hint: "Weight 20%" },
            { label: "Source consistency", value: asPct(m.source_consistency_pct), to: "/mdm/golden", hint: "Weight 10%" },
          ]}
          // `bare` sets the score band alone; the cells below are not drawn.
          situation={{ sentence: `MDM health ${m.mdm_health_score}, ${verdict}`, tone }}
          changed={{ sentence: "" }}
          why={{ sentence: "" }}
          next={{ sentence: "" }}
        />
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
          <LedgerHead title="Match work" meta={total > items.length ? `${items.length.toLocaleString()} of ${total.toLocaleString()} merge decisions waiting` : `${total.toLocaleString()} merge ${total === 1 ? "decision" : "decisions"} waiting`} action={<Link href="/inbox" className="m-text-meta m-ink-accent-ink hover:underline">Open inbox</Link>} />
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
