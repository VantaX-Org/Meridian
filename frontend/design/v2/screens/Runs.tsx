"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { formatDate } from "@/lib/format";
import { analyseRun, type VersionHead } from "@/lib/api/v2/runs";
import type { Job, JobKind } from "@/types/jobs";
import { useOpenItem, useV2Href, useV2Session } from "@/lib/v2/hooks";
import { JOB_KIND_LABEL, JOB_STATUS_LABEL, jobObject, jobSeconds } from "@/lib/v2/jobs";
import { useLandscape } from "@/lib/v2/queries";
import { useSystemExtractions, useTimeline, useV2Jobs, useVersionsPage } from "@/lib/v2/runs-queries";
import { useScopeSystem } from "@/lib/v2/scope";
import { f1, int } from "@/lib/v2/score";
import { RunTimelineChart, kindWord } from "../RunTimeline";
import { VerdictMark } from "../marks";
import { Dash, EmptyFrame, ErrorFrame, PageTitle, Skeleton, V2Link } from "../parts";
import { ResultFrame, useOutcome } from "../inspector/shared";
import { duration } from "../shell/StatusStrip";

const RUN_STATUS: Record<string, { word: string; mark: "go" | "no-go" | null }> = {
  complete: { word: "Complete", mark: "go" },
  agents_complete: { word: "Complete", mark: "go" },
  ai_enriched: { word: "Complete", mark: "go" },
  partial: { word: "Partial", mark: null },
  failed: { word: "Failed", mark: "no-go" },
  agents_failed: { word: "Failed", mark: "no-go" },
  error: { word: "Failed", mark: "no-go" },
  errored: { word: "Failed", mark: "no-go" },
  pending: { word: "Queued", mark: null },
  running: { word: "Running", mark: null },
  extracted: { word: "Extracted", mark: null },
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
  { value: "all", label: "Any status" },
  { value: "complete", label: "Complete" },
  { value: "failed", label: "Failed" },
  { value: "active", label: "Queued or running" },
] as const;

