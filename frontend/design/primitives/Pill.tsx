import type { ReactNode } from "react";
import { mColor } from "../tokens";

export type PillTone = "neutral" | "go" | "at-risk" | "no-go";

const TONE_COLOR: Record<PillTone, string> = {
  neutral: mColor.ink2,
  go: mColor.pass,
  "at-risk": mColor.medium,
  "no-go": mColor.critical,
};

export function Pill({ tone = "neutral", children }: { tone?: PillTone; children: ReactNode }) {
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 text-[12px] leading-4 rounded-full border"
      style={{ color: TONE_COLOR[tone], borderColor: TONE_COLOR[tone], background: "var(--m-sheet-raised)" }}
    >
      {children}
    </span>
  );
}
