"use client";

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { formatDate } from "@/lib/format";
import { t } from "@/lib/v2/i18n";
import { int } from "@/lib/v2/score";
import { labelText } from "@/lib/v2/labels";
import { describeTable } from "@/lib/v2/sap-fields";
import { useV2Session } from "@/lib/v2/hooks";
import { useFixture } from "@/lib/api/v2/fixture";
import { errorSentence } from "@/lib/api/v2/client";
import { exportSignavio, getCatalogue, getDiscoveryRuns, getRun, getRunModel, type RunSummary } from "@/lib/api/v2/discovery";
import type { DiscoveryStats, ProcessModelDocument } from "@/types/process-model";
import { duration } from "../../object/model";
import { Button, Chip, Code, DataTable, StatCard, useToast, type ChipTone, type Column } from "../../kit";
import { QueryView } from "../states";

const pct = (n: number) => `${Math.round(n * 100)}%`;
/** Process times run to days; under a day they read as hours, minutes and seconds. */
const span = (s: number | null | undefined) => (s == null ? t("Not measured") : s >= 86400 ? t("{n} days", { n: (s / 86400).toFixed(1) }) : duration(s));

const STATUS: Record<string, ChipTone> = { completed: "good", failed: "warn" };

interface Step {
  key: string;
  level: "L4" | "L5";
  l4: { id: string; name: string };
  id: string;
  name: string;
  tcode: string | null;
  tables: string[];
  source: string | null;
  d: DiscoveryStats | null;
}

/** The as-is model flattened to its L4 steps and the L5 activities under each, in model order. */
function steps(doc: ProcessModelDocument | undefined): Step[] {
  return (doc?.l1 ?? []).flatMap((l1) => l1.l2.flatMap((l2) => l2.l3.flatMap((l3) => l3.l4.flatMap((l4) => [
    { key: l4.id, level: "L4" as const, l4, id: l4.id, name: l4.name, tcode: l4.tcode, tables: [], source: l4.source ?? null, d: l4.discovery ?? null },
    ...l4.activities.map((a) => ({ key: a.id, level: "L5" as const, l4, id: a.id, name: a.name, tcode: a.tcode, tables: a.sap_tables, source: a.source ?? null, d: a.discovery ?? null })),
  ]))));
}

function RunModel({ run }: { run: RunSummary }) {
  const fx = useFixture();
  const detail = useQuery({ queryKey: ["v2", "discovery", "run", fx, run.id], queryFn: () => getRun(run.id), retry: false });
  const model = useQuery({ queryKey: ["v2", "discovery", "model", fx, run.id], queryFn: () => getRunModel(run.id), retry: false });
  const s = detail.data?.stats;
  const cases = Object.values(s?.case_types ?? {}).reduce((a, b) => a + b, 0);
  const rows = steps(model.data);
  const cols: Column<Step>[] = [
    { id: "level", label: t("Level"), cell: (r) => r.level },
    {
      id: "step", label: t("Step"),
      cell: (r) => (
        <span className="nx-cell-stack">
          <Code code={r.id} text={r.name} />
          {r.level === "L5" ? <span className="nx-sub">{t("Under {step}", { step: r.l4.name })}</span> : null}
        </span>
      ),
    },
    { id: "tcode", label: t("Transaction"), cell: (r) => (r.tcode ? <Code code={r.tcode} text={r.name} /> : "") },
    { id: "tables", label: t("Tables"), cell: (r) => <span className="nx-cell-stack">{r.tables.map((tb) => <Code key={tb} code={tb} text={describeTable(tb) ?? undefined} />)}</span> },
    { id: "cases", label: t("Cases"), align: "end", compare: (a, b) => (a.d?.case_count ?? 0) - (b.d?.case_count ?? 0), cell: (r) => (r.d ? int(r.d.case_count) : "") },
    { id: "share", label: t("Share"), align: "end", compare: (a, b) => (a.d?.share ?? 0) - (b.d?.share ?? 0), cell: (r) => (r.d ? pct(r.d.share) : "") },
    { id: "median", label: t("Median time"), align: "end", cell: (r) => (r.d ? span(r.d.median_seconds) : "") },
    { id: "rework", label: t("Rework"), align: "end", cell: (r) => (r.d?.rework_rate == null ? "" : pct(r.d.rework_rate)) },
    { id: "fitness", label: t("Fitness"), align: "end", compare: (a, b) => (a.d?.fitness ?? 0) - (b.d?.fitness ?? 0), cell: (r) => (r.d?.fitness == null ? "" : pct(r.d.fitness)) },
    { id: "seen", label: t("Seen in the data"), cell: (r) => (r.d?.observed ? <Chip tone="good">{t("Observed")}</Chip> : <Chip tone="neutral">{t("Not observed")}</Chip>) },
  ];
  return (
    <section className="nx-cell-stack" data-testid="process-run">
      <QueryView loading={detail.isLoading} error={detail.error} onRetry={() => void detail.refetch()} empty={false} emptyHeading="" label={t("Loading the run")}>
        <div className="nx-statgrid" data-testid="process-run-stats">
          <StatCard label={t("Cases")} value={cases} />
          <StatCard label={t("Variants")} value={s?.variants ?? 0} />
          <StatCard label={t("Median time")} value={s?.throughput?.median_seconds ?? 0} format={(n) => span(n)} />
          <StatCard label={t("Automation rate")} value={s?.automation_rate ?? 0} format={pct} />
          <StatCard label={t("Fitness")} value={s?.conformance?.fitness ?? 0} format={pct} />
        </div>
      </QueryView>
      <h3 className="nx-rn-h3">{t("The as-is flow, step by step")}</h3>
      <p className="nx-sub">{t("Every L4 step the run found and the L5 activities under it, with the cases that passed through, the time they took and how closely they follow the reference.")}</p>
      <QueryView loading={model.isLoading} error={model.error} onRetry={() => void model.refetch()} empty={rows.length === 0} emptyHeading={t("This run found no steps below L3.")} label={t("Loading the as-is flow")}>
        <DataTable rows={rows} columns={cols} rowKey={(r) => r.key} rowLabel={(r) => r.name} caption={t("The as-is flow, step by step")} />
      </QueryView>
    </section>
  );
}

