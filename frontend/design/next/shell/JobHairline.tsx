"use client";

import { V2Link } from "@/design/v2/parts";
import { t } from "@/lib/v2/i18n";
import { useOpenItem } from "@/lib/v2/hooks";
import { firstSentence, JOB_KIND_LABEL, jobDoing, jobObject, openFailures } from "@/lib/v2/jobs";
import { useV2Jobs } from "@/lib/v2/runs-queries";

/**
 * A thin line under the header with one sentence about the newest active job (what it does, its percent and its
 * latest message), a link to its inspector. A queued job says its place in the queue in place of a percent. Below
 * it, the newest failed job that nobody has dealt with, in one line with a link to open it. Nothing when idle.
 */
export function JobHairline() {
  const { hrefFor } = useOpenItem();
  const { active, jobs } = useV2Jobs();
  const job = [...active].sort((a, b) => b.updated_at - a.updated_at)[0];
  const failed = openFailures(jobs)[0];
  if (!job && !failed) return null;
  const pct = job ? Math.max(0, Math.min(100, Math.round(job.percent ?? 0))) : 0;
  const more = active.length - 1;
  const doing = job ? `${jobDoing(job)}${more > 0 ? t(" and {more} more", { more }) : ""}` : "";
  const text = !job ? "" : job.status === "queued" && job.queue_position != null ? t("{label}, queued, position {n}", { label: job.label, n: job.queue_position }) : `${doing} ${pct}%`;
  const why = failed ? firstSentence(failed.error) : "";
  return (
    <div className="nx-hairline" role="status" data-testid="job-hairline">
      {job ? (
        <>
          <div className="nx-hairline-bar" role="progressbar" aria-label={job.label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
            <div className="nx-hairline-fill" style={{ width: `${pct}%` }} />
          </div>
          <p className="nx-hairline-text" data-testid="job-line">
            <V2Link href={hrefFor({ kind: "job", id: job.id })}>{text}</V2Link>
            {job.message && job.status !== "queued" ? <span>{`: ${job.message}`}</span> : null}
          </p>
        </>
      ) : null}
      {failed ? (
        <p className="nx-hairline-text" data-testid="status-failure">
          {t("{JOB_KIND_LABEL} of {jobObject} failed{value}", { JOB_KIND_LABEL: JOB_KIND_LABEL[failed.kind], jobObject: jobObject(failed), value: why ? `: ${why}` : "" })}{" "}
          <V2Link href={hrefFor({ kind: "job", id: failed.id })}>{t("Open")}</V2Link>
        </p>
      ) : null}
    </div>
  );
}
