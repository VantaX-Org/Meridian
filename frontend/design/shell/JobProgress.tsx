"use client";

import { useEffect, useState } from "react";
import type { Job } from "../../types/jobs";
import { etaSeconds, formatDuration, isStalled, updatedAgo } from "../../lib/job-timing";
import { Mono } from "../primitives/Mono";
import { Pill } from "../primitives/Pill";

const RULE_MSG = /^(.*· rule \d+\/\d+ · )(\S+)$/;

/** Live detail for a running job: message with the rule id in mono, elapsed, ETA, freshness, stall warning. */
export function JobProgress({ job }: { job: Job }) {
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now() / 1000), 1000);
    return () => clearInterval(t);
  }, []);
  const m = RULE_MSG.exec(job.message);
  const eta = etaSeconds(job.percent, job.started_at, now);
  const stalled = isStalled(job.status, job.updated_at, now);
  return (
    <div className="mt-1 flex flex-col gap-1 text-[12px]" style={{ color: "var(--m-ink-3)" }}>
      {job.message && (
        <span>
          {m ? (
            <>
              {m[1]}
              <Mono>{m[2]}</Mono>
            </>
          ) : (
            job.message
          )}
        </span>
      )}
      <span style={{ fontVariantNumeric: "tabular-nums" }}>
        {formatDuration(now - job.started_at)} elapsed
        {eta !== null && ` · about ${formatDuration(eta)} left`} · {updatedAgo(job.updated_at, now)}
      </span>
      {stalled && (
        <span>
          <Pill tone="at-risk">No update for {Math.floor((now - job.updated_at) / 60)} min — may be stalled</Pill>
        </span>
      )}
    </div>
  );
}
