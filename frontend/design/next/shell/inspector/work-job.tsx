"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { cancelJob } from "@/lib/api/v2/run-ops";
import { retryJobById } from "@/lib/api/v2/runs";
import { formatDate } from "@/lib/format";
import type { Job } from "@/types/jobs";
import { useOpenItem, useV2Session } from "@/lib/v2/hooks";
import { JOB_KIND_LABEL, JOB_STATUS_LABEL, jobObject, jobSeconds, readPathLabel, retryPermission } from "@/lib/v2/jobs";
import { useLandscape } from "@/lib/v2/queries";
import { useV2Job } from "@/lib/v2/runs-queries";
import { int } from "@/lib/v2/score";
import { describeTable } from "@/lib/v2/sap-fields";
import { t } from "@/lib/v2/i18n";
import { V2Link } from "@/design/v2/parts";
import { Button, Chip, Code, Confirm, EmptyState, ErrorState, ProgressBar, Skeleton } from "../../kit";
import { Actions, Fact, Facts, InspectorFrame, type BodyProps } from "./frame";
import { Dash, Note, OutcomeLine, Sec, duration, isAuthError, useOutcome } from "./work-common";

const STAGE_WORD: Record<string, string> = { get queued() { return t("Waiting"); }, get running() { return t("Running"); }, get done() { return t("Done"); }, get failed() { return t("Failed"); }, get skipped() { return t("Skipped"); } };

/** Mirrors api/routes/jobs.py _retryable: an extraction needs its recorded start request, an analysis its run. */
export function canRetry(job: Job): boolean {
  if (job.kind === "analysis") return Boolean(job.version_id);
  if (job.kind === "extraction") return Boolean(job.retry) && Boolean(job.system_id);
  return ["config_load", "process_discovery"].includes(job.kind) && Boolean(job.system_id);
}

function StatusWord({ job }: { job: Job }) {
  const tone = job.status === "completed" ? "good" : job.status === "failed" ? "bad" : "neutral";
  return <Chip tone={tone}>{JOB_STATUS_LABEL[job.status]}</Chip>;
}

