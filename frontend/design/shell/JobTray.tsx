"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useJobs, useJobStream } from "../../hooks/use-jobs";
import { onJobTrayOpen } from "../../lib/job-tray-bus";
import type { Job } from "../../types/jobs";
import { IconButton } from "../primitives/IconButton";
import { Drawer } from "../primitives/Drawer";
import { EmptyState } from "../primitives/EmptyState";
import { Status } from "../primitives/Status";
import { JobProgress } from "./JobProgress";
import { RetryJobButton } from "./RetryJob";
import { IconActivity } from "../icons";

/** Where a job's result lives, when it carries an id: its run, its discovery run or its system. */
export function jobHref(job: Job): string | null {
  if (job.kind === "process_discovery" && job.run_ids?.[0]) return `/process/runs/${job.run_ids[0]}`;
  if (job.version_id) return `/runs/${job.version_id}`;
  if (job.system_id) return `/systems/${job.system_id}`;
  return null;
}

/**
 * The jobs drawer: every job with its lifecycle, progress, the live detail while it runs and, when it failed,
 * the error it failed with. "Open" goes to the run or system the job belongs to; "Retry" starts a failed job again
 * when its kind can be retried and the user may start it.
 */
export function JobTray() {
  useJobStream();
  const { jobs, active } = useJobs();
  const [open, setOpen] = useState(false);
  useEffect(() => onJobTrayOpen(() => setOpen(true)), []);

  return (
    <>
      <div style={{ position: "relative" }}>
        <IconButton aria-label={active.length > 0 ? `Jobs, ${active.length} running` : "Jobs"} onClick={() => setOpen(true)}>
          <IconActivity size={16} />
        </IconButton>
        {active.length > 0 && (
          <span
            aria-hidden="true"
            className="absolute rounded-full"
            style={{ top: 4, right: 4, width: 6, height: 6, background: "var(--m-accent)" }}
          />
        )}
      </div>
      <Drawer open={open} onOpenChange={setOpen} title="Jobs">
        {jobs.length === 0 && (
          <EmptyState
            variant="inline"
            title="No jobs yet"
            detail="Extractions, analysis runs and imports show here while they run"
            action={<Link href="/admin/jobs" onClick={() => setOpen(false)} className="m-text-body font-medium m-ink-accent-ink hover:underline">Job history</Link>}
          />
        )}
        <ul className="flex flex-col gap-4">
          {jobs.map((job) => {
            const href = jobHref(job);
            return (
              <li key={job.id} className="flex flex-col gap-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="m-text-body font-medium m-ink">{job.label}</span>
                  <span className="m-numeric m-text-meta m-ink-3">{job.percent}%</span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Status kind="lifecycle" value={job.status} />
                  {href && (
                    <Link href={href} onClick={() => setOpen(false)} className="m-text-meta font-medium m-ink-accent-ink hover:underline" aria-label={`Open ${job.label}`}>
                      Open
                    </Link>
                  )}
                  <RetryJobButton job={job} />
                </div>
                {job.status === "failed" && job.error && (
                  <p className="m-text-meta m-ink-2" data-testid="job-error">{job.error}</p>
                )}
                <div
                  role="progressbar"
                  aria-label={`${job.label} progress`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={job.percent}
                  style={{ height: 4, borderRadius: "var(--m-radius-pill)", background: "var(--m-sheet-sunken)", overflow: "hidden" }}
                >
                  <div style={{ width: `${Math.min(100, Math.max(0, job.percent))}%`, height: "100%", background: "var(--m-accent)" }} />
                </div>
                {job.status === "running" && <JobProgress job={job} />}
              </li>
            );
          })}
        </ul>
      </Drawer>
    </>
  );
}
