"use client";

/** Fix › What-if: simulate every rule fix on a run and compare the score before and after. */

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button, Card, EmptyState, ErrorState, ReportPage, ScoreRing, Select, Stat, Waterfall } from "@/design";
import { createSimulation, getSimulation, isSimulationResult } from "@/lib/api/simulation";
import { getVersions } from "@/lib/api/versions";
import { apiErrorMessage, isListFailure } from "@/lib/error";
import { usePermissions } from "@/lib/permissions";

export default function WhatIfPage() {
  const { can } = usePermissions();
  const [picked, setPicked] = useState("");
  const [simId, setSimId] = useState<string | null>(null);
  const versions = useQuery({ queryKey: ["versions", "what-if"], queryFn: () => getVersions({ limit: 25 }) });
  const runs = (versions.data?.versions ?? []).filter((v) => v.status === "complete" || v.status === "agents_complete" || v.status === "ai_enriched");
  const versionId = picked || runs[0]?.id || "";
  const run = useMutation({
    mutationFn: () => createSimulation({ version_id: versionId, all_rule_fixes: true, rank: true }),
    onSuccess: (r) => setSimId(r.simulation_id),
    onError: (e) => toast.error(`Simulation not started. ${apiErrorMessage(e)}`),
  });
  const sim = useQuery({
    queryKey: ["simulation", simId],
    queryFn: () => getSimulation(simId as string),
    enabled: !!simId,
    refetchInterval: (q) => (q.state.data && isSimulationResult(q.state.data) ? false : 2000),
  });
  const final = sim.data && isSimulationResult(sim.data) ? sim.data : null;
  const result = final && final.status === "completed" ? final : null;
  const failed = final && final.status === "failed" ? final : null;
  const running = !!simId && !final && !sim.isError;

  const controls = (
    <div className="flex gap-2">
      {runs.length > 0 && <Select label="Analysis run" value={versionId} onValueChange={(v) => { setPicked(v); setSimId(null); }} options={runs.map((r) => ({ value: r.id, label: r.label ?? r.id }))} placeholder="Run" />}
      {can("analyse") && <Button pending={run.isPending || running} disabled={!versionId} onClick={() => run.mutate()}>Run simulation</Button>}
    </div>
  );

  const o = result?.dqs.overall;
  return (
    <ReportPage
      state={versions.isLoading ? "loading" : isListFailure(versions) ? "error" : runs.length === 0 ? "empty" : undefined}
      emptyProps={{ title: "No finished run to simulate.", detail: "Run an analysis, then come back to see what the fixes would be worth.", ghost: "chart" }}
      errorProps={{ message: apiErrorMessage(versions.error), onRetry: () => void versions.refetch() }}
      narrative={controls}
      charts={
        result && o ? (
          <>
            <Card title="Score before"><ScoreRing score={o.before ?? 0} size={120} /></Card>
            <Card title="Score after"><ScoreRing score={o.after ?? 0} size={120} /></Card>
            <Card title="Change by module">
              <Waterfall
                label="Score change by module"
                data={[
                  { x: "Before", y: o.before ?? 0, total: true },
                  ...result.dqs.modules.map((m) => ({ x: m.module, y: m.delta ?? 0 })),
                  { x: "After", y: o.after ?? 0, total: true },
                ]}
              />
            </Card>
          </>
        ) : failed ? (
          <ErrorState message={failed.error} onRetry={() => run.mutate()} />
        ) : sim.isError ? (
          <ErrorState message="This simulation has expired. Run it again." onRetry={() => run.mutate()} />
        ) : (
          <EmptyState title={running ? "Simulating." : "No simulation yet."} detail={running ? "Applying every rule fix to a copy of the data." : "Pick a run and press Run simulation. Nothing is written to your system."} ghost="ring" />
        )
      }
      tables={
        result ? (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Findings resolved" value={result.findings.resolved} />
            <Stat label="Findings introduced" value={result.findings.introduced} />
            <Stat label="Cells changed" value={result.fixes.cells_changed} />
            <Stat label="Records fixed" value={result.records.resolved} />
          </div>
        ) : undefined
      }
    />
  );
}
