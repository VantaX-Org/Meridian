"use client";

import { useV2Jobs } from "@/lib/v2/runs-queries";

/** A thin line under the header with one sentence about the running job. Nothing when idle. */
export function JobHairline() {
  const job = useV2Jobs().active[0];
  if (!job) return null;
  const pct = Math.max(0, Math.min(100, Math.round(job.percent)));
  return (
    <div className="nx-hairline" role="status" data-testid="job-hairline">
      <div className="nx-hairline-bar" role="progressbar" aria-label={job.label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
        <div className="nx-hairline-fill" style={{ width: `${pct}%` }} />
      </div>
      <p className="nx-hairline-text">{job.message || job.label}</p>
    </div>
  );
}
