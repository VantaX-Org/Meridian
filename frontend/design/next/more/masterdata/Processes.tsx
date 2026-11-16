"use client";

import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { errorSentence } from "@/lib/api/v2/client";
import {
  addSchedule, deleteSchedule, exportBpmn, exportSignavio, getCase, getCases, getCatalogue, getConformance, getDfg, getDiscoveryHealth,
  getSchedules, getVariants, patchSchedule, startDiscovery,
  type CaseRow, type CatalogueEntry, type Conformance, type Freshness, type L1Health, type NodeStats, type Schedule, type Variant,
} from "@/lib/api/v2/discovery";
import { useFixture } from "@/lib/api/v2/fixture";
import { formatDate, formatDuration } from "@/lib/format";
import { useUrlParam, useV2Session } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";
import { useLandscape } from "@/lib/v2/queries";
import { int } from "@/lib/v2/score";
import { Button, Chip, Code, DataTable, EmptyState, ErrorState, PartBar, SidePanel, Skeleton, StatCard, useToast, type Column } from "../../kit";
import { ChartCard, compact } from "../ChartCard";
import { TableSave } from "./TableSave";
import { httpStatus, noRetry4xx } from "./util";

/**
 * Processes, native: the as-is flows mined from a system's own event tables, one L1 process at a time. A run opens the
 * flow from L2 down to L5, its variants, the conformance against the reference model and the cases. Schedules keep the
 * mining current; the flows export to Signavio and BPMN. A figure the backend did not store shows as a dash.
 */

const pct = (x: number | null | undefined) => (x == null ? "-" : `${Math.round(x * 100)}%`);
const fit = (x: number | null | undefined) => (x == null ? "-" : x.toFixed(2));
const secs = (x: number | null | undefined) => (x == null ? "-" : formatDuration(x * 1000));

const FRESH: Record<Freshness, () => string> = {
  fresh: () => t("Current"),
  due: () => t("Due"),
  stale: () => t("Out of date"),
  failed: () => t("Failed"),
  paused: () => t("Schedule paused"),
  manual: () => t("Not scheduled"),
};

/** The person may act: has the permission and is not on a shared link or viewing as someone else. */
function useMay(p: string): boolean {
  const s = useV2Session();
  return s.can(p) && !s.shared && !s.viewAs;
}

function Section({ title, meta, testId, children }: { title: string; meta?: string; testId: string; children: ReactNode }) {
  return (
    <section aria-label={title} data-testid={testId}>
      <h3>{title}</h3>
      {meta ? <p className="nx-sub">{meta}</p> : null}
      {children}
    </section>
  );
}

const failed = (q: { error: unknown; refetch: () => unknown }) => (
  <ErrorState sentence={t("The process discovery data could not be read.")} error={q.error} onRetry={() => void q.refetch()} />
);

