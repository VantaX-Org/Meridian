"use client";

/**
 * Inline progress banner for a running analysis or extraction, shown on the
 * run / extraction detail pages. Mirrors the job tray's progress bar styling.
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
    <div
      className="flex flex-col gap-2 rounded-[var(--m-radius-sheet)] border p-4"
      style={{ borderColor: "var(--m-border)" }}
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="m-text-body font-medium" style={{ color: "var(--m-ink)" }}>
          {label}
          {step ? (
            <span style={{ color: "var(--m-ink-3)" }}> | {step}</span>
          ) : null}
        </span>
        <span className="m-numeric m-text-meta" style={{ color: "var(--m-ink-3)" }}>
          {pct}%
        </span>
      </div>
      <div
        role="progressbar"
        aria-label={`${label} progress`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        style={{ height: 4, borderRadius: "var(--m-radius-pill)", background: "var(--m-sheet-sunken)", overflow: "hidden" }}
      >
        <div className="m-motion-width" style={{ width: `${pct}%`, height: "100%", background: "var(--m-accent)" }} />
      </div>
      {detail ? (
        <div className="m-text-meta" style={{ color: "var(--m-ink-3)" }}>
          {detail}
        </div>
      ) : null}
    </div>
  );
}
