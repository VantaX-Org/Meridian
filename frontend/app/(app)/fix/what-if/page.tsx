"use client";

/** Fix › What-if: simulate every rule fix on a run and compare the score before and after. */

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button, Card, Delta, EmptyState, ErrorState, ReportPage, Select, Stat, Waterfall, asyncStateOf } from "@/design";
import { createSimulation, getSimulation, isSimulationResult } from "@/lib/api/simulation";
import { getVersions } from "@/lib/api/versions";
import { isFinished } from "@/lib/runs";
import { apiErrorMessage } from "@/lib/error";
import { useSearchParams } from "next/navigation";
import { usePermissions } from "@/lib/permissions";
import { CreateBatchFromSimulation, RuleImpact } from "./rule-impact";

export default function WhatIfPage() {
  const { can } = usePermissions();
  const [picked, setPicked] = useState("");
  const [simId, setSimId] = useState<string | null>(null);
  const versions = useQuery({ queryKey: ["versions", "what-if"], queryFn: () => getVersions({ limit: 25 }) });
  const runs = (versions.data?.versions ?? []).filter(isFinished);
  const fromUrl = useSearchParams().get("run");
  const versionId = picked || runs.find((v) => v.id === fromUrl)?.id || runs[0]?.id || "";
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
      {can("apply") && result ? <CreateBatchFromSimulation simulation={result} /> : null}
    </div>
  );

  const o = result?.dqs.overall;
  return (
    <ReportPage
      state={asyncStateOf(versions, () => runs.length === 0, true)}
      emptyProps={{ title: "No finished run to simulate", detail: "Run an analysis, then come back to see what the fixes would be worth.", ghost: "chart" }}
      errorProps={{ message: apiErrorMessage(versions.error), onRetry: () => void versions.refetch() }}
      narrative={controls}
      charts={
        result && o ? (
          <>
            <Card title="Score before"><Stat label="Data quality score" value={o.before ?? 0} decimals={1} /></Card>
            <Card title="Score after"><Stat label="Data quality score" value={o.after ?? 0} decimals={1} tone={(o.after ?? 0) >= (o.before ?? 0) ? "go" : "at-risk"} delta={o.before != null && o.after != null ? <Delta value={o.after - o.before} /> : undefined} /></Card>
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
          <ErrorState title="Simulation did not produce fixes" message={failed.error} onRetry={() => run.mutate()} />
        ) : sim.isError ? (
          <ErrorState message="This simulation has expired. Run it again." onRetry={() => run.mutate()} />
        ) : (
          <EmptyState title={running ? "Simulating" : "No simulation yet"} detail={running ? "Applying every rule fix to a copy of the data." : "Pick a run and press Run simulation. Nothing is written to your system"} ghost="ring" />
        )
      }
      tables={
        result ? (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Stat label="Findings resolved" value={result.findings.resolved} />
              <Stat label="Findings introduced" value={result.findings.introduced} />
              <Stat label="Cells changed" value={result.fixes.cells_changed} />
              <Stat label="Records fixed" value={result.records.resolved} />
            </div>
            <RuleImpact result={result} />
          </div>
        ) : undefined
      }
    />
  );
}
