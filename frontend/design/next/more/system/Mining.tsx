"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { formatDate } from "@/lib/format";
import { t } from "@/lib/v2/i18n";
import { int } from "@/lib/v2/score";
import { moduleText } from "@/lib/v2/labels";
import { useSystemExtractions } from "@/lib/v2/runs-queries";
import { useFixture } from "@/lib/api/v2/fixture";
import { getMiningGraph, getMiningRunSummary, type MiningActivity, type MiningTransition, type MiningVariant, type StepStatus } from "@/lib/api/v2/mining";
import { Chip, Code, DataTable, SegmentedControl, StatCard, type ChipTone, type Column } from "../../kit";
import { QueryView } from "../states";

const pct = (n: number) => `${Math.round(n * 100)}%`;
const TONE: Record<StepStatus, ChipTone> = { green: "good", amber: "warn", red: "bad" };
const statusText = (s: StepStatus) => (s === "green" ? t("Ready") : s === "amber" ? t("Needs attention") : t("Blocked"));

/** The module's process graph for one run: each step with the quality of its records, the variants and the flows. */
function Graph({ vid, module }: { vid: string; module: string }) {
  const fx = useFixture();
  const q = useQuery({ queryKey: ["v2", "mining", "graph", fx, vid, module], queryFn: () => getMiningGraph(vid, module), retry: false });
  const g = q.data;
  const acts = g?.activities ?? [];
  const label = (id: string) => acts.find((a) => a.id === id)?.label ?? id;
  const aCols: Column<MiningActivity>[] = [
    { id: "step", label: t("Step"), cell: (r) => <Code code={r.id} text={r.label} /> },
    { id: "l4", label: t("Part of"), cell: (r) => <Code code={r.l4_id} text={r.l4_name} /> },
    { id: "tcode", label: t("Transaction"), cell: (r) => (r.tcode ? <Code code={r.tcode} text={r.label} /> : "") },
    { id: "status", label: t("Status"), cell: (r) => <Chip tone={TONE[r.step_status]}>{statusText(r.step_status)}</Chip> },
    { id: "affected", label: t("Records affected"), align: "end", compare: (a, b) => a.affected_records - b.affected_records, cell: (r) => int(r.affected_records) },
    { id: "findings", label: t("Findings"), align: "end", compare: (a, b) => a.finding_count - b.finding_count, cell: (r) => int(r.finding_count) },
    { id: "pass", label: t("Pass rate"), align: "end", compare: (a, b) => (a.avg_pass_rate ?? 0) - (b.avg_pass_rate ?? 0), cell: (r) => (r.avg_pass_rate == null ? t("Not measured") : pct(r.avg_pass_rate)) },
  ];
  const vCols: Column<MiningVariant>[] = [
    { id: "variant", label: t("Variant"), cell: (r) => <Code code={r.tcode ?? r.id} text={r.label} /> },
    { id: "steps", label: t("Steps"), align: "end", cell: (r) => int(r.activity_count) },
    { id: "coverage", label: t("Coverage"), align: "end", compare: (a, b) => a.coverage - b.coverage, cell: (r) => pct(r.coverage) },
    { id: "ready", label: t("Readiness"), cell: (r) => <Chip tone={TONE[r.readiness]}>{statusText(r.readiness)}</Chip> },
    { id: "quality", label: t("Quality"), align: "end", compare: (a, b) => a.quality - b.quality, cell: (r) => pct(r.quality) },
  ];
  const tCols: Column<MiningTransition>[] = [
    { id: "from", label: t("From"), cell: (r) => <Code code={r.from} text={label(r.from)} /> },
    { id: "to", label: t("To"), cell: (r) => <Code code={r.to} text={label(r.to)} /> },
    { id: "weight", label: t("Weight"), align: "end", compare: (a, b) => a.weight - b.weight, cell: (r) => int(r.weight) },
  ];
  return (
    <QueryView loading={q.isLoading} error={q.error} onRetry={() => void q.refetch()} empty={acts.length === 0} emptyHeading={t("No process steps for this object in this run.")} label={t("Loading the process graph")}>
      <section className="nx-cell-stack" data-testid="mining-graph">
        <h3 className="nx-rn-h3">{t("Steps and the quality of their records")}</h3>
        <DataTable rows={acts} columns={aCols} rowKey={(r) => r.id} rowLabel={(r) => r.label} caption={t("Steps and the quality of their records")} />
        <h3 className="nx-rn-h3">{t("Variants")}</h3>
        <DataTable rows={g?.variants ?? []} columns={vCols} rowKey={(r) => r.id} rowLabel={(r) => r.label} caption={t("Variants")} empty={{ heading: t("No variants found.") }} />
        <h3 className="nx-rn-h3">{t("Flows between steps")}</h3>
        <DataTable rows={g?.transitions ?? []} columns={tCols} rowKey={(r) => `${r.from}>${r.to}`} rowLabel={(r) => `${label(r.from)} ${label(r.to)}`} caption={t("Flows between steps")} empty={{ heading: t("No flows found.") }} />
        {g && !g.cases_supported ? <p className="nx-sub" data-testid="mining-no-cases">{t("Single cases are not traced for this object yet, so the graph shows steps and variants only.")}</p> : null}
      </section>
    </QueryView>
  );
}

