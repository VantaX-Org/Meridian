// frontend/app/(app)/objects/_freshness.tsx
import { Pill, type PillTone } from "@/design";
import type { Freshness } from "@/lib/api/v1/objects";

/** One word and one tone per freshness state: fresh is go, stale at risk, failed no-go, the rest neutral. */
export const FRESHNESS: Record<Freshness, { label: string; tone: PillTone }> = {
  fresh: { label: "Fresh", tone: "go" },
  due: { label: "Due", tone: "neutral" },
  stale: { label: "Stale", tone: "at-risk" },
  failed: { label: "Failed", tone: "no-go" },
  paused: { label: "Paused", tone: "neutral" },
  manual: { label: "Manual", tone: "neutral" },
};

/** The freshness pill. A value outside the set (an older backend) renders neutral with its own text. */
export function FreshnessPill({ value }: { value: Freshness | string }) {
  const known = FRESHNESS[value as Freshness];
  return <Pill tone={known?.tone ?? "neutral"}>{known?.label ?? value}</Pill>;
}
