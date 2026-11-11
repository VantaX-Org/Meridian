"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { formatDate } from "@/lib/format";
import { analyseRun, type TimelineRun, type VersionHead } from "@/lib/api/v2/runs";
import { exportRuns, type ExportFormat } from "@/lib/api/v2/run-ops";
import type { Job, JobKind } from "@/types/jobs";
import { useOpenItem, useUrlParam, useV2Href, useV2Session } from "@/lib/v2/hooks";
import { JOB_KIND_LABEL, JOB_STATUS_LABEL, jobObject, jobSeconds } from "@/lib/v2/jobs";
import { useLandscape } from "@/lib/v2/queries";
import { useSystemExtractions, useTimeline, useV2Jobs, useVersionsPage } from "@/lib/v2/runs-queries";
import { useScopeSystem } from "@/lib/v2/scope";
import { f1, int } from "@/lib/v2/score";
import { RunTimelineChart, RunTimelineMenu } from "../RunTimeline";
import { RunChip } from "../RunChip";
import { InactiveChip, Lede, PrimaryAction } from "../RunParts";
import { VerdictMark } from "../marks";
import { ChartFrame, ChartTable, MULTI_H, SmallMultiples, TrendChart, niceTicks, scoreDomain } from "../charts";
import { CcBanner, CcHBars, CcPage } from "./cc-parts";
import { Dash, EmptyFrame, ErrorFrame, PageTitle, Skeleton, V2Link } from "../parts";
import { ResultFrame, useOutcome } from "../inspector/shared";
import { duration } from "../shell/StatusStrip";
import { t } from "@/lib/v2/i18n";
import { RunForecast } from "./step10/Prediction";
import { TableExport } from "@/design/v2/TableExport";

const RUN_STATUS: Record<string, { word: string; mark: "go" | "no-go" | null }> = {
  complete: { get word() { return t("Complete"); }, mark: "go" },
  agents_complete: { get word() { return t("Complete"); }, mark: "go" },
  ai_enriched: { get word() { return t("Complete"); }, mark: "go" },
  partial: { get word() { return t("Partial"); }, mark: null },
  failed: { get word() { return t("Failed"); }, mark: "no-go" },
  agents_failed: { get word() { return t("Failed"); }, mark: "no-go" },
  error: { get word() { return t("Failed"); }, mark: "no-go" },
  errored: { get word() { return t("Failed"); }, mark: "no-go" },
  pending: { get word() { return t("Queued"); }, mark: null },
  running: { get word() { return t("Running"); }, mark: null },
  extracted: { get word() { return t("Extracted"); }, mark: null },
};

/** Run status as a mark and a word; the filter groups the raw statuses the same way. */
export function runStatus(status: string): { word: string; mark: "go" | "no-go" | null } {
  return RUN_STATUS[status] ?? { word: status.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()), mark: null };
}

/** Lowest and highest shown score over the objects the run scored, or null when it scored none. */
export function scoreRange(v: VersionHead): [number, number] | null {
  const scores = Object.values(v.dqs_summary ?? {})
    .map((m) => m.composite_score)
    .filter((n): n is number => typeof n === "number");
  return scores.length ? [Math.min(...scores), Math.max(...scores)] : null;
}

export function rulesOf(v: VersionHead): number | null {
  const n = Object.values(v.dqs_summary ?? {}).reduce((sum, m) => sum + (typeof m.total_checks === "number" ? m.total_checks : 0), 0);
  return n > 0 ? n : null;
}

const STATUS_FILTERS = [
  { value: "all", get label() { return t("Any status"); } },
  { value: "complete", get label() { return t("Complete"); } },
  { value: "failed", get label() { return t("Failed"); } },
  { value: "active", get label() { return t("Queued or running"); } },
] as const;

function statusGroup(status: string): "complete" | "failed" | "active" | "other" {
  const w = runStatus(status).word;
  // The word is in the interface's language, so it is compared with the same words.
  return w === t("Complete") ? "complete" : w === t("Failed") ? "failed" : w === t("Queued") || w === t("Running") ? "active" : "other";
}

