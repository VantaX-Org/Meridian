"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { errorSentence } from "@/lib/api/v2/client";
import {
  addSchedule, deleteSchedule, exportBpmn, exportSignavio, getCase, getCases, getCatalogue, getConformance, getDfg,
  getDiscoveryHealth, getSchedules, getVariants, patchSchedule, startDiscovery,
  type CaseRow, type CatalogueEntry, type Freshness, type Schedule, type Variant,
} from "@/lib/api/v2/discovery";
import { useFixture } from "@/lib/api/v2/fixture";
import { formatDate, formatDuration } from "@/lib/format";
import { useUrlParam, useV2Session } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";
import { useLandscape } from "@/lib/v2/queries";
import { DASH, int } from "@/lib/v2/score";
import { Button, Chip, Code, DataTable, EmptyState, ErrorState, Skeleton, useToast, type Column } from "../kit";
import { About, Banner, HBars, Panel } from "./cfg-parts";
import { ExportTable } from "./ExportTable";

/**
 * Process discovery: the as-is flows mined from a system's own event tables, one L1 process at a time
 * (api/routes/process_discovery.py). The catalogue lists every L1 with its latest run; a run opens the flow from L2
 * down to L5, the case variants, the conformance against the reference model and the cases. Schedules keep the mining
 * current; the flows export to Signavio and BPMN. A figure the backend did not store shows as a dash.
 */

const status = (e: unknown) => (e as { response?: { status?: number }; status?: number } | null)?.response?.status ?? (e as { status?: number } | null)?.status;
const retry = (n: number, e: unknown) => { const s = status(e); return s !== 403 && s !== 404 && n < 2; };
const pct = (x: number | null | undefined) => (x === null || x === undefined ? DASH : `${Math.round(x * 100)}%`);
const fit = (x: number | null | undefined) => (x === null || x === undefined ? DASH : x.toFixed(2));
const secs = (x: number | null | undefined) => (x === null || x === undefined ? DASH : formatDuration(x * 1000));
const readFail = () => t("The process discovery data could not be read.");

const FRESH: Record<Freshness, () => string> = {
  fresh: () => t("Current"),
  due: () => t("Due"),
  stale: () => t("Out of date"),
  failed: () => t("Failed"),
  paused: () => t("Schedule paused"),
  manual: () => t("Not scheduled"),
};

