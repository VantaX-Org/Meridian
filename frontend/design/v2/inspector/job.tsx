"use client";

import { useQueryClient } from "@tanstack/react-query";
import { formatDate } from "@/lib/format";
import type { Job } from "@/types/jobs";
import { retryJobById } from "@/lib/api/v2/runs";
import { useV2Session } from "@/lib/v2/hooks";
import { JOB_KIND_LABEL, JOB_STATUS_LABEL, jobObject, jobSeconds, retryPermission } from "@/lib/v2/jobs";
import { useLandscape } from "@/lib/v2/queries";
import { useV2Job } from "@/lib/v2/runs-queries";
import { int } from "@/lib/v2/score";
import { duration } from "../shell/StatusStrip";
import { Actions, Fact, Facts, InspectorFrame } from "../Inspector";
import { VerdictMark } from "../marks";
import { EmptyFrame, ErrorFrame, Mono, Skeleton, V2Link } from "../parts";
import { ResultFrame, useOutcome } from "./shared";
import { t as tr } from "@/lib/v2/i18n";

const STAGE_WORD: Record<string, string> = { get queued() { return tr("Waiting"); }, get running() { return tr("Running"); }, get done() { return tr("Done"); }, get failed() { return tr("Failed"); }, get skipped() { return tr("Skipped"); } };

/** Mirrors api/routes/jobs.py _retryable: an extraction needs its recorded start request, an analysis its run. */
export function canRetry(job: Job): boolean {
  if (job.kind === "analysis") return Boolean(job.version_id);
  if (job.kind === "extraction") return Boolean(job.retry) && Boolean(job.system_id);
  return ["config_load", "process_discovery"].includes(job.kind) && Boolean(job.system_id);
}

function StatusWord({ job }: { job: Job }) {
  const verdict = job.status === "completed" ? "go" : job.status === "failed" ? "no-go" : null;
  return (
    <span className="m2-v">
      {verdict ? <VerdictMark verdict={verdict} /> : null}
      {JOB_STATUS_LABEL[job.status]}
    </span>
  );
}

