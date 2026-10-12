"use client";

/** MDM › Overview: health ring, trend line and the numbers behind the score. */

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Button, Card, EmptyState, ExplorerPage, Line, PageHeader, ScoreExplainer, Stat } from "@/design";
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
          <div className="grid gap-4 md:grid-cols-[auto_1fr]">
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
            <Card title="Health over time">
              {points.length === 0 ? <EmptyState title="No history yet" detail="Each snapshot adds a point to this line." action={<Button variant="secondary" render={<Link href="/mdm/golden">Open golden records</Link>} />} /> : <Line data={points.map((p) => ({ x: p.snapshot_date, y: p.mdm_health_score }))} label="MDM health score" />}
            </Card>
          </div>
          {m && (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Stat label="Coverage" value={`${m.golden_record_coverage_pct}%`} href="/mdm/golden" />
              <Stat label="Match confidence" value={`${Math.round(m.avg_match_confidence * 100)}%`} href="/mdm/match-rules" />
              <Stat label="Steward SLA" value={`${m.steward_sla_compliance_pct}%`} href="/inbox" />
              <Stat label="Backlog" value={m.backlog_count.toLocaleString()} href="/inbox" />
            </div>
          )}
        </div>
      }
    />
  );
}