export function Processes() {
  const fixture = useFixture();
  const landscape = useLandscape(null);
  const systems = landscape.data?.systems ?? [];
  const [systemParam, setSystem] = useUrlParam<string>("system", "");
  const systemId = systemParam || systems[0]?.id || "";
  const [runId, setRun] = useUrlParam<string>("run", "");
  const catalogue = useQuery({ queryKey: ["discovery", fixture, systemId, "catalogue"], queryFn: () => getCatalogue(systemId), enabled: !!systemId, staleTime: 60_000, retry: noRetry4xx });
  const health = useQuery({ queryKey: ["discovery", fixture, systemId, "health"], queryFn: () => getDiscoveryHealth(systemId), enabled: !!systemId, staleTime: 60_000, retry: noRetry4xx });

  if (landscape.isPending || (systemId && catalogue.isPending)) return <div className="nx-body"><Skeleton lines={8} label={t("Process discovery")} /></div>;
  if (landscape.isError) return <div className="nx-body" data-testid="pd-page">{failed(landscape)}</div>;
  if (!systemId) return <div className="nx-body" data-testid="pd-page"><EmptyState heading={t("No system is connected. Connect a system to mine its processes.")} /></div>;
  if (catalogue.isError) {
    return (
      <div className="nx-body" data-testid="pd-page">
        {httpStatus(catalogue.error) === 403 ? <EmptyState heading={t("Your role cannot read the process discovery data.")} /> : failed(catalogue)}
      </div>
    );
  }

  const rows = catalogue.data ?? [];
  const system = systems.find((s) => s.id === systemId);
  const minable = rows.filter((r) => !r.reason);
  const mined = minable.filter((r) => r.last_run);
  const fits = mined.map((r) => r.last_run?.fitness).filter((x): x is number => typeof x === "number").sort((a, b) => a - b);
  const median = fits.length ? fits[Math.floor(fits.length / 2)] : null;
  const cases = mined.reduce((n, r) => n + (r.last_run?.cases ?? 0), 0);
  const behind = (health.data ?? []).filter((h) => h.freshness !== "fresh" && h.freshness !== "manual").length;
  const selected = rows.find((r) => r.last_run?.id === runId) ?? null;

  return (
    <div className="nx-body" data-testid="pd-page">
      <section aria-label={t("Process discovery")} data-testid="pd-banner">
        <p className="nx-sub">{t("Flows are mined from the system's own event tables, from L2 down to L5.")}</p>
        <h2>{t("{mined} of {minable} processes mined on {system}", { mined: mined.length, minable: minable.length, system: system?.name ?? "-" })}</h2>
        <div className="nx-row nx-wrap">
          <label className="nx-field">
            {t("System")}
            <select className="nx-input" value={systemId} onChange={(e) => (setSystem(e.target.value), setRun(""))} data-testid="pd-system">
              {systems.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          {selected?.last_run ? <Exports runId={selected.last_run.id} /> : null}
        </div>
        <div className="nx-statgrid">
          <StatCard label={t("Median fitness")} value={median ?? 0} format={() => fit(median)} />
          <StatCard label={t("Cases mined")} value={cases} />
          <StatCard label={t("Behind schedule")} value={behind} format={(n) => (health.data ? int(n) : "-")} />
        </div>
        <p className="nx-sub">{t("How closely the real flows match the reference model; 1 is a perfect match.")}</p>
      </section>
      <Catalogue systemId={systemId} rows={rows} onOpen={setRun} />
      <Health q={health} />
      <Schedules systemId={systemId} l1s={minable.map((r) => r.l1)} names={new Map(rows.map((r) => [r.l1, r.name]))} />
      {selected?.last_run ? <RunDetail key={selected.last_run.id} entry={selected} runId={selected.last_run.id} /> : null}
    </div>
  );
}

function Catalogue({ systemId, rows, onOpen }: { systemId: string; rows: CatalogueEntry[]; onOpen: (id: string) => void }) {
  const may = useMay("run_process_discovery");
  const toast = useToast();
  const qc = useQueryClient();
  const start = useMutation({
    mutationFn: (l1: string) => startDiscovery(systemId, [l1], "full"),
    onSuccess: (_, l1) => {
      toast({ text: t("Discovery of {l1} is queued.", { l1 }), tone: "good" });
      void qc.invalidateQueries({ queryKey: ["discovery"] });
    },
    onError: (e) => toast({ text: errorSentence(e, t("The run could not start.")), tone: "bad" }),
  });
  const state = (r: CatalogueEntry) => r.reason ?? (r.in_progress ? t("Mining now") : r.failed ? `${t("Failed")}: ${r.failed.error ?? "-"}` : r.last_run ? `${t("Mined")} ${formatDate(r.last_run.finished_at, "date")}` : t("Not mined yet"));
  const cols: Column<CatalogueEntry>[] = [
    { id: "process", label: t("Process"), cell: (r) => <span className="nx-cell-stack"><Code code={r.l1} text={r.name} /><span className="nx-sub">{state(r)}</span></span> },
    { id: "cases", label: t("Cases"), align: "end", compare: (a, b) => (a.last_run?.cases ?? -1) - (b.last_run?.cases ?? -1), cell: (r) => (r.last_run?.cases == null ? <span title={t("Not mined")}>-</span> : int(r.last_run.cases)) },
    { id: "variants", label: t("Variants"), align: "end", cell: (r) => (r.last_run?.variants == null ? "-" : int(r.last_run.variants)) },
    { id: "through", label: t("Median throughput"), align: "end", cell: (r) => secs(r.last_run?.median_seconds) },
    { id: "auto", label: t("Automated"), align: "end", cell: (r) => pct(r.last_run?.automation_rate) },
    { id: "fit", label: t("Fitness"), align: "end", compare: (a, b) => (a.last_run?.fitness ?? -1) - (b.last_run?.fitness ?? -1), cell: (r) => fit(r.last_run?.fitness) },
    { id: "dq", label: t("DQ defects"), align: "end", cell: (r) => (r.dq_defects == null ? "-" : int(r.dq_defects)) },
    {
      id: "act", label: t("Actions"), cell: (r) => (
        <span className="nx-row nx-wrap">
          {r.last_run ? <Button size={32} onClick={() => onOpen(r.last_run?.id ?? "")} data-testid={`pd-open-${r.l1}`}>{t("Open flow")}</Button> : null}
          {!r.reason && !r.in_progress && may ? (
            <Button size={32} disabled={start.isPending} onClick={() => start.mutate(r.l1)} data-testid={`pd-run-${r.l1}`}>{r.last_run ? t("Mine again") : t("Mine")}</Button>
          ) : null}
        </span>
      ),
    },
  ];
  return (
    <Section title={t("Processes")} meta={t("{count} L1 processes", { count: rows.length })} testId="pd-catalogue">
      <TableSave title={t("Processes")}>
        <DataTable rows={rows} columns={cols} rowKey={(r) => r.l1} rowLabel={(r) => `${r.l1} ${r.name}`} caption={t("Processes")} empty={{ heading: t("Not mined yet") }} />
      </TableSave>
    </Section>
  );
}

function Exports({ runId }: { runId: string }) {
  const may = useMay("export_process");
  const toast = useToast();
  if (!may) return null;
  return (
    <Button size={32} onClick={() => void exportSignavio(runId).catch((e: unknown) => toast({ text: errorSentence(e, t("The export failed.")), tone: "bad" }))} data-testid="pd-export-signavio">
      {t("Export to Signavio")}
    </Button>
  );
}

function Health({ q }: { q: { data?: L1Health[]; isPending: boolean; isError: boolean; error: unknown; refetch: () => unknown } }) {
  const cols: Column<L1Health>[] = [
    { id: "l1", label: t("Process"), cell: (h) => <span className="nx-mono">{h.l1}</span> },
    { id: "fresh", label: t("Schedule"), cell: (h) => <Chip tone={h.freshness === "fresh" ? "good" : h.freshness === "failed" || h.freshness === "stale" ? "bad" : "neutral"}>{FRESH[h.freshness]()}</Chip> },
    { id: "fit", label: t("Fitness"), align: "end", cell: (h) => fit(h.last_run?.fitness) },
    { id: "drift", label: t("Fitness since the run before"), align: "end", compare: (a, b) => (a.fitness_drift ?? 0) - (b.fitness_drift ?? 0), cell: (h) => (h.fitness_drift == null ? t("First run") : `${h.fitness_drift > 0 ? "+" : ""}${h.fitness_drift.toFixed(2)}`) },
  ];
  return (
    <Section title={t("Fitness since the run before")} testId="pd-health">
      {q.isError ? failed(q) : (
        <DataTable rows={(q.data ?? []).filter((h) => h.last_run)} columns={cols} rowKey={(h) => h.l1} rowLabel={(h) => h.l1} caption={t("Fitness since the run before")} loading={q.isPending} empty={{ heading: t("First run") }} />
      )}
    </Section>
  );
}

function Schedules({ systemId, l1s, names }: { systemId: string; l1s: string[]; names: Map<string, string> }) {
  const fixture = useFixture();
  const edit = useMay("run_process_discovery");
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["discovery", fixture, systemId, "schedules"], queryFn: () => getSchedules(systemId), staleTime: 60_000, retry: noRetry4xx });
  const [l1, setL1] = useState("");
  const [cron, setCron] = useState("0 2 * * *");
  const done = (text: string) => () => {
    toast({ text, tone: "good" });
    void qc.invalidateQueries({ queryKey: ["discovery"] });
  };
  const fail = (e: unknown) => toast({ text: errorSentence(e, t("The schedule could not be saved.")), tone: "bad" });
  const add = useMutation({ mutationFn: () => addSchedule(systemId, l1 || l1s[0], cron), onSuccess: done(t("Schedule added.")), onError: fail });
  const toggle = useMutation({ mutationFn: (s: Schedule) => patchSchedule(systemId, s.id, { active: !s.active }), onSuccess: done(t("Schedule changed.")), onError: fail });
  const remove = useMutation({ mutationFn: (id: string) => deleteSchedule(systemId, id), onSuccess: done(t("Schedule removed.")), onError: fail });
  const cols: Column<Schedule>[] = [
    { id: "l1", label: t("Process"), cell: (s) => <Code code={s.l1} text={names.get(s.l1)} /> },
    { id: "cron", label: t("Cron"), cell: (s) => <span className="nx-mono">{s.schedule_cron}</span> },
    { id: "next", label: t("Next run"), cell: (s) => (s.active ? formatDate(s.next_run_at, "datetime") : t("Paused")) },
    ...(edit ? [{
      id: "act", label: t("Actions"), cell: (s: Schedule) => (
        <span className="nx-row nx-wrap">
          <Button size={32} onClick={() => toggle.mutate(s)}>{s.active ? t("Pause") : t("Resume")}</Button>
          <Button size={32} variant="danger" onClick={() => remove.mutate(s.id)} data-testid={`pd-sch-del-${s.id}`}>{t("Remove")}</Button>
        </span>
      ),
    }] : []),
  ];
  return (
    <Section title={t("Schedules")} testId="pd-schedules">
      {q.isError ? failed(q) : (
        <DataTable rows={q.data ?? []} columns={cols} rowKey={(s) => s.id} rowLabel={(s) => s.l1} caption={t("Schedules")} loading={q.isPending} empty={{ heading: t("No schedules. Each process is mined only when someone starts a run.") }} />
      )}
      {edit && l1s.length ? (
        <form className="nx-row nx-wrap" onSubmit={(e) => (e.preventDefault(), add.mutate())}>
          <label className="nx-field">
            {t("Process")}
            <select className="nx-input" value={l1 || l1s[0]} onChange={(e) => setL1(e.target.value)}>
              {l1s.map((x) => <option key={x} value={x}>{`${x} ${names.get(x) ?? ""}`.trim()}</option>)}
            </select>
          </label>
          <label className="nx-field">
            {t("Cron")}
            <input className="nx-input nx-mono" value={cron} onChange={(e) => setCron(e.target.value)} />
          </label>
          <Button type="submit" size={32} disabled={add.isPending || !cron.trim()} data-testid="pd-sch-add">{t("Add schedule")}</Button>
        </form>
      ) : null}
    </Section>
  );
}

