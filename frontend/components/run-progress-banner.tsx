"use client";

import { Card, ProgressFill } from "@/design";

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
}: {
  /** 0..100. */
  percent: number;
  /** e.g. "Analysis running" / "Extraction running". */
  label: string;
  /** Current step / stage description. */
  step?: string;
  /** Secondary line, e.g. rows processed / ETA. */
  detail?: string;
}) {
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
