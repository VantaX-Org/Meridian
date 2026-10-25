"use client";

/** MDM › Overview: the MDM health figure with its four inputs, then the match work waiting on a steward. */

import Link from "next/link";
import { useQueries, useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Button, Card, DataTable, ExplorerPage, Line, PageHeader, Pill, Stat, statusLabel, type CellMeta } from "@/design";
import { actionColumn, LedgerHead, RowLink } from "@/components/mdm/ledger";
import { getMdmHealth } from "@/lib/api/analytics";
import { getMdmDashboard } from "@/lib/api/mdm-metrics";
import { getQueueItems } from "@/lib/api/stewardship";
import { formatModuleName, relativeTime } from "@/lib/format";
import type { StewardshipQueueItem, StewardshipStatus } from "@/types/api";
import { isListFailure } from "@/lib/error";

/** The statuses the inbox counts as live work (inbox/page.tsx LIVE). */
const LIVE: StewardshipStatus[] = ["open", "in_progress", "escalated"];
const MATCH_WORK = "merge_decision";
const SHOWN = 10;

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
  const health = useQuery({ queryKey: ["mdm", "health"], queryFn: () => getMdmHealth() });
  // Match work only, in every status the inbox counts as live; the queue API filters one status a call.
  const queues = useQueries({
    queries: LIVE.map((status) => ({
      queryKey: ["mdm", "queue", MATCH_WORK, status],
      queryFn: () => getQueueItems({ item_type: MATCH_WORK, status, limit: SHOWN }),
      meta: { ignoreError: true },
    })),
  });
  const m = dash.data?.latest ?? null;
  const trend = dash.data?.trend ?? [];
  const points = health.data?.data ?? [];
  // A task can change status between the three reads; keep each once.
  const items = [...new Map(queues.flatMap((q) => q.data?.items ?? []).map((t) => [t.id, t])).values()].sort(urgentFirst).slice(0, SHOWN);
  const total = queues.reduce((n, q) => n + (q.data?.total ?? 0), 0);
  const failed = isListFailure(dash) ? dash : isListFailure(health) ? health : null;
  const state = dash.isLoading || health.isLoading ? "loading" : failed ? "error" : !m && points.length === 0 && items.length === 0 ? "empty" : undefined;
  const tone = m ? (m.mdm_health_score >= 85 ? "go" : m.mdm_health_score >= 60 ? "at-risk" : "no-go") : undefined;
  const verdict = tone ? statusLabel("verdict", tone) : null;

  return (
    <ExplorerPage
      header={
        <PageHeader
          title="MDM overview"
          meta={m
            ? `${m.golden_record_count.toLocaleString()} golden records, ${m.backlog_count.toLocaleString()} waiting on a steward`
            : "How complete and consistent your golden records are, and the match work waiting on a steward"}
          actions={<>
            <Button variant="secondary" render={<Link href="/mdm/survivorship">Survivorship rules</Link>} />
            <Button render={<Link href="/mdm/golden/merge">Review match pairs</Link>} />
          </>}
        />
      }
      summary={m ? (
        <section aria-label="MDM health" className="m-hero m-motion-rise">
          <div className="grid gap-8 @7xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] @7xl:items-end">
            <div className="m-hero-lead">
              <div className="m-score-hero" data-testid="score-hero">
                <Stat hero label="MDM health" value={m.mdm_health_score} bar={m.mdm_health_score} rule={{ target: 85 }} tone={tone} versionId={m.snapshot_date} hint={verdict ?? undefined} />
              </div>
            </div>
            <div className="m-motion-stagger grid min-w-0 grid-cols-2 gap-x-6 gap-y-4 @3xl:grid-cols-4 @7xl:grid-cols-2">
              <Stat label="Coverage" value={`${m.golden_record_coverage_pct}%`} href="/mdm/golden" hint="Weight 40%" spark={trend.map((t) => t.golden_record_coverage_pct)} />
              <Stat label="Match confidence" value={`${Math.round(m.avg_match_confidence * 100)}%`} href="/mdm/match-rules" hint="Weight 30%" spark={trend.map((t) => t.avg_match_confidence * 100)} />
              <Stat label="Steward SLA" value={`${m.steward_sla_compliance_pct}%`} href="/inbox" hint="Weight 20%" spark={trend.map((t) => t.steward_sla_compliance_pct)} />
              <Stat label="Source consistency" value={`${m.source_consistency_pct}%`} href="/mdm/golden" hint="Weight 10%" spark={trend.map((t) => t.source_consistency_pct)} />
            </div>
          </div>
        </section>
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
          <LedgerHead title="Match work" meta={total > items.length ? `${items.length.toLocaleString()} of ${total.toLocaleString()} waiting` : `${total.toLocaleString()} waiting`} action={<Link href="/inbox" className="m-text-meta m-ink-accent-ink hover:underline">Open inbox</Link>} />
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
