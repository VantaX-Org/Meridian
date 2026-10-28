"use client";

import { useEffect } from "react";
import { useParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Card, ProgressFill } from "@/design";
import { TERMINAL_EVENTS, streamRunEvents } from "@/lib/api/run-events";
import { queryKeys } from "@/lib/query-keys";

/**
 * Follows a run's server-sent progress (GET /events/{versionId}) and refetches the run's status the moment the server
 * says something, instead of waiting for the next poll. The page's poll stays on as the fallback: with no stream
 * (the server publishes none, a proxy buffers it, the connection drops) nothing changes but the delay.
 */
export function useRunEvents(versionId: string | undefined): void {
  const qc = useQueryClient();
  useEffect(() => {
    if (!versionId) return;
    return streamRunEvents(
      versionId,
      (e) => {
        // A finished run changes more than its status: its scores, findings and steps.
        void qc.invalidateQueries({ queryKey: TERMINAL_EVENTS.has(e.event) ? queryKeys.run(versionId) : [...queryKeys.run(versionId), "status"] });
      },
      () => {},
    );
  }, [qc, versionId]);
}

/**
 * Inline progress banner for a running analysis or extraction, shown on the
 * run / extraction detail pages. A sheet like any other card, with the job
 * tray's accent fill on a sunken track.
 */
export function RunProgressBanner({
  percent,
  label,
  step,
  detail,
  versionId,
}: {
  /** 0..100. */
  percent: number;
  /** e.g. "Analysis running" / "Extraction running". */
  label: string;
  /** Current step / stage description. */
  step?: string;
  /** Secondary line, e.g. rows processed / ETA. */
  detail?: string;
  /** The run to follow live; on a /runs/[versionId] page it is that run. */
  versionId?: string;
}) {
  const params = useParams<{ versionId?: string }>();
  useRunEvents(versionId ?? params?.versionId);
  const pct = Math.min(100, Math.max(0, Math.round(percent)));
  return (
    <Card padding="sm">
      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-3">
          <span className="m-text-body font-medium m-ink">
            {label}
            {step ? <span className="m-ink-3"> | {step}</span> : null}
          </span>
          <span className="m-numeric m-text-meta m-ink-3">{pct}%</span>
        </div>
        <div
          role="progressbar"
          aria-label={`${label} progress`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          className="h-1 overflow-hidden rounded-[var(--m-radius-pill)] [background:var(--m-sheet-sunken)]"
        >
          <ProgressFill value={pct} animate />
        </div>
        {detail ? <div className="m-text-meta m-ink-3">{detail}</div> : null}
      </div>
    </Card>
  );
}
