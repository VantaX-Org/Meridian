"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useFixture } from "@/lib/api/v2/fixture";
import { getConfigProcess, getConfigProcesses, rediscoverConfig } from "@/lib/api/v2/config";
import type { ProcessStep } from "@/lib/api/v2/config";
import { useV2Session } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";
import { whole } from "@/lib/v2/format";
import { BarList, Button, Card, DataTable, EmptyState, FieldChip, Select, StatTile, Stepper, useToast } from "@/ui/kit";
import { errMsg, Gate } from "./shared";

const STATUS: Record<string, () => string> = { active: () => t("Active"), partial: () => t("Partial"), inactive: () => t("Inactive") };

/** One business process of the latest configuration run, step by step, with where the volume and exceptions sit. */
function ProcessDetail({ id }: { id: string }) {
  const fx = useFixture();
  const q = useQuery({ queryKey: ["v2", "config-process", fx, id] as const, queryFn: () => getConfigProcess(id), retry: false });
  return (
    <Gate q={q} empty={null}>
      {(p) => (
        <div className="mx-col">
          <dl className="mx-tiles">
            <StatTile label={t("Status")} value={(STATUS[p.status] ?? (() => p.status))()} />
            <StatTile label={t("Completeness")} value={`${Math.round(p.completeness_score * 100)}%`} />
            <StatTile label={t("Volume")} value={whole(p.total_volume)} />
            <StatTile label={t("Exception rate")} value={`${(p.exception_rate * 100).toFixed(1)}%`} />
            <StatTile label={t("Cycle days")} value={p.avg_cycle_days == null ? "-" : p.avg_cycle_days.toFixed(1)} />
            <StatTile label={t("Bottleneck")} value={p.bottleneck_step ?? "-"} />
          </dl>
          {p.steps.length === 0 ? <EmptyState heading={t("No steps")} body={t("This process has no steps in the latest read.")} /> : (
            <>
              <BarList label={t("Volume by step")} items={p.steps.map((s) => ({ id: String(s.step_number), label: s.step_name, value: s.volume, display: whole(s.volume), sev: s.step_name === p.bottleneck_step ? "high" : undefined }))} />
              <DataTable<ProcessStep> label={t("Process steps")} rows={p.steps} rowKey={(s) => String(s.step_number)} height={300} columns={[
                { key: "n", label: t("Step"), render: (s) => s.step_number },
                { key: "name", label: t("Name"), render: (s) => s.step_name },
                { key: "table", label: t("SAP table"), render: (s) => <FieldChip code={s.sap_table} description={s.detected ? t("Found in the data") : t("Not found in the data")} /> },
                { key: "vol", label: t("Volume"), align: "end" as const, render: (s) => whole(s.volume) },
                { key: "exc", label: t("Exceptions"), align: "end" as const, render: (s) => whole(s.exception_count) },
                { key: "days", label: t("Days to next step"), align: "end" as const, render: (s) => (s.avg_days_to_next_step == null ? "-" : s.avg_days_to_next_step.toFixed(1)) },
              ]} />
            </>
          )}
        </div>
      )}
    </Gate>
  );
}

export function ProcessCard() {
  const fx = useFixture();
  const list = useQuery({ queryKey: ["v2", "config-processes", fx] as const, queryFn: getConfigProcesses, retry: false });
  const [pick, setPick] = useState<string | null>(null);
  return (
    <Card title={t("Business processes")} sub={t("Each process as the latest transactions show it.")}>
      <Gate q={list} empty={null}>
        {(d) => {
          if (d.processes.length === 0) return <EmptyState heading={t("No processes found")} body={t("Rediscover the configuration to list its processes.")} />;
          const id = pick ?? d.processes[0].process_id;
          return (
            <div className="mx-col">
              <Select aria-label={t("Process")} value={id} onChange={(e) => setPick(e.target.value)} options={d.processes.map((p) => ({ value: p.process_id, label: `${p.process_id} ${p.process_name}` }))} />
              <ProcessDetail id={id} />
            </div>
          );
        }}
      </Gate>
    </Card>
  );
}

/** Confirm, queue, then the lists refresh: queues a rerun of discovery on the latest analysed version. */
export function RediscoverCard() {
  const qc = useQueryClient();
  const toast = useToast();
  const me = useV2Session();
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [run, setRun] = useState<string | null>(null);
  if (!(me.can("trigger_sync") || me.can("manage_systems"))) return null;
  const go = async () => {
    setBusy(true);
    try {
      const r = await rediscoverConfig();
      setRun(r.version_id);
      setStep(r.queued ? 2 : 0);
      if (r.queued) await qc.invalidateQueries({ queryKey: ["v2"] });
    } catch (e) { toast(errMsg(e), "bad"); } finally { setBusy(false); }
  };
  return (
    <Card title={t("Rediscover the configuration")} sub={t("Reads the configuration again from the latest analysed run.")}>
      <div className="mx-col">
        <Stepper label={t("Rediscover steps")} current={step} steps={[{ id: "confirm", label: t("Confirm") }, { id: "queue", label: t("Queue") }, { id: "done", label: t("Queued") }]} />
        {step === 2 ? (
          <p className="mx-muted">{t("Queued on run {id}. The lists refresh when it finishes.", { id: run ?? "" })}</p>
        ) : step === 1 ? (
          <span className="mx-links">
            <Button disabled={busy} onClick={() => void go()}>{t("Queue the rerun")}</Button>
            <Button variant="ghost" disabled={busy} onClick={() => setStep(0)}>{t("Cancel")}</Button>
          </span>
        ) : <Button variant="secondary" onClick={() => setStep(1)}>{t("Rediscover")}</Button>}
      </div>
    </Card>
  );
}