function TableProgress({ job }: { job: Job }) {
  if (job.tables.length === 0) return null;
  return (
    <>
      <h3>{tr("Tables")}</h3>
      <table className="m2-jtbl" data-testid="job-tables">
        <thead>
          <tr>
            <th scope="col">{tr("Table")}</th>
            <th scope="col">{tr("State")}</th>
            <th scope="col" className="m2-r">
              {tr("Rows")}
            </th>
          </tr>
        </thead>
        <tbody>
          {job.tables.map((t) => (
            <tr key={t.table}>
              <td>
                <Mono>{t.table}</Mono>
              </td>
              <td>{t.status === "live" ? tr("Read") : t.status === "failed" ? tr("Failed") : t.status === "running" ? tr("Reading") : t.status === "queued" ? tr("Waiting") : t.status.replace(/_/g, " ")}</td>
              <td className="m2-r">{t.expected ? tr("{rows} of {expected}", { rows: int(t.rows), expected: int(t.expected) }) : int(t.rows)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function JobBody({ job }: { job: Job }) {
  const qc = useQueryClient();
  const session = useV2Session();
  const landscape = useLandscape(null).data;
  const { outcome, pending, run } = useOutcome();
  const system = landscape?.systems.find((s) => s.id === job.system_id);
  const secs = jobSeconds(job);
  const allowed = session.can(retryPermission(job.kind));
  const retryable = canRetry(job);
  const live = job.status === "queued" || job.status === "running";
  return (
    <>
      <Facts>
        <Fact label={tr("Job")}>{JOB_KIND_LABEL[job.kind]}</Fact>
        <Fact label={tr("Object")}>{jobObject(job)}</Fact>
        {system ? <Fact label={tr("System")}>{system.name}</Fact> : null}
        <Fact label={tr("Started")}>{formatDate(job.started_at * 1000, "datetime")}</Fact>
        <Fact label={live ? tr("Running for") : tr("Took")}>{secs == null ? "—" : duration(secs)}</Fact>
        {job.rows_total > 0 || job.rows_done > 0 ? <Fact label={tr("Rows")}>{job.rows_total ? tr("{rows_done} of {rows_total}", { rows_done: int(job.rows_done), rows_total: int(job.rows_total) }) : int(job.rows_done)}</Fact> : null}
        {job.version_id && job.status === "completed" ? (
          <Fact label={tr("Run")}>
            <V2Link href={`/run/${job.version_id}`}>{tr("Open the run")}</V2Link>
          </Fact>
        ) : null}
        <Fact label={tr("Job id")}>
          <Mono>{job.id}</Mono>
        </Fact>
      </Facts>

      {live ? (
        <>
          <div className="m2-prog" role="progressbar" aria-label={tr("{JOB_KIND_LABEL} progress", { JOB_KIND_LABEL: JOB_KIND_LABEL[job.kind] })} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(job.percent)} style={{ marginTop: 12 }}>
            <span style={{ width: `${Math.min(100, Math.max(0, job.percent))}%` }} />
          </div>
          {job.message ? <p className="m2-prov">{job.message}</p> : null}
        </>
      ) : null}

      <h3>{tr("Stages")}</h3>
      <ol className="m2-stages" data-testid="job-stages">
        {job.stages.map((s) => (
          <li key={s.id} data-status={s.status}>
            {s.status === "done" ? <VerdictMark verdict="go" /> : s.status === "failed" ? <VerdictMark verdict="no-go" /> : null}
            <span>{s.label}</span>
            <span className="m2-meta">{STAGE_WORD[s.status] ?? s.status}</span>
          </li>
        ))}
      </ol>

      <TableProgress job={job} />

      {job.status === "failed" ? (
        <>
          <h3>{tr("What went wrong")}</h3>
          <div className="m2-errbox" role="alert" data-testid="job-error">
            <p>{job.error ?? tr("The job failed and did not say why.")}</p>
          </div>
        </>
      ) : null}

      {job.status === "failed" ? (
        <Actions>
          <button
            type="button"
            className="m2-btn m2-strong"
            disabled={!allowed || !retryable || pending !== null}
            onClick={() =>
              void run("retry", async () => {
                const r = await retryJobById(job.id);
                void qc.invalidateQueries({ queryKey: ["v2"] });
                void qc.invalidateQueries({ queryKey: ["jobs"] });
                return { tone: "ok", title: tr("Started again"), detail: tr("A new job runs the same request."), job: r.job_id ?? null };
              })
            }
          >
            {pending === "retry" ? tr("Retrying…") : tr("Retry")}
          </button>
          {system ? (
            <V2Link href={`/s/${system.id}`} className="m2-btn">
              {tr("Open")}{" "}{system.name}
            </V2Link>
          ) : null}
        </Actions>
      ) : null}
      {job.status === "failed" && !allowed ? <p className="m2-prov">{tr("Retry needs the {permission} permission on this system.", { permission: retryPermission(job.kind).replace(/_/g, " ") })}</p> : null}
      {job.status === "failed" && allowed && !retryable ? <p className="m2-prov">{tr("This kind of job cannot be retried; start it again from its page.")}</p> : null}
      {outcome ? <ResultFrame outcome={outcome} /> : null}
    </>
  );
}

/** `?open=job:<id>`: stages, per-table progress, the error and Retry. */
export function JobInspector({ id, onClose }: { id: string; onClose: () => void }) {
  const { job, loading, missing, refetch } = useV2Job(id);
  const title = job ? `${JOB_KIND_LABEL[job.kind]}, ${jobObject(job)}` : tr("Job");
  return (
    <InspectorFrame title={title} status={job ? <StatusWordLine job={job} /> : loading ? <Skeleton width={120} height={12} /> : tr("Not found")} onClose={onClose}>
      {job ? (
        <JobBody job={job} />
      ) : loading ? (
        <Skeleton width="100%" height={120} />
      ) : missing ? (
        <EmptyFrame>{tr("This job is no longer in the registry. Jobs are kept for 7 days, and the 200 most recent.")}</EmptyFrame>
      ) : (
        <ErrorFrame onRetry={() => void refetch()}>{tr("The job could not be read.")}</ErrorFrame>
      )}
    </InspectorFrame>
  );
}

function StatusWordLine({ job }: { job: Job }) {
  const live = job.status === "queued" || job.status === "running";
  return (
    <>
      <StatusWord job={job} />
      {live ? ` ${Math.round(job.percent)}%` : ""}
    </>
  );
}