/** "Start a run": analyse the newest stored extraction of one system, the existing POST /versions/{id}/analyse. */
function StartRun({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const land = useLandscape(null);
  const session = useV2Session();
  const systems = (land.data?.systems ?? []).filter((s) => s.state !== "not_extracted");
  const [picked, setPicked] = useState<string | null>(null);
  const chosen = picked ?? systems.find((s) => s.state === "extracted")?.id ?? systems[0]?.id ?? "";
  const extractions = useSystemExtractions(chosen, Boolean(chosen));
  const newest = extractions.data?.versions.find((v) => v.analysable);
  const { outcome, pending, run } = useOutcome();
  const allowed = session.can("analyse");
  const system = systems.find((s) => s.id === chosen);
  return (
    <div className="m2-handoff" data-testid="start-run" role="group" aria-label={t("Start a run")}>
      {systems.length === 0 ? (
        <>
          <p>{t("No system has been extracted yet, so there is nothing to analyse. Extract a system first.")}</p>
          <V2Link href="/s" className="m2-btn m2-strong" data-testid="start-run-pick-system">
            {t("Choose a system to extract")}
          </V2Link>
        </>
      ) : (
        <>
          <p>{t("An analysis scores the newest stored extraction of a system with every rule. To read fresh data first, extract the system from its page.")}</p>
          <div className="m2-pop-cmp">
            <label htmlFor="start-system" className="m2-meta">
              {t("System")}
            </label>
            <select id="start-system" className="m2-sel" value={chosen} onChange={(e) => setPicked(e.target.value)}>
              {systems.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="m2-btn m2-strong"
              disabled={!allowed || !newest || pending !== null}
              onClick={() =>
                void run("analyse", async () => {
                  if (!newest) return { tone: "fail", title: t("Nothing to analyse"), detail: t("No stored extraction of this system can be analysed.") };
                  const r = await analyseRun(newest.id);
                  void qc.invalidateQueries({ queryKey: ["v2"] });
                  void qc.invalidateQueries({ queryKey: ["jobs"] });
                  return { tone: "ok", title: t("Analysis started"), detail: t("The {run_at} extraction of {name} is being scored.", { run_at: formatDate(newest.run_at, "datetime"), name: system?.name ?? t("the system") }), job: r.job_id };
                })
              }
            >
              {pending === "analyse" ? t("Starting…") : t("Analyse {name}", { name: system?.name ?? "" }).trim()}
            </button>
            {chosen ? (
              <V2Link href={`/s/${encodeURIComponent(chosen)}?open=${encodeURIComponent(`system:${chosen}`)}`} className="m2-btn" data-testid="start-run-extract">
                {t("Extract fresh data first")}
              </V2Link>
            ) : null}
            <button type="button" className="m2-btn m2-ghost" onClick={onClose}>
              {t("Close")}
            </button>
          </div>
          {newest ? <RunForecast systemId={chosen} modules={newest.objects} what="analysis" /> : null}
          {extractions.isSuccess && !newest ? <p className="m2-prov">{t("This system has no stored extraction that can be analysed.")}</p> : null}
          {!allowed ? <p className="m2-prov">{t("Starting a run needs the analyse permission.")}</p> : null}
        </>
      )}
      {outcome ? <ResultFrame outcome={outcome} /> : null}
    </div>
  );
}

/** The runs of one system, newest first, each row naming its run in full and offering the comparison with the one before. */
function LedgerGroup({ name, inactive, rows, meta }: { name: string; inactive: boolean; rows: readonly VersionHead[]; meta: Map<string, TimelineRun> }) {
  const router = useRouter();
  const v2Href = useV2Href();
  const chartRuns = [...rows].reverse().map((v) => meta.get(v.id)).filter((r): r is TimelineRun => Boolean(r));
  const failed = rows.filter((v) => statusGroup(v.status) === "failed").length;
  const tick = (r: TimelineRun) => (r.run_number != null ? t("run {n}", { n: r.run_number }) : formatDate(r.run_at, "date").replace(/\s+\d{4}$/, ""));
  return (
    <section className="m2-frame m2-ledger-group" aria-label={name} data-testid="runs-group">
      <h3 className="m2-ledger-h">
        {name} {inactive ? <InactiveChip /> : null}
        <span className="m2-meta" data-testid="runs-count">
          {" "}
          {failed ? t("{rowsCount} {rowsCount, plural, one {run} other {runs}}, {failed} failed", { rowsCount: rows.length, failed }) : t("{rowsCount} {rowsCount, plural, one {run} other {runs}}", { rowsCount: rows.length })}
        </span>
      </h3>
      <TableExport><table className="m2-tbl" data-testid="runs-table">
        <thead>
          <tr>
            <th scope="col">{t("Run")}</th>
            <th scope="col">{t("Status")}</th>
            <th scope="col" className="m2-r" title={t("Records the rules read in this run")}>
              {t("Records checked")}
            </th>
            <th scope="col" className="m2-r">
              {t("Took")}
            </th>
            <th scope="col" className="m2-r" title={t("How many objects this run gave a score")}>
              {t("Objects scored")}
            </th>
            <th scope="col" className="m2-r" title={t("Lowest and highest shown score over the objects the run scored, out of 100")}>
              {t("Scores, out of 100")}
            </th>
            <th scope="col">{t("Compare")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((v, i) => {
            const m = meta.get(v.id);
            const st = runStatus(v.status);
            const range = scoreRange(v);
            const scored = m ? Object.keys(m.objects).length : Object.keys(v.dqs_summary ?? {}).length;
            const prev = rows[i + 1];
            return (
              <tr key={v.id} data-testid="run-row">
                <th scope="row">
                  <V2Link href={`/run/${v.id}`} className="m2-rowlink">
                    <RunChip run={{ run_number: m?.run_number ?? v.run_number ?? null, run_at: v.run_at, status: v.status, baseline: Boolean(v.metadata?.baseline) }} system={name} />
                  </V2Link>
                  {v.label ? <span className="m2-meta">{" "}{v.label}</span> : null}
                  {v.metadata?.archived ? <span className="m2-meta">{" "}{t("archived")}</span> : null}
                </th>
                <td>
                  <span className="m2-v">
                    {st.mark ? <VerdictMark verdict={st.mark} /> : null}
                    {st.word}
                  </span>
                </td>
                <td className="m2-r">{m?.records_checked == null ? <Dash /> : int(m.records_checked)}</td>
                <td className="m2-r">{m?.duration_s == null ? <Dash /> : duration(m.duration_s)}</td>
                <td className="m2-r">{scored ? int(scored) : <Dash />}</td>
                <td className="m2-r">{range ? t("{range} to {range2}", { range: f1(range[0]), range2: f1(range[1]) }) : <Dash />}</td>
                <td>
                  {prev ? (
                    <V2Link href={`/run/${prev.id}/vs/${v.id}`} className="m2-btn m2-sm" data-testid="compare-previous">
                      {t("Compare with previous")}
                    </V2Link>
                  ) : (
                    <span className="m2-meta" title={t("This is the first run of the system, so there is nothing earlier to compare with.")}>
                      {t("First run")}
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table></TableExport>
      {chartRuns.length > 1 ? (
        <div className="m2-ledger-chart" data-testid="runs-group-chart">
          <p className="m2-prov">{t("Where each {name} run falls in time. The table above lists the same runs. Choose a square to open that run.", { name })}</p>
          <RunTimelineChart runs={chartRuns} selectedId={chartRuns[chartRuns.length - 1].id} onPick={(id) => router.push(v2Href(`/run/${id}`))} label={t("{name} runs on a date axis, choose one to open it", { name })} fallbackWidth={900} tick={tick} />
        </div>
      ) : null}
    </section>
  );
}

/** Runs by system, newest first in each; active systems before inactive ones, then by name. A system that was removed still groups. */
export function groupRuns(rows: readonly VersionHead[], systems: readonly { id: string; name: string; is_active?: boolean }[]) {
  const by = new Map<string, VersionHead[]>();
  for (const v of rows) {
    const k = v.metadata?.system_id ?? "";
    by.set(k, [...(by.get(k) ?? []), v]);
  }
  const stamp = (v: VersionHead) => new Date(v.run_at ?? 0).getTime();
  const out = [...by.entries()].map(([id, list]) => {
    const sys = systems.find((s) => s.id === id);
    return { id, name: sys?.name ?? t("Unknown system"), inactive: sys?.is_active === false, rows: [...list].sort((a, b) => stamp(b) - stamp(a)) };
  });
  return out.sort((a, b) => Number(a.inactive) - Number(b.inactive) || a.name.localeCompare(b.name));
}

function RunsLedger({ systemFilter, statusFilter, showArchived }: { systemFilter: string; statusFilter: string; showArchived: boolean }) {
  const land = useLandscape(null);
  const page = useVersionsPage({ limit: 50, include_archived: showArchived });
  const timeline = useTimeline(null, 50);
  const meta = useMemo(() => new Map((timeline.data?.runs ?? []).map((r) => [r.id, r])), [timeline.data]);
  const rows = (page.data?.versions ?? []).filter((v) => (systemFilter === "all" || v.metadata?.system_id === systemFilter) && (statusFilter === "all" || statusGroup(v.status) === statusFilter));
  const groups = groupRuns(rows, land.data?.systems ?? []);
  if (page.isLoading) return <Skeleton width="100%" height={200} />;
  if (page.isError) return <ErrorFrame onRetry={() => void page.refetch()}>{t("The runs could not be read.")}</ErrorFrame>;
  if (rows.length === 0) {
    return <EmptyFrame>{(page.data?.versions.length ?? 0) === 0 ? t("No run has been made yet. Extract a system and run an analysis to see it here.") : t("No run matches these filters. Choose Any status and All systems to see every run.")}</EmptyFrame>;
  }
  return (
    <div data-testid="runs-ledger">
      {groups.map((g) => (
        <LedgerGroup key={g.id} name={g.name} inactive={g.inactive} rows={g.rows} meta={meta} />
      ))}
    </div>
  );
}

const KINDS: JobKind[] = ["extraction", "analysis", "config_load", "config_sync", "upload", "simulation", "process_discovery"];

function JobsTable({ kind, status }: { kind: string; status: string }) {
  const jobs = useV2Jobs();
  const land = useLandscape(null);
  const { hrefFor } = useOpenItem();
  const rows = jobs.jobs.filter((j) => (kind === "all" || j.kind === kind) && (status === "all" || (status === "active" ? j.status === "queued" || j.status === "running" : j.status === status)));
  if (jobs.isLoading) return <Skeleton width="100%" height={160} />;
  if (jobs.isError) return <ErrorFrame onRetry={() => void jobs.refetch()}>{t("The jobs could not be read.")}</ErrorFrame>;
  if (rows.length === 0) return <EmptyFrame>{jobs.jobs.length === 0 ? t("No job has run in the last 7 days.") : t("No job matches these filters.")}</EmptyFrame>;
  const sys = (j: Job) => land.data?.systems.find((s) => s.id === j.system_id)?.name;
  return (
    <div className="m2-frame">
      <TableExport><table className="m2-tbl" data-testid="jobs-table">
        <thead>
          <tr>
            <th scope="col">{t("Job")}</th>
            <th scope="col">{t("Object")}</th>
            <th scope="col">{t("System")}</th>
            <th scope="col">{t("State")}</th>
            <th scope="col" className="m2-r">
              {t("Progress")}
            </th>
            <th scope="col">{t("Started")}</th>
            <th scope="col" className="m2-r">
              {t("Took")}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((j) => {
            const secs = jobSeconds(j);
            return (
              <tr key={j.id} data-testid="job-row">
                <th scope="row">
                  <V2Link href={hrefFor({ kind: "job", id: j.id })} className="m2-rowlink">
                    {JOB_KIND_LABEL[j.kind]}
                  </V2Link>
                </th>
                <td>{jobObject(j)}</td>
                <td>{sys(j) ?? <Dash />}</td>
                <td>
                  <span className="m2-v">
                    {j.status === "completed" ? <VerdictMark verdict="go" /> : j.status === "failed" ? <VerdictMark verdict="no-go" /> : null}
                    {JOB_STATUS_LABEL[j.status]}
                  </span>
                </td>
                <td className="m2-r">{j.status === "queued" || j.status === "running" ? `${Math.round(j.percent)}%` : j.status === "completed" ? "100%" : <Dash />}</td>
                <td>{formatDate(j.started_at * 1000, "datetime")}</td>
                <td className="m2-r">{secs == null ? <Dash /> : duration(secs)}</td>
              </tr>
            );
          })}
        </tbody>
      </table></TableExport>
    </div>
  );
}

/** Export of the runs list (up to 100 runs) as Excel or CSV, following the system filter and the archived switch. */
export function RunsExport({ system, archived }: { system: string; archived: boolean }) {
  const session = useV2Session();
  const { outcome, pending, run } = useOutcome();
  const allowed = session.can("export");
  const go = (format: ExportFormat) =>
    void run(format, async () => {
      await exportRuns(format, { system_id: system === "all" ? undefined : system, include_archived: archived || undefined });
      return session.fixture
        ? { tone: "info", title: t("Fixture mode: no file is produced") }
        : { tone: "ok", title: t("Runs downloading"), detail: t("The browser saves the file when it is ready. It follows the system filter and the archived switch, up to 100 runs.") };
    });
  return (
    <span className="m2-cta" data-testid="runs-export">
      {(["xlsx", "csv"] as const).map((f) => (
        <button key={f} type="button" className="m2-btn" disabled={!allowed || pending !== null} title={allowed ? t("Export runs") : t("Exporting runs needs the export permission")} onClick={() => go(f)}>
          {f === "xlsx" ? t("Export runs to Excel") : t("Export runs to CSV")}
        </button>
      ))}
      {outcome ? <ResultFrame outcome={outcome} /> : null}
    </span>
  );
}

/**
 * `/runs`: the timeline at full width, the table of runs (or of jobs, every kind, each opening the job inspector),
 * filters by system and status, and "Start a run".
 */
export function RunsCanvas() {
  const params = useSearchParams();
  const session = useV2Session();
  const scope = useScopeSystem();
  const view = params.get("view") === "jobs" ? "jobs" : "runs";
  const timeline = useTimeline(scope?.id ?? null, 12);
  const land = useLandscape(null);
  const jobs = useV2Jobs();
  const [system, setSystem] = useState("all");
  const [status, setStatus] = useUrlParam<string>("status", "all");
  const [kind, setKind] = useState("all");
  const [jobStatus, setJobStatus] = useState("all");
  const [archived, setArchived] = useState(false);
  const [starting, setStarting] = useState(false);

  const runs = timeline.data?.runs ?? [];
  const latest = runs.length ? runs[runs.length - 1] : null;
  const baseline = runs.find((r) => r.baseline);
  const link = (v: "runs" | "jobs") => {
    const next = new URLSearchParams(params.toString());
    next.delete("open");
    if (v === "jobs") next.set("view", "jobs");
    else next.delete("view");
    const qs = next.toString();
    return qs ? `/runs?${qs}` : "/runs";
  };

  const prev = runs.length > 1 ? runs[runs.length - 2] : null;
  const nowScore = latest ? meanScore(latest) : null;
  const prevScore = prev ? meanScore(prev) : null;
  const delta = nowScore != null && prevScore != null ? nowScore - prevScore : null;
  const views = (
    <nav className="m2-views" aria-label={t("Runs views")}>
      <V2Link href={link("runs")} aria-current={view === "runs" ? "page" : undefined}>
        {t("Runs")}
      </V2Link>
      <V2Link href={link("jobs")} aria-current={view === "jobs" ? "page" : undefined}>
        {jobs.active.length ? t("Jobs ({activeCount} running)", { activeCount: jobs.active.length }) : t("Jobs")}
      </V2Link>
    </nav>
  );
  const startButton = (
    <button type="button" className="m2-btn m2-next" aria-expanded={starting} disabled={!session.can("analyse")} title={session.can("analyse") ? undefined : t("Starting a run needs the analyse permission")} onClick={() => setStarting((v) => !v)}>
      {t("Start a run")}
    </button>
  );

  return (
    <CcPage>
      <PageTitle sub={scope?.name}>{t("Runs")}</PageTitle>
      <Lede>
        {t("Every run of every system, newest first within each system. Open a run to see what it scored, or compare it with the one before to see what changed.")}
      </Lede>
      <RunTimelineMenu />
      <CcBanner
        testId="runs-banner"
        label={t("Latest run")}
        eyebrow={t("Latest run")}
        headline={latest ? t("Finished on {run_at}", { run_at: formatDate(latest.run_at, "date") }) : t("No run has finished yet")}
        verdict={delta == null ? undefined : delta < -0.05 ? "at-risk" : "go"}
        why={
          delta == null
            ? t("A second run is needed to say whether the data got better or worse.")
            : delta < -0.05
              ? t("The average score fell by {n} points since the run before.", { n: f1(Math.abs(delta)) })
              : delta > 0.05
                ? t("The average score rose by {n} points since the run before.", { n: f1(delta) })
                : t("The average score did not change since the run before.")
        }
        figs={[
          { label: t("Runs shown"), value: int(runs.length), note: baseline ? t("baseline {run_at}", { run_at: formatDate(baseline.run_at, "date") }) : t("no baseline set") },
          { label: t("Average score"), value: f1(nowScore), note: t("out of 100") },
          { label: t("Took"), value: latest?.duration_s != null ? duration(latest.duration_s) : "—", note: t("latest run") },
        ]}
        action={<PrimaryAction action={startButton} why={t("A new run measures the data again, so you can compare it with the last one.")} />}
      />

      <section className="m2-sec" aria-label={t("Timeline")}>
        {timeline.isLoading ? (
          <Skeleton width="100%" height={100} />
        ) : timeline.isError ? (
          <ErrorFrame onRetry={() => void timeline.refetch()}>{t("The timeline could not be read.")}</ErrorFrame>
        ) : runs.length === 0 ? (
          <EmptyFrame>{t("Runs appear here once a system has been extracted and analysed.")}</EmptyFrame>
        ) : (
          <>
            <div className="m2-cc-split">
              <RunScoreTrend runs={runs} />
              <section className="m2-cc-card" aria-label={t("How long each run took")} data-testid="runs-durations">
                <h3>{t("How long each run took")}</h3>
                <CcHBars
                  label={t("Run duration")}
                  rows={runs
                    .filter((r) => r.duration_s != null)
                    .slice(-8)
                    .map((r) => ({ key: r.id, label: r.run_at ? formatDate(r.run_at, "date") : r.id.slice(0, 8), value: r.duration_s as number, text: duration(r.duration_s as number) }))}
                />
              </section>
            </div>
          </>
        )}
      </section>

      {starting ? <StartRun onClose={() => setStarting(false)} /> : null}

      {view === "runs" ? (
        <section className="m2-sec" aria-label={t("Runs")} style={{ marginTop: "var(--m2-s4)" }}>
          <div className="m2-rfilters">
            {views}
            <label>
              {t("System")}
              <select className="m2-sel" value={system} onChange={(e) => setSystem(e.target.value)}>
                <option value="all">{t("All systems")}</option>
                {(land.data?.systems ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t("Status")}
              <select className="m2-sel" value={status} onChange={(e) => setStatus(e.target.value)}>
                {STATUS_FILTERS.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} />
              {t("Show archived runs")}
            </label>
            <RunsExport system={system} archived={archived} />
          </div>
          <RunsLedger systemFilter={system} statusFilter={status} showArchived={archived} />
        </section>
      ) : (
        <section className="m2-sec" aria-label={t("Jobs")} style={{ marginTop: "var(--m2-s4)" }}>
          <div className="m2-rfilters">
            {views}
            <label>
              {t("Kind")}
              <select className="m2-sel" value={kind} onChange={(e) => setKind(e.target.value)}>
                <option value="all">{t("Every kind")}</option>
                {KINDS.map((k) => (
                  <option key={k} value={k}>
                    {JOB_KIND_LABEL[k]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t("State")}
              <select className="m2-sel" value={jobStatus} onChange={(e) => setJobStatus(e.target.value)}>
                <option value="all">{t("Any state")}</option>
                <option value="active">{t("Queued or running")}</option>
                <option value="completed">{t("Done")}</option>
                <option value="failed">{t("Failed")}</option>
              </select>
            </label>
          </div>
          <JobsTable kind={kind} status={jobStatus} />
        </section>
      )}
      {view === "runs" ? <ObjectTrends runs={runs} labelOf={(m) => land.data?.objects.find((o) => o.module === m)?.label ?? m} state={timeline.isLoading ? "loading" : timeline.isError ? "error" : "ready"} onRetry={() => void timeline.refetch()} /> : null}
    </CcPage>
  );
}

/** The mean of the objects' measured scores in one run. */
export function meanScore(r: TimelineRun): number | null {
  const vs = Object.values(r.objects)
    .map((o) => o.raw_score ?? o.score)
    .filter((v): v is number => v != null);
  return vs.length ? vs.reduce((a, b) => a + b, 0) / vs.length : null;
}

function RunScoreTrend({ runs }: { runs: readonly TimelineRun[] }) {
  const points = runs.map((r) => {
    const full = r.run_at ? formatDate(r.run_at, "date") : (r.label ?? r.id.slice(0, 6));
    const label = r.run_at ? formatDate(r.run_at, "day") : full;
    const value = meanScore(r);
    return { id: r.id, label, title: t("{label}: average score {score}", { label: full, score: f1(value) }), value };
  });
  const known = points.map((p) => p.value).filter((v): v is number => v != null);
  const ticks = niceTicks(Math.max(0, Math.min(...known, 100) - 10), Math.min(100, Math.max(...known, 0) + 10), 4);
  return (
    <ChartFrame
      title={t("Score over time")}
      sub={t("Average object score, last {n} runs", { n: points.length })}
      height={160}
      level={3}
      state={known.length < 2 ? "empty" : "ready"}
      empty={t("Two runs are needed to draw a trend.")}
      testId="runs-trend"
      table={<ChartTable caption={t("Average score by run")} head={[t("Run"), t("Score")]} rows={points.map((p) => [p.label, f1(p.value)])} />}
    >
      <TrendChart points={points} domain={[ticks[0], ticks[ticks.length - 1]] as const} ticks={ticks} height={160} label={t("Average object score by run")} yLabel={t("score")} format={f1} />
    </ChartFrame>
  );
}

/**
 * Every object's measured score over the runs of the timeline, as small multiples on one shared scale: which objects
 * are moving, and which way, at a glance. The table behind "Show the figures" holds every value.
 */
export function ObjectTrends({ runs, labelOf, state, onRetry }: { runs: readonly TimelineRun[]; labelOf: (module: string) => string; state: "ready" | "loading" | "error"; onRetry: () => void }) {
  const modules = useMemo(() => [...new Set(runs.flatMap((r) => Object.keys(r.objects)))], [runs]);
  const series = useMemo(
    () =>
      modules
        .map((m) => ({ module: m, values: runs.map((r) => r.objects[m]?.raw_score ?? r.objects[m]?.score ?? null) }))
        .filter((x) => x.values.filter((v) => v != null).length > 1)
        .sort((a, b) => (a.values[a.values.length - 1] ?? 0) - (b.values[b.values.length - 1] ?? 0)),
    [modules, runs],
  );
  const domain = useMemo(() => scoreDomain(series.flatMap((x) => x.values.filter((v): v is number => v != null)), [85], 20), [series]);
  const lastOf = (vs: readonly (number | null)[]) => [...vs].reverse().find((v) => v != null) ?? null;
  const firstOf = (vs: readonly (number | null)[]) => vs.find((v) => v != null) ?? null;
  return (
    <section className="m2-sec" aria-label={t("Objects over these runs")}>
      <ChartFrame
        title={t("Objects over these runs")}
        sub={t("Measured score, one panel per object on one scale, lowest first")}
        state={state === "ready" && series.length === 0 ? "empty" : state}
        empty={t("Each object gets a panel once two runs have scored it.")}
        onRetry={onRetry}
        height={MULTI_H * 2 + 48}
        testId="object-trends"
        table={
          <ChartTable
            caption={t("Measured score by object and run")}
            head={[t("Object"), ...runs.map((r) => (r.run_at ? formatDate(r.run_at, "date") : r.id.slice(0, 8)))]}
            rows={series.map((x) => [labelOf(x.module), ...x.values.map((v) => (v == null ? "—" : f1(v)))])}
          />
        }
      >
        <SmallMultiples
          items={series.map((x) => ({
            id: x.module,
            title: labelOf(x.module),
            values: x.values,
            last: f1(lastOf(x.values)),
            label: t("{label}: measured {first} to {last} over {count} runs", { label: labelOf(x.module), first: f1(firstOf(x.values)), last: f1(lastOf(x.values)), count: x.values.length }),
          }))}
          domain={domain}
          reference={{ value: 85, label: t("85 cap") }}
        />
      </ChartFrame>
    </section>
  );
}