function RunDetail({ entry, runId }: { entry: CatalogueEntry; runId: string }) {
  const fixture = useFixture();
  const mayExport = useMay("export_process");
  const toast = useToast();
  const [path, setPath] = useState<{ id: string; name: string }[]>([]);
  const node = path.at(-1)?.id ?? null;
  const [variant, setVariant] = useState<string | null>(null);
  const dfg = useQuery({ queryKey: ["discovery", fixture, runId, "dfg", node], queryFn: () => getDfg(runId, node), staleTime: 60_000, retry: noRetry4xx });
  const variants = useQuery({ queryKey: ["discovery", fixture, runId, "variants"], queryFn: () => getVariants(runId), staleTime: 60_000, retry: noRetry4xx });
  const conf = useQuery({ queryKey: ["discovery", fixture, runId, "conformance"], queryFn: () => getConformance(runId), staleTime: 60_000, retry: noRetry4xx });
  const names = new Map((dfg.data?.nodes ?? []).map((n) => [n.id, n.name]));
  type Edge = NonNullable<typeof dfg.data>["edges"][number];

  const nodeCols: Column<NodeStats>[] = [
    { id: "step", label: t("Step"), cell: (n) => <Button size={32} variant="quiet" onClick={() => setPath([...path, { id: n.id, name: n.name }])} data-testid={`pd-node-${n.id}`}><Code code={n.id} text={n.name} /></Button> },
    { id: "cases", label: t("Cases"), align: "end", compare: (a, b) => a.case_count - b.case_count, cell: (n) => (n.observed ? int(n.case_count) : <Chip tone="warn">{t("Not observed")}</Chip>) },
    { id: "time", label: t("Median throughput"), align: "end", cell: (n) => secs(n.median_seconds) },
    { id: "fit", label: t("Fitness"), align: "end", cell: (n) => fit(n.fitness) },
    { id: "dq", label: t("DQ defects"), align: "end", cell: (n) => (n.dq_defects == null ? "-" : int(n.dq_defects)) },
  ];
  const edgeCols: Column<Edge>[] = [
    { id: "from", label: t("From"), cell: (e) => <Code code={e.source} text={names.get(e.source)} /> },
    { id: "to", label: t("To"), cell: (e) => <Code code={e.target} text={names.get(e.target)} /> },
    { id: "cases", label: t("Cases"), align: "end", compare: (a, b) => a.count - b.count, cell: (e) => int(e.count) },
    { id: "wait", label: t("Median wait"), align: "end", cell: (e) => secs(e.median_seconds) },
  ];
  const variantCols: Column<Variant>[] = [
    { id: "path", label: t("Path"), cell: (v) => <Button size={32} variant={variant === v.hash ? "secondary" : "quiet"} onClick={() => setVariant(variant === v.hash ? null : v.hash)} data-testid={`pd-variant-${v.hash}`}>{v.activities.join(" > ")}</Button> },
    { id: "cases", label: t("Cases"), align: "end", compare: (a, b) => a.case_count - b.case_count, cell: (v) => `${int(v.case_count)} (${pct(v.share)})` },
    { id: "time", label: t("Median throughput"), align: "end", cell: (v) => secs(v.median_seconds) },
    { id: "fit", label: t("Fitness"), align: "end", cell: (v) => fit(v.fitness) },
  ];

  return (
    <>
      <Section title={t("{l1} as-is flow", { l1: entry.name })} meta={dfg.data ? t("Level {level}", { level: dfg.data.level }) : undefined} testId="pd-flow">
        <nav aria-label={t("Flow level")} className="nx-row nx-wrap">
          <Button size={32} variant="quiet" onClick={() => setPath([])} disabled={!path.length}>{entry.l1}</Button>
          {path.map((p, i) => (
            <Button key={p.id} size={32} variant="quiet" onClick={() => setPath(path.slice(0, i + 1))} disabled={i === path.length - 1}>{p.name}</Button>
          ))}
          {node && mayExport ? (
            <Button size={32} onClick={() => void exportBpmn(runId, node).catch((e: unknown) => toast({ text: errorSentence(e, t("The export failed.")), tone: "bad" }))} data-testid="pd-export-bpmn">{t("Export BPMN")}</Button>
          ) : null}
        </nav>
        {dfg.isPending ? <Skeleton lines={5} label={t("Cases per step")} /> : dfg.isError ? failed(dfg) : !dfg.data.nodes.length ? (
          <EmptyState heading={t("No steps below this one. This is the deepest level mined for this step.")} />
        ) : (
          <>
            <div className="nx-chartcards">
              <ChartCard
                title={t("Cases per step")} state="ready" testId="pd-steps"
                chart={<PartBar segments={dfg.data.nodes.map((n) => ({ label: `${n.name} (${n.id})`, value: n.case_count }))} label={t("Cases per step")} format={compact} />}
                figure={int(dfg.data.node.case_count)} line={t("Process instances read from the event tables.")} emptyLine={t("No cases. This run stored no cases to show.")}
              />
            </div>
            <TableSave title={t("Cases per step")}>
              <DataTable rows={dfg.data.nodes} columns={nodeCols} rowKey={(n) => n.id} rowLabel={(n) => `${n.id} ${n.name}`} caption={t("Cases per step")} />
            </TableSave>
            {dfg.data.edges.length ? (
              <TableSave title={t("Hand-offs")}>
                <DataTable rows={dfg.data.edges} columns={edgeCols} rowKey={(e) => `${e.source}-${e.target}`} rowLabel={(e) => `${e.source} ${e.target}`} caption={t("Hand-offs")} />
              </TableSave>
            ) : null}
          </>
        )}
      </Section>
      <Section title={t("Variants")} meta={variants.data ? t("{count} in total", { count: variants.data.total }) : undefined} testId="pd-variants">
        {variants.isError ? failed(variants) : (
          <TableSave title={t("Variants")}>
            <DataTable rows={variants.data?.items ?? []} columns={variantCols} rowKey={(v) => v.hash} rowLabel={(v) => v.activities.join(" > ")} caption={t("Variants")} loading={variants.isPending} empty={{ heading: t("No variants. This run stored no case paths.") }} />
          </TableSave>
        )}
      </Section>
      <Section title={t("Conformance")} meta={conf.data ? `${t("Fitness")} ${fit(conf.data.fitness)}` : undefined} testId="pd-conformance">
        {conf.isPending ? <Skeleton lines={4} label={t("Conformance")} /> : conf.isError ? (
          httpStatus(conf.error) === 404 ? <EmptyState heading={t("No conformance check. This run was not checked against the reference model.")} /> : failed(conf)
        ) : <ConformanceTables c={conf.data} />}
      </Section>
      <Cases runId={runId} variant={variant} />
    </>
  );
}

