"use client";

import { Fragment, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { errorSentence } from "@/lib/api/v2/client";
import {
  addSchedule,
  deleteSchedule,
  exportBpmn,
  exportSignavio,
  getCase,
  getCases,
  getCatalogue,
  getConformance,
  getDfg,
  getDiscoveryHealth,
  getSchedules,
  getVariants,
  patchSchedule,
  startDiscovery,
  type CatalogueEntry,
  type Freshness,
} from "@/lib/api/v2/discovery";
import { useFixture } from "@/lib/api/v2/fixture";
import { formatDate, formatDuration } from "@/lib/format";
import { useUrlParam, useV2Session } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";
import { useLandscape } from "@/lib/v2/queries";
import { DASH, int } from "@/lib/v2/score";
import { Dash, EmptyFrame, ErrorFrame, Mono, Skeleton } from "../parts";
import { useToast } from "../Toast";
import { CcBanner, CcDelta, CcHBars, CcPage } from "./cc-parts";
import { ScrollFrame } from "./object/ScrollFrame";

/**
 * Process discovery: the as-is flows mined from a system's own event tables, one L1 process at a time. The catalogue
 * lists every L1 with its latest completed run, a run in progress or failed and the DQ defects on its objects. A run
 * opens the flow from L2 down to L5, the case variants, the conformance against the reference model and the cases
 * themselves. Schedules keep the mining current; the flows export to Signavio and BPMN. Every figure is what the
 * backend stored for the run; a figure it did not store shows as a dash.
 */

const status = (e: unknown) => (e as { response?: { status?: number }; status?: number } | null)?.response?.status ?? (e as { status?: number } | null)?.status;
const retry = (n: number, e: unknown) => {
  const s = status(e);
  return s !== 403 && s !== 404 && n < 2;
};
const pct = (x: number | null | undefined) => (x === null || x === undefined ? DASH : `${Math.round(x * 100)}%`);
const fit = (x: number | null | undefined) => (x === null || x === undefined ? DASH : x.toFixed(2));
const secs = (x: number | null | undefined) => (x === null || x === undefined ? DASH : formatDuration(x * 1000));

const FRESH: Record<Freshness, () => string> = {
  fresh: () => t("Current"),
  due: () => t("Due"),
  stale: () => t("Out of date"),
  failed: () => t("Failed"),
  paused: () => t("Schedule paused"),
  manual: () => t("Not scheduled"),
};

function Panel({ title, meta, testId, children }: { title: string; meta?: string; testId: string; children: ReactNode }) {
  return (
    <section className="m2-ck-panel" aria-label={title} data-testid={testId}>
      <header className="m2-ck-head">
        <h2 className="m2-h2">{title}</h2>
        {meta ? <span className="m2-meta">{meta}</span> : null}
      </header>
      {children}
    </section>
  );
}

export function ProcessDiscovery() {
  const fixture = useFixture();
  const landscape = useLandscape(null);
  const systems = landscape.data?.systems ?? [];
  const [systemParam, setSystem] = useUrlParam<string>("system", "");
  const systemId = systemParam || systems[0]?.id || "";
  const [runId, setRun] = useUrlParam<string>("run", "");

  const catalogue = useQuery({ queryKey: ["discovery", fixture, systemId, "catalogue"], queryFn: () => getCatalogue(systemId), enabled: !!systemId, staleTime: 60_000, retry });
  const health = useQuery({ queryKey: ["discovery", fixture, systemId, "health"], queryFn: () => getDiscoveryHealth(systemId), enabled: !!systemId, staleTime: 60_000, retry });

  if (landscape.isPending || (systemId && catalogue.isPending)) return <CcPage><Skeleton width="100%" height={320} /></CcPage>;
  if (landscape.isError) return <CcPage><ErrorFrame onRetry={() => void landscape.refetch()}>{t("The process discovery data could not be read.")}</ErrorFrame></CcPage>;
  if (!systemId) return <CcPage><EmptyFrame>{t("No system is connected. Connect a system to mine its processes.")}</EmptyFrame></CcPage>;
  if (catalogue.isError) return <CcPage><ErrorFrame onRetry={() => void catalogue.refetch()}>{t("The process discovery data could not be read.")}</ErrorFrame></CcPage>;

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
    <CcPage>
      <div className="m2-cc-split">
        <label className="m2-meta">
          {t("System")}{" "}
          <select className="m2-sel" value={systemId} onChange={(e) => (setSystem(e.target.value), setRun(""))} data-testid="pd-system">
            {systems.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </label>
        {selected ? <Exports runId={selected.last_run?.id ?? ""} /> : null}
      </div>
      <CcBanner
        testId="pd-banner"
        label={t("Process discovery")}
        eyebrow={t("Process discovery")}
        headline={t("{mined} of {minable} processes mined on {system}", { mined: mined.length, minable: minable.length, system: system?.name ?? DASH })}
        why={t("Flows are mined from the system's own event tables, from L2 down to L5.")}
        figs={[
          { label: t("Median fitness"), value: fit(median), note: t("Against the reference model") },
          { label: t("Cases mined"), value: int(cases) },
          { label: t("Behind schedule"), value: health.data ? int(behind) : DASH },
        ]}
      />
      <Catalogue systemId={systemId} rows={rows} runId={runId} onOpen={setRun} />
      <div className="m2-cc-split">
        <Panel title={t("Fitness since the run before")} testId="pd-health">
          {health.isError ? (
            <ErrorFrame onRetry={() => void health.refetch()}>{t("The process discovery data could not be read.")}</ErrorFrame>
          ) : (
            <CcDelta
              label={t("Fitness since the run before")}
              rows={(health.data ?? []).filter((h) => h.last_run).map((h) => ({
                key: h.l1,
                label: <><Mono>{h.l1}</Mono> {FRESH[h.freshness]()}</>,
                delta: h.fitness_drift === null ? null : -h.fitness_drift * 100,
                text: h.fitness_drift === null ? t("First run") : `${h.fitness_drift > 0 ? "+" : ""}${h.fitness_drift.toFixed(2)}`,
              }))}
            />
          )}
        </Panel>
        <Schedules systemId={systemId} l1s={minable.map((r) => r.l1)} />
      </div>
      {selected?.last_run ? <RunDetail key={selected.last_run.id} entry={selected} runId={selected.last_run.id} /> : null}
    </CcPage>
  );
}

function Catalogue({ systemId, rows, runId, onOpen }: { systemId: string; rows: CatalogueEntry[]; runId: string; onOpen: (id: string) => void }) {
  const { can } = useV2Session();
  const toast = useToast();
  const qc = useQueryClient();
  const start = useMutation({
    mutationFn: (l1: string) => startDiscovery(systemId, [l1], "full"),
    onSuccess: (_, l1) => {
      toast.show(t("Discovery of {l1} is queued.", { l1 }));
      void qc.invalidateQueries({ queryKey: ["discovery"] });
    },
    onError: (e) => toast.show(errorSentence(e, t("The run could not start."))),
  });
  return (
    <Panel title={t("Processes")} meta={t("{count} L1 processes", { count: rows.length })} testId="pd-catalogue">
      <ScrollFrame label={t("Processes")}>
        <table className="m2-tbl m2-cards">
          <thead>
            <tr>
              <th scope="col">{t("Process")}</th>
              <th scope="col">{t("Cases")}</th>
              <th scope="col">{t("Variants")}</th>
              <th scope="col">{t("Median throughput")}</th>
              <th scope="col">{t("Automated")}</th>
              <th scope="col">{t("Fitness")}</th>
              <th scope="col">{t("DQ defects")}</th>
              <th scope="col">{t("State")}</th>
              <th scope="col"><span className="m2-sr">{t("Actions")}</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const lr = r.last_run;
              const state = r.reason ?? (r.in_progress ? t("Mining now") : r.failed ? `${t("Failed")}: ${r.failed.error ?? DASH}` : lr ? `${t("Mined")} ${formatDate(lr.finished_at, "date")}` : t("Not mined yet"));
              return (
                <tr key={r.l1} aria-current={lr?.id === runId ? "true" : undefined}>
                  <th scope="row" className="m2-card-lead">
                    <Mono>{r.l1}</Mono> {r.name}
                  </th>
                  <td data-label={t("Cases")}>{lr ? int(lr.cases) : <Dash why={t("Not mined")} />}</td>
                  <td data-label={t("Variants")}>{lr ? int(lr.variants) : DASH}</td>
                  <td data-label={t("Median throughput")}>{secs(lr?.median_seconds)}</td>
                  <td data-label={t("Automated")}>{pct(lr?.automation_rate)}</td>
                  <td data-label={t("Fitness")}>{fit(lr?.fitness)}</td>
                  <td data-label={t("DQ defects")}>{r.dq_defects === null ? DASH : int(r.dq_defects)}</td>
                  <td data-label={t("State")}>{state}</td>
                  <td data-label={t("Actions")}>
                    {lr ? (
                      <button type="button" className="m2-btn" onClick={() => onOpen(lr.id)} data-testid={`pd-open-${r.l1}`}>{t("Open flow")}</button>
                    ) : null}{" "}
                    {!r.reason && !r.in_progress && can("run_process_discovery") ? (
                      <button type="button" className="m2-btn" disabled={start.isPending} onClick={() => start.mutate(r.l1)} data-testid={`pd-run-${r.l1}`}>{lr ? t("Mine again") : t("Mine")}</button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </ScrollFrame>
    </Panel>
  );
}

function Exports({ runId }: { runId: string }) {
  const { can } = useV2Session();
  const toast = useToast();
  if (!can("export_process")) return null;
  return (
    <button type="button" className="m2-btn" onClick={() => void exportSignavio(runId).catch((e: unknown) => toast.show(errorSentence(e, t("The export failed."))))} data-testid="pd-export-signavio">
      {t("Export to Signavio")}
    </button>
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
    toast.show(msg);
    void qc.invalidateQueries({ queryKey: ["discovery"] });
  };
  const fail = (e: unknown) => toast.show(errorSentence(e, t("The schedule could not be saved.")));
  const add = useMutation({ mutationFn: () => addSchedule(systemId, l1 || l1s[0], cron), onSuccess: done(t("Schedule added.")), onError: fail });
  const toggle = useMutation({ mutationFn: (s: { id: string; active: boolean }) => patchSchedule(systemId, s.id, { active: !s.active }), onSuccess: done(t("Schedule changed.")), onError: fail });
  const remove = useMutation({ mutationFn: (id: string) => deleteSchedule(systemId, id), onSuccess: done(t("Schedule removed.")), onError: fail });
  const edit = can("run_process_discovery");
  return (
    <Panel title={t("Schedules")} testId="pd-schedules">
      {q.isError ? (
        <ErrorFrame onRetry={() => void q.refetch()}>{t("The process discovery data could not be read.")}</ErrorFrame>
      ) : !q.data?.length ? (
        <EmptyFrame>{t("No schedules. Each process is mined only when someone starts a run.")}</EmptyFrame>
      ) : (
        <table className="m2-tbl m2-cards">
          <thead>
            <tr>
              <th scope="col">{t("Process")}</th>
              <th scope="col">{t("Cron")}</th>
              <th scope="col">{t("Next run")}</th>
              <th scope="col"><span className="m2-sr">{t("Actions")}</span></th>
            </tr>
          </thead>
          <tbody>
            {q.data.map((s) => (
              <tr key={s.id}>
                <th scope="row" className="m2-card-lead"><Mono>{s.l1}</Mono></th>
                <td data-label={t("Cron")}><Mono>{s.schedule_cron}</Mono></td>
                <td data-label={t("Next run")}>{s.active ? formatDate(s.next_run_at, "datetime") : t("Paused")}</td>
                <td data-label={t("Actions")}>
                  {edit ? (
                    <>
                      <button type="button" className="m2-btn" onClick={() => toggle.mutate(s)}>{s.active ? t("Pause") : t("Resume")}</button>{" "}
                      <button type="button" className="m2-btn" onClick={() => remove.mutate(s.id)} data-testid={`pd-sch-del-${s.id}`}>{t("Remove")}</button>
                    </>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {edit && l1s.length ? (
        <form className="m2-cc-split" onSubmit={(e) => (e.preventDefault(), add.mutate())}>
          <select className="m2-sel" aria-label={t("Process")} value={l1 || l1s[0]} onChange={(e) => setL1(e.target.value)}>
            {l1s.map((x) => (
              <option key={x} value={x}>{x}</option>
            ))}
          </select>
          <input className="m2-inp" aria-label={t("Cron")} value={cron} onChange={(e) => setCron(e.target.value)} />
          <button type="submit" className="m2-btn" disabled={add.isPending || !cron.trim()} data-testid="pd-sch-add">{t("Add schedule")}</button>
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

  return (
    <>
      <Panel title={t("{l1} as-is flow", { l1: entry.name })} meta={dfg.data ? t("Level {level}", { level: dfg.data.level }) : undefined} testId="pd-flow">
        <nav aria-label={t("Flow level")} className="m2-meta">
          <button type="button" className="m2-btn" onClick={() => setPath([])} disabled={!path.length}>{entry.l1}</button>
          {path.map((p, i) => (
            <Fragment key={p.id}>
              {" / "}
              <button type="button" className="m2-btn" onClick={() => setPath(path.slice(0, i + 1))} disabled={i === path.length - 1}>{p.name}</button>
            </Fragment>
          ))}
          {node && can("export_process") ? (
            <>
              {" "}
              <button type="button" className="m2-btn" onClick={() => void exportBpmn(runId, node).catch((e: unknown) => toast.show(errorSentence(e, t("The export failed."))))} data-testid="pd-export-bpmn">{t("Export BPMN")}</button>
            </>
          ) : null}
        </nav>
        {dfg.isPending ? (
          <Skeleton width="100%" height={200} />
        ) : dfg.isError ? (
          <ErrorFrame onRetry={() => void dfg.refetch()}>{t("The process discovery data could not be read.")}</ErrorFrame>
        ) : !dfg.data.nodes.length ? (
          <EmptyFrame>{t("No steps below this one. This is the deepest level mined for this step.")}</EmptyFrame>
        ) : (
          <>
            <CcHBars
              testId="pd-steps"
              label={t("Cases per step")}
              rows={dfg.data.nodes.map((n) => ({
                key: n.id,
                label: (
                  <button type="button" className="m2-linkbtn" onClick={() => setPath([...path, { id: n.id, name: n.name }])} data-testid={`pd-node-${n.id}`}>
                    <Mono>{n.id}</Mono> {n.name}
                  </button>
                ),
                value: n.case_count,
                text: n.observed ? `${int(n.case_count)}  ${secs(n.median_seconds)}` : t("Not observed"),
                tone: n.observed ? "data" : "warn",
              }))}
            />
            {dfg.data.edges.length ? (
              <ScrollFrame label={t("Hand-offs")}>
                <table className="m2-tbl m2-cards" data-testid="pd-edges">
                  <thead>
                    <tr>
                      <th scope="col">{t("From")}</th>
                      <th scope="col">{t("To")}</th>
                      <th scope="col">{t("Cases")}</th>
                      <th scope="col">{t("Median wait")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dfg.data.edges.map((e) => (
                      <tr key={`${e.source}-${e.target}`}>
                        <th scope="row" className="m2-card-lead"><Mono>{e.source}</Mono> {names.get(e.source) ?? ""}</th>
                        <td data-label={t("To")}><Mono>{e.target}</Mono> {names.get(e.target) ?? ""}</td>
                        <td data-label={t("Cases")}>{int(e.count)}</td>
                        <td data-label={t("Median wait")}>{secs(e.median_seconds)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ScrollFrame>
            ) : null}
          </>
        )}
      </Panel>
      <div className="m2-cc-split">
        <Panel title={t("Variants")} meta={variants.data ? t("{count} in total", { count: variants.data.total }) : undefined} testId="pd-variants">
          {variants.isPending ? (
            <Skeleton width="100%" height={160} />
          ) : variants.isError ? (
            <ErrorFrame onRetry={() => void variants.refetch()}>{t("The process discovery data could not be read.")}</ErrorFrame>
          ) : !variants.data.items.length ? (
            <EmptyFrame>{t("No variants. This run stored no case paths.")}</EmptyFrame>
          ) : (
            <ScrollFrame label={t("Variants")}>
              <table className="m2-tbl m2-cards">
                <thead>
                  <tr>
                    <th scope="col">{t("Path")}</th>
                    <th scope="col">{t("Cases")}</th>
                    <th scope="col">{t("Median throughput")}</th>
                    <th scope="col">{t("Fitness")}</th>
                  </tr>
                </thead>
                <tbody>
                  {variants.data.items.map((v) => (
                    <tr key={v.hash} aria-current={variant === v.hash ? "true" : undefined}>
                      <th scope="row" className="m2-card-lead">
                        <button type="button" className="m2-linkbtn" onClick={() => setVariant(variant === v.hash ? null : v.hash)} data-testid={`pd-variant-${v.hash}`}>
                          {v.activities.join(" > ")}
                        </button>
                      </th>
                      <td data-label={t("Cases")}>{int(v.case_count)} ({pct(v.share)})</td>
                      <td data-label={t("Median throughput")}>{secs(v.median_seconds)}</td>
                      <td data-label={t("Fitness")}>{fit(v.fitness)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollFrame>
          )}
        </Panel>
        <Panel title={t("Conformance")} meta={conf.data ? `${t("Fitness")} ${fit(conf.data.fitness)}` : undefined} testId="pd-conformance">
          {conf.isPending ? (
            <Skeleton width="100%" height={160} />
          ) : conf.isError ? (
            status(conf.error) === 404 ? <EmptyFrame>{t("No conformance check. This run was not checked against the reference model.")}</EmptyFrame> : <ErrorFrame onRetry={() => void conf.refetch()}>{t("The process discovery data could not be read.")}</ErrorFrame>
          ) : (
            <>
              <table className="m2-tbl m2-cards">
                <thead>
                  <tr>
                    <th scope="col">{t("Step")}</th>
                    <th scope="col">{t("Fitness")}</th>
                    <th scope="col">{t("Out of order")}</th>
                    <th scope="col">{t("Cases missing it")}</th>
                  </tr>
                </thead>
                <tbody>
                  {conf.data.steps.map((s) => (
                    <tr key={s.activity}>
                      <th scope="row" className="m2-card-lead">{s.activity}</th>
                      <td data-label={t("Fitness")}>{fit(s.step_fitness)}</td>
                      <td data-label={t("Out of order")}>{int(s.out_of_order)}</td>
                      <td data-label={t("Cases missing it")}>{conf.data.missing[s.activity] === undefined ? DASH : int(conf.data.missing[s.activity])}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {conf.data.extra.length ? (
                <CcHBars
                  testId="pd-extra"
                  label={t("Steps outside the reference model")}
                  rows={conf.data.extra.map((x) => ({ key: x.activity, label: x.activity, value: x.cases, text: `${int(x.cases)} (${pct(x.share)})`, tone: "warn" }))}
                />
              ) : null}
            </>
          )}
        </Panel>
      </div>
      <Cases runId={runId} variant={variant} />
    </>
  );
}

function Cases({ runId, variant }: { runId: string; variant: string | null }) {
  const fixture = useFixture();
  const [open, setOpen] = useState<string | null>(null);
  const q = useQuery({ queryKey: ["discovery", fixture, runId, "cases", variant], queryFn: () => getCases(runId, variant ?? undefined), staleTime: 60_000, retry });
  const one = useQuery({ queryKey: ["discovery", fixture, runId, "case", open], queryFn: () => getCase(runId, open ?? ""), enabled: !!open, staleTime: 60_000, retry });
  return (
    <Panel title={t("Cases")} meta={q.data ? t("{count} in total", { count: q.data.total }) : undefined} testId="pd-cases">
      {q.isPending ? (
        <Skeleton width="100%" height={160} />
      ) : q.isError ? (
        <ErrorFrame onRetry={() => void q.refetch()}>{t("The process discovery data could not be read.")}</ErrorFrame>
      ) : !q.data.items.length ? (
        <EmptyFrame>{t("No cases. This run stored no cases to show.")}</EmptyFrame>
      ) : (
        <ScrollFrame label={t("Cases")}>
          <table className="m2-tbl m2-cards">
            <thead>
              <tr>
                <th scope="col">{t("Case")}</th>
                <th scope="col">{t("Started")}</th>
                <th scope="col">{t("Last event")}</th>
                <th scope="col">{t("Events")}</th>
              </tr>
            </thead>
            <tbody>
              {q.data.items.map((c) => (
                <Fragment key={c.case_id}>
                  <tr>
                    <th scope="row" className="m2-card-lead">
                      <button type="button" className="m2-linkbtn" aria-expanded={open === c.case_id} onClick={() => setOpen(open === c.case_id ? null : c.case_id)} data-testid={`pd-case-${c.case_id}`}>
                        <Mono>{c.case_id}</Mono>
                      </button>
                    </th>
                    <td data-label={t("Started")}>{formatDate(c.first_ts, "datetime")}</td>
                    <td data-label={t("Last event")}>{formatDate(c.last_ts, "datetime")}</td>
                    <td data-label={t("Events")}>{int(c.events)}</td>
                  </tr>
                  {open === c.case_id ? (
                    <tr>
                      <td colSpan={4} data-testid="pd-case-events">
                        {one.isPending ? (
                          <Skeleton width="100%" height={80} />
                        ) : one.isError ? (
                          <ErrorFrame onRetry={() => void one.refetch()}>{t("The process discovery data could not be read.")}</ErrorFrame>
                        ) : (
                          <ol>
                            {one.data.events.map((ev) => (
                              <li key={ev.seq}>
                                {formatDate(ev.ts, "datetime")} {ev.activity}
                                {ev.resource ? <> <Mono>{ev.resource}</Mono></> : null}
                                {ev.automated === null ? null : ev.automated ? ` ${t("Automated")}` : ` ${t("Manual")}`}
                                {ev.source_table ? <> <Mono>{ev.source_table}</Mono></> : null}
                              </li>
                            ))}
                          </ol>
                        )}
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              ))}
            </tbody>
          </table>
        </ScrollFrame>
      )}
    </Panel>
  );
}
