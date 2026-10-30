"use client";

import { useJobStream, useJobs } from "@/hooks/use-jobs";
import type { Job } from "@/types/jobs";
import { useOpenItem } from "@/lib/v2/hooks";
import { jobDoing } from "@/lib/v2/jobs";
import { useV2Jobs } from "@/lib/v2/runs-queries";
import { V2Link } from "../parts";
import { t } from "@/lib/v2/i18n";

export interface JobLineProps {
  /** 0 to 100, or null when nothing is running. */
  percent: number | null;
  label?: string;
  /** Where the label goes when clicked: the job inspector (`?open=job:<id>`). */
  href?: string;
  /** Step 10: a queued job's place in the queue; the line says it in place of a percent. */
  queuePosition?: number | null;
}

/**
 * A 2px line under the bar. It is empty and silent until a job runs; then it fills and a one-line label sits at its
 * right edge, a link to the job's inspector. Never a tray, never a modal. Announced politely for assistive technology.
 */
export function JobLine({ percent, label, href, queuePosition }: JobLineProps) {
  const on = percent !== null;
  const text = on ? (queuePosition != null ? t("{label}, queued, position {n}", { label: label ?? t("Working"), n: queuePosition }) : `${label ?? t("Working")} ${Math.round(percent)}%`) : "";
  return (
    <div className={`m2-job${on ? " m2-on" : ""}`} role="status" aria-live="polite" data-testid="job-line">
      <div className="m2-job-bar" style={{ width: `${on ? Math.max(0, Math.min(100, percent)) : 0}%` }} />
      <div className="m2-job-lbl">
        {on && href ? (
          <V2Link href={href} data-testid="job-line-link">
            {text}
          </V2Link>
        ) : (
          text
        )}
      </div>
    </div>
  );
}

/** The line for the newest running job: its kind and object, its percent, and a link that opens it. */
function LineFor({ active }: { active: readonly Job[] }) {
  const { hrefFor } = useOpenItem();
  if (active.length === 0) return <JobLine percent={null} />;
  const job = [...active].sort((a, b) => b.updated_at - a.updated_at)[0];
  const more = active.length - 1;
  const percent = Math.min(100, Math.max(0, Math.round(job.percent ?? 0)));
  return <JobLine percent={percent} label={`${jobDoing(job)}${more > 0 ? t(" and {more} more", { more }) : ""}`} href={hrefFor({ kind: "job", id: job.id })} queuePosition={job.status === "queued" ? (job.queue_position ?? null) : null} />;
}

/** The job line fed by the jobs stream (the existing SSE hook). */
export function LiveJobLine() {
  useJobStream();
  const { active } = useJobs();
  return <LineFor active={active} />;
}

/** Fixture mode: the same line from the fixture jobs (a running one appears with `?job=running`). */
export function FixtureJobLine() {
  const { active } = useV2Jobs();
  return <LineFor active={active} />;
}