/**
 * Data mining of one system (api/routes/mining.py summary and api/routes/process_mining.py graph): pick a run, see
 * the duplicates, outliers and relationships per object, then the process graph of one object.
 */
export function Mining({ id }: { id: string }) {
  const fx = useFixture();
  const ext = useSystemExtractions(id);
  const versions = (ext.data?.versions ?? []).filter((v) => v.analysed_at);
  const [picked, setPicked] = useState<string | null>(null);
  const vid = versions.find((v) => v.id === picked)?.id ?? versions[0]?.id ?? null;
  const sum = useQuery({ queryKey: ["v2", "mining", "run-summary", fx, vid], queryFn: () => getMiningRunSummary(vid as string), enabled: !!vid, retry: false });
  const mods = Object.keys(sum.data?.per_module ?? {});
  const [mod, setMod] = useState<string | null>(null);
  const obj = mod && mods.includes(mod) ? mod : mods[0] ?? null;
  const totals = sum.data?.totals;
  return (
    <div className="nx-body" data-testid="mining">
      <p className="nx-sub">{t("What mining found in one run of this system: duplicate records, outlying values and fields that move together, then how each object's records flow through its process steps.")}</p>
      <QueryView loading={ext.isLoading} error={ext.error} onRetry={() => void ext.refetch()} empty={versions.length === 0} emptyHeading={t("No analysed run on this system yet.")} label={t("Loading the runs")}>
        <SegmentedControl label={t("Run")} value={vid ?? ""} onChange={(v) => setPicked(v)} items={versions.slice(0, 6).map((v) => ({ value: v.id, label: formatDate(v.run_at, "date") }))} />
        <QueryView loading={sum.isLoading} error={sum.error} onRetry={() => void sum.refetch()} empty={mods.length === 0} emptyHeading={t("Mining has not run on this run yet.")} label={t("Loading the mining summary")}>
          <div className="nx-statgrid" data-testid="mining-totals">
            <StatCard label={t("Duplicates")} value={totals?.duplicates ?? 0} />
            <StatCard label={t("Outliers")} value={totals?.anomalies ?? 0} />
            <StatCard label={t("Relationships")} value={totals?.relationships ?? 0} />
          </div>
          <SegmentedControl label={t("Object")} value={obj ?? ""} onChange={(v) => setMod(v)} items={mods.map((m) => {
            const c = sum.data!.per_module[m];
            return { value: m, label: `${moduleText(m)} (${int(c.duplicates + c.anomalies + c.relationships)})` };
          })} />
          {vid && obj ? <Graph key={`${vid}-${obj}`} vid={vid} module={obj} /> : null}
        </QueryView>
      </QueryView>
    </div>
  );
}
