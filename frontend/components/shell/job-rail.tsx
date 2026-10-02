"use client";

import Link from "next/link";
import { useState } from "react";
import { Activity } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Chip } from "@/components/aurora";
import { useJobs } from "@/hooks/use-jobs";
import type { Job } from "@/types/jobs";

const KIND_LABEL: Record<Job["kind"], string> = {
  extraction: "Download", config_sync: "Config sync", analysis: "Analysis", upload: "Import",
};
const TONE: Record<Job["status"], "neutral" | "info" | "success" | "danger"> = {
  queued: "neutral", running: "info", completed: "success", failed: "danger",
};

function age(ts: number): string {
  const s = Math.max(0, Math.round(Date.now() / 1000 - ts));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  return `${Math.round(s / 3600)}h`;
}

/** Top-bar pulse: how many jobs are in flight and how far along, with the recent list on click. */
export function JobRail() {
  const { jobs, active } = useJobs();
  const [open, setOpen] = useState(false);
  const percent = active.length
    ? Math.round(active.reduce((a, j) => a + j.percent, 0) / active.length)
    : null;
  const recent = jobs.slice(0, 8);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            className="aurora-job-rail aurora-focus-ring"
            data-live={active.length ? "true" : undefined}
            aria-label={active.length ? `${active.length} jobs running` : "Jobs"}
            title="Jobs"
          />
        }
      >
        <Activity size={14} aria-hidden />
        <span className="aurora-job-rail__count aurora-number">{active.length}</span>
        {percent !== null ? (
          <span className="aurora-job-rail__bar" role="progressbar" aria-valuenow={percent} aria-valuemin={0}
                aria-valuemax={100}>
            <span style={{ width: `${percent}%` }} />
          </span>
        ) : null}
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} className="aurora-job-rail__panel" data-theme="dark">
        <div className="aurora-job-rail__head">
          <span>Jobs</span>
          <Link href="/data?tab=runs" onClick={() => setOpen(false)}>All runs →</Link>
        </div>
        {recent.length === 0 ? (
          <p className="aurora-job-rail__empty">Nothing has run yet.</p>
        ) : (
          <ul>
            {recent.map((j) => (
              <li key={j.id}>
                <div className="aurora-job-rail__row">
                  <span className="aurora-job-rail__label" title={j.label}>
                    <span className="aurora-job-rail__kind">{KIND_LABEL[j.kind]}</span> {j.label}
                  </span>
                  <Chip tone={TONE[j.status]}>{j.status}</Chip>
                  <span className="aurora-job-rail__age aurora-number">{age(j.updated_at)}</span>
                </div>
                {j.status === "running" || j.status === "queued" ? (
                  <div className="aurora-job-rail__progress" title={j.message}>
                    <span style={{ width: `${j.percent}%` }} />
                  </div>
                ) : null}
                {j.error ? <p className="aurora-job-rail__error">{j.error}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
