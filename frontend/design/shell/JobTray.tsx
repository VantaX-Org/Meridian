"use client";

import { useEffect, useState } from "react";
import { useJobs, useJobStream } from "../../hooks/use-jobs";
import { onJobTrayOpen } from "../../lib/job-tray-bus";
import { IconButton } from "../primitives/IconButton";
import { Drawer } from "../primitives/Drawer";
import { JobProgress } from "./JobProgress";
import { IconActivity } from "../icons";

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
        {jobs.length === 0 && <p className="m-text-body" style={{ color: "var(--m-ink-3)" }}>No jobs yet.</p>}
        <ul className="flex flex-col gap-4">
          {jobs.map((job) => (
            <li key={job.id} className="flex flex-col gap-1">
              <div className="flex items-baseline justify-between gap-2">
                <span className="m-text-body font-medium" style={{ color: "var(--m-ink)" }}>{job.label}</span>
                <span className="m-numeric m-text-meta" style={{ color: "var(--m-ink-3)" }}>{job.percent}%</span>
              </div>
              {job.status !== "running" && <span className="m-text-meta" style={{ color: "var(--m-ink-3)" }}>{job.status}</span>}
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
          ))}
        </ul>
      </Drawer>
    </>
  );
}
