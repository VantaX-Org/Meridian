"use client";

/** MDM › Overview: health ring, trend line and the numbers behind the score. */

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Button, Card, ExplorerPage, Line, ScoreRing, Stat } from "@/design";
import { getMdmHealth } from "@/lib/api/analytics";
import { getMdmDashboard } from "@/lib/api/mdm-metrics";
import { apiErrorMessage, isListFailure } from "@/lib/error";

export default function MdmOverviewPage() {
  const dash = useQuery({ queryKey: ["mdm", "dashboard"], queryFn: getMdmDashboard });
  const health = useQuery({ queryKey: ["mdm", "health"], queryFn: () => getMdmHealth() });
  const m = dash.data?.latest ?? null;
  const points = health.data?.data ?? [];
  const failed = isListFailure(dash) ? dash : isListFailure(health) ? health : null;
  const state = dash.isLoading || health.isLoading ? "loading" : failed ? "error" : !m && points.length === 0 ? "empty" : undefined;

  return (
    <ExplorerPage
      toolbarEnd={<Button variant="secondary" render={<Link href="/mdm/survivorship">Survivorship rules</Link>} />}
      state={state}
      emptyProps={{
        title: "No MDM health snapshot yet.",
        detail: "The first snapshot is taken after golden records are built.",
        action: <Button variant="secondary" render={<Link href="/mdm/golden">Open golden records</Link>} />,
        ghost: "chart",
      }}
      errorProps={{ message: apiErrorMessage(failed?.error), onRetry: () => { void dash.refetch(); void health.refetch(); } }}
      table={
        <div className="flex flex-col gap-4">
          <div className="grid gap-4 md:grid-cols-[auto_1fr]">
            <Card title="MDM health">{m ? <ScoreRing score={m.mdm_health_score} size={120} /> : <p className="text-[13px]" style={{ color: "var(--m-ink-3)" }}>No current snapshot yet.</p>}</Card>
            <Card title="Health over time">
              {points.length === 0 ? <p className="text-[13px]" style={{ color: "var(--m-ink-3)" }}>No history yet.</p> : <Line data={points.map((p) => ({ x: p.snapshot_date, y: p.mdm_health_score }))} label="MDM health score" />}
            </Card>
          </div>
          {m && (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Stat label="Golden records" value={m.golden_record_count.toLocaleString()} href="/mdm/golden" />
              <Stat label="Coverage" value={`${m.golden_record_coverage_pct}%`} />
              <Stat label="Match confidence" value={`${Math.round(m.avg_match_confidence * 100)}%`} />
              <Stat label="Steward SLA" value={`${m.steward_sla_compliance_pct}%`} />
              <Stat label="Source consistency" value={`${m.source_consistency_pct}%`} />
              <Stat label="Backlog" value={m.backlog_count} />
              <Stat label="Sync coverage" value={`${m.sync_coverage_pct}%`} />
              <Stat label="Active systems" value={dash.data?.active_systems_count ?? 0} />
            </div>
          )}
        </div>
      }
    />
  );
}
