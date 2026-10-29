"use client";

import { useJobStream, useJobs } from "@/hooks/use-jobs";

export interface JobLineProps {
  /** 0 to 100, or null when nothing is running. */
  percent: number | null;
  label?: string;
}

/**
 * A 2px line under the bar. It is empty and silent until a job runs; then it fills and a one-line label sits at its
 * right edge. Never a tray, never a modal. Announced politely for assistive technology.
 */
export function JobLine({ percent, label }: JobLineProps) {
  const on = percent !== null;
  return (
    <div className={`m2-job${on ? " m2-on" : ""}`} role="status" aria-live="polite" data-testid="job-line">
      <div className="m2-job-bar" style={{ width: `${on ? Math.max(0, Math.min(100, percent)) : 0}%` }} />
      <div className="m2-job-lbl">{on ? `${label ?? "Working"} ${Math.round(percent)}%` : ""}</div>
    </div>
  );
}

/** The job line fed by the jobs stream (the existing SSE hook), averaged over the running jobs. */
export function LiveJobLine() {
  useJobStream();
  const { active } = useJobs();
  if (active.length === 0) return <JobLine percent={null} />;
  const percent = Math.min(100, Math.max(0, Math.round(active.reduce((n, j) => n + (j.percent ?? 0), 0) / active.length)));
  return <JobLine percent={percent} label={active.length === 1 ? active[0].label : `${active.length} jobs`} />;
}
