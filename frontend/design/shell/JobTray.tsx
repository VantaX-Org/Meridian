"use client";

import { useEffect, useState } from "react";
import { Briefcase } from "lucide-react";
import { useJobs, useJobStream } from "../../hooks/use-jobs";
import { onJobTrayOpen } from "../../lib/job-tray-bus";
import { IconButton } from "../primitives/IconButton";
import { Badge } from "../primitives/Badge";
import { Drawer } from "../primitives/Drawer";
import { JobProgress } from "./JobProgress";

export function JobTray() {
  useJobStream();
  const { jobs, active } = useJobs();
  const [open, setOpen] = useState(false);
  useEffect(() => onJobTrayOpen(() => setOpen(true)), []);

  return (
    <>
      <div style={{ position: "relative" }}>
        <IconButton aria-label="Jobs" onClick={() => setOpen(true)}>
          <Briefcase size={18} />
        </IconButton>
        {active.length > 0 && (
          <span style={{ position: "absolute", top: -4, right: -4 }}>
            <Badge count={active.length} />
          </span>
        )}
      </div>
      <Drawer open={open} onOpenChange={setOpen} title="Jobs">
        {jobs.length === 0 && <p style={{ color: "var(--m-ink-3)" }}>No jobs yet.</p>}
        <ul className="flex flex-col gap-2">
          {jobs.map((job) => (
            <li key={job.id} className="text-[13px]" style={{ color: "var(--m-ink)" }}>
              {job.label} — {job.status} ({job.percent}%)
              {job.status === "running" && <JobProgress job={job} />}
            </li>
          ))}
        </ul>
      </Drawer>
    </>
  );
}