/**
 * The as-is process model of one system (api/routes/process_discovery.py): its discovery runs, and for the picked run
 * the mined counts and the model from L4 down to the L5 activities. Downloading the model needs export_process.
 */
export function ProcessModel({ id }: { id: string }) {
  const fx = useFixture();
  const session = useV2Session();
  const toast = useToast();
  const live = !session.shared && !session.viewAs;
  const canExport = session.can("export_process") && live;
  const q = useQuery({ queryKey: ["v2", "discovery", "runs", fx, id], queryFn: () => getDiscoveryRuns(id), retry: false });
  const cat = useQuery({ queryKey: ["v2", "discovery", "catalogue", fx, id], queryFn: () => getCatalogue(id), retry: false });
  const name = (l1: string) => cat.data?.find((c) => c.l1 === l1)?.name ?? labelText(l1);
  const runs = q.data ?? [];
  const [picked, setPicked] = useState<string | null>(null);
  const run = runs.find((r) => r.id === picked) ?? runs.find((r) => r.status === "completed") ?? null;
  const dl = useMutation({
    mutationFn: (runId: string) => exportSignavio(runId),
    onError: (e) => toast({ text: errorSentence(e, t("The model could not be downloaded.")), tone: "bad" }),
  });
  const cols: Column<RunSummary>[] = [
    { id: "l1", label: t("Process"), cell: (r) => <Code code={r.l1} text={name(r.l1)} /> },
    { id: "status", label: t("Status"), cell: (r) => <Chip tone={STATUS[r.status] ?? "neutral"}>{labelText(r.status)}</Chip> },
    { id: "mode", label: t("Mode"), cell: (r) => (r.mode === "full" ? t("Full") : t("Incremental")) },
    {
      id: "window", label: t("Window"),
      cell: (r) => (r.window_from && r.window_to ? `${formatDate(r.window_from, "date")} – ${formatDate(r.window_to, "date")}` : t("Not set")),
    },
    { id: "finished", label: t("Finished"), compare: (a, b) => (a.finished_at ?? "").localeCompare(b.finished_at ?? ""), cell: (r) => (r.finished_at ? formatDate(r.finished_at, "datetime") : r.error ?? "") },
  ];
  return (
    <div className="nx-body" data-testid="process-model">
      <p className="nx-sub">{t("The process flows discovery found in this system, as they really run, from L4 steps down to L5 activities. Open a run to see its model.")}</p>
      <QueryView loading={q.isLoading} error={q.error} onRetry={() => void q.refetch()} empty={runs.length === 0} emptyHeading={t("No process discovery has run on this system yet.")} label={t("Loading the discovery runs")}>
        <DataTable rows={runs} columns={cols} rowKey={(r) => r.id} rowLabel={(r) => name(r.l1)} caption={t("Discovery runs")} onOpenRow={(r) => setPicked(r.id)} />
      </QueryView>
      {run ? (
        <>
          <div className="nx-row nx-wrap">
            <h3 className="nx-rn-h3">{t("Run of {process}, finished {when}", { process: name(run.l1), when: run.finished_at ? formatDate(run.finished_at, "datetime") : t("Not finished") })}</h3>
            {canExport ? (
              <Button size={32} variant="secondary" icon="download" loading={dl.isPending} loadingLabel={t("Downloading the model")} onClick={() => dl.mutate(run.id)} data-testid="process-export">
                {t("Download for Signavio")}
              </Button>
            ) : null}
          </div>
          <RunModel key={run.id} run={run} />
        </>
      ) : null}
    </div>
  );
}