function ConformanceTables({ c }: { c: Conformance }) {
  type Step = Conformance["steps"][number];
  type Extra = Conformance["extra"][number];
  const stepCols: Column<Step>[] = [
    { id: "step", label: t("Step"), cell: (s) => s.activity },
    { id: "fit", label: t("Fitness"), align: "end", compare: (a, b) => a.step_fitness - b.step_fitness, cell: (s) => fit(s.step_fitness) },
    { id: "order", label: t("Out of order"), align: "end", cell: (s) => int(s.out_of_order) },
    { id: "missing", label: t("Cases missing it"), align: "end", cell: (s) => (c.missing[s.activity] === undefined ? "-" : int(c.missing[s.activity])) },
  ];
  const extraCols: Column<Extra>[] = [
    { id: "step", label: t("Step"), cell: (x) => x.activity },
    { id: "cases", label: t("Cases"), align: "end", compare: (a, b) => a.cases - b.cases, cell: (x) => `${int(x.cases)} (${pct(x.share)})` },
  ];
  return (
    <>
      <TableSave title={t("Conformance")}>
        <DataTable rows={c.steps} columns={stepCols} rowKey={(s) => s.activity} rowLabel={(s) => s.activity} caption={t("Conformance")} />
      </TableSave>
      {c.extra.length ? (
        <div data-testid="pd-extra">
          <TableSave title={t("Steps outside the reference model")}>
            <DataTable rows={c.extra} columns={extraCols} rowKey={(x) => x.activity} rowLabel={(x) => x.activity} caption={t("Steps outside the reference model")} />
          </TableSave>
        </div>
      ) : null}
    </>
  );
}

