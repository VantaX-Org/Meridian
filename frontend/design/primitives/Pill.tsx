import type { ReactNode } from "react";
import { clsx } from "clsx";
import type { Verdict } from "./Status";

/**
 * Tone of a free label (a tag, a count, a state outside the status vocabulary). When the label IS a verdict,
 * a severity or a lifecycle stage, render `<Status>` instead: it owns the label.
 */
export type PillTone = "neutral" | "info" | Verdict;
export type PillVariant = "soft" | "solid";

const DOT: ReadonlySet<PillTone> = new Set(["go", "at-risk", "no-go"]);

/**
 * `variant="solid"` is for the row's primary verdict (Readiness column, FindingDrawer header): solid fill, `-on` text, no dot.
 * Never mix soft and solid in one column.
 */
export function Pill({
  tone = "neutral",
  variant = "soft",
  children,
}: {
  tone?: PillTone;
  variant?: PillVariant;
  children: ReactNode;
}) {
  const solid = variant === "solid";
  const cls = solid ? `m-pill-solid-${tone}` : `m-pill-${tone}`;
  return (
    <span className={clsx("m-pill", cls)}>
      {!solid && DOT.has(tone) && <span className="m-pill-dot" aria-hidden="true" />}
      {children}
    </span>
  );
}
