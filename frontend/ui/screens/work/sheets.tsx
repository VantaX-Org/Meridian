"use client";

import { useEffect, useState } from "react";
import { createSimulation, getSimulation, isDone, type SimulationState } from "@/lib/api/v2/simulations";
import { useBatches } from "@/lib/v2/approvals-queries";
import { useRecordLinks, useWorkSummary } from "@/lib/v2/work-queries";
import { fixed } from "@/lib/v2/format";
import { t } from "@/lib/v2/i18n";
import { useCanvasRun } from "@/lib/v2/scope";
import type { SheetDef } from "@/ui/kit/SheetHost";
import { Button, DataTable, EmptyState, FieldChip, Skeleton, StatTile } from "@/ui/kit";
import { BatchDetail } from "./Approvals";
import { RecordDetail } from "./RecordDetail";
import { day } from "./shared";

type RecArg = { module: string; recordKey: string; version?: string };

/**
 * The record sheet. A caller passes { module, recordKey, version }; the deep link `?open=record:<module>:<key>` passes the
 * bare id, and the run then comes from the address (`?run=` or the run page). With neither it reads the latest run.
 */
export function RecordSheet({ arg }: { arg: unknown }) {
  const run = useCanvasRun();
  const i = typeof arg === "string" ? arg.indexOf(":") : -1;
  const a: RecArg = typeof arg === "string" ? { module: arg.slice(0, Math.max(i, 0)), recordKey: arg.slice(i + 1) } : (arg as RecArg);
  return <RecordDetail module={a.module} recordKey={a.recordKey} version={a.version ?? run ?? undefined} />;
}

function Decisions({ module, recordKey }: RecArg) {
  const rec = useRecordLinks(module, recordKey, null);
  if (rec.isLoading) return <Skeleton lines={4} label={t("Loading the decisions")} />;
  const rows = rec.data?.history ?? [];
  if (!rows.length) return <EmptyState heading={t("No decisions yet")} />;
  return (
    <DataTable label={t("Decisions")} rows={rows} rowKey={(h) => `${h.check_id}-${h.at}-${h.action}`} height={360}
      columns={[
        { key: "a", label: t("When"), render: (h) => day(h.at), sort: (h) => h.at ?? "" },
        { key: "c", label: t("Rule"), render: (h) => <FieldChip code={h.check_id} /> },
        { key: "x", label: t("Action"), render: (h) => h.action },
        { key: "f", label: t("From"), render: (h) => h.from_value ?? "" },
        { key: "t", label: t("To"), render: (h) => h.to_value ?? "" },
        { key: "u", label: t("By"), render: (h) => h.user ?? "" },
      ]} />
  );
}

function Approve({ id }: { id: string }) {
  const q = useBatches();
  const b = q.rows.find((r) => r.id === id);
  return b ? <BatchDetail b={b} /> : <EmptyState heading={t("Batch not found")} />;
}

/** What if: runs every proposed rule fix as a simulation and shows the score before and after. */
function WhatIf() {
  const sum = useWorkSummary();
  const version = sum.data?.version_id;
  const [sim, setSim] = useState<SimulationState | null>(null);
  const [failed, setFailed] = useState(false);
  const [id, setId] = useState<string | null>(null);
  useEffect(() => {
    if (!id) return;
    let stop = false;
    const tick = async () => {
      try {
        const s = await getSimulation(id);
        if (stop) return;
        setSim(s);
        if (!isDone(s) && s.status !== "failed") setTimeout(() => void tick(), 1500);
      } catch { if (!stop) setFailed(true); }
    };
    void tick();
    return () => { stop = true; };
  }, [id]);
  const start = async () => {
    if (!version) return;
    setFailed(false); setSim(null);
    try { setId((await createSimulation({ version_id: version, all_rule_fixes: true, rank: true })).simulation_id); } catch { setFailed(true); }
  };
  return (
    <>
      <p className="mx-muted">{t("Try every proposed fix on a copy. Nothing changes in SAP.")}</p>
      <Button variant="primary" disabled={!version} onClick={() => void start()}>{t("Run the simulation")}</Button>
      {failed || (sim && sim.status === "failed") ? <p>{t("The simulation did not finish. Try again.")}</p> : null}
      {id && !sim && !failed ? <Skeleton lines={3} label={t("Running the simulation")} /> : null}
      {sim && isDone(sim) ? (
        <>
          <dl className="mx-tiles">
            <StatTile label={t("Score now")} value={fixed(sim.dqs.overall.before ?? 0, 1)} />
            <StatTile label={t("Score after")} value={fixed(sim.dqs.overall.after ?? 0, 1)} />
            <StatTile label={t("Change")} value={fixed(sim.dqs.overall.delta ?? 0, 1)} />
            <StatTile label={t("Records fixed")} value={String(sim.records.resolved)} />
          </dl>
          {sim.side_effects.length ? <p>{t("{n} rules would get worse.", { n: sim.side_effects.length })}</p> : null}
        </>
      ) : null}
    </>
  );
}

export const workSheets: Record<string, SheetDef> = {
  record: { get label() { return t("Record"); }, render: (a) => <RecordSheet arg={a} /> },
  decisions: { get label() { return t("Decisions"); }, render: (a) => <Decisions {...(a as RecArg)} /> },
  approve: { get label() { return t("Approve a batch"); }, render: (a) => <Approve id={String((a as { id: string }).id)} /> },
  whatif: { get label() { return t("What if"); }, render: () => <WhatIf /> },
};