function TableProgress({ job }: { job: Job }) {
  if (job.tables.length === 0) return null;
  const withPath = job.tables.some((x) => x.path);
  return (
    <Sec title={t("Tables")}>
      <div className="nx-wk-scroll">
        <table className="nx-wk-table" data-testid="job-tables">
          <thead>
            <tr>
              <th scope="col">{t("Table")}</th>
              <th scope="col">{t("State")}</th>
              {withPath ? <th scope="col">{t("Read through")}</th> : null}
              <th scope="col" className="nx-wk-num">{t("Rows")}</th>
            </tr>
          </thead>
          <tbody>
            {job.tables.map((x) => (
              <tr key={x.table}>
                <td><Code code={x.table} text={describeTable(x.table) ?? undefined} /></td>
                <td>{x.status === "live" ? t("Read") : x.status === "failed" ? t("Failed") : x.status === "running" ? t("Reading") : x.status === "queued" ? t("Waiting") : x.status.replace(/_/g, " ")}</td>
                {withPath ? <td data-testid="job-table-path">{readPathLabel(x)}</td> : null}
                <td className="nx-wk-num">{x.expected ? t("{rows} of {expected}", { rows: int(x.rows), expected: int(x.expected) }) : int(x.rows)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Sec>
  );
}

function JobBody({ job }: { job: Job }) {
  const qc = useQueryClient();
  const session = useV2Session();
  const landscape = useLandscape(null).data;
  const { outcome, pending, run } = useOutcome();
  const { hrefFor } = useOpenItem();
  const [confirming, setConfirming] = useState(false);
  const system = landscape?.systems.find((s) => s.id === job.system_id);
  const secs = jobSeconds(job);
  const allowed = session.can(retryPermission(job.kind));
  const retryable = canRetry(job);
  const live = job.status === "queued" || job.status === "running";
  const canCancel = session.can("manage_settings");
  // A refused sign-in is not fixed by retrying: the credentials change first, then the editor retries this job.
  const signIn = job.status === "failed" && system && isAuthError(job.error) && session.can("manage_systems") ? system : null;
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["v2"] });
    void qc.invalidateQueries({ queryKey: ["jobs"] });
  };
  return (
    <>
      <Facts>
        <Fact label={t("Job")}>{JOB_KIND_LABEL[job.kind]}</Fact>
        <Fact label={t("Object")}>{jobObject(job)}</Fact>
        {system ? (
          <Fact label={t("System")}>
            <V2Link href={`/s/${system.id}`} data-testid="job-open-system">{system.name}</V2Link>
          </Fact>
        ) : null}
        {job.status === "queued" ? <Fact label={t("Queue")}>{job.queue_position != null ? t("Position {n} in the queue", { n: job.queue_position }) : <Dash why={t("The server did not give this job's place in the queue")} />}</Fact> : null}
        <Fact label={t("Started")}>{formatDate(job.started_at * 1000, "datetime")}</Fact>
        <Fact label={live ? t("Running for") : t("Took")}>{secs == null ? "—" : duration(secs)}</Fact>
        {job.rows_total > 0 || job.rows_done > 0 ? <Fact label={t("Rows")}>{job.rows_total ? t("{rows_done} of {rows_total}", { rows_done: int(job.rows_done), rows_total: int(job.rows_total) }) : int(job.rows_done)}</Fact> : null}
        {job.version_id && job.status === "completed" ? (
          <Fact label={t("Run")}>
            <V2Link href={`/run/${job.version_id}`}>{t("Open the run")}</V2Link>
          </Fact>
        ) : null}
        <Fact label={t("Job id")}><span className="nx-wk-mono">{job.id}</span></Fact>
      </Facts>

      {live ? <ProgressBar value={Math.round(job.percent)} label={t("{JOB_KIND_LABEL} progress", { JOB_KIND_LABEL: JOB_KIND_LABEL[job.kind] })} text={job.message || undefined} /> : null}

      <Sec title={t("Stages")}>
        <ol className="nx-ib-list" data-testid="job-stages">
          {job.stages.map((s) => (
            <li key={s.id} className="nx-ib-row" data-status={s.status}>
              <span>{s.label}</span>
              <Chip tone={s.status === "done" ? "good" : s.status === "failed" ? "bad" : "neutral"}>{STAGE_WORD[s.status] ?? s.status}</Chip>
            </li>
          ))}
        </ol>
      </Sec>

      <TableProgress job={job} />

      {job.status === "failed" ? (
        <Sec title={t("What went wrong")}>
          <div className="nx-wk-alert" role="alert" data-testid="job-error">
            <p>{job.error ?? t("The job failed and did not say why.")}</p>
          </div>
        </Sec>
      ) : null}

      {live ? (
        <Actions>
          <Button disabled={!canCancel} reason={t("Cancelling a job needs the manage settings permission")} loading={pending === "cancel"} loadingLabel={t("Cancelling…")} onClick={() => setConfirming(true)} data-testid="job-cancel">
            {t("Cancel job")}
          </Button>
        </Actions>
      ) : null}
      <Confirm
        open={confirming}
        title={t("Cancel this job?")}
        consequence={t("The job stops where it is. Work it already saved stays, and an analysis run is marked failed.")}
        confirmLabel={t("Yes, cancel the job")}
        danger
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false);
          void run("cancel", async () => {
            const r = await cancelJob(job.id);
            refresh();
            return r.tasks_revoked === false
              ? { tone: "info", title: t("Cancelled"), detail: t("The worker could not be told to stop, so it may run on until its next check. The job counts as cancelled.") }
              : { tone: "ok", title: t("Cancelled") };
          });
        }}
      />

      {job.status === "failed" ? (
        <Actions>
          {signIn ? (
            <V2Link href={hrefFor({ kind: "connection", id: `${signIn.id}:${job.id}` })} data-testid="job-connection-settings">
              {t("Connection settings")}
            </V2Link>
          ) : null}
          <Button
            variant={signIn ? "secondary" : "primary"}
            disabled={!allowed || !retryable || pending !== null}
            loading={pending === "retry"}
            loadingLabel={t("Retrying…")}
            onClick={() =>
              void run("retry", async () => {
                const r = await retryJobById(job.id);
                refresh();
                return { tone: "ok", title: t("Started again"), detail: t("A new job runs the same request."), job: r.job_id ?? null };
              })
            }
          >
            {t("Retry")}
          </Button>
          {system ? <V2Link href={`/s/${system.id}`}>{t("Open")}{" "}{system.name}</V2Link> : null}
        </Actions>
      ) : null}
      {job.status === "failed" && !allowed ? <Note>{t("Retry needs the {permission} permission on this system.", { permission: retryPermission(job.kind).replace(/_/g, " ") })}</Note> : null}
      {job.status === "failed" && allowed && !retryable ? <Note>{t("This kind of job cannot be retried; start it again from its page.")}</Note> : null}
      {outcome ? <OutcomeLine outcome={outcome} /> : null}
    </>
  );
}

/** `?open=job:<id>`: stages, per-table progress, the error, Cancel and Retry. */
export function JobBodyView({ id, onClose }: BodyProps) {
  const { job, loading, missing, refetch } = useV2Job(id);
  const title = job ? `${JOB_KIND_LABEL[job.kind]}, ${jobObject(job)}` : t("Job");
  const live = job ? job.status === "queued" || job.status === "running" : false;
  const status = job ? <><StatusWord job={job} />{live ? ` ${Math.round(job.percent)}%` : ""}</> : loading ? null : t("Not found");
  return (
    <InspectorFrame title={title} status={status} onClose={onClose}>
      {job ? (
        <JobBody job={job} />
      ) : loading ? (
        <Skeleton lines={5} label={t("Job")} />
      ) : missing ? (
        <EmptyState heading={t("Not found")}>{t("This job is no longer in the registry. Jobs are kept for 7 days, and the 200 most recent.")}</EmptyState>
      ) : (
        <ErrorState sentence={t("The job could not be read.")} onRetry={() => void refetch()} />
      )}
    </InspectorFrame>
  );
}