export function ProcessDiscovery() {
  const fixture = useFixture();
  const landscape = useLandscape(null);
  const systems = landscape.data?.systems ?? [];
  const [systemParam, setSystem] = useUrlParam<string>("system", "");
  const systemId = systemParam || systems[0]?.id || "";
  const [runId, setRun] = useUrlParam<string>("run", "");

  const catalogue = useQuery({ queryKey: ["discovery", fixture, systemId, "catalogue"], queryFn: () => getCatalogue(systemId), enabled: !!systemId, staleTime: 60_000, retry });
  const health = useQuery({ queryKey: ["discovery", fixture, systemId, "health"], queryFn: () => getDiscoveryHealth(systemId), enabled: !!systemId, staleTime: 60_000, retry });

  if (landscape.isPending || (systemId && catalogue.isPending)) return <div className="nx-body"><Skeleton lines={6} label={t("Process discovery")} /></div>;
  if (landscape.isError) return <div className="nx-body"><ErrorState sentence={readFail()} onRetry={() => void landscape.refetch()} /></div>;
  if (!systemId) return <div className="nx-body"><EmptyState heading={t("No system is connected. Connect a system to mine its processes.")} /></div>;
  if (catalogue.isError) return <div className="nx-body"><ErrorState sentence={readFail()} onRetry={() => void catalogue.refetch()} /></div>;

  const rows = catalogue.data ?? [];
  const system = systems.find((s) => s.id === systemId);
  const minable = rows.filter((r) => !r.reason);
  const mined = minable.filter((r) => r.last_run);
  const fits = mined.map((r) => r.last_run?.fitness).filter((x): x is number => typeof x === "number").sort((a, b) => a - b);
  const median = fits.length ? fits[Math.floor(fits.length / 2)] : null;
  const cases = mined.reduce((n, r) => n + (r.last_run?.cases ?? 0), 0);
  const behind = (health.data ?? []).filter((h) => h.freshness !== "fresh" && h.freshness !== "manual").length;
  const selected = rows.find((r) => r.last_run?.id === runId) ?? null;
  const lr = selected?.last_run;

  return (
    <div className="nx-body" data-testid="process-discovery">
      <About
        shows={t("Rebuilds how each process really runs from the system's event tables, down to level 5, and compares it with the reference model.")}
        why={t("Flows are mined from the system's own event tables, from L2 down to L5.")}
        next={{ href: "/config", label: t("Open the configuration") }}
        means={[
          [t("Median fitness"), t("How closely the real flows match the reference model; 1 is a perfect match.")],
          [t("Cases mined"), t("Process instances read from the event tables.")],
          [t("Behind schedule"), t("Processes whose latest discovery is older than its schedule allows.")],
        ]}
      />
      <div className="nx-row nx-wrap">
        <label className="nx-field">
          {t("System")}
          <select className="nx-input" value={systemId} onChange={(e) => { setSystem(e.target.value); setRun(""); }} data-testid="pd-system">
            {systems.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        {lr ? (
          <Chip tone={lr.status === "failed" ? "bad" : lr.status === "completed" ? "good" : "warn"}>
            {lr.status === "failed" ? t("Failed") : lr.status === "completed" ? `${t("Mined")} ${formatDate(lr.finished_at, "date")}` : t("Mining now")}
          </Chip>
        ) : null}
        {lr ? <Exports runId={lr.id} /> : null}
      </div>
      <Banner
        title={t("{mined} of {minable} processes mined on {system}", { mined: mined.length, minable: minable.length, system: system?.name ?? DASH })}
        why={t("Flows are mined from the system's own event tables, from L2 down to L5.")}
        meta={t("Process discovery")}
        label={t("Process discovery")}
        testId="pd-banner"
        figs={[
          { label: t("Median fitness"), value: fit(median), note: t("Against the reference model") },
          { label: t("Cases mined"), value: int(cases) },
          { label: t("Behind schedule"), value: health.data ? int(behind) : DASH },
        ]}
      />
      <Catalogue systemId={systemId} rows={rows} onOpen={setRun} />
      <Panel title={t("Fitness since the run before")} testId="pd-health">
        {health.isPending ? (
          <Skeleton lines={3} label={t("Fitness since the run before")} />
        ) : health.isError ? (
          <ErrorState sentence={readFail()} onRetry={() => void health.refetch()} />
        ) : (
          <HBars
            label={t("Fitness since the run before")}
            rows={health.data.filter((h) => h.last_run).map((h) => ({
              key: h.l1,
              label: <Code code={h.l1} text={FRESH[h.freshness]()} />,
              value: h.fitness_drift === null ? 0 : Math.min(100, Math.abs(h.fitness_drift) * 100),
              text: h.fitness_drift === null ? t("First run") : `${h.fitness_drift > 0 ? "+" : ""}${h.fitness_drift.toFixed(2)}`,
              tone: h.fitness_drift === null || h.fitness_drift === 0 ? "warn" : h.fitness_drift < 0 ? "good" : "bad",
            }))}
          />
        )}
      </Panel>
      <Schedules systemId={systemId} l1s={minable.map((r) => r.l1)} />
      {selected && lr ? <RunDetail key={lr.id} entry={selected} runId={lr.id} /> : null}
    </div>
  );
}

function Catalogue({ systemId, rows, onOpen }: { systemId: string; rows: CatalogueEntry[]; onOpen: (id: string) => void }) {
  const { can } = useV2Session();
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
  const columns: Column<CatalogueEntry>[] = [
    {
      id: "process", label: t("Process"), compare: (a, b) => a.l1.localeCompare(b.l1),
      cell: (r) => {
        const lr = r.last_run;
        const state = r.reason ?? (r.in_progress ? t("Mining now") : r.failed ? `${t("Failed")}: ${r.failed.error ?? DASH}` : lr ? `${t("Mined")} ${formatDate(lr.finished_at, "date")}` : t("Not mined yet"));
        return <span className="nx-cell-stack"><Code code={r.l1} text={r.name} /><span className="nx-sub">{state}</span></span>;
      },
    },
    { id: "cases", label: t("Cases"), align: "end", compare: (a, b) => (a.last_run?.cases ?? -1) - (b.last_run?.cases ?? -1), cell: (r) => (r.last_run ? int(r.last_run.cases) : <span title={t("Not mined")}>{DASH}</span>) },
    { id: "variants", label: t("Variants"), align: "end", cell: (r) => (r.last_run ? int(r.last_run.variants) : DASH) },
    { id: "throughput", label: t("Median throughput"), align: "end", cell: (r) => secs(r.last_run?.median_seconds) },
    { id: "automated", label: t("Automated"), align: "end", cell: (r) => pct(r.last_run?.automation_rate) },
    { id: "fitness", label: t("Fitness"), align: "end", compare: (a, b) => (a.last_run?.fitness ?? -1) - (b.last_run?.fitness ?? -1), cell: (r) => fit(r.last_run?.fitness) },
    { id: "dq", label: t("DQ defects"), align: "end", cell: (r) => (r.dq_defects === null ? DASH : int(r.dq_defects)) },
    {
      id: "actions", label: t("Actions"),
      cell: (r) => (
        <span className="nx-row nx-wrap">
          {r.last_run ? <Button variant="secondary" size={32} onClick={() => onOpen(r.last_run?.id ?? "")} data-testid={`pd-open-${r.l1}`}>{t("Open flow")}</Button> : null}
          {!r.reason && !r.in_progress && can("run_process_discovery") ? (
            <Button variant="quiet" size={32} disabled={start.isPending} onClick={() => start.mutate(r.l1)} data-testid={`pd-run-${r.l1}`}>{r.last_run ? t("Mine again") : t("Mine")}</Button>
          ) : null}
        </span>
      ),
    },
  ];
  return (
    <Panel title={t("Processes")} meta={t("{count} L1 processes", { count: rows.length })} testId="pd-catalogue">
      <ExportTable>
        <DataTable rows={rows} columns={columns} rowKey={(r) => r.l1} rowLabel={(r) => `${r.l1} ${r.name}`} caption={t("Processes")} />
      </ExportTable>
    </Panel>
  );
}

function Exports({ runId }: { runId: string }) {
  const { can } = useV2Session();
  const toast = useToast();
  if (!can("export_process")) return null;
  return (
    <Button variant="secondary" size={32} onClick={() => void exportSignavio(runId).catch((e: unknown) => toast({ text: errorSentence(e, t("The export failed.")), tone: "bad" }))} data-testid="pd-export-signavio">
      {t("Export to Signavio")}
    </Button>
  );
}

function Schedules({ systemId, l1s }: { systemId: string; l1s: string[] }) {
  const fixture = useFixture();
  const { can } = useV2Session();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["discovery", fixture, systemId, "schedules"], queryFn: () => getSchedules(systemId), staleTime: 60_000, retry });
  const [l1, setL1] = useState("");
  const [cron, setCron] = useState("0 2 * * *");
  const done = (msg: string) => () => {
    toast({ text: msg, tone: "good" });
    void qc.invalidateQueries({ queryKey: ["discovery"] });
  };
  const fail = (e: unknown) => toast({ text: errorSentence(e, t("The schedule could not be saved.")), tone: "bad" });
  const add = useMutation({ mutationFn: () => addSchedule(systemId, l1 || l1s[0], cron), onSuccess: done(t("Schedule added.")), onError: fail });
  const toggle = useMutation({ mutationFn: (s: Schedule) => patchSchedule(systemId, s.id, { active: !s.active }), onSuccess: done(t("Schedule changed.")), onError: fail });
  const remove = useMutation({ mutationFn: (id: string) => deleteSchedule(systemId, id), onSuccess: done(t("Schedule removed.")), onError: fail });
  const edit = can("run_process_discovery");
  const columns: Column<Schedule>[] = [
    { id: "l1", label: t("Process"), cell: (s) => <Code code={s.l1} /> },
    { id: "cron", label: t("Cron"), cell: (s) => <Code code={s.schedule_cron} /> },
    { id: "next", label: t("Next run"), cell: (s) => (s.active ? formatDate(s.next_run_at, "datetime") : t("Paused")) },
    {
      id: "actions", label: t("Actions"),
      cell: (s) => (edit ? (
        <span className="nx-row nx-wrap">
          <Button variant="quiet" size={32} onClick={() => toggle.mutate(s)}>{s.active ? t("Pause") : t("Resume")}</Button>
          <Button variant="danger" size={32} onClick={() => remove.mutate(s.id)} data-testid={`pd-sch-del-${s.id}`}>{t("Remove")}</Button>
        </span>
      ) : null),
    },
  ];
  return (
    <Panel title={t("Schedules")} testId="pd-schedules">
      <DataTable
        rows={q.data ?? []}
        columns={columns}
        rowKey={(s) => s.id}
        rowLabel={(s) => s.l1}
        caption={t("Schedules")}
        loading={q.isPending}
        error={q.isError ? { sentence: readFail(), onRetry: () => void q.refetch() } : undefined}
        empty={{ heading: t("No schedules. Each process is mined only when someone starts a run.") }}
      />
      {edit && l1s.length ? (
        <form className="nx-row nx-wrap" onSubmit={(e) => { e.preventDefault(); add.mutate(); }}>
          <select className="nx-input" aria-label={t("Process")} value={l1 || l1s[0]} onChange={(e) => setL1(e.target.value)}>
            {l1s.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
          <input className="nx-input" aria-label={t("Cron")} value={cron} onChange={(e) => setCron(e.target.value)} />
          <Button type="submit" variant="primary" size={32} loading={add.isPending} disabled={!cron.trim()} data-testid="pd-sch-add">{t("Add schedule")}</Button>
        </form>
      ) : null}
    </Panel>
  );
}

