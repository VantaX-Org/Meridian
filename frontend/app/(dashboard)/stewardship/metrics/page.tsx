"use client";

/**
 * Workbench, Steward metrics: queue health and throughput over the last
 * 30 days, by task type, by status and by steward.
 */

import { useQuery } from "@tanstack/react-query";
import { Banner, EmptyState, Metric, MetricStrip, PageHeader, SectionCard, TableSkeleton } from "@/components/ui-core";
import { typeLabel } from "../../workbench/queue";
import { getMetrics } from "@/lib/api/stewardship";

const pct = (r: number | null | undefined) => (r == null ? null : Math.round(r * 100));
const sentence = (s: string) => { const t = s.replace(/_/g, " "); return t.charAt(0).toUpperCase() + t.slice(1); };

function CountTable({ head, rows, unit = "" }: { head: [string, string]; rows: [string, number][]; unit?: string }) {
  if (!rows.length) return <EmptyState>Nothing recorded yet.</EmptyState>;
  const total = rows.reduce((a, [, n]) => a + n, 0);
  return (
    <div className="ui-matrix-scroll"><table className="ui-mini-table">
      <thead><tr><th scope="col">{head[0]}</th><th scope="col" className="aurora-number">{head[1]}</th>{unit ? null : <th scope="col" className="aurora-number">Share</th>}</tr></thead>
      <tbody>{[...rows].sort((a, b) => b[1] - a[1]).map(([k, n]) => (
        <tr key={k}>
          <td>{k}</td>
          <td className="aurora-number">{unit ? `${n.toFixed(1)}${unit}` : n.toLocaleString()}</td>
          {unit ? null : <td className="aurora-number">{total ? Math.round((n / total) * 100) : 0}%</td>}
        </tr>
      ))}</tbody>
    </table></div>
  );
}

export default function StewardshipMetricsPage() {
  const q = useQuery({ queryKey: ["stewardship.metrics"], queryFn: getMetrics, refetchInterval: 30_000 });
  const m = q.data;
  const resolved = m ? (m.items_by_status.resolved ?? 0) : null;

  return (
    <div className="ui-page">
      <PageHeader title="Steward metrics" summary="Queue health and throughput over the last 30 days. Refreshes every 30 seconds." />
      <MetricStrip label="Stewardship">
        <Metric label="Backlog" value={m?.backlog_total ?? null} tone={m?.backlog_total ? "warning" : "default"} />
        <Metric label="Resolved" value={resolved} />
        <Metric label="SLA compliance" value={pct(m?.sla_compliance_rate)} unit="%" tone={m && m.sla_compliance_rate < 0.9 ? "danger" : "default"} />
        <Metric label="Suggestions accepted" value={pct(m?.ai_acceptance_rate)} unit="%" />
      </MetricStrip>
      {q.isLoading ? <TableSkeleton rows={6} label="Loading steward metrics" />
        : q.error || !m ? <Banner tone="danger" title="Steward metrics could not be read">{(q.error as Error | null)?.message ?? "No data returned."}</Banner>
        : (
          <div className="ui-columns">
            <div className="ui-stack">
              <SectionCard title="Tasks by type" flush>
                <CountTable head={["Type", "Tasks"]} rows={Object.entries(m.items_by_type).map(([k, n]) => [typeLabel(k), n])} />
              </SectionCard>
              <SectionCard title="Steward throughput" meta="Last 30 days" flush>
                {m.steward_breakdown?.length ? (
                  <div className="ui-matrix-scroll"><table className="ui-mini-table">
                    <thead><tr>
                      <th scope="col">Steward</th>
                      <th scope="col" className="aurora-number">Resolved</th>
                      <th scope="col" className="aurora-number">Assigned</th>
                      <th scope="col" className="aurora-number">Average resolve</th>
                    </tr></thead>
                    <tbody>{[...m.steward_breakdown].sort((a, b) => b.resolved - a.resolved).map((s) => (
                      <tr key={s.steward_name}>
                        <td>{s.steward_name}</td>
                        <td className="aurora-number">{s.resolved}</td>
                        <td className="aurora-number">{s.total}</td>
                        <td className="aurora-number">{s.avg_resolution_hours != null ? `${s.avg_resolution_hours.toFixed(1)}h` : "—"}</td>
                      </tr>
                    ))}</tbody>
                  </table></div>
                ) : <EmptyState>No steward has resolved a task in the last 30 days.</EmptyState>}
              </SectionCard>
            </div>
            <div className="ui-stack">
              <SectionCard title="Tasks by status" flush>
                <CountTable head={["Status", "Tasks"]} rows={Object.entries(m.items_by_status).map(([k, n]) => [sentence(k), n])} />
              </SectionCard>
              <SectionCard title="Average time to resolve" flush>
                <CountTable head={["Type", "Hours"]} unit="h" rows={Object.entries(m.avg_resolution_hours_by_type).map(([k, n]) => [typeLabel(k), n])} />
              </SectionCard>
            </div>
          </div>
        )}
    </div>
  );
}
