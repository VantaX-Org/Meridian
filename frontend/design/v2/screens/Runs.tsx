"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { formatDate } from "@/lib/format";
import { analyseRun, type VersionHead } from "@/lib/api/v2/runs";
import type { Job, JobKind } from "@/types/jobs";
import { useOpenItem, useUrlParam, useV2Href, useV2Session } from "@/lib/v2/hooks";
import { JOB_KIND_LABEL, JOB_STATUS_LABEL, jobObject, jobSeconds } from "@/lib/v2/jobs";
import { useLandscape } from "@/lib/v2/queries";
import { useSystemExtractions, useTimeline, useV2Jobs, useVersionsPage } from "@/lib/v2/runs-queries";
import { useScopeSystem } from "@/lib/v2/scope";
import { f1, int } from "@/lib/v2/score";
import { RunTimelineChart, kindWord, triggerOf } from "../RunTimeline";
import { VerdictMark } from "../marks";
import { Dash, EmptyFrame, ErrorFrame, PageTitle, Skeleton, V2Link } from "../parts";
import { ResultFrame, useOutcome } from "../inspector/shared";
import { duration } from "../shell/StatusStrip";
import { t } from "@/lib/v2/i18n";
import { RunForecast } from "./step10/Prediction";

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
        <p>{t("No system has been extracted yet, so there is nothing to analyse. Extract a system first.")}</p>
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

