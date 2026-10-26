"use client";

/** Fix › What-if: simulate every rule fix on a run and compare the score before and after. */

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button, Delta, EmptyState, ErrorState, ReportPage, Select, Stat, Waterfall, asyncStateOf, toast } from "@/design";
import { createSimulation, getSimulation, isSimulationResult } from "@/lib/api/simulation";
import { getVersions } from "@/lib/api/versions";
import { isFinished } from "@/lib/runs";
import { apiErrorMessage } from "@/lib/error";
import { formatModuleName } from "@/lib/format";
import { runChoiceLabels } from "@/lib/run-scope";
import { useSearchParams } from "next/navigation";
import { usePermissions } from "@/lib/permissions";
import { CreateBatchFromSimulation, RuleImpact } from "./rule-impact";

export default function WhatIfPage() {
  const { can } = usePermissions();
  const [picked, setPicked] = useState("");
  const [simId, setSimId] = useState<string | null>(null);
  // The window and the fallback used to disagree: a ?run= older than the 25 returned kept its id in the
  // URL while the simulation silently ran the newest run. Ask for enough to contain the URL's run, and
  // say so when a run is not found rather than switching behind the user's back.
  const fromUrl = useSearchParams().get("run");
  const versions = useQuery({ queryKey: ["versions", "what-if", fromUrl], queryFn: () => getVersions({ limit: 100 }) });
  const runs = (versions.data?.versions ?? []).filter(isFinished);
  const runLabels = runChoiceLabels(runs);
  const urlRun = fromUrl ? runs.find((v) => v.id === fromUrl) : undefined;
  const missingUrlRun = Boolean(fromUrl) && !versions.isLoading && !urlRun;
  const versionId = picked || urlRun?.id || runs[0]?.id || "";
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
    <div className="flex items-center gap-2">
      {runs.length > 0 && <Select label="Analysis run" value={versionId} onValueChange={(v) => { setPicked(v); setSimId(null); }} options={runs.map((r) => ({ value: r.id, label: runLabels.get(r.id) ?? "Run" }))} placeholder="Run" />}
      {missingUrlRun ? (
        <span className="m-text-meta m-ink-3" role="status">
          That run is not among the latest {runs.length} finished runs; pick one above.
        </span>
      ) : null}
      {can("analyse") && <Button pending={run.isPending || running} disabled={!versionId} onClick={() => run.mutate()}>Run simulation</Button>}
      {can("apply") && result ? <CreateBatchFromSimulation simulation={result} /> : null}
    </div>
  );

  const o = result?.dqs.overall;
  const delta = o && o.before != null && o.after != null ? Math.round((o.after - o.before) * 10) / 10 : null;
  return (
    <ReportPage
      title="What-if"
      meta="Apply every rule fix to a copy of a run and compare the score before and after"
      exportMenu={controls}
      state={asyncStateOf(versions, () => runs.length === 0, true)}
      emptyProps={{
        title: "No finished run to simulate",
        detail: "Run an analysis, then come back to see what the fixes would be worth.",
        ghost: "chart",
        action: <Button render={<Link href="/runs">Open runs</Link>} />,
      }}
      errorProps={{ error: versions.error, onRetry: () => void versions.refetch() }}
      narrative={
        result && o && delta != null
          ? `Applying every fix would move the score from ${(o.before ?? 0).toFixed(1)} to ${(o.after ?? 0).toFixed(1)}, resolving ${result.findings.resolved.toLocaleString()} findings across ${result.records.resolved.toLocaleString()} records.`
          : "Pick a run and press Run simulation. Nothing is written to your system."
      }
      charts={
        result && o ? (
          <div className="flex flex-col gap-4">
            <div className="m-stat-grid">
              <Stat label="Score before" value={o.before ?? 0} decimals={1} />
              <Stat label="Score after" value={o.after ?? 0} decimals={1} tone={(o.after ?? 0) >= (o.before ?? 0) ? "go" : "at-risk"} delta={delta != null ? <Delta value={delta} /> : undefined} />
              <Stat label="Findings resolved" value={result.findings.resolved.toLocaleString()} />
              <Stat label="Findings introduced" value={result.findings.introduced.toLocaleString()} />
              <Stat label="Cells changed" value={result.fixes.cells_changed.toLocaleString()} />
              <Stat label="Records fixed" value={result.records.resolved.toLocaleString()} />
            </div>
            <div className="flex flex-col gap-1">
              <h2 className="font-semibold m-text-h">Score change by object</h2>
              <Waterfall
                label="Score change by module"
                data={[
                  { x: "Before", y: o.before ?? 0, total: true },
                  ...result.dqs.modules.map((m) => ({ x: formatModuleName(m.module), y: m.delta ?? 0 })),
                  { x: "After", y: o.after ?? 0, total: true },
                ]}
              />
            </div>
          </div>
        ) : failed ? (
          <ErrorState title="Simulation did not produce fixes" message={failed.error} onRetry={() => run.mutate()} />
        ) : sim.isError ? (
          <ErrorState message="This simulation has expired. Run it again." onRetry={() => run.mutate()} />
        ) : (
          <EmptyState title={running ? "Simulating" : "No simulation yet"} detail={running ? "Applying every rule fix to a copy of the data." : "Pick a run and press Run simulation. Nothing is written to your system"} ghost="ring" />
        )
      }
      tables={result ? <RuleImpact result={result} /> : undefined}
    />
  );
}