function Cases({ runId, variant }: { runId: string; variant: string | null }) {
  const fixture = useFixture();
  const [open, setOpen] = useState<string | null>(null);
  const q = useQuery({ queryKey: ["discovery", fixture, runId, "cases", variant], queryFn: () => getCases(runId, variant ?? undefined), staleTime: 60_000, retry: noRetry4xx });
  const one = useQuery({ queryKey: ["discovery", fixture, runId, "case", open], queryFn: () => getCase(runId, open ?? ""), enabled: !!open, staleTime: 60_000, retry: noRetry4xx });
  const cols: Column<CaseRow>[] = [
    { id: "case", label: t("Case"), cell: (c) => <Button size={32} variant="quiet" onClick={() => setOpen(c.case_id)} data-testid={`pd-case-${c.case_id}`}><span className="nx-mono">{c.case_id}</span></Button> },
    { id: "start", label: t("Started"), compare: (a, b) => (a.first_ts ?? "").localeCompare(b.first_ts ?? ""), cell: (c) => formatDate(c.first_ts, "datetime") },
    { id: "last", label: t("Last event"), cell: (c) => formatDate(c.last_ts, "datetime") },
    { id: "events", label: t("Events"), align: "end", compare: (a, b) => a.events - b.events, cell: (c) => int(c.events) },
  ];
  return (
    <Section title={t("Cases")} meta={q.data ? t("{count} in total", { count: q.data.total }) : undefined} testId="pd-cases">
      {q.isError ? failed(q) : (
        <TableSave title={t("Cases")}>
          <DataTable rows={q.data?.items ?? []} columns={cols} rowKey={(c) => c.case_id} rowLabel={(c) => c.case_id} caption={t("Cases")} loading={q.isPending} onOpenRow={(c) => setOpen(c.case_id)} empty={{ heading: t("No cases. This run stored no cases to show.") }} />
        </TableSave>
      )}
      <SidePanel open={!!open} onClose={() => setOpen(null)} title={open ?? t("Case")}>
        <div data-testid="pd-case-events">
          {one.isPending ? <Skeleton lines={4} label={t("Events")} /> : one.isError ? failed(one) : (
            <ol>
              {one.data.events.map((ev) => (
                <li key={ev.seq}>
                  {formatDate(ev.ts, "datetime")} {ev.activity}
                  {ev.resource ? <> <span className="nx-mono">{ev.resource}</span></> : null}
                  {ev.automated == null ? null : ev.automated ? ` ${t("Automated")}` : ` ${t("Manual")}`}
                  {ev.source_table ? <> <Code code={ev.source_table} /></> : null}
                </li>
              ))}
            </ol>
          )}
        </div>
      </SidePanel>
    </Section>
  );
}
