import type { ReactNode } from "react";
import { clsx } from "clsx";

export type PillTone = "neutral" | "go" | "at-risk" | "no-go" | "info";

const DOT: ReadonlySet<PillTone> = new Set(["go", "at-risk", "no-go"]);

export function Pill({ tone = "neutral", children }: { tone?: PillTone; children: ReactNode }) {
  return (
    <span className={clsx("m-pill", `m-pill-${tone}`)}>
      {DOT.has(tone) && <span className="m-pill-dot" aria-hidden="true" />}
      {children}
    </span>
  );
}
