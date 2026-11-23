"use client";

import { useState } from "react";
import { getMiningGraph, getMiningRunSummary, type MiningActivity, type MiningGraph, type MiningVariant, type StepStatus } from "@/lib/api/v2/mining";
import { getVersionsPage } from "@/lib/api/v2/runs";
import { t } from "@/lib/v2/i18n";
import { moduleText } from "@/lib/v2/labels";
import { BarList, Card, Code, DataTable, Select } from "@/ui/kit";
import { Async, Empty, num, useRead } from "./shared";

const STEP: Record<StepStatus, () => string> = { green: () => t("Healthy"), amber: () => t("At risk"), red: () => t("Failing") };

/** The newest run's id, shared by both mining views. */
function useLatestRun() {
  return useRead(["mining", "latest-run"], async () => (await getVersionsPage({ limit: 1 })).versions[0] ?? null);
}

/** Duplicates, anomalies and relationships the mining pass found, per object of the newest run. */
export function MiningByObject() {
  const run = useLatestRun();
  const id = run.data?.id ?? "";
  const sum = useRead(["mining", "run-summary", id], () => getMiningRunSummary(id), !!id);
  return (
    <Async q={run} lines={3}>
      {(v) => !v ? <Empty heading={t("There is no run to mine")} /> : (
        <Async q={sum} lines={4}>
          {(s) => {
            const rows = Object.entries(s.per_module).map(([name, c]) => ({ module: name, ...c }));
            return rows.length === 0 ? <Empty heading={t("Nothing mined for this run yet")} body={t("Mine the latest run to fill this view.")} /> : (
              <Card title={t("Findings by object")} sub={t("{d} duplicates, {a} anomalies, {r} relationships in the newest run.", { d: num(s.totals.duplicates), a: num(s.totals.anomalies), r: num(s.totals.relationships) })}>
                <BarList label={t("Anomalies by object")} items={[...rows].sort((x, y) => y.anomalies - x.anomalies).map((r) => ({ id: r.module, label: moduleText(r.module), value: r.anomalies, display: num(r.anomalies) }))} />
                <DataTable label={t("Findings by object")} rows={rows} rowKey={(r) => r.module} height={260} columns={[
                  { key: "module", label: t("Object"), sort: (r) => r.module, render: (r) => <Code code={r.module} description={moduleText(r.module)} /> },
                  { key: "dup", label: t("Duplicates"), align: "end", sort: (r) => r.duplicates, render: (r) => num(r.duplicates) },
                  { key: "ano", label: t("Anomalies"), align: "end", sort: (r) => r.anomalies, render: (r) => num(r.anomalies) },
                  { key: "rel", label: t("Relationships"), align: "end", sort: (r) => r.relationships, render: (r) => num(r.relationships) },
                ]} />
              </Card>
            );
          }}
        </Async>
      )}
    </Async>
  );
}

function Steps({ g }: { g: MiningGraph }) {
  const name = new Map(g.activities.map((a) => [a.id, a.label]));
  return (
    <>
      {g.activities.length === 0 ? <Empty heading={t("No process steps mined for this object")} /> : (
        <Card title={t("Process steps")} sub={t("Each step with the records it touches and how many findings sit on it.")}>
          <BarList label={t("Findings by step")} items={[...g.activities].sort((a, b) => b.finding_count - a.finding_count).map((a) => ({ id: a.id, label: a.label, value: a.finding_count, display: num(a.finding_count), sev: a.step_status === "red" ? "high" : a.step_status === "amber" ? "medium" : undefined }))} />
          <DataTable<MiningActivity> label={t("Process steps")} rows={g.activities} rowKey={(a) => a.id} height={280} columns={[
            { key: "label", label: t("Step"), render: (a) => <Code code={a.tcode ?? a.l4_id} description={a.label} /> },
            { key: "l4", label: t("Process"), render: (a) => a.l4_name },
            { key: "status", label: t("Status"), render: (a) => STEP[a.step_status]() },
            { key: "rec", label: t("Records"), align: "end", sort: (a) => a.affected_records, render: (a) => num(a.affected_records) },
            { key: "find", label: t("Findings"), align: "end", sort: (a) => a.finding_count, render: (a) => num(a.finding_count) },
            { key: "pass", label: t("Pass rate"), align: "end", render: (a) => (a.avg_pass_rate == null ? t("n/a") : `${Math.round(a.avg_pass_rate * 100)}%`) },
          ]} />
        </Card>
      )}
      {g.variants.length > 0 ? (
        <Card title={t("Process variants")} sub={t("Paths through the steps, with how much of the data follows each.")}>
          <DataTable<MiningVariant> label={t("Process variants")} rows={g.variants} rowKey={(v) => v.id} height={220} columns={[
            { key: "label", label: t("Variant"), render: (v) => <Code code={v.tcode ?? v.id} description={v.label} /> },
            { key: "steps", label: t("Steps"), align: "end", render: (v) => v.activity_ids.map((i) => name.get(i) ?? i).join(" > ") },
            { key: "cov", label: t("Coverage"), align: "end", render: (v) => `${Math.round(v.coverage * 100)}%` },
            { key: "q", label: t("Quality"), align: "end", render: (v) => `${Math.round(v.quality * 100)}%` },
            { key: "ready", label: t("Status"), render: (v) => STEP[v.readiness]() },
          ]} />
        </Card>
      ) : null}
    </>
  );
}

/** The mined process steps and variants of one object, picked from the objects the newest run mined. */
export function MiningSteps() {
  const run = useLatestRun();
  const id = run.data?.id ?? "";
  const mods = run.data?.metadata?.modules ?? [];
  const [pick, setPick] = useState("");
  const mod = pick || mods[0] || "";
  const g = useRead(["mining", "graph", id, mod], () => getMiningGraph(id, mod), !!id && !!mod);
  return (
    <Async q={run} lines={3}>
      {(v) => !v || mods.length === 0 ? <Empty heading={t("There is no run to mine")} /> : (
        <>
          <Select aria-label={t("Object")} value={mod} onChange={(e) => setPick(e.target.value)} options={mods.map((m) => ({ value: m, label: moduleText(m) }))} />
          <Async q={g} lines={5}>{(d) => <Steps g={d} />}</Async>
        </>
      )}
    </Async>
  );
}