function RunsTable({ systemFilter, statusFilter, showArchived }: { systemFilter: string; statusFilter: string; showArchived: boolean }) {
  const land = useLandscape(null);
  const page = useVersionsPage({ limit: 50, include_archived: showArchived });
  const timeline = useTimeline(null, 50);
  const meta = useMemo(() => new Map((timeline.data?.runs ?? []).map((r) => [r.id, r])), [timeline.data]);
  const systemName = (id: string | undefined) => land.data?.systems.find((s) => s.id === id)?.name;
  const rows = (page.data?.versions ?? []).filter((v) => (systemFilter === "all" || v.metadata?.system_id === systemFilter) && (statusFilter === "all" || statusGroup(v.status) === statusFilter));
  if (page.isLoading) return <Skeleton width="100%" height={200} />;
  if (page.isError) return <ErrorFrame onRetry={() => void page.refetch()}>{t("The runs could not be read.")}</ErrorFrame>;
  if (rows.length === 0) {
    return <EmptyFrame>{(page.data?.versions.length ?? 0) === 0 ? t("No run has been made yet. Extract a system and run an analysis to see it here.") : t("No run matches these filters.")}</EmptyFrame>;
  }
  const failedRows = rows.filter((v) => statusGroup(v.status) === "failed").length;
  return (
    <div className="m2-frame">
      <p className="m2-prov" data-testid="runs-count" style={{ margin: "var(--m2-s2) var(--m2-s3)" }}>
        {failedRows ? t("{rowsCount} {rowsCount, plural, one {run} other {runs}} in the table, {failedRows} of them failed.", { rowsCount: rows.length, failedRows }) : t("{rowsCount} {rowsCount, plural, one {run} other {runs}} in the table.", { rowsCount: rows.length })}
      </p>
      <table className="m2-tbl" data-testid="runs-table">
        <thead>
          <tr>
            <th scope="col">{t("Date")}</th>
            <th scope="col">{t("System")}</th>
            <th scope="col">{t("Label")}</th>
            <th scope="col">{t("Trigger")}</th>
            <th scope="col" className="m2-r">
              {t("Records")}
            </th>
            <th scope="col" className="m2-r">
              {t("Rules")}
            </th>
            <th scope="col" className="m2-r" title={t("Lowest and highest shown score over the objects the run scored")}>
              {t("Score")}
            </th>
            <th scope="col">{t("Status")}</th>
            <th scope="col" className="m2-r">
              {t("Took")}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((v) => {
            const m = meta.get(v.id);
            const st = runStatus(v.status);
            const range = scoreRange(v);
            const rules = rulesOf(v);
            const sys = systemName(v.metadata?.system_id);
            return (
              <tr key={v.id} data-testid="run-row">
                <th scope="row">
                  <V2Link href={`/run/${v.id}`} className="m2-rowlink">
                    {formatDate(v.run_at, "datetime")}
                  </V2Link>
                </th>
                <td>{sys ?? <Dash />}</td>
                <td>
                  {v.metadata?.baseline ? t("Baseline") : null}
                  {v.metadata?.baseline && v.label ? ", " : null}
                  {v.label ?? (v.metadata?.baseline ? null : <Dash />)}
                  {v.metadata?.archived ? <span className="m2-meta">{" "}{t("archived")}</span> : null}
                </td>
                <td>{kindWord(triggerOf(m?.kind, v.metadata))}</td>
                <td className="m2-r">{m?.records_checked == null ? <Dash /> : int(m.records_checked)}</td>
                <td className="m2-r">{rules == null ? <Dash /> : int(rules)}</td>
                <td className="m2-r">{range ? t("{range} to {range2}", { range: f1(range[0]), range2: f1(range[1]) }) : <Dash />}</td>
                <td>
                  <span className="m2-v">
                    {st.mark ? <VerdictMark verdict={st.mark} /> : null}
                    {st.word}
                  </span>
                </td>
                <td className="m2-r">{m?.duration_s == null ? <Dash /> : duration(m.duration_s)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
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
      <table className="m2-tbl" data-testid="jobs-table">
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
      </table>
    </div>
  );
}

/**
 * `/runs`: the timeline at full width, the table of runs (or of jobs, every kind, each opening the job inspector),
 * filters by system and status, and "Start a run".
 */
export function RunsCanvas() {
  const router = useRouter();
  const params = useSearchParams();
  const v2Href = useV2Href();
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

  return (
    <>
      <PageTitle sub={scope?.name}>{t("Runs")}</PageTitle>
      <p className="m2-finding">
        {latest ? t("The timeline shows the last {runsCount} finished {runsCount, plural, one {run} other {runs}}, the latest on {run_at}.", { runsCount: runs.length, run_at: formatDate(latest.run_at, "date") }) : t("No run has finished for this scope yet.")}
        {baseline ? t(" The baseline is {run_at}.", { run_at: formatDate(baseline.run_at, "date") }) : ""}
      </p>

      <section className="m2-sec" aria-label={t("Timeline")}>
        {timeline.isLoading ? (
          <Skeleton width="100%" height={100} />
        ) : timeline.isError ? (
          <ErrorFrame onRetry={() => void timeline.refetch()}>{t("The timeline could not be read.")}</ErrorFrame>
        ) : runs.length === 0 ? (
          <EmptyFrame>{t("Runs appear here once a system has been extracted and analysed.")}</EmptyFrame>
        ) : (
          <div className="m2-frame" style={{ padding: "var(--m2-s3) var(--m2-s4)" }}>
            <RunTimelineChart runs={runs} selectedId={latest?.id ?? null} onPick={(id) => router.push(v2Href(`/run/${id}`))} label={t("Runs on a date axis, choose one to open it")} fallbackWidth={900} />
          </div>
        )}
      </section>

      <div className="m2-cta" style={{ justifyContent: "space-between" }}>
        <nav className="m2-views" aria-label={t("Runs views")}>
          <V2Link href={link("runs")} aria-current={view === "runs" ? "page" : undefined}>
            {t("Runs")}
          </V2Link>
          <V2Link href={link("jobs")} aria-current={view === "jobs" ? "page" : undefined}>
            {jobs.active.length ? t("Jobs ({activeCount} running)", { activeCount: jobs.active.length }) : t("Jobs")}
          </V2Link>
        </nav>
        <button type="button" className="m2-btn m2-strong" aria-expanded={starting} disabled={!session.can("analyse")} title={session.can("analyse") ? undefined : t("Starting a run needs the analyse permission")} onClick={() => setStarting((v) => !v)}>
          {t("Start a run")}
        </button>
      </div>
      {starting ? <StartRun onClose={() => setStarting(false)} /> : null}

      {view === "runs" ? (
        <section className="m2-sec" aria-label={t("Runs")} style={{ marginTop: "var(--m2-s4)" }}>
          <div className="m2-rfilters">
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
          </div>
          <RunsTable systemFilter={system} statusFilter={status} showArchived={archived} />
        </section>
      ) : (
        <section className="m2-sec" aria-label={t("Jobs")} style={{ marginTop: "var(--m2-s4)" }}>
          <div className="m2-rfilters">
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
    </>
  );
}
