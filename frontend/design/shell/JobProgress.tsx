"use client";

import { useEffect, useState } from "react";
import type { Job } from "../../types/jobs";
import { etaSeconds, formatDuration, isStalled, updatedAgo } from "../../lib/job-timing";
import { Mono } from "../primitives/Mono";
import { Pill } from "../primitives/Pill";

// The worker joins message parts with a middle dot (U+00B7); split on it so each part renders as its own element.
const SEP = / \u00B7 /;
const RULE_PART = /^rule \d+\/\d+$/;

/** Live detail for a running job: message with the rule id in mono, elapsed, ETA, freshness, stall warning. */
export function JobProgress({ job }: { job: Job }) {
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now() / 1000), 1000);
    return () => clearInterval(t);
  }, []);
  const parts = job.message.split(SEP);
  const ruleId = parts.length > 2 && RULE_PART.test(parts[parts.length - 2]) ? parts[parts.length - 1] : null;
  const shown = ruleId ? parts.slice(0, -1) : parts;
  const eta = etaSeconds(job.percent, job.started_at, now);
  const stalled = isStalled(job.status, job.updated_at, now);
  return (
    <div className="mt-1 flex flex-col gap-1 text-[12px]" style={{ color: "var(--m-ink-3)" }}>
      {job.message && (
        <span className="flex flex-wrap gap-x-2">
          {shown.map((part, i) => (
            <span key={i}>{part}</span>
          ))}
          {ruleId && <Mono>{ruleId}</Mono>}
        </span>
      )}
      <span className="flex flex-wrap gap-x-2" style={{ fontVariantNumeric: "tabular-nums" }}>
        <span>{formatDuration(now - job.started_at)} elapsed</span>
        {eta !== null && <span>about {formatDuration(eta)} left</span>}
        <span>{updatedAgo(job.updated_at, now)}</span>
      </span>
      {stalled && (
        <span>
          <Pill tone="at-risk">No update for {Math.floor((now - job.updated_at) / 60)} min — may be stalled</Pill>
        </span>
      )}
    </div>
  );
}