function RunDetail({ entry, runId }: { entry: CatalogueEntry; runId: string }) {
  const fixture = useFixture();
  const { can } = useV2Session();
  const toast = useToast();
  const [path, setPath] = useState<{ id: string; name: string }[]>([]);
  const node = path.at(-1)?.id ?? null;
  const [variant, setVariant] = useState<string | null>(null);
  const dfg = useQuery({ queryKey: ["discovery", fixture, runId, "dfg", node], queryFn: () => getDfg(runId, node), staleTime: 60_000, retry });
  const variants = useQuery({ queryKey: ["discovery", fixture, runId, "variants"], queryFn: () => getVariants(runId), staleTime: 60_000, retry });
  const conf = useQuery({ queryKey: ["discovery", fixture, runId, "conformance"], queryFn: () => getConformance(runId), staleTime: 60_000, retry });
  const names = new Map((dfg.data?.nodes ?? []).map((n) => [n.id, n.name]));
  type Edge = NonNullable<typeof dfg.data>["edges"][number];
  const edgeCols: Column<Edge>[] = [
    { id: "from", label: t("From"), cell: (e) => <Code code={e.source} text={names.get(e.source)} /> },
    { id: "to", label: t("To"), cell: (e) => <Code code={e.target} text={names.get(e.target)} /> },
    { id: "cases", label: t("Cases"), align: "end", compare: (a, b) => a.count - b.count, cell: (e) => int(e.count) },
    { id: "wait", label: t("Median wait"), align: "end", cell: (e) => secs(e.median_seconds) },
  ];
  const variantCols: Column<Variant>[] = [
    { id: "path", label: t("Path"), cell: (v) => <span data-testid={`pd-variant-${v.hash}`}>{v.activities.join(" > ")}</span> },
    { id: "cases", label: t("Cases"), align: "end", compare: (a, b) => a.case_count - b.case_count, cell: (v) => `${int(v.case_count)} (${pct(v.share)})` },
    { id: "throughput", label: t("Median throughput"), align: "end", cell: (v) => secs(v.median_seconds) },
    { id: "fitness", label: t("Fitness"), align: "end", cell: (v) => fit(v.fitness) },
  ];
  type Step = NonNullable<typeof conf.data>["steps"][number];
  const stepCols: Column<Step>[] = [
    { id: "step", label: t("Step"), cell: (s) => s.activity },
    { id: "fitness", label: t("Fitness"), align: "end", cell: (s) => fit(s.step_fitness) },
    { id: "order", label: t("Out of order"), align: "end", cell: (s) => int(s.out_of_order) },
    { id: "missing", label: t("Cases missing it"), align: "end", cell: (s) => (conf.data?.missing[s.activity] === undefined ? DASH : int(conf.data.missing[s.activity])) },
  ];

  return (
    <>
      <Panel title={t("{l1} as-is flow", { l1: entry.name })} meta={dfg.data ? t("Level {level}", { level: dfg.data.level }) : undefined} testId="pd-flow">
        <nav aria-label={t("Flow level")} className="nx-row nx-wrap">
          <Button variant="quiet" size={32} onClick={() => setPath([])} disabled={!path.length}>{entry.l1}</Button>
          {path.map((p, i) => (
            <Button key={p.id} variant="quiet" size={32} onClick={() => setPath(path.slice(0, i + 1))} disabled={i === path.length - 1}>{`/ ${p.name}`}</Button>
          ))}
          {node && can("export_process") ? (
            <Button variant="secondary" size={32} onClick={() => void exportBpmn(runId, node).catch((e: unknown) => toast({ text: errorSentence(e, t("The export failed.")), tone: "bad" }))} data-testid="pd-export-bpmn">{t("Export BPMN")}</Button>
          ) : null}
        </nav>
        {dfg.isPending ? (
          <Skeleton lines={5} label={t("Cases per step")} />
        ) : dfg.isError ? (
          <ErrorState sentence={readFail()} onRetry={() => void dfg.refetch()} />
        ) : !dfg.data.nodes.length ? (
          <EmptyState heading={t("No steps below this one. This is the deepest level mined for this step.")} />
        ) : (
          <>
            <div data-testid="pd-steps">
              <HBars
                label={t("Cases per step")}
                rows={dfg.data.nodes.map((n) => ({
                  key: n.id,
                  label: (
                    <button type="button" className="nx-link" onClick={() => setPath([...path, { id: n.id, name: n.name }])} data-testid={`pd-node-${n.id}`}>
                      <Code code={n.id} text={n.name} />
                    </button>
                  ),
                  value: dfg.data.node.case_count ? (n.case_count / dfg.data.node.case_count) * 100 : n.share * 100,
                  text: n.observed ? `${int(n.case_count)}  ${secs(n.median_seconds)}` : t("Not observed"),
                  tone: n.observed ? "good" : "warn",
                }))}
              />
            </div>
            {dfg.data.edges.length ? (
              <div data-testid="pd-edges">
                <ExportTable>
                  <DataTable rows={dfg.data.edges} columns={edgeCols} rowKey={(e) => `${e.source}-${e.target}`} rowLabel={(e) => `${e.source} ${e.target}`} caption={t("Hand-offs")} />
                </ExportTable>
              </div>
            ) : null}
          </>
        )}
      </Panel>
      <Panel title={t("Variants")} meta={variants.data ? t("{count} in total", { count: variants.data.total }) : undefined} testId="pd-variants">
        <ExportTable>
          <DataTable
            rows={variants.data?.items ?? []}
            columns={variantCols}
            rowKey={(v) => v.hash}
            rowLabel={(v) => v.activities.join(" > ")}
            caption={t("Variants")}
            loading={variants.isPending}
            error={variants.isError ? { sentence: readFail(), onRetry: () => void variants.refetch() } : undefined}
            empty={{ heading: t("No variants. This run stored no case paths.") }}
            onOpenRow={(v) => setVariant(variant === v.hash ? null : v.hash)}
          />
        </ExportTable>
      </Panel>
      <Panel title={t("Conformance")} meta={conf.data ? `${t("Fitness")} ${fit(conf.data.fitness)}` : undefined} testId="pd-conformance">
        {conf.isPending ? (
          <Skeleton lines={4} label={t("Conformance")} />
        ) : conf.isError ? (
          status(conf.error) === 404
            ? <EmptyState heading={t("No conformance check. This run was not checked against the reference model.")} />
            : <ErrorState sentence={readFail()} onRetry={() => void conf.refetch()} />
        ) : (
          <>
            <ExportTable>
              <DataTable rows={conf.data.steps} columns={stepCols} rowKey={(s) => s.activity} rowLabel={(s) => s.activity} caption={t("Conformance")} />
            </ExportTable>
            {conf.data.extra.length ? (
              <div data-testid="pd-extra">
                <HBars
                  label={t("Steps outside the reference model")}
                  rows={conf.data.extra.map((x) => ({ key: x.activity, label: x.activity, value: x.share * 100, text: `${int(x.cases)} (${pct(x.share)})`, tone: "warn" }))}
                />
              </div>
            ) : null}
          </>
        )}
      </Panel>
      <Cases runId={runId} variant={variant} />
    </>
  );
}

