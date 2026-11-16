"use client";

import { NxLink } from "@/design/next/kit";
import { t } from "@/lib/v2/i18n";
import { useOpenItem } from "@/lib/v2/hooks";
import { useV2Jobs } from "@/lib/v2/runs-queries";

/**
 * A thin line under the header with one sentence about the newest active job, a link to its inspector. A queued job
 * says its place in the queue in place of a percent. Nothing when idle.
 */
export function JobHairline() {
  const { hrefFor } = useOpenItem();
  const job = [...useV2Jobs().active].sort((a, b) => b.updated_at - a.updated_at)[0];
  if (!job) return null;
  const pct = Math.max(0, Math.min(100, Math.round(job.percent ?? 0)));
  const text = job.status === "queued" && job.queue_position != null ? t("{label}, queued, position {n}", { label: job.label, n: job.queue_position }) : job.message || job.label;
  return (
    <div className="nx-hairline" role="status" data-testid="job-hairline">
      <div className="nx-hairline-bar" role="progressbar" aria-label={job.label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
        <div className="nx-hairline-fill" style={{ width: `${pct}%` }} />
      </div>
      <p className="nx-hairline-text">
        <NxLink href={hrefFor({ kind: "job", id: job.id })}>{text}</NxLink>
      </p>
    </div>
  );
}
