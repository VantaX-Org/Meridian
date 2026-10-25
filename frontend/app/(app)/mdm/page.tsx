"use client";

/** MDM › Overview: the MDM health figure with its four inputs, then the match work waiting on a steward. */

import { useMemo } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Button, Card, DataTable, ExplorerPage, Line, PageHeader, Pill, Stat, type CellMeta } from "@/design";
import { actionColumn, LedgerHead, RowLink } from "@/components/mdm/ledger";
import { getMdmHealth } from "@/lib/api/analytics";
import { getMdmDashboard } from "@/lib/api/mdm-metrics";
import { getQueueItems } from "@/lib/api/stewardship";
import { formatModuleName, relativeTime } from "@/lib/format";
import type { StewardshipQueueItem } from "@/types/api";
import { apiErrorMessage, isListFailure } from "@/lib/error";

const itemLabel = (t: string) => {
  const s = t.replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
};

/** Match decisions come first (they move the golden records), then the earliest due. */
const matchFirst = (a: StewardshipQueueItem, b: StewardshipQueueItem) =>
  Number(b.item_type === "merge_decision") - Number(a.item_type === "merge_decision") ||
  (a.due_at ?? "9999").localeCompare(b.due_at ?? "9999");

const columns: ColumnDef<StewardshipQueueItem>[] = [
  { id: "item", header: "Work", cell: ({ row }) => (row.original.item_type === "merge_decision" ? <Pill tone="info">{itemLabel(row.original.item_type)}</Pill> : itemLabel(row.original.item_type)) },
  { id: "object", header: "Object", cell: ({ row }) => formatModuleName(row.original.domain) },
  { id: "due", header: "Due", meta: { numeric: true } satisfies CellMeta, cell: ({ row }) => (row.original.due_at ? relativeTime(row.original.due_at) : `Opened ${relativeTime(row.original.created_at)}`) },
  actionColumn((r) => <RowLink href={`/inbox?type=${encodeURIComponent(r.item_type)}`}>Open</RowLink>),
];

export default function MdmOverviewPage() {
  const dash = useQuery({ queryKey: ["mdm", "dashboard"], queryFn: getMdmDashboard });
  const health = useQuery({ queryKey: ["mdm", "health"], queryFn: () => getMdmHealth() });
  const queue = useQuery({ queryKey: ["mdm", "queue-open"], queryFn: () => getQueueItems({ status: "open", limit: 10 }), meta: { ignoreError: true } });
  const m = dash.data?.latest ?? null;
  const trend = dash.data?.trend ?? [];
  const points = health.data?.data ?? [];
  const items = useMemo(() => [...(queue.data?.items ?? [])].sort(matchFirst), [queue.data]);
  const total = queue.data?.total ?? 0;
  const failed = isListFailure(dash) ? dash : isListFailure(health) ? health : null;
  const state = dash.isLoading || health.isLoading ? "loading" : failed ? "error" : !m && points.length === 0 && items.length === 0 ? "empty" : undefined;
  const tone = m ? (m.mdm_health_score >= 85 ? "go" : m.mdm_health_score >= 60 ? "at-risk" : "no-go") : undefined;
  const verdict = m ? (m.mdm_health_score >= 85 ? "Healthy" : m.mdm_health_score >= 60 ? "Needs attention" : "Unhealthy") : null;

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
      errorProps={{ message: apiErrorMessage(failed?.error), onRetry: () => { void dash.refetch(); void health.refetch(); } }}
      table={
        <section aria-label="Match work">
          <LedgerHead title="Match work" meta={total > items.length ? `${items.length.toLocaleString()} of ${total.toLocaleString()} open` : `${total.toLocaleString()} open`} action={<Link href="/inbox" className="m-text-meta m-ink-accent-ink hover:underline">Open inbox</Link>} />
          <DataTable
            columns={columns}
            data={items}
            getRowId={(r) => r.id}
            hideToolbar
            hideSearch
            height="auto"
            tableId="mdm-match-work"
            emptyMessage="No open match work"
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
