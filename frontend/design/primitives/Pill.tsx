import type { ReactNode } from "react";
import { clsx } from "clsx";

export type PillTone = "neutral" | "go" | "at-risk" | "no-go" | "info";
export type PillVariant = "soft" | "solid";

const DOT: ReadonlySet<PillTone> = new Set(["go", "at-risk", "no-go"]);

/**
 * `variant="solid"` is for the row's primary verdict (Readiness column, FindingDrawer header): solid fill, `-on` text, no dot.
 * Never mix soft and solid in one column. `ember` is for hero zones only and ignores `tone` and `variant`.
 */
export function Pill({
  tone = "neutral",
  variant = "soft",
  ember = false,
  children,
}: {
  tone?: PillTone;
  variant?: PillVariant;
  ember?: boolean;
  children: ReactNode;
}) {
  const solid = variant === "solid" && !ember;
  const cls = ember ? "m-pill-ember" : solid ? `m-pill-solid-${tone}` : `m-pill-${tone}`;
  return (
    <span className={clsx("m-pill", cls)}>
      {(ember || (!solid && DOT.has(tone))) && <span className="m-pill-dot" aria-hidden="true" />}
      {children}
    </span>
  );
}
