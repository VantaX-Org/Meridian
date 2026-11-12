"use client";

import type { ReactNode } from "react";

/** Determinate when `value` (0 to 100) is given, else indeterminate. The text below says what is happening, never only a bar. */
export function ProgressBar({ value, label, text }: { value?: number; label: string; text?: ReactNode }) {
  const det = typeof value === "number";
  const pct = det ? Math.max(0, Math.min(100, value)) : undefined;
  return (
    <div className="nx-progress">
      <div className="nx-bar" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
        {det ? <div className="nx-bar-fill" style={{ width: `${pct}%` }} /> : <div className="nx-bar-indeterminate" />}
      </div>
      {text ? <div className="nx-progress-text">{text}</div> : null}
    </div>
  );
}