function Cases({ runId, variant }: { runId: string; variant: string | null }) {
  const fixture = useFixture();
  const [open, setOpen] = useState<string | null>(null);
  const q = useQuery({ queryKey: ["discovery", fixture, runId, "cases", variant], queryFn: () => getCases(runId, variant ?? undefined), staleTime: 60_000, retry });
  const one = useQuery({ queryKey: ["discovery", fixture, runId, "case", open], queryFn: () => getCase(runId, open ?? ""), enabled: !!open, staleTime: 60_000, retry });
  const columns: Column<CaseRow>[] = [
    { id: "case", label: t("Case"), cell: (c) => <span data-testid={`pd-case-${c.case_id}`}><Code code={c.case_id} /></span> },
    { id: "start", label: t("Started"), cell: (c) => formatDate(c.first_ts, "datetime") },
    { id: "last", label: t("Last event"), cell: (c) => formatDate(c.last_ts, "datetime") },
    { id: "events", label: t("Events"), align: "end", compare: (a, b) => a.events - b.events, cell: (c) => int(c.events) },
  ];
  return (
    <Panel title={t("Cases")} meta={q.data ? t("{count} in total", { count: q.data.total }) : undefined} testId="pd-cases">
      <ExportTable>
        <DataTable
          rows={q.data?.items ?? []}
          columns={columns}
          rowKey={(c) => c.case_id}
          rowLabel={(c) => c.case_id}
          caption={t("Cases")}
          loading={q.isPending}
          error={q.isError ? { sentence: readFail(), onRetry: () => void q.refetch() } : undefined}
          empty={{ heading: t("No cases. This run stored no cases to show.") }}
          onOpenRow={(c) => setOpen(open === c.case_id ? null : c.case_id)}
        />
      </ExportTable>
      {open ? (
        <div data-testid="pd-case-events">
          {one.isPending ? (
            <Skeleton lines={3} label={t("Events")} />
          ) : one.isError ? (
            <ErrorState sentence={readFail()} onRetry={() => void one.refetch()} />
          ) : (
            <ol>
              {one.data.events.map((ev) => (
                <li key={ev.seq} className="nx-row nx-wrap">
                  <span>{formatDate(ev.ts, "datetime")} {ev.activity}</span>
                  {ev.resource ? <Code code={ev.resource} /> : null}
                  {ev.automated === null ? null : <span>{ev.automated ? t("Automated") : t("Manual")}</span>}
                  {ev.source_table ? <Code code={ev.source_table} /> : null}
                </li>
              ))}
            </ol>
          )}
        </div>
      ) : null}
    </Panel>
  );
}