function statusGroup(status: string): "complete" | "failed" | "active" | "other" {
  const w = runStatus(status).word;
  return w === "Complete" ? "complete" : w === "Failed" ? "failed" : w === "Queued" || w === "Running" ? "active" : "other";
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
    <div className="m2-handoff" data-testid="start-run" role="group" aria-label="Start a run">
      {systems.length === 0 ? (
        <p>No system has been extracted yet, so there is nothing to analyse. Extract a system first.</p>
      ) : (
        <>
          <p>An analysis scores the newest stored extraction of a system with every rule. To read fresh data first, extract the system from its page.</p>
          <div className="m2-pop-cmp">
            <label htmlFor="start-system" className="m2-meta">
              System
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
                  if (!newest) return { tone: "fail", title: "Nothing to analyse", detail: "No stored extraction of this system can be analysed." };
                  const r = await analyseRun(newest.id);
                  void qc.invalidateQueries({ queryKey: ["v2"] });
                  void qc.invalidateQueries({ queryKey: ["jobs"] });
                  return { tone: "ok", title: "Analysis started", detail: `The ${formatDate(newest.run_at, "datetime")} extraction of ${system?.name ?? "the system"} is being scored.`, job: r.job_id };
                })
              }
            >
              {pending === "analyse" ? "Starting…" : `Analyse ${system?.name ?? ""}`.trim()}
            </button>
            <button type="button" className="m2-btn m2-ghost" onClick={onClose}>
              Close
            </button>
          </div>
          {extractions.isSuccess && !newest ? <p className="m2-prov">This system has no stored extraction that can be analysed.</p> : null}
          {!allowed ? <p className="m2-prov">Starting a run needs the analyse permission.</p> : null}
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
  if (page.isError) return <ErrorFrame onRetry={() => void page.refetch()}>The runs could not be read.</ErrorFrame>;
  if (rows.length === 0) {
    return <EmptyFrame>{(page.data?.versions.length ?? 0) === 0 ? "No run has been made yet. Extract a system and run an analysis to see it here." : "No run matches these filters."}</EmptyFrame>;
  }
  return (
    <div className="m2-frame">
      <table className="m2-tbl" data-testid="runs-table">
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col">System</th>
            <th scope="col">Label</th>
            <th scope="col">Trigger</th>
            <th scope="col" className="m2-r">
              Records
            </th>
            <th scope="col" className="m2-r">
              Rules
            </th>
            <th scope="col" className="m2-r" title="Lowest and highest shown score over the objects the run scored">
              Score
            </th>
            <th scope="col">Status</th>
            <th scope="col" className="m2-r">
              Took
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
                  <V2Link href={`/v2/run/${v.id}`} className="m2-rowlink">
                    {formatDate(v.run_at, "datetime")}
                  </V2Link>
                </th>
                <td>{sys ?? <Dash />}</td>
                <td>
                  {v.metadata?.baseline ? "Baseline" : null}
                  {v.metadata?.baseline && v.label ? ", " : null}
                  {v.label ?? (v.metadata?.baseline ? null : <Dash />)}
                  {v.metadata?.archived ? <span className="m2-meta"> archived</span> : null}
                </td>
                <td>{kindWord(m?.kind ?? v.metadata?.trigger)}</td>
                <td className="m2-r">{m?.records_checked == null ? <Dash /> : int(m.records_checked)}</td>
                <td className="m2-r">{rules == null ? <Dash /> : int(rules)}</td>
                <td className="m2-r">{range ? `${f1(range[0])} to ${f1(range[1])}` : <Dash />}</td>
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
  if (jobs.isError) return <ErrorFrame onRetry={() => void jobs.refetch()}>The jobs could not be read.</ErrorFrame>;
  if (rows.length === 0) return <EmptyFrame>{jobs.jobs.length === 0 ? "No job has run in the last 7 days." : "No job matches these filters."}</EmptyFrame>;
  const sys = (j: Job) => land.data?.systems.find((s) => s.id === j.system_id)?.name;
  return (
    <div className="m2-frame">
      <table className="m2-tbl" data-testid="jobs-table">
        <thead>
          <tr>
            <th scope="col">Job</th>
            <th scope="col">Object</th>
            <th scope="col">System</th>
            <th scope="col">State</th>
            <th scope="col" className="m2-r">
              Progress
            </th>
            <th scope="col">Started</th>
            <th scope="col" className="m2-r">
              Took
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
 * `/v2/runs`: the timeline at full width, the table of runs (or of jobs, every kind, each opening the job inspector),
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
  const [status, setStatus] = useState("all");
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
    return qs ? `/v2/runs?${qs}` : "/v2/runs";
  };

  return (
    <>
      <PageTitle sub={scope?.name}>Runs</PageTitle>
      <p className="m2-finding">
        {latest ? `The last ${runs.length} ${runs.length === 1 ? "run" : "runs"}, the latest on ${formatDate(latest.run_at, "date")}.` : "No run has finished for this scope yet."}
        {baseline ? ` The baseline is ${formatDate(baseline.run_at, "date")}.` : ""}
      </p>

      <section className="m2-sec" aria-label="Timeline">
        {timeline.isLoading ? (
          <Skeleton width="100%" height={100} />
        ) : timeline.isError ? (
          <ErrorFrame onRetry={() => void timeline.refetch()}>The timeline could not be read.</ErrorFrame>
        ) : runs.length === 0 ? (
          <EmptyFrame>Runs appear here once a system has been extracted and analysed.</EmptyFrame>
        ) : (
          <div className="m2-frame" style={{ padding: "var(--m2-s3) var(--m2-s4)" }}>
            <RunTimelineChart runs={runs} selectedId={latest?.id ?? null} onPick={(id) => router.push(v2Href(`/v2/run/${id}`))} label="Runs on a date axis, choose one to open it" fallbackWidth={900} />
          </div>
        )}
      </section>

      <div className="m2-cta" style={{ justifyContent: "space-between" }}>
        <nav className="m2-views" aria-label="Runs views">
          <V2Link href={link("runs")} aria-current={view === "runs" ? "page" : undefined}>
            Runs
          </V2Link>
          <V2Link href={link("jobs")} aria-current={view === "jobs" ? "page" : undefined}>
            {`Jobs${jobs.active.length ? ` (${jobs.active.length} running)` : ""}`}
          </V2Link>
        </nav>
        <button type="button" className="m2-btn m2-strong" aria-expanded={starting} disabled={!session.can("analyse")} title={session.can("analyse") ? undefined : "Starting a run needs the analyse permission"} onClick={() => setStarting((v) => !v)}>
          Start a run
        </button>
      </div>
      {starting ? <StartRun onClose={() => setStarting(false)} /> : null}

      {view === "runs" ? (
        <section className="m2-sec" aria-label="Runs" style={{ marginTop: "var(--m2-s4)" }}>
          <div className="m2-filters">
            <label>
              System
              <select className="m2-sel" value={system} onChange={(e) => setSystem(e.target.value)}>
                <option value="all">All systems</option>
                {(land.data?.systems ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Status
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
              Show archived runs
            </label>
          </div>
          <RunsTable systemFilter={system} statusFilter={status} showArchived={archived} />
        </section>
      ) : (
        <section className="m2-sec" aria-label="Jobs" style={{ marginTop: "var(--m2-s4)" }}>
          <div className="m2-filters">
            <label>
              Kind
              <select className="m2-sel" value={kind} onChange={(e) => setKind(e.target.value)}>
                <option value="all">Every kind</option>
                {KINDS.map((k) => (
                  <option key={k} value={k}>
                    {JOB_KIND_LABEL[k]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              State
              <select className="m2-sel" value={jobStatus} onChange={(e) => setJobStatus(e.target.value)}>
                <option value="all">Any state</option>
                <option value="active">Queued or running</option>
                <option value="completed">Done</option>
                <option value="failed">Failed</option>
              </select>
            </label>
          </div>
          <JobsTable kind={kind} status={jobStatus} />
        </section>
      )}
    </>
  );
}
