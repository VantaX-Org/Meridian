"use client";

/** MDM › Overview: health ring, trend line and the numbers behind the score. */

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Button, Card, EmptyState, ExplorerPage, Line, PageHeader, ScoreExplainer, Stat } from "@/design";
import { getMdmHealth } from "@/lib/api/analytics";
import { getMdmDashboard } from "@/lib/api/mdm-metrics";
import { getQueueItems } from "@/lib/api/stewardship";
import { formatModuleName, relativeTime } from "@/lib/format";
import type { StewardshipQueueItem } from "@/types/api";
import { apiErrorMessage, isListFailure } from "@/lib/error";

const itemLabel = (t: string) => t.replace(/_/g, " ");

/** A short list of open stewardship items; a region-empty line, never a card, when there are none. */
function QueuePanel({ title, items, total, empty }: { title: string; items: StewardshipQueueItem[] | undefined; total: number; empty: string }) {
  return (
    <Card title={title} actions={<Link href="/inbox" className="m-text-meta" style={{ color: "var(--m-accent-ink)" }}>{total > (items?.length ?? 0) ? `Open all ${total.toLocaleString()}` : "Open inbox"}</Link>}>
      {items && items.length > 0 ? (
        <ul className="flex flex-col">
          {items.map((i) => (
            <li key={i.id} className="flex items-baseline justify-between gap-3 py-1 m-text-body" style={{ borderTop: "1px solid var(--m-line)" }}>
              <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
                <span>{formatModuleName(i.domain)}</span>
                <span className="m-text-meta" style={{ color: "var(--m-ink-3)" }}>{itemLabel(i.item_type)}</span>
              </span>
              <span className="m-text-meta shrink-0" style={{ color: "var(--m-ink-3)" }}>{i.due_at ? `due ${relativeTime(i.due_at)}` : `opened ${relativeTime(i.created_at)}`}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="m-text-body" style={{ color: "var(--m-ink-3)" }}>{empty}</p>
      )}
    </Card>
  );
}

export default function MdmOverviewPage() {
  const dash = useQuery({ queryKey: ["mdm", "dashboard"], queryFn: getMdmDashboard });
  const health = useQuery({ queryKey: ["mdm", "health"], queryFn: () => getMdmHealth() });
  const queue = useQuery({ queryKey: ["mdm", "queue-open"], queryFn: () => getQueueItems({ status: "open", limit: 10 }), meta: { ignoreError: true } });
  const merges = useQuery({ queryKey: ["mdm", "queue-merge"], queryFn: () => getQueueItems({ status: "open", item_type: "merge_decision", limit: 8 }), meta: { ignoreError: true } });
  const m = dash.data?.latest ?? null;
  const trend = dash.data?.trend ?? [];
  const points = health.data?.data ?? [];
  const failed = isListFailure(dash) ? dash : isListFailure(health) ? health : null;
  const state = dash.isLoading || health.isLoading ? "loading" : failed ? "error" : !m && points.length === 0 ? "empty" : undefined;

  return (
    <ExplorerPage
      header={<PageHeader title="MDM overview" meta={m ? `${m.golden_record_count.toLocaleString()} golden records` : undefined} />}
      toolbarEnd={<Button variant="secondary" render={<Link href="/mdm/survivorship">Survivorship rules</Link>} />}
      state={state}
      emptyProps={{
        title: "No MDM health snapshot",
        detail: "The first snapshot is taken after golden records are built.",
        action: <Button variant="secondary" render={<Link href="/mdm/golden">Open golden records</Link>} />,
        ghost: "chart",
      }}
      errorProps={{ message: apiErrorMessage(failed?.error), onRetry: () => { void dash.refetch(); void health.refetch(); } }}
      table={
        <div className="flex flex-col gap-4">
          <div className="grid gap-4 @5xl:grid-cols-12">
            <div className="@5xl:col-span-3">
              <Card title="MDM health">{m ? <ScoreExplainer
                score={m.mdm_health_score}
                band={m.mdm_health_score >= 85 ? { label: "Healthy", tone: "go" } : m.mdm_health_score >= 60 ? { label: "Needs attention", tone: "at-risk" } : { label: "Unhealthy", tone: "no-go" }}
                // Fixed weights from api/services/mdm_scoring.py; the snapshot carries the four inputs.
                dimensions={[
                  { name: "Golden record coverage", weight: 0.4, score: m.golden_record_coverage_pct },
                  { name: "Match confidence", weight: 0.3, score: m.avg_match_confidence * 100 },
                  { name: "Steward SLA", weight: 0.2, score: m.steward_sla_compliance_pct },
                  { name: "Source consistency", weight: 0.1, score: m.source_consistency_pct },
                ]}
                rules={[]}
                historyHref="/mdm"
              /> : <EmptyState title="No current snapshot" detail="The first snapshot is taken after golden records are built." action={<Button variant="secondary" render={<Link href="/mdm/golden">Open golden records</Link>} />} />}</Card>
            </div>
            <div className="@5xl:col-span-5">
              <Card title="Health over time">
                {points.length === 0 ? <EmptyState title="No history yet" detail="Each snapshot adds a point to this line." action={<Button variant="secondary" render={<Link href="/mdm/golden">Open golden records</Link>} />} /> : <Line data={points.map((p) => ({ x: p.snapshot_date, y: p.mdm_health_score }))} label="MDM health score" height={160} />}
              </Card>
            </div>
            {m && (
              <div className="grid grid-cols-2 content-start gap-3 @5xl:col-span-4">
                <Stat label="Golden records" help="goldenRecord" value={m.golden_record_count.toLocaleString()} href="/mdm/golden" spark={trend.map((t) => t.golden_record_count)} />
                <Stat label="Coverage" value={`${m.golden_record_coverage_pct}%`} href="/mdm/golden" spark={trend.map((t) => t.golden_record_coverage_pct)} />
                <Stat label="Match confidence" value={`${Math.round(m.avg_match_confidence * 100)}%`} href="/mdm/match-rules" spark={trend.map((t) => t.avg_match_confidence * 100)} />
                <Stat label="Steward SLA" value={`${m.steward_sla_compliance_pct}%`} href="/inbox" spark={trend.map((t) => t.steward_sla_compliance_pct)} />
              </div>
            )}
          </div>
          {m && (
            <div className="m-stat-grid">
              <Stat label="Source consistency" value={`${m.source_consistency_pct}%`} href="/mdm/golden" spark={trend.map((t) => t.source_consistency_pct)} />
              <Stat label="Backlog" value={m.backlog_count.toLocaleString()} href="/inbox" spark={trend.map((t) => t.backlog_count)} />
              <Stat label="Sync coverage" value={`${m.sync_coverage_pct}%`} href="/systems" spark={trend.map((t) => t.sync_coverage_pct)} />
              <Stat label="Active systems" value={dash.data?.active_systems_count ?? 0} href="/systems" />
            </div>
          )}
          <div className="grid gap-4 @5xl:grid-cols-12">
            <div className="@5xl:col-span-7">
              <QueuePanel title="Stewardship queue" items={queue.data?.items} total={queue.data?.total ?? 0} empty="No open stewardship items." />
            </div>
            <div className="@5xl:col-span-5">
              <QueuePanel title="Match clusters awaiting review" items={merges.data?.items} total={merges.data?.total ?? 0} empty="No match clusters awaiting review." />
            </div>
          </div>
        </div>
      }
    />
  );
}
