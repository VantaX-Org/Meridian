"use client";

import { Chip, Text, type ChipTone } from "@/components/aurora";
import type { Job, JobStage, JobTable } from "@/types/jobs";

export const KIND_LABEL: Record<Job["kind"], string> = {
  extraction: "Download", config_sync: "Config sync", analysis: "Analysis", upload: "Import",
};
export const STATUS_TONE: Record<Job["status"], ChipTone> = {
  queued: "neutral", running: "info", completed: "success", failed: "danger",
};
const TABLE_TONE: Record<string, ChipTone> = {
  queued: "neutral", running: "info", live: "success", failed: "danger",
};

export function fmtInt(n: number): string {
  return new Intl.NumberFormat("en-GB").format(n);
}

export function fmtDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

/** Elapsed, rows per second and a remaining-time estimate from the job's own rate. */
export function jobTiming(job: Job, nowSec: number) {
  const end = job.finished_at ?? nowSec;
  const elapsed = Math.max(0, end - job.started_at);
  const rate = elapsed > 0 && job.rows_done > 0 ? job.rows_done / elapsed : null;
  const remaining =
    job.status === "running" && job.percent > 0 && job.percent < 100
      ? (elapsed / job.percent) * (100 - job.percent)
      : null;
  return { elapsed, rate, remaining };
}

export function StageStepper({ stages }: { stages: JobStage[] }) {
  return (
    <ol className="aurora-stepper" aria-label="Stages">
      {stages.map((s) => (
        <li key={s.id} className="aurora-stepper__step" data-status={s.status}>
          <span className="aurora-stepper__dot" aria-hidden />
          <span className="aurora-stepper__label">{s.label}</span>
        </li>
      ))}
    </ol>
  );
}

export function ProgressBar({ percent, live, label }: { percent: number; live?: boolean; label?: string }) {
  return (
    <div className="aurora-progress" data-live={live ? "true" : undefined} role="progressbar"
         aria-valuenow={Math.round(percent)} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <span style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} />
    </div>
  );
}

/** One row per SAP table the download reads, with its own bar against SAP's row count. */
export function TableProgress({ tables }: { tables: JobTable[] }) {
  if (!tables.length) return null;
  return (
    <table className="aurora-table-progress">
      <thead>
        <tr><th>Table</th><th>Status</th><th className="aurora-number">Rows</th><th>Read</th></tr>
      </thead>
      <tbody>
        {tables.map((t) => {
          const pct = t.expected ? (t.rows / t.expected) * 100 : t.status === "live" ? 100 : 0;
          return (
            <tr key={t.table} data-status={t.status}>
              <td className="aurora-number">{t.table}</td>
              <td><Chip tone={TABLE_TONE[t.status] ?? "warning"}>{t.status.replace(/_/g, " ")}</Chip></td>
              <td className="aurora-number">
                {fmtInt(t.rows)}{t.expected !== null ? <span className="aurora-table-progress__expected"> / {fmtInt(t.expected)}</span> : null}
              </td>
              <td><ProgressBar percent={pct} live={t.status === "running"} label={`${t.table} read`} /></td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export interface JobCardProps {
  job: Job;
  systemName?: string;
  nowSec: number;
  /** Full detail (stage stepper, every table) — used in the drawer and for in-flight jobs. */
  expanded?: boolean;
  onOpen?: () => void;
}

export function JobCard({ job, systemName, nowSec, expanded = false, onOpen }: JobCardProps) {
  const { elapsed, rate, remaining } = jobTiming(job, nowSec);
  const live = job.status === "running";
  return (
    <article className="aurora-job-card" data-status={job.status}>
      <header className="aurora-job-card__head">
        <div className="aurora-job-card__title">
          <Text variant="text-micro" tone="muted" className="aurora-job-card__kind">{KIND_LABEL[job.kind]}</Text>
          <Text variant="text-lead" as="h3">{job.label}</Text>
          {systemName ? <Text variant="text-small" tone="tertiary">{systemName}</Text> : null}
        </div>
        <div className="aurora-job-card__meta">
          <Chip tone={STATUS_TONE[job.status]}>{job.status}</Chip>
          <Text variant="text-small" tone="muted" numeric>{fmtDuration(elapsed)}</Text>
          {onOpen ? (
            <button type="button" className="aurora-job-card__open aurora-focus-ring" onClick={onOpen}>Details</button>
          ) : null}
        </div>
      </header>
      {expanded ? <StageStepper stages={job.stages} /> : null}
      <div className="aurora-job-card__bar">
        <ProgressBar percent={job.percent} live={live} label={`${job.label} progress`} />
        <Text variant="text-small" numeric className="aurora-job-card__pct">{Math.round(job.percent)}%</Text>
      </div>
      <div className="aurora-job-card__facts">
        <Text variant="text-small" tone="secondary">{job.message || "—"}</Text>
        <Text variant="text-small" tone="muted" numeric>
          {job.rows_total ? `${fmtInt(job.rows_done)} / ${fmtInt(job.rows_total)} rows` : job.rows_done ? `${fmtInt(job.rows_done)} rows` : ""}
          {rate ? ` · ${fmtInt(Math.round(rate))}/s` : ""}
          {remaining !== null ? ` · ~${fmtDuration(remaining)} left` : ""}
        </Text>
      </div>
      {job.error ? <Text variant="text-small" tone="danger" className="aurora-job-card__error">{job.error}</Text> : null}
      {expanded ? <TableProgress tables={job.tables} /> : null}
    </article>
  );
}
